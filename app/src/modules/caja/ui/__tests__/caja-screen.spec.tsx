/**
 * @jest-environment jsdom
 *
 * RTL — the /caja client island (S7): wireframe 06a + 06b (S1/S2).
 *
 * The island is a pure projection of the two DTOs the server page hands it. These specs pin the
 * wireframe labels and values (06a KPIs, the método table, the corte panel), the 06b section kept
 * SEPARATE with its anchor link, the deliberately disabled "Cerrar caja" (S3), the PDF link (S4),
 * the negative Diferencia styling and the empty-day zeros — plus the absence of any date control
 * (S1: today only).
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CierreDiarioDto, ResumenDiaDto } from "../../http/shared";
import { CajaScreen } from "../CajaScreen";
import { formatearMonto } from "@/shared/ui/format";

const CIERRE: CierreDiarioDto = {
  fechaSD: "2026-11-11",
  totalFacturado: "2000.00",
  totalCobrado: "1500.50",
  efectivoEsperado: "1000.25",
  diferencia: "-499.50",
  metodos: [{ metodo: "EFECTIVO", cobros: "1500.50", cantidad: 3 }],
  corte: { cobros: "1500.50", devoluciones: "500.25" },
};

const RESUMEN: ResumenDiaDto = {
  fechaSD: "2026-11-11",
  ventas: "2000.00",
  costoVendido: "1348.00",
  margenBruto: "652.00",
  margenPorcentaje: "32.6",
};

const CIERRE_VACIO: CierreDiarioDto = {
  fechaSD: "2026-11-11",
  totalFacturado: "0.00",
  totalCobrado: "0.00",
  efectivoEsperado: "0.00",
  diferencia: "0.00",
  metodos: [],
  corte: { cobros: "0.00", devoluciones: "0.00" },
};

const RESUMEN_VACIO: ResumenDiaDto = {
  fechaSD: "2026-11-11",
  ventas: "0.00",
  costoVendido: "0.00",
  margenBruto: "0.00",
  margenPorcentaje: "0.0",
};

function renderizar(
  cierre: CierreDiarioDto = CIERRE,
  resumen: ResumenDiaDto = RESUMEN,
) {
  return render(
    <CajaScreen
      cierre={cierre}
      resumen={resumen}
      empresaNombre="Empresa Demo"
      sucursalNombre="Sucursal Central"
    />,
  );
}

afterEach(cleanup);

describe("06a Cierre diario de caja — header (S1)", () => {
  it("renders the title, today's SD date and the read-only tenant names", () => {
    renderizar();

    expect(screen.getByText("Cierre diario de caja")).toBeInTheDocument();
    expect(screen.getByTestId("caja-fecha")).toHaveTextContent("11/11/2026");
    expect(screen.getByTestId("caja-tenant")).toHaveTextContent("Empresa Demo");
    expect(screen.getByTestId("caja-tenant")).toHaveTextContent("Sucursal Central");
  });

  it("renders NO date control: the close is always today (S1)", () => {
    const { container } = renderizar();

    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.queryByLabelText(/fecha/i)).not.toBeInTheDocument();
  });

  it("renders the informational note verbatim", () => {
    renderizar();

    expect(
      screen.getByText("Cierre informativo: no bloquea las operaciones del día."),
    ).toBeInTheDocument();
  });
});

describe("06a KPIs (S1)", () => {
  it("renders the four KPI labels with the DTO figures", () => {
    renderizar();

    expect(screen.getByText("Total facturado")).toBeInTheDocument();
    expect(screen.getByText("Total cobrado")).toBeInTheDocument();
    expect(screen.getByText("Efectivo esperado")).toBeInTheDocument();
    expect(screen.getByText("Diferencia")).toBeInTheDocument();

    expect(screen.getByTestId("caja-kpi-total-facturado")).toHaveTextContent(
      formatearMonto("2000.00"),
    );
    expect(screen.getByTestId("caja-kpi-total-cobrado")).toHaveTextContent(
      formatearMonto("1500.50"),
    );
    expect(screen.getByTestId("caja-kpi-efectivo-esperado")).toHaveTextContent(
      formatearMonto("1000.25"),
    );
  });

  it("shows Diferencia with its sign and styles a negative one distinctly", () => {
    renderizar();

    const diferencia = screen.getByTestId("caja-kpi-diferencia");
    expect(diferencia).toHaveTextContent("-RD$ 499.50");
    expect(diferencia.className).toMatch(/text-red/);
  });

  it("does not apply the negative styling to a non-negative Diferencia", () => {
    renderizar({ ...CIERRE, diferencia: "120.00" });

    const diferencia = screen.getByTestId("caja-kpi-diferencia");
    expect(diferencia).toHaveTextContent("RD$ 120.00");
    expect(diferencia.className).not.toMatch(/text-red/);
  });
});

describe("06a método table (S1/S6)", () => {
  it("renders the Método | Ventas | Cobros | Total header", () => {
    renderizar();

    const tabla = screen.getByTestId("caja-tabla-metodos");
    for (const columna of ["Método", "Ventas", "Cobros", "Total"]) {
      expect(within(tabla).getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }
  });

  it("shows each method's Cobros with an em dash under Ventas (no per-method sales source)", () => {
    renderizar();

    const fila = screen.getByTestId("caja-metodo-EFECTIVO");
    const celdas = within(fila).getAllByRole("cell");
    expect(celdas[0]).toHaveTextContent("Efectivo");
    expect(celdas[1]).toHaveTextContent("—");
    expect(celdas[2]).toHaveTextContent(formatearMonto("1500.50"));
  });

  it("closes with a Total row: day-level Ventas, summed Cobros, day-level Total", () => {
    renderizar();

    const total = screen.getByTestId("caja-total-fila");
    const celdas = within(total).getAllByRole("cell");
    expect(celdas[0]).toHaveTextContent("Total");
    expect(celdas[1]).toHaveTextContent(formatearMonto("2000.00"));
    expect(celdas[2]).toHaveTextContent(formatearMonto("1500.50"));
    expect(celdas[3]).toHaveTextContent(formatearMonto("2000.00"));
  });
});

describe("06a Corte de caja panel (S1)", () => {
  it("renders the formula verbatim and the three values", () => {
    renderizar();

    const panel = screen.getByTestId("caja-corte");
    expect(panel).toHaveTextContent("Corte de caja");
    expect(panel).toHaveTextContent(
      "Efectivo esperado = Cobros en efectivo − Devoluciones en efectivo",
    );
    expect(within(panel).getByTestId("caja-corte-cobros")).toHaveTextContent(
      formatearMonto("1500.50"),
    );
    expect(within(panel).getByTestId("caja-corte-devoluciones")).toHaveTextContent(
      formatearMonto("500.25"),
    );
    expect(within(panel).getByTestId("caja-corte-esperado")).toHaveTextContent(
      formatearMonto("1000.25"),
    );
  });
});

describe("06a actions (S3/S4)", () => {
  it("renders Cerrar caja DISABLED with the Próximamente hint", () => {
    renderizar();

    const cerrar = screen.getByRole("button", { name: "Cerrar caja" });
    expect(cerrar).toBeDisabled();
    expect(screen.getByTestId("caja-cerrar-hint")).toHaveTextContent("Próximamente");
  });

  it("renders Exportar PDF as a link to the PDF route", () => {
    renderizar();

    const exportar = screen.getByRole("link", { name: "Exportar PDF" });
    expect(exportar).toHaveAttribute("href", "/api/caja/cierre-pdf");
  });
});

describe("06b Resumen del día (S2)", () => {
  it("renders its own heading and the four sales/cost/margin KPIs", () => {
    renderizar();

    expect(
      screen.getByText("Resumen del día — Ventas, costo y margen bruto"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ventas del día")).toBeInTheDocument();
    expect(screen.getByText("Costo de lo vendido")).toBeInTheDocument();
    expect(screen.getByText("Margen bruto")).toBeInTheDocument();
    expect(screen.getByText("Margen %")).toBeInTheDocument();

    expect(screen.getByTestId("caja-resumen-ventas")).toHaveTextContent(
      formatearMonto("2000.00"),
    );
    expect(screen.getByTestId("caja-resumen-costo")).toHaveTextContent(
      formatearMonto("1348.00"),
    );
    expect(screen.getByTestId("caja-resumen-margen")).toHaveTextContent(
      formatearMonto("652.00"),
    );
    expect(screen.getByTestId("caja-resumen-margen-pct")).toHaveTextContent("32.6%");
  });

  it("keeps the close KPIs OUT of the summary section (no duplication)", () => {
    renderizar();

    const resumen = screen.getByTestId("caja-resumen");
    expect(within(resumen).queryByText("Total facturado")).not.toBeInTheDocument();
    expect(within(resumen).queryByText("Total cobrado")).not.toBeInTheDocument();
    expect(within(resumen).queryByText("Efectivo esperado")).not.toBeInTheDocument();
    expect(within(resumen).queryByText("Diferencia")).not.toBeInTheDocument();
  });

  it("links back to the close with the wireframe anchor label", () => {
    renderizar();

    const enlace = screen.getByRole("link", { name: "Ver cierre de caja →" });
    expect(enlace).toHaveAttribute("href", "#caja-cierre");
  });
});

describe("empty day (S7)", () => {
  it("renders RD$ 0.00 / 0.0% states like the wireframe", () => {
    renderizar(CIERRE_VACIO, RESUMEN_VACIO);

    expect(screen.getByTestId("caja-kpi-total-facturado")).toHaveTextContent("RD$ 0.00");
    expect(screen.getByTestId("caja-kpi-total-cobrado")).toHaveTextContent("RD$ 0.00");
    expect(screen.getByTestId("caja-kpi-efectivo-esperado")).toHaveTextContent("RD$ 0.00");
    expect(screen.getByTestId("caja-kpi-diferencia")).toHaveTextContent("RD$ 0.00");
    expect(screen.getByTestId("caja-corte-esperado")).toHaveTextContent("RD$ 0.00");
    expect(screen.getByTestId("caja-resumen-ventas")).toHaveTextContent("RD$ 0.00");
    expect(screen.getByTestId("caja-resumen-margen-pct")).toHaveTextContent("0.0%");
  });

  it("renders no method row but still the Total row", () => {
    renderizar(CIERRE_VACIO, RESUMEN_VACIO);

    expect(screen.queryByTestId("caja-metodo-EFECTIVO")).not.toBeInTheDocument();
    expect(screen.getByTestId("caja-total-fila")).toBeInTheDocument();
  });
});
