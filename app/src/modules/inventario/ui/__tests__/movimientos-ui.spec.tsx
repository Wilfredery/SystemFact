/**
 * @jest-environment jsdom
 *
 * Inventario "Historial de movimientos" island tests
 * (odd/tasks/inventario-historial.md, T2: S1, S7). The `"use server"` action module
 * is mocked at the HTTP boundary — the island is tested against the action's
 * result contract, never a database.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  MovimientosScreen,
  cantidadConSigno,
  type FiltrosMovimientos,
  type MovimientosInicial,
} from "../MovimientosScreen";
import { listarMovimientosInventarioAction } from "@/modules/inventario/http/actions";
import type { ListarMovimientosOutput } from "@/modules/inventario/application/listar-movimientos-inventario";
import { TIPOS_MOVIMIENTO, etiquetaTipoMovimiento } from "@/modules/inventario/domain/movimientos";

jest.mock("@/modules/inventario/http/actions", () => ({
  listarMovimientosInventarioAction: jest.fn(),
}));

const mockListar = jest.mocked(listarMovimientosInventarioAction);

const SIN_FILTROS: FiltrosMovimientos = { tipo: null, producto: "", desde: "", hasta: "" };

function salida(parcial: Partial<ListarMovimientosOutput> = {}): ListarMovimientosOutput {
  return {
    items: [
      {
        id: 31,
        fecha: "2026-11-05T15:00:00.000Z",
        tipo: "AJUSTE",
        productoCodigo: "P-007",
        productoNombre: "Arroz",
        cantidadMovida: "5",
        cantidadAnterior: "10",
        cantidadNueva: "15",
        usuarioNombre: "Ana Pérez",
        motivo: "Conteo físico: e2e",
      },
      {
        id: 30,
        fecha: "2026-11-04T09:30:00.000Z",
        tipo: "SALIDA_VENTA",
        productoCodigo: "P-008",
        productoNombre: "Habichuelas",
        cantidadMovida: "-2.5",
        cantidadAnterior: "12.5",
        cantidadNueva: "10",
        usuarioNombre: null,
        motivo: "Venta",
      },
    ],
    total: 60,
    page: 1,
    limit: 25,
    desde: "2026-10-16",
    hasta: "2026-11-14",
    ...parcial,
  };
}

function montar(inicial: MovimientosInicial = { ok: true, data: salida() }) {
  return render(<MovimientosScreen inicial={inicial} filtrosIniciales={SIN_FILTROS} />);
}

async function resolver(data: ListarMovimientosOutput): Promise<void> {
  mockListar.mockResolvedValueOnce({ ok: true, data });
}

beforeEach(() => {
  mockListar.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("MovimientosScreen — table", () => {
  it("renders exactly the eight columns and one row per movement", () => {
    montar();

    const columnas = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(columnas).toEqual([
      "Fecha",
      "Producto",
      "Tipo",
      "Cantidad movida",
      "Cantidad anterior",
      "Cantidad nueva",
      "Usuario",
      "Motivo",
    ]);
    expect(screen.getAllByTestId(/^movimiento-fila-/)).toHaveLength(2);
  });

  it("shows fecha in Santo Domingo time, producto, tipo label, signed quantities, usuario and motivo", () => {
    montar();

    const ajuste = within(screen.getByTestId("movimiento-fila-31"));
    // 2026-11-05T15:00Z is 11:00 in America/Santo_Domingo (UTC-4).
    expect(ajuste.getByText(/05\/11\/2026.*11:00:00/)).toBeInTheDocument();
    expect(ajuste.getByText("P-007")).toBeInTheDocument();
    expect(ajuste.getByText("Arroz")).toBeInTheDocument();
    expect(ajuste.getByText("Ajuste manual")).toBeInTheDocument();
    expect(ajuste.getByText("+5")).toBeInTheDocument();
    expect(ajuste.getByText("10")).toBeInTheDocument();
    expect(ajuste.getByText("15")).toBeInTheDocument();
    expect(ajuste.getByText("Ana Pérez")).toBeInTheDocument();
    expect(ajuste.getByText("Conteo físico: e2e")).toBeInTheDocument();

    const venta = within(screen.getByTestId("movimiento-fila-30"));
    expect(venta.getByText("Salida por venta")).toBeInTheDocument();
    expect(venta.getByText("-2.5")).toBeInTheDocument();
    // A user the session cannot read renders a dash, not a crash.
    expect(venta.getByText("—")).toBeInTheDocument();
  });

  it("has no write control: no buttons in rows, no actions column, no form", () => {
    montar();

    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    const tabla = screen.getByRole("table");
    expect(within(tabla).queryAllByRole("button")).toHaveLength(0);
    expect(within(tabla).queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /ajustar|guardar|eliminar|anular|editar/i })).not.toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
  });

  it("shows the empty state (and no table) when nothing matches", () => {
    montar({ ok: true, data: salida({ items: [], total: 0 }) });

    expect(screen.getByText("No hay movimientos que coincidan con los filtros.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Página 1 de 1")).toBeInTheDocument();
  });
});

describe("MovimientosScreen — filters", () => {
  it("offers the tipo filter with a label for each of the 7 values", () => {
    montar();

    const tipo = screen.getByLabelText("Filtrar por tipo de movimiento");
    const opciones = within(tipo).getAllByRole("option").map((o) => [o.textContent, (o as HTMLOptionElement).value]);
    expect(opciones).toEqual([
      ["Todos los tipos", ""],
      ...TIPOS_MOVIMIENTO.map((t) => [etiquetaTipoMovimiento(t), t]),
    ]);
    expect(opciones).toHaveLength(8);
  });

  it("shows the range applied by the server in Desde/Hasta on the first load", () => {
    montar();

    expect(screen.getByLabelText("Desde")).toHaveValue("2026-10-16");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-11-14");
  });

  it("re-queries page 1 with the tipo filter and the displayed range", async () => {
    montar();
    await resolver(salida());

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por tipo de movimiento"), {
        target: { value: "SALIDA_VENTA" },
      });
    });

    expect(mockListar).toHaveBeenCalledTimes(1);
    expect(mockListar).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      tipo: "SALIDA_VENTA",
      desde: "2026-10-16",
      hasta: "2026-11-14",
    });
  });

  it("re-queries page 1 when Desde or Hasta change", async () => {
    montar();
    await resolver(salida());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-11-01" } });
    });
    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, limit: 25, desde: "2026-11-01", hasta: "2026-11-14" });

    await resolver(salida());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-11-10" } });
    });
    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, limit: 25, desde: "2026-11-01", hasta: "2026-11-10" });
  });

  it("debounces the producto search by 300ms and resets to page 1", async () => {
    jest.useFakeTimers();
    montar({ ok: true, data: salida({ page: 2 }) });
    await resolver(salida());

    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "arr" } });
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "arroz" } });
    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(mockListar).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockListar).toHaveBeenCalledTimes(1);
    expect(mockListar).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      producto: "arroz",
      desde: "2026-10-16",
      hasta: "2026-11-14",
    });
  });
});

describe("MovimientosScreen — pagination", () => {
  it("shows Página X de Y and walks Anterior / Siguiente keeping the filters", async () => {
    montar();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();

    await resolver(salida({ page: 2 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    });
    expect(mockListar).toHaveBeenLastCalledWith({ page: 2, limit: 25, desde: "2026-10-16", hasta: "2026-11-14" });
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();

    await resolver(salida({ page: 1 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
    });
    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, limit: 25, desde: "2026-10-16", hasta: "2026-11-14" });
  });

  it("disables Siguiente on the last page", () => {
    montar({ ok: true, data: salida({ page: 3 }) });

    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeEnabled();
  });
});

describe("MovimientosScreen — errors", () => {
  it("keeps the filters and shows the message when the first load failed", () => {
    montar({ ok: false, message: "El rango de fechas no puede superar 90 días." });

    expect(screen.getByRole("alert")).toHaveTextContent("El rango de fechas no puede superar 90 días.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Desde")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Página siguiente" })).not.toBeInTheDocument();
  });

  it("shows the typed message of a failed re-query and keeps the rows already loaded", async () => {
    montar();
    mockListar.mockResolvedValueOnce({
      ok: false,
      error: { code: "RANGO_FECHAS_EXCEDIDO", message: "El rango de fechas no puede superar 90 días." },
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-01-01" } });
    });

    expect(screen.getByRole("alert")).toHaveTextContent("El rango de fechas no puede superar 90 días.");
    expect(screen.getByTestId("movimiento-fila-31")).toBeInTheDocument();
  });

  it("recovers when the action itself rejects", async () => {
    montar();
    mockListar.mockRejectedValueOnce(new Error("timeout"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo cargar el historial. Intente de nuevo.");
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
  });
});

describe("cantidadConSigno", () => {
  it("prefixes + to positives only", () => {
    expect(cantidadConSigno("5")).toBe("+5");
    expect(cantidadConSigno("0.5")).toBe("+0.5");
    expect(cantidadConSigno("-2.5")).toBe("-2.5");
    expect(cantidadConSigno("0")).toBe("0");
  });
});
