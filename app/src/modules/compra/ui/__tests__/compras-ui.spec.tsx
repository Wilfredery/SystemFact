/**
 * @jest-environment jsdom
 *
 * Compras list screen tests (odd/tasks/compras.md, T2: S4, S6). The
 * `"use server"` action module is mocked at the HTTP boundary, so the island is
 * tested against the actions' result contract, never a database.
 *
 * S4: 25 rows per page, columns correlativo / proveedor / tipo / NCF / estado /
 * fecha / total, estado + tipo + proveedor filters, and the Acciones column
 * driven by the permission seam. S6: money reaches the screen as the fixed-point
 * STRING the action returned and is only formatted for display — no float math.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ComprasScreen, type ComprasInicial } from "../ComprasScreen";
import type { CompraFila, FiltrosCompras } from "../compras-filtros";
import { listarComprasAction, obtenerCompraAction } from "@/modules/compra/http/actions";

jest.mock("@/modules/compra/http/actions", () => ({
  listarComprasAction: jest.fn(),
  obtenerCompraAction: jest.fn(),
  obtenerPermisosCompraAction: jest.fn(),
}));

const mockListar = jest.mocked(listarComprasAction);
const mockObtener = jest.mocked(obtenerCompraAction);

const FILTROS: FiltrosCompras = { proveedorBusqueda: "", estado: "", tipoCompra: "" };

const BORRADOR: CompraFila = {
  id: 7,
  correlativoInterno: "C-000007",
  tipoCompra: "MERCANCIA",
  estado: "BORRADOR",
  ncf: "B0100000001",
  total: "1234.50",
  fecha: "2026-11-10T14:00:00.000Z",
  proveedorNombre: "Distribuidora Norte",
};

const RECIBIDA: CompraFila = {
  id: 8,
  correlativoInterno: "C-000008",
  tipoCompra: "SERVICIO_PROFESIONAL",
  estado: "RECIBIDA",
  ncf: null,
  total: "0.10",
  fecha: "2026-11-09T14:00:00.000Z",
  proveedorNombre: "Suplidor Sur",
};

type ListadoCompras = { items: CompraFila[]; total: number; page: number };

function salida(parcial: Partial<ListadoCompras> = {}): ListadoCompras {
  return { items: [BORRADOR, RECIBIDA], total: 2, page: 1, ...parcial };
}

function montar({
  inicial = { ok: true, data: salida() },
  puedeGestionar = true,
  filtros = FILTROS,
}: {
  inicial?: ComprasInicial;
  puedeGestionar?: boolean;
  filtros?: FiltrosCompras;
} = {}) {
  return render(
    <ComprasScreen
      inicial={inicial}
      filtrosIniciales={filtros}
      puedeGestionar={puedeGestionar}
    />,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("ComprasScreen — rows and columns (S4)", () => {
  it("renders one row per purchase with correlativo, proveedor, tipo, NCF, estado, fecha and total", () => {
    montar();

    for (const columna of [
      "Correlativo",
      "Proveedor",
      "Tipo",
      "NCF",
      "Estado",
      "Fecha",
      "Total",
    ]) {
      expect(screen.getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }

    const borrador = within(screen.getByTestId("compra-fila-7"));
    expect(borrador.getByText("C-000007")).toBeInTheDocument();
    expect(borrador.getByText("Distribuidora Norte")).toBeInTheDocument();
    expect(borrador.getByText("Mercancía")).toBeInTheDocument();
    expect(borrador.getByText("B0100000001")).toBeInTheDocument();
    expect(borrador.getByText("Borrador")).toBeInTheDocument();
    // 14:00Z renders as the same SD calendar day, dd/MM/yyyy.
    expect(borrador.getByText("10/11/2026")).toBeInTheDocument();

    // A purchase without an NCF yet shows the dash, never "null".
    const recibida = within(screen.getByTestId("compra-fila-8"));
    expect(recibida.getByText("—")).toBeInTheDocument();
    expect(recibida.getByText("Servicio profesional")).toBeInTheDocument();
    expect(recibida.getByText("Recibida")).toBeInTheDocument();
  });

  it("S6: totals are formatted from the returned decimal strings, never via float math", () => {
    montar();

    const borrador = within(screen.getByTestId("compra-fila-7"));
    expect(borrador.getByText("RD$ 1,234.50")).toBeInTheDocument();

    // "0.10" must stay 0.10: a Number()/toFixed() round-trip would drop the
    // trailing zero and display "RD$ 0.1".
    const recibida = within(screen.getByTestId("compra-fila-8"));
    expect(recibida.getByText("RD$ 0.10")).toBeInTheDocument();
  });
});

describe("ComprasScreen — role gate (S4)", () => {
  it("gives a view-only caller (Operador/Despachador) no manage markup", () => {
    montar({ puedeGestionar: false });

    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ver detalle/ })).toBeNull();

    // The read side still works: they receive purchases.
    expect(screen.getByLabelText("Buscar proveedor")).toBeInTheDocument();
    expect(screen.getByTestId("compra-fila-7")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives the manage caller the Acciones column with a labelled row action", () => {
    montar();

    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ver detalle C-000007" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ver detalle C-000008" }),
    ).toBeInTheDocument();
  });
});

describe("ComprasScreen — filters (S4)", () => {
  it("applies the estado filter immediately, from page 1", async () => {
    montar();
    mockListar.mockResolvedValueOnce({
      ok: true,
      data: salida({ items: [BORRADOR], total: 1 }),
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
        target: { value: "BORRADOR" },
      });
    });

    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "BORRADOR" });
    await waitFor(() =>
      expect(screen.queryByTestId("compra-fila-8")).toBeNull(),
    );
  });

  it("applies the tipo filter immediately, from page 1", async () => {
    montar();
    mockListar.mockResolvedValueOnce({ ok: true, data: salida() });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por tipo de compra"), {
        target: { value: "ALQUILER" },
      });
    });

    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, tipoCompra: "ALQUILER" });
  });

  it("debounces the supplier search by 300 ms and trims it", async () => {
    montar();
    jest.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Buscar proveedor"), {
      target: { value: "  norte " },
    });
    expect(mockListar).not.toHaveBeenCalled();

    mockListar.mockResolvedValueOnce({ ok: true, data: salida() });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mockListar).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      proveedorBusqueda: "norte",
    });
  });
});

describe("ComprasScreen — pagination (S4)", () => {
  it("paginates 25 per page and disables Anterior on the first page", async () => {
    montar({ inicial: { ok: true, data: salida({ total: 60 }) } });

    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    mockListar.mockResolvedValueOnce({
      ok: true,
      data: salida({ total: 60, page: 2 }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    });

    expect(mockListar).toHaveBeenCalledWith({ page: 2, limit: 25 });
    await waitFor(() => expect(screen.getByText("Página 2 de 3")).toBeInTheDocument());
  });

  it("disables both page buttons while a request is pending", async () => {
    montar({ inicial: { ok: true, data: salida({ total: 60 }) } });
    // A request that never settles keeps the island in the pending state.
    mockListar.mockReturnValueOnce(new Promise(() => {}));

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
  });
});

describe("ComprasScreen — row detail action (S4, S7)", () => {
  it("reads the purchase through obtenerCompraAction and shows it read-only", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 7,
        correlativoInterno: "C-000007",
        tipoCompra: "MERCANCIA",
        estado: "BORRADOR",
        ncf: "B0100000001",
        tipoNcf: "B01",
        fecha: "2026-11-10T14:00:00.000Z",
        subtotal: "1046.19",
        subtotalGravado: "1046.19",
        subtotalExento: "0.00",
        itbis: "188.31",
        retencionIsr: "20.92",
        retencionItbis: "0.00",
        total: "1234.50",
        proveedor: { id: 3, nombre: "Distribuidora Norte" },
        lineas: [],
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ver detalle C-000007" }));
    });

    expect(mockObtener).toHaveBeenCalledWith({ id: 7 });
    const panel = screen.getByRole("region", { name: "Detalle de compra C-000007" });
    const detalle = within(panel);
    expect(detalle.getByText("Distribuidora Norte")).toBeInTheDocument();
    expect(detalle.getByText("RD$ 1,234.50")).toBeInTheDocument();
    expect(detalle.getByText("RD$ 188.31")).toBeInTheDocument();
    expect(detalle.getByText("RD$ 20.92")).toBeInTheDocument();
  });
});

describe("ComprasScreen — failures", () => {
  it("shows the empty state and the server refusal message", () => {
    montar({ inicial: { ok: true, data: salida({ items: [], total: 0 }) } });
    expect(
      screen.getByText("No hay compras que coincidan con los filtros."),
    ).toBeInTheDocument();
    cleanup();

    montar({ inicial: { ok: false, message: "No tiene permisos para listar compras" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tiene permisos para listar compras",
    );
  });
});
