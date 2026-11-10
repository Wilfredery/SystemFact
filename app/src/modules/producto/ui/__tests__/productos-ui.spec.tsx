/**
 * @jest-environment jsdom
 *
 * Productos screen tests (odd/tasks/productos.md, T1: S1-S4). The `"use server"`
 * action module is mocked at the HTTP boundary, so the island is tested against
 * the actions' result contract, never a database. The view-only case (Operador
 * and Despachador, S3) is asserted as ZERO manage markup, not as disabled
 * controls: hiding is the courtesy, the action re-checks on the server.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ProductosScreen,
  type FiltrosProductos,
  type ProductosInicial,
} from "../ProductosScreen";
import {
  actualizarProductoAction,
  consultarProductosAction,
  crearProductoAction,
  desactivarProductoAction,
  obtenerProductoPorIdAction,
} from "@/modules/producto/http/actions";
import type { ConsultarProductosOutput } from "@/modules/producto/application/consultar-productos";
import type { ProductoConsultaItem } from "@/modules/producto/application/producto-consulta-projection";

jest.mock("@/modules/producto/http/actions", () => ({
  consultarProductosAction: jest.fn(),
  obtenerProductoPorIdAction: jest.fn(),
  crearProductoAction: jest.fn(),
  actualizarProductoAction: jest.fn(),
  desactivarProductoAction: jest.fn(),
}));

const mockConsultar = jest.mocked(consultarProductosAction);
const mockObtener = jest.mocked(obtenerProductoPorIdAction);
const mockCrear = jest.mocked(crearProductoAction);
const mockActualizar = jest.mocked(actualizarProductoAction);
const mockDesactivar = jest.mocked(desactivarProductoAction);

const FILTROS: FiltrosProductos = { busqueda: "", categoriaId: null, estado: "activos" };

const ARROZ: ProductoConsultaItem = {
  id: 7,
  codigo: "P-007",
  nombre: "Arroz",
  descripcion: "Arroz selecto",
  categoriaId: 3,
  categoria: "Granos",
  unidadMedida: "Libra",
  precioVenta: "125.50",
  tasaItbis: "18",
  itbisVigenteDesde: "2026-01-01T00:00:00.000Z",
  itbisVigenteHasta: null,
  itbisAplicaRetencionITBIS: false,
  activo: true,
  version: 4,
};

const ACEITE: ProductoConsultaItem = {
  ...ARROZ,
  id: 8,
  codigo: "P-008",
  nombre: "Aceite",
  categoriaId: 4,
  categoria: "Aceites",
  unidadMedida: "Litro",
  precioVenta: "80.00",
  tasaItbis: "16",
};

function salida(parcial: Partial<ConsultarProductosOutput> = {}): ConsultarProductosOutput {
  return {
    items: [ARROZ, ACEITE],
    total: 2,
    page: 1,
    limit: 25,
    categorias: [
      { id: 3, nombre: "Granos" },
      { id: 4, nombre: "Aceites" },
    ],
    ...parcial,
  };
}

function montar({
  inicial = { ok: true, data: salida() },
  puedeGestionar = true,
  filtros = FILTROS,
}: {
  inicial?: ProductosInicial;
  puedeGestionar?: boolean;
  filtros?: FiltrosProductos;
} = {}) {
  return render(
    <ProductosScreen inicial={inicial} filtrosIniciales={filtros} puedeGestionar={puedeGestionar} />,
  );
}

function resolverConsulta(data: ConsultarProductosOutput): void {
  mockConsultar.mockResolvedValueOnce({ ok: true, data });
}

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("ProductosScreen — list, filters and pagination (S1, S4)", () => {
  it("renders the columns and one row per product with its unit, ITBIS and price", () => {
    montar({ puedeGestionar: false });

    for (const columna of ["Código", "Nombre", "Categoría", "Und.", "ITBIS", "Precio", "Estado"]) {
      expect(screen.getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }

    const arroz = within(screen.getByTestId("producto-fila-7"));
    expect(arroz.getByText("P-007")).toBeInTheDocument();
    expect(arroz.getByText("Arroz")).toBeInTheDocument();
    expect(arroz.getByText("Granos")).toBeInTheDocument();
    expect(arroz.getByText("Libra")).toBeInTheDocument();
    expect(arroz.getByText("18%")).toBeInTheDocument();
    expect(arroz.getByText("RD$ 125.50")).toBeInTheDocument();
    expect(arroz.getByText("Activo")).toBeInTheDocument();
  });

  it("S3: a view-only caller (Operador/Despachador) gets no manage markup at all", () => {
    montar({ puedeGestionar: false });

    expect(screen.queryByRole("button", { name: "+ Nuevo producto" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Desactivar/ })).toBeNull();
    // The read side still works.
    expect(screen.getByLabelText("Buscar producto")).toBeInTheDocument();
    expect(screen.getByTestId("producto-fila-7")).toBeInTheDocument();
  });

  it("S3: the manage caller sees the create control and the row actions", () => {
    montar();

    expect(screen.getByRole("button", { name: "+ Nuevo producto" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar P-007" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar P-007" })).toBeInTheDocument();
  });

  it("S1: the status filter re-queries from page 1 with the chosen estado", async () => {
    montar();
    resolverConsulta(salida({ items: [ACEITE], total: 1 }));

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
        target: { value: "todos" },
      });
    });

    expect(mockConsultar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "todos" });
    await waitFor(() => expect(screen.getByTestId("producto-fila-8")).toBeInTheDocument());
  });

  it("S1: the category filter is sent only when one is chosen", async () => {
    montar();
    resolverConsulta(salida({ items: [ARROZ], total: 1 }));

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por categoría"), {
        target: { value: "3" },
      });
    });

    expect(mockConsultar).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      estado: "activos",
      categoriaId: 3,
    });
  });

  it("S1: the search is debounced and searches by name or code", async () => {
    montar();
    jest.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Buscar producto"), {
      target: { value: "  arroz " },
    });
    expect(mockConsultar).not.toHaveBeenCalled();

    resolverConsulta(salida({ items: [ARROZ], total: 1 }));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mockConsultar).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      estado: "activos",
      busqueda: "arroz",
    });
  });

  it("S4: paginates 25 per page and disables Anterior on the first page", async () => {
    montar({ inicial: { ok: true, data: salida({ total: 60 }) } });

    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    resolverConsulta(salida({ total: 60, page: 2 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    });

    expect(mockConsultar).toHaveBeenCalledWith({ page: 2, limit: 25, estado: "activos" });
    await waitFor(() => expect(screen.getByText("Página 2 de 3")).toBeInTheDocument());
  });

  it("shows the empty state and the server refusal message", () => {
    montar({ inicial: { ok: true, data: salida({ items: [], total: 0 }) } });
    expect(screen.getByText("No hay productos que coincidan con los filtros.")).toBeInTheDocument();
    cleanup();

    montar({ inicial: { ok: false, message: "No tiene permisos para listar productos" } });
    expect(screen.getByRole("alert")).toHaveTextContent("No tiene permisos para listar productos");
  });
});

describe("ProductosScreen — create dialog (S1)", () => {
  it("collects every field and calls crearProductoAction, then refreshes the list", async () => {
    montar();
    mockCrear.mockResolvedValueOnce({ ok: true, data: { id: 9, codigo: "P-009" } });
    resolverConsulta(salida({ items: [ARROZ], total: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo producto" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("heading", { name: "Nuevo producto" })).toBeInTheDocument();

    fireEvent.change(within(dialogo).getByLabelText("Código *"), { target: { value: "P-009" } });
    fireEvent.change(within(dialogo).getByLabelText("Nombre *"), { target: { value: "Café" } });
    fireEvent.change(within(dialogo).getByLabelText("Categoría *"), { target: { value: "3" } });
    fireEvent.change(within(dialogo).getByLabelText("Unidad"), { target: { value: "Libra" } });
    fireEvent.change(within(dialogo).getByLabelText("Precio de venta *"), {
      target: { value: "250.00" },
    });
    fireEvent.change(within(dialogo).getByLabelText("ITBIS *"), { target: { value: "16" } });
    fireEvent.change(within(dialogo).getByLabelText("Descripción"), {
      target: { value: "Molido" },
    });

    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(mockCrear).toHaveBeenCalledWith({
      categoriaId: 3,
      codigo: "P-009",
      nombre: "Café",
      descripcion: "Molido",
      unidadMedida: "Libra",
      precioVenta: "250.00",
      itbisTasa: "16",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockConsultar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "activos" });
    expect(await screen.findByRole("status")).toHaveTextContent("Producto creado.");
  });

  it("S4: a price the server would refuse is stopped in the form (no action call)", async () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo producto" }));
    const dialogo = screen.getByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Código *"), { target: { value: "P-009" } });
    fireEvent.change(within(dialogo).getByLabelText("Nombre *"), { target: { value: "Café" } });
    fireEvent.change(within(dialogo).getByLabelText("Categoría *"), { target: { value: "3" } });
    fireEvent.change(within(dialogo).getByLabelText("Precio de venta *"), {
      target: { value: "12,50" },
    });

    expect(within(dialogo).getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(within(dialogo).getByText(/Monto inválido/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("explains that a product cannot be created without an active category", () => {
    montar({ inicial: { ok: true, data: salida({ categorias: [] }) } });

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo producto" }));
    const dialogo = screen.getByRole("dialog");

    expect(within(dialogo).getByText("No hay categorías activas.")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("shows the server message and keeps the dialog open when creation is refused", async () => {
    montar();
    mockCrear.mockResolvedValueOnce({
      ok: false,
      error: { code: "CODIGO_PRODUCTO_DUPLICADO", message: "Ya existe un producto con ese código en la empresa" },
    });

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo producto" }));
    const dialogo = screen.getByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Código *"), { target: { value: "P-007" } });
    fireEvent.change(within(dialogo).getByLabelText("Nombre *"), { target: { value: "Arroz" } });
    fireEvent.change(within(dialogo).getByLabelText("Categoría *"), { target: { value: "3" } });
    fireEvent.change(within(dialogo).getByLabelText("Precio de venta *"), {
      target: { value: "100.00" },
    });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(
      await within(dialogo).findByText("Ya existe un producto con ese código en la empresa"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ProductosScreen — edit dialog (S1, S4)", () => {
  it("prefills from a fresh single-product read and submits id + version", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({ ok: true, data: ARROZ });
    mockActualizar.mockResolvedValueOnce({ ok: true, data: { id: 7, version: 5 } });
    resolverConsulta(salida());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar P-007" }));
    });

    expect(mockObtener).toHaveBeenCalledWith({ id: 7 });
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("heading", { name: "Editar producto" })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Código *")).toHaveValue("P-007");
    expect(within(dialogo).getByLabelText("Nombre *")).toHaveValue("Arroz");
    expect(within(dialogo).getByLabelText("Categoría *")).toHaveValue("3");
    expect(within(dialogo).getByLabelText("Unidad")).toHaveValue("Libra");
    expect(within(dialogo).getByLabelText("Precio de venta *")).toHaveValue("125.50");
    expect(within(dialogo).getByLabelText("ITBIS *")).toHaveValue("18");
    expect(within(dialogo).getByLabelText("Descripción")).toHaveValue("Arroz selecto");

    fireEvent.change(within(dialogo).getByLabelText("Precio de venta *"), {
      target: { value: "130.00" },
    });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(mockActualizar).toHaveBeenCalledWith({
      id: 7,
      version: 4,
      codigo: "P-007",
      nombre: "Arroz",
      categoriaId: 3,
      unidadMedida: "Libra",
      precioVenta: "130.00",
      itbisTasa: "18",
      descripcion: "Arroz selecto",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("status")).toHaveTextContent("Producto actualizado.");
  });

  it("S4: a stale version maps to the fixed conflict message and no silent overwrite", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({ ok: true, data: ARROZ });
    mockActualizar.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CONCURRENCIA_CONFLICTO",
        message: "Otro usuario modificó el producto; recargue y reintente",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar P-007" }));
    });
    const dialogo = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(
      await within(dialogo).findByText("Otro usuario modificó el producto; recargue y reintente"),
    ).toBeInTheDocument();
  });

  it("shows the refusal when the fresh read fails and opens no dialog", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({
      ok: false,
      error: { code: "PRODUCTO_NO_ENCONTRADO", message: "El producto no existe en la empresa" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar P-007" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("El producto no existe en la empresa");
  });
});

describe("ProductosScreen — deactivate with confirmation (S4)", () => {
  it("asks first, then deactivates and refreshes; the product is never deleted", async () => {
    montar();
    mockDesactivar.mockResolvedValueOnce({ ok: true, data: { id: 7 } });
    resolverConsulta(salida({ items: [ACEITE], total: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "Desactivar P-007" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("heading", { name: "Desactivar producto" })).toBeInTheDocument();
    expect(dialogo.textContent).toContain("P-007");
    expect(dialogo.textContent).toContain("No se elimina");
    expect(mockDesactivar).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    });

    expect(mockDesactivar).toHaveBeenCalledWith({ id: 7 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("status")).toHaveTextContent("Producto desactivado.");
    expect(mockConsultar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "activos" });
  });

  it("keeps the dialog open with the server reason when deactivation is refused", async () => {
    montar();
    mockDesactivar.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "PRODUCTO_TIENE_MOVIMIENTOS",
        message: "El producto tiene referencias activas y no puede desactivarse",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Desactivar P-007" }));
    const dialogo = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    });

    expect(
      await within(dialogo).findByText(
        "El producto tiene referencias activas y no puede desactivarse",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockConsultar).not.toHaveBeenCalled();
  });
});
