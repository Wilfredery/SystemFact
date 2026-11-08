/**
 * @jest-environment jsdom
 *
 * Inventario consulta screen tests (odd/tasks/inventario-consulta.md, T3). The
 * `"use server"` action module is mocked at the HTTP boundary — the island is
 * tested against the action's result contract, never a database.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  InventarioScreen,
  type FiltrosInventario,
  type InventarioInicial,
} from "../InventarioScreen";
import { consultarInventarioAction } from "@/modules/inventario/http/actions";
import type { ConsultarInventarioOutput } from "@/modules/inventario/application/consultar-inventario";

jest.mock("@/modules/inventario/http/actions", () => ({
  consultarInventarioAction: jest.fn(),
}));

const mockConsultar = jest.mocked(consultarInventarioAction);

const SIN_FILTROS: FiltrosInventario = { busqueda: "", categoriaId: null, estado: null };

function salida(parcial: Partial<ConsultarInventarioOutput> = {}): ConsultarInventarioOutput {
  return {
    items: [
      {
        productoId: 7,
        codigo: "P-007",
        nombre: "Arroz",
        categoria: "Granos",
        unidadMedida: "LB",
        cantidad: "120.000",
        stockMinimo: 10,
        estado: "normal",
      },
      {
        productoId: 8,
        codigo: "P-008",
        nombre: "Habichuelas",
        categoria: "Granos",
        unidadMedida: "LB",
        cantidad: "4.000",
        stockMinimo: 10,
        estado: "bajo_stock",
      },
      {
        productoId: 9,
        codigo: "P-009",
        nombre: "Aceite",
        categoria: "Aceites",
        unidadMedida: "UND",
        cantidad: "0.000",
        stockMinimo: 5,
        estado: "agotado",
      },
    ],
    total: 60,
    page: 1,
    limit: 25,
    resumen: { totalProductos: 60, bajoStock: 4, agotados: 2, valorInventario: "152700.00" },
    categorias: [
      { id: 1, nombre: "Granos" },
      { id: 2, nombre: "Aceites" },
    ],
    ...parcial,
  };
}

function montar(inicial: InventarioInicial = { ok: true, data: salida() }) {
  return render(<InventarioScreen inicial={inicial} filtrosIniciales={SIN_FILTROS} />);
}

async function resolver(data: ConsultarInventarioOutput): Promise<void> {
  mockConsultar.mockResolvedValueOnce({ ok: true, data });
}

beforeEach(() => {
  mockConsultar.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("InventarioScreen — rows, badges and KPIs", () => {
  it("renders the columns, one row per product with its status badge, and no actions", () => {
    montar();

    for (const columna of ["Código", "Nombre", "Categoría", "Und.", "Existencia", "Stock mín.", "Estado"]) {
      expect(screen.getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ajustar/i })).not.toBeInTheDocument();

    const arroz = within(screen.getByTestId("inventario-fila-7"));
    expect(arroz.getByText("P-007")).toBeInTheDocument();
    expect(arroz.getByText("Arroz")).toBeInTheDocument();
    expect(arroz.getByText("120.000")).toBeInTheDocument();
    expect(arroz.getByText("Disponible")).toBeInTheDocument();
    expect(within(screen.getByTestId("inventario-fila-8")).getByText("Bajo stock")).toBeInTheDocument();
    expect(within(screen.getByTestId("inventario-fila-9")).getByText("Agotado")).toBeInTheDocument();
  });

  it("shows the four KPI cards with the value formatted as RD$", () => {
    montar();

    expect(within(screen.getByTestId("inventario-kpi-total")).getByText("60")).toBeInTheDocument();
    expect(within(screen.getByTestId("inventario-kpi-bajo")).getByText("4")).toBeInTheDocument();
    expect(within(screen.getByTestId("inventario-kpi-agotados")).getByText("2")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("inventario-kpi-valor")).getByText("RD$ 152,700.00"),
    ).toBeInTheDocument();
    expect(screen.getByText("Total productos")).toBeInTheDocument();
    expect(screen.getByText("Valor de inventario")).toBeInTheDocument();
  });

  it("offers the filter controls with the wireframe labels", () => {
    montar();

    expect(screen.getByPlaceholderText("Buscar por nombre o código...")).toBeInTheDocument();
    const categoria = screen.getByLabelText("Filtrar por categoría");
    expect(within(categoria).getAllByRole("option")[0]).toHaveTextContent("Todas las categorías");
    expect(within(categoria).getByRole("option", { name: "Granos" })).toHaveValue("1");
    const estado = screen.getByLabelText("Filtrar por estado");
    expect(within(estado).getAllByRole("option").map((o) => [o.textContent, (o as HTMLOptionElement).value])).toEqual([
      ["Todos los estados", ""],
      ["Disponible", "normal"],
      ["Bajo stock", "bajo_stock"],
      ["Agotado", "agotado"],
    ]);
  });

  it("shows the empty state when there are no rows", () => {
    montar({ ok: true, data: salida({ items: [], total: 0 }) });

    expect(screen.getByText("No hay productos que coincidan con los filtros.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Página 1 de 1")).toBeInTheDocument();
  });
});

describe("InventarioScreen — errors", () => {
  it("shows a business error from the first load in a visible alert", () => {
    montar({ ok: false, message: "No tiene permisos para consultar inventario" });

    expect(screen.getByRole("alert")).toHaveTextContent("No tiene permisos para consultar inventario");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the message of a failed re-query and keeps the rows already loaded", async () => {
    montar();
    mockConsultar.mockResolvedValueOnce({
      ok: false,
      error: { code: "NO_AUTORIZADO", message: "No tiene permisos para consultar inventario" },
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "agotado" } });
    });

    expect(screen.getByRole("alert")).toHaveTextContent("No tiene permisos para consultar inventario");
    expect(screen.getByTestId("inventario-fila-7")).toBeInTheDocument();
  });

  it("recovers when the action itself rejects: message shown, controls usable again", async () => {
    montar();
    mockConsultar.mockRejectedValueOnce(new Error("timeout"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo cargar el inventario. Intente de nuevo.",
    );
    expect(screen.getByTestId("inventario-fila-7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
  });
});

describe("InventarioScreen — querying", () => {
  it("re-queries page 1 with the category filter", async () => {
    montar();
    await resolver(salida());

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por categoría"), { target: { value: "2" } });
    });

    expect(mockConsultar).toHaveBeenCalledTimes(1);
    expect(mockConsultar).toHaveBeenCalledWith({ page: 1, limit: 25, categoriaId: 2 });
  });

  it("re-queries page 1 with the status filter, keeping the category", async () => {
    montar();
    await resolver(salida());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por categoría"), { target: { value: "2" } });
    });
    await resolver(salida());

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "bajo_stock" } });
    });

    expect(mockConsultar).toHaveBeenLastCalledWith({
      page: 1,
      limit: 25,
      categoriaId: 2,
      estado: "bajo_stock",
    });
  });

  it("debounces the search by 300ms and resets to page 1", async () => {
    jest.useFakeTimers();
    montar({ ok: true, data: salida({ page: 2 }) });
    await resolver(salida());

    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "arr" } });
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "arroz" } });
    await act(async () => {
      jest.advanceTimersByTime(299);
    });
    expect(mockConsultar).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockConsultar).toHaveBeenCalledTimes(1);
    expect(mockConsultar).toHaveBeenCalledWith({ page: 1, limit: 25, busqueda: "arroz" });
  });

  it("goes to the next and previous page keeping the filters", async () => {
    montar();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();

    await resolver(salida({ page: 2 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    });
    expect(mockConsultar).toHaveBeenLastCalledWith({ page: 2, limit: 25 });
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();

    await resolver(salida({ page: 1 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
    });
    expect(mockConsultar).toHaveBeenLastCalledWith({ page: 1, limit: 25 });
  });

  it("keeps pagination disabled while a typed search is still waiting for its debounce", async () => {
    jest.useFakeTimers();
    montar();

    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "arr" } });
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();

    await resolver(salida());
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(mockConsultar).toHaveBeenCalledTimes(1);
    expect(mockConsultar).toHaveBeenCalledWith({ page: 1, limit: 25, busqueda: "arr" });
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
  });

  it("disables the next button on the last page", () => {
    montar({ ok: true, data: salida({ page: 3 }) });

    expect(screen.getByText("Página 3 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  });
});
