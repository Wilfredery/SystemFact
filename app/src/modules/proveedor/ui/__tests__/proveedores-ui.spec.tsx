/**
 * @jest-environment jsdom
 *
 * Proveedores screen tests (odd/tasks/proveedores.md, T1: S1-S4). The
 * `"use server"` action module is mocked at the HTTP boundary, so the island is
 * tested against the actions' result contract, never a database.
 *
 * S3 is asserted as ZERO markup, not as disabled controls: a view-only caller
 * (Operador, Despachador) gets no create button, no actions column and no row
 * buttons at all — hiding is the courtesy, the actions re-check on the server.
 * S4: deactivation is a soft delete (`activo=false`, the dialog says so) and an
 * edit round-trips the stored `version`.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProveedoresScreen, type ProveedoresInicial } from "../ProveedoresScreen";
import type { FiltrosProveedores } from "../proveedores-filtros";
import {
  actualizarProveedorAction,
  crearProveedorAction,
  desactivarProveedorAction,
  listarProveedoresAction,
  obtenerProveedorAction,
} from "@/modules/proveedor/http/actions";
import type { ProveedorDetalleDto, ProveedorDto } from "@/modules/proveedor/http/shared";

jest.mock("@/modules/proveedor/http/actions", () => ({
  listarProveedoresAction: jest.fn(),
  obtenerProveedorAction: jest.fn(),
  crearProveedorAction: jest.fn(),
  actualizarProveedorAction: jest.fn(),
  desactivarProveedorAction: jest.fn(),
  obtenerPermisosProveedorAction: jest.fn(),
}));

const mockListar = jest.mocked(listarProveedoresAction);
const mockObtener = jest.mocked(obtenerProveedorAction);
const mockCrear = jest.mocked(crearProveedorAction);
const mockActualizar = jest.mocked(actualizarProveedorAction);
const mockDesactivar = jest.mocked(desactivarProveedorAction);

const FILTROS: FiltrosProveedores = { busqueda: "", estado: "activos" };

const NORTE: ProveedorDto = {
  id: 4,
  nombre: "Distribuidora Norte",
  contacto: "Juan Pérez",
  telefono: "809-555-1212",
  rnc: "138000001",
  tipoProveedor: "FORMAL",
  tipoPersona: "JURIDICA",
  activo: true,
};

const SUR: ProveedorDto = {
  id: 5,
  nombre: "Suplidor Sur",
  contacto: "Ana Díaz",
  telefono: "809-555-3434",
  rnc: null,
  tipoProveedor: "INFORMAL",
  tipoPersona: "FISICA",
  activo: true,
};

const NORTE_DETALLE: ProveedorDetalleDto = { ...NORTE, version: 3 };

type ListadoProveedores = {
  items: ProveedorDto[];
  total: number;
  page: number;
};

function salida(parcial: Partial<ListadoProveedores> = {}): ListadoProveedores {
  return { items: [NORTE, SUR], total: 2, page: 1, ...parcial };
}

function montar({
  inicial = { ok: true, data: salida() },
  puedeGestionar = true,
  filtros = FILTROS,
}: {
  inicial?: ProveedoresInicial;
  puedeGestionar?: boolean;
  filtros?: FiltrosProveedores;
} = {}) {
  return render(
    <ProveedoresScreen
      inicial={inicial}
      filtrosIniciales={filtros}
      puedeGestionar={puedeGestionar}
    />,
  );
}

function resolverListado(data: ListadoProveedores): void {
  mockListar.mockResolvedValueOnce({ ok: true, data });
}

function abrirCreacion(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proveedor" }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("ProveedoresScreen — list, filters and pagination (S1, S4)", () => {
  it("renders one row per supplier with RNC, contact, phone, type and status", () => {
    montar();

    for (const columna of ["Nombre", "RNC", "Contacto", "Teléfono", "Tipo", "Estado"]) {
      expect(screen.getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }

    const norte = within(screen.getByTestId("proveedor-fila-4"));
    expect(norte.getByText("Distribuidora Norte")).toBeInTheDocument();
    expect(norte.getByText("138000001")).toBeInTheDocument();
    expect(norte.getByText("Juan Pérez")).toBeInTheDocument();
    expect(norte.getByText("809-555-1212")).toBeInTheDocument();
    expect(norte.getByText("Formal")).toBeInTheDocument();
    expect(norte.getByText("Activo")).toBeInTheDocument();

    // An informal supplier has no RNC: the cell shows the dash, never "null".
    const sur = within(screen.getByTestId("proveedor-fila-5"));
    expect(sur.getByText("—")).toBeInTheDocument();
    expect(sur.getByText("Informal")).toBeInTheDocument();
  });

  it("S3: a view-only caller (Operador/Despachador) gets no manage markup", () => {
    montar({ puedeGestionar: false });

    expect(screen.queryByRole("button", { name: "+ Nuevo proveedor" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Desactivar/ })).toBeNull();

    // The read side still works: they receive purchases from these suppliers.
    expect(screen.getByLabelText("Buscar proveedor")).toBeInTheDocument();
    expect(screen.getByTestId("proveedor-fila-4")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("S3: the manage caller sees the create control and the row actions", () => {
    montar();

    expect(screen.getByRole("button", { name: "+ Nuevo proveedor" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Distribuidora Norte" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar Distribuidora Norte" })).toBeInTheDocument();
  });

  it("S1: the status filter re-queries from page 1 including inactive rows", async () => {
    montar();
    resolverListado(salida({ items: [SUR], total: 1 }));

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
        target: { value: "todos" },
      });
    });

    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, incluirInactivos: true });
    await waitFor(() => expect(screen.getByTestId("proveedor-fila-5")).toBeInTheDocument());
  });

  it("S1: the search is debounced and searches by name or RNC", async () => {
    montar();
    jest.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Buscar proveedor"), {
      target: { value: "  norte " },
    });
    expect(mockListar).not.toHaveBeenCalled();

    resolverListado(salida({ items: [NORTE], total: 1 }));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mockListar).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      incluirInactivos: false,
      buscar: "norte",
    });
  });

  it("S4: paginates 25 per page and disables Anterior on the first page", async () => {
    montar({ inicial: { ok: true, data: salida({ total: 60 }) } });

    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    resolverListado(salida({ total: 60, page: 2 }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    });

    expect(mockListar).toHaveBeenCalledWith({ page: 2, limit: 25, incluirInactivos: false });
    await waitFor(() => expect(screen.getByText("Página 2 de 3")).toBeInTheDocument());
  });

  it("shows the empty state and the server refusal message", () => {
    montar({ inicial: { ok: true, data: salida({ items: [], total: 0 }) } });
    expect(
      screen.getByText("No hay proveedores que coincidan con los filtros."),
    ).toBeInTheDocument();
    cleanup();

    montar({ inicial: { ok: false, message: "No tiene permisos para listar proveedores" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tiene permisos para listar proveedores",
    );
  });
});

describe("ProveedoresScreen — create dialog (S1, S3)", () => {
  it("collects the identity and contact fields and calls crearProveedorAction", async () => {
    montar();
    mockCrear.mockResolvedValueOnce({ ok: true, data: { id: 9, nombre: "Comercial Nueva", version: 1 } });
    resolverListado(salida({ items: [NORTE], total: 1 }));

    const dialogo = abrirCreacion();
    expect(
      within(dialogo).getByRole("heading", { name: "Nuevo proveedor" }),
    ).toBeInTheDocument();

    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Comercial Nueva SRL" },
    });
    fireEvent.change(within(dialogo).getByLabelText("RNC"), {
      target: { value: "1-01-00001-2" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Contacto *"), {
      target: { value: "María Gómez" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-2222" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Tipo de proveedor *"), {
      target: { value: "FORMAL" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Tipo de persona *"), {
      target: { value: "JURIDICA" },
    });

    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(mockCrear).toHaveBeenCalledWith({
      nombre: "Comercial Nueva SRL",
      rnc: "1-01-00001-2",
      contacto: "María Gómez",
      telefono: "809-555-2222",
      tipoProveedor: "FORMAL",
      tipoPersona: "JURIDICA",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, incluirInactivos: false });
    expect(await screen.findByRole("status")).toHaveTextContent("Proveedor creado.");
  });

  it("S4: an RNC outside the domain's 9–11 digits is stopped in the form", async () => {
    montar();

    const dialogo = abrirCreacion();
    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Distribuidora Norte" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Contacto *"), {
      target: { value: "Juan Pérez" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-1212" },
    });
    fireEvent.change(within(dialogo).getByLabelText("RNC"), {
      target: { value: "12" },
    });

    expect(within(dialogo).getByText(/9 y 11 dígitos/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Guardar" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("accepts a blank RNC (informal supplier) and sends null", async () => {
    montar();
    mockCrear.mockResolvedValueOnce({ ok: true, data: { id: 9, nombre: "Suplidor Sur", version: 1 } });
    resolverListado(salida({ items: [SUR], total: 1 }));

    const dialogo = abrirCreacion();
    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Suplidor Sur" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Contacto *"), {
      target: { value: "Ana Díaz" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-3434" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Tipo de proveedor *"), {
      target: { value: "INFORMAL" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Tipo de persona *"), {
      target: { value: "FISICA" },
    });

    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(mockCrear).toHaveBeenCalledWith({
      nombre: "Suplidor Sur",
      rnc: null,
      contacto: "Ana Díaz",
      telefono: "809-555-3434",
      tipoProveedor: "INFORMAL",
      tipoPersona: "FISICA",
    });
  });

  it("shows the server message and keeps the dialog open when creation is refused", async () => {
    montar();
    mockCrear.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "RNC_PROVEEDOR_DUPLICADO",
        message: "Ya existe un proveedor activo con ese RNC en la empresa",
      },
    });

    const dialogo = abrirCreacion();
    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Distribuidora Norte" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Contacto *"), {
      target: { value: "Juan Pérez" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-1212" },
    });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(
      await within(dialogo).findByText(
        "Ya existe un proveedor activo con ese RNC en la empresa",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ProveedoresScreen — edit dialog (S1, S4)", () => {
  it("prefills from a fresh single-supplier read and submits id + version", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({ ok: true, data: NORTE_DETALLE });
    mockActualizar.mockResolvedValueOnce({
      ok: true,
      data: { id: 4, version: 4 },
    });
    resolverListado(salida());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar Distribuidora Norte" }));
    });

    expect(mockObtener).toHaveBeenCalledWith({ id: 4 });
    const dialogo = screen.getByRole("dialog");
    expect(
      within(dialogo).getByRole("heading", { name: "Editar proveedor" }),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Nombre o razón social *")).toHaveValue(
      "Distribuidora Norte",
    );
    expect(within(dialogo).getByLabelText("RNC")).toHaveValue("138000001");
    expect(within(dialogo).getByLabelText("Contacto *")).toHaveValue("Juan Pérez");
    expect(within(dialogo).getByLabelText("Teléfono *")).toHaveValue("809-555-1212");
    expect(within(dialogo).getByLabelText("Tipo de proveedor *")).toHaveValue("FORMAL");
    expect(within(dialogo).getByLabelText("Tipo de persona *")).toHaveValue("JURIDICA");

    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-9999" },
    });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(mockActualizar).toHaveBeenCalledWith({
      id: 4,
      version: 3,
      nombre: "Distribuidora Norte",
      rnc: "138000001",
      contacto: "Juan Pérez",
      telefono: "809-555-9999",
      tipoProveedor: "FORMAL",
      tipoPersona: "JURIDICA",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("status")).toHaveTextContent("Proveedor actualizado.");
  });

  it("S4: a stale version maps to the fixed conflict message and no silent overwrite", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({ ok: true, data: NORTE_DETALLE });
    mockActualizar.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CONCURRENCIA_CONFLICTO",
        message: "Otro usuario modificó el proveedor; recargue y reintente",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar Distribuidora Norte" }));
    });
    const dialogo = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(
      await within(dialogo).findByText(
        "Otro usuario modificó el proveedor; recargue y reintente",
      ),
    ).toBeInTheDocument();
  });

  it("shows the refusal when the fresh read fails and opens no dialog", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({
      ok: false,
      error: { code: "PROVEEDOR_NO_ENCONTRADO", message: "El proveedor no existe en la empresa" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar Distribuidora Norte" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("El proveedor no existe en la empresa");
  });
});

describe("ProveedoresScreen — deactivate with confirmation (S4)", () => {
  it("asks first, then deactivates and refreshes; the supplier is never deleted", async () => {
    montar();
    mockDesactivar.mockResolvedValueOnce({ ok: true, data: { id: 4 } });
    resolverListado(salida({ items: [SUR], total: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "Desactivar Distribuidora Norte" }));
    const dialogo = screen.getByRole("dialog");
    expect(
      within(dialogo).getByRole("heading", { name: "Desactivar proveedor" }),
    ).toBeInTheDocument();
    expect(dialogo.textContent).toContain("Distribuidora Norte");
    expect(dialogo.textContent).toContain("No se elimina");
    expect(mockDesactivar).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    });

    expect(mockDesactivar).toHaveBeenCalledWith({ id: 4 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("status")).toHaveTextContent("Proveedor desactivado.");
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, incluirInactivos: false });
  });

  it("keeps the dialog open with the server reason when deactivation is refused", async () => {
    montar();
    mockDesactivar.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "PROVEEDOR_TIENE_COMPRAS",
        message: "El proveedor tiene compras no canceladas y no puede desactivarse",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Desactivar Distribuidora Norte" }));
    const dialogo = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    });

    expect(
      await within(dialogo).findByText(
        "El proveedor tiene compras no canceladas y no puede desactivarse",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockListar).not.toHaveBeenCalled();
  });
});
