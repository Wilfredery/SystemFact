/**
 * @jest-environment jsdom
 *
 * Board 07 (Reportes) UI alignment tests — odd/tasks/uiux-alignment.md S36–S40.
 *
 * S36 (D1, 07a): the table adopts the wireframe's nine columns —
 * Producto | P. costo | P. salida | Cant. vendida | Cant. comprada |
 * Ventas | Costo | Margen | Margen % — and the table no longer carries
 * Inversión/Capital (they live in the S37 KPI tiles).
 *
 * S37 (D2, 07a): the KPIs render as the wireframe's five tiles
 * (Inversión, Entrada, Salida, Capital en mercancía, Margen de ganancia + %)
 * instead of one summary line.
 *
 * S38 (D3, 07b): the comparativa table renders PER-PERIOD rows (Período
 * actual / Período anterior) with Variación (RD$) and Variación (%) columns
 * and a TOTAL row — the per-day detail stays available through the CSV
 * export (FIN-5 semantics unchanged in the use case).
 *
 * S39 (D4/D5, 07b): four KPI tiles (Ventas período actual/anterior,
 * Variación RD$, Variación %) and the per-board footer strip.
 *
 * S40 (F1): no raw-palette classes remain in the reportes UI files this
 * board covers (panels + selector + route page) — every color routes through
 * the system.md tokens.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { PanelRentabilidad } from "../rentabilidad-panel";
import { PanelFinanciero } from "../financiero-panel";
import type { Pagina } from "../../domain/reporte-resultado";
import type { RentabilidadFila } from "../../domain/margen";
import { calcularFilaRentabilidad, resumirRentabilidad } from "../../domain/margen";
import type { ComparativaFila } from "../../domain/financiero";
import type { SeleccionReporte } from "../url";
import { REPORTE_ID } from "../../domain/catalogo";

const seleccionRentabilidad: SeleccionReporte = {
  reporte: REPORTE_ID.RENTABILIDAD,
  filtro: { desde: "2026-04-01", hasta: "2026-04-30" },
};

const seleccionComparativa: SeleccionReporte = {
  reporte: REPORTE_ID.COMPARATIVA,
  filtro: { desde: "2026-07-01", hasta: "2026-07-31" },
};

// JD round 1 (JD-A-002): the row is DERIVED from the domain (never hand-typed), so the
// suite discriminates the real formulas — the costo bug this round caught is what a
// hand-written fixture hides.
const FILA: RentabilidadFila = calcularFilaRentabilidad({
  productoId: 1,
  nombre: "Arroz",
  costoPromedio: "60.00",
  unidadesVendidas: "50.000",
  ventasBrutas: "4600.00",
  unidadesCompradas: "50.000",
  inversion: "2600.00",
  stockActual: "5.000",
});

function paginaRentabilidad(): Pagina<RentabilidadFila> {
  return {
    filas: [FILA],
    total: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    // The summary map the screen consumes is the label→string projection (EXP-2).
    resumen: { ...resumirRentabilidad([FILA]) },
  };
}

const FILA_COMPARATIVA: ComparativaFila = { fechaSD: "2026-07-15", monto: "2200.00" };

function paginaComparativa(): Pagina<ComparativaFila> {
  return {
    filas: [FILA_COMPARATIVA],
    total: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    resumen: {
      montoActual: "4500.00",
      montoAnterior: "3900.00",
      variacionMonto: "600.00",
      variacionPorciento: "15.38",
    },
  };
}

describe("Board 07 — 07a wireframe columns (S36)", () => {
  it("renders the wireframe's nine columns with Ventas and Costo", () => {
    render(<PanelRentabilidad pagina={paginaRentabilidad()} seleccion={seleccionRentabilidad} />);
    for (const encabezado of [
      "Producto",
      "P. costo",
      "P. salida",
      "Cant. vendida",
      "Cant. comprada",
      "Ventas",
      "Costo",
      "Margen",
      "Margen %",
    ]) {
      expect(screen.getByRole("columnheader", { name: encabezado })).toBeInTheDocument();
    }
    const fila = screen.getByText("Arroz").closest("tr");
    expect(fila?.textContent).toContain("4,600.00"); // ventas
    expect(fila?.textContent).toContain("3,000.00"); // costo de lo vendido (the term the margen subtracts)
  });

  it("keeps Inversión and Capital OUT of the table (they live in the tiles)", () => {
    render(<PanelRentabilidad pagina={paginaRentabilidad()} seleccion={seleccionRentabilidad} />);
    expect(screen.queryByRole("columnheader", { name: "Inversión" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Capital" })).toBeNull();
  });
});

describe("Board 07 — 07a KPI tiles (S37)", () => {
  it("renders the five wireframe tiles from the page-independent summary", () => {
    render(<PanelRentabilidad pagina={paginaRentabilidad()} seleccion={seleccionRentabilidad} />);
    expect(screen.getByText("Inversión")).toBeInTheDocument();
    expect(screen.getByText("Entrada (unid.)")).toBeInTheDocument();
    expect(screen.getByText("Salida (unid.)")).toBeInTheDocument();
    expect(screen.getByText("Capital en mercancía")).toBeInTheDocument();
    expect(screen.getByText("Margen de ganancia")).toBeInTheDocument();
    const tileMargen = screen.getByText("Margen de ganancia").closest("div");
    expect(tileMargen?.textContent).toContain("RD$ 1,600.00");
    expect(tileMargen?.textContent).toContain("34.78%");
  });
});

describe("Board 07 — 07b per-period rows (S38)", () => {
  it("renders the two period rows with variación columns and the TOTAL row", () => {
    render(
      <PanelFinanciero
        reporte="comparativa"
        pagina={paginaComparativa()}
        seleccion={seleccionComparativa}
      />,
    );
    for (const encabezado of ["Período", "Ventas (RD$)", "Variación (RD$)", "Variación (%)"]) {
      expect(screen.getByRole("columnheader", { name: encabezado })).toBeInTheDocument();
    }
    expect(screen.getByText("Período actual")).toBeInTheDocument();
    expect(screen.getByText("Período anterior")).toBeInTheDocument();
    const filaActual = screen.getByText("Período actual").closest("tr");
    expect(filaActual?.textContent).toContain("+RD$ 600.00");
    expect(filaActual?.textContent).toContain("+15.38%");
    // The per-day detail rows are NOT rendered (S38): the CSV keeps them.
    expect(screen.queryByText("2026-07-15")).toBeNull();
  });

  it("renders the four wireframe KPI tiles and the footer strip (S39)", () => {
    render(
      <PanelFinanciero
        reporte="comparativa"
        pagina={paginaComparativa()}
        seleccion={seleccionComparativa}
      />,
    );
    expect(screen.getByText("Ventas período actual")).toBeInTheDocument();
    expect(screen.getByText("Ventas período anterior")).toBeInTheDocument();
    expect(screen.getByTestId("r07b-kpi-variacion")).toHaveTextContent("+RD$ 600.00");
    expect(screen.getByText("Filtrado por empresa y sucursal activa")).toBeInTheDocument();
  });
});

describe("Board 07 — footer strip on 07a (S39)", () => {
  it("renders the filter strip", () => {
    render(<PanelRentabilidad pagina={paginaRentabilidad()} seleccion={seleccionRentabilidad} />);
    expect(screen.getByText("Filtrado por período y sucursal")).toBeInTheDocument();
  });
});

describe("Board 07 — F0 token retrofit (S40)", () => {
  const RAIZ = path.join(__dirname, "..");
  const FILES = [
    "rentabilidad-panel.tsx",
    "financiero-panel.tsx",
    "report-selector.tsx",
    path.join(RAIZ, "../../../app/(app)/reportes/page.tsx"),
  ];
  const RAW_PALETTE =
    /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;
  const ARBITRARY_COLOR = /(?:text|bg|border|ring)-\[(?:#|rgb|hsl|oklch)[^\]]+\]/g;

  it("keeps zero raw-palette classes in the reportes files this board covers", () => {
    const ofensas = FILES.flatMap((archivo) => {
      const fuente = readFileSync(path.isAbsolute(archivo) ? archivo : path.join(RAIZ, archivo), "utf8");
      const coincidencias = [...(fuente.match(RAW_PALETTE) ?? []), ...(fuente.match(ARBITRARY_COLOR) ?? [])];
      return coincidencias.map((c) => `${archivo}: ${c}`);
    });
    expect(ofensas).toEqual([]);
  });
});
