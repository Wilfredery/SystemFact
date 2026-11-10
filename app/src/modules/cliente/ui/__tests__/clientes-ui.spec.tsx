/**
 * @jest-environment jsdom
 *
 * Clientes screen tests (odd/tasks/clientes.md, T1: S1-S4). The `"use server"`
 * action module is mocked at the HTTP boundary, so the island is tested against
 * the actions' result contract, never a database.
 *
 * S3 is asserted as ZERO markup, not as disabled controls: a view-only caller
 * (Operador, Despachador) gets no manage button, no actions column and no credit
 * fields at all — hiding is the courtesy, the actions re-check on the server.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  ClientesScreen,
  type ClientesInicial,
} from "../ClientesScreen";
import type { FiltrosClientes } from "../clientes-filtros";
import {
  actualizarClienteAction,
  crearClienteAction,
  desactivarClienteAction,
  listarClientesAction,
  obtenerClienteAction,
} from "@/modules/cliente/http/actions";
import type { ClienteDto } from "@/modules/cliente/http/shared";

jest.mock("@/modules/cliente/http/actions", () => ({
  listarClientesAction: jest.fn(),
  obtenerClienteAction: jest.fn(),
  crearClienteAction: jest.fn(),
  actualizarClienteAction: jest.fn(),
  desactivarClienteAction: jest.fn(),
  obtenerPermisosClienteAction: jest.fn(),
}));

const mockListar = jest.mocked(listarClientesAction);
const mockObtener = jest.mocked(obtenerClienteAction);
const mockCrear = jest.mocked(crearClienteAction);
const mockActualizar = jest.mocked(actualizarClienteAction);
const mockDesactivar = jest.mocked(desactivarClienteAction);

const FILTROS: FiltrosClientes = { busqueda: "", estado: "activos" };

const ACME: ClienteDto = {
  id: 4,
  nombre: "Acme SRL",
  telefono: "809-555-0000",
  direccion: "Av. 1",
  identificacionFiscal: "131045677",
  tipoCliente: "MAYORISTA",
  esConsumidorFinal: false,
  creditoHabilitado: true,
  limiteCredito: "20000.00",
  plazoCreditoDias: 30,
  activo: true,
  version: 3,
};

const JUAN: ClienteDto = {
  ...ACME,
  id: 5,
  nombre: "Juan Pérez",
  telefono: "809-555-1111",
  identificacionFiscal: "00113918205",
  tipoCliente: "MINORISTA",
  creditoHabilitado: false,
  limiteCredito: "0.00",
  plazoCreditoDias: 30,
};

type ListadoClientes = {
  items: ClienteDto[];
  total: number;
  page: number;
  limit: number;
};

function salida(parcial: Partial<ListadoClientes> = {}): ListadoClientes {
  return { items: [ACME, JUAN], total: 2, page: 1, limit: 25, ...parcial };
}

function montar({
  inicial = { ok: true, data: salida() },
  puedeGestionar = true,
  puedeVerCredito = true,
  filtros = FILTROS,
}: {
  inicial?: ClientesInicial;
  puedeGestionar?: boolean;
  puedeVerCredito?: boolean;
  filtros?: FiltrosClientes;
} = {}) {
  return render(
    <ClientesScreen
      inicial={inicial}
      filtrosIniciales={filtros}
      puedeGestionar={puedeGestionar}
      puedeVerCredito={puedeVerCredito}
    />,
  );
}

function resolverListado(data: ListadoClientes): void {
  mockListar.mockResolvedValueOnce({ ok: true, data });
}

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("ClientesScreen — list, filters and pagination (S1, S4)", () => {
  it("renders one row per client with RNC, phone, type, credit and status", () => {
    montar();

    for (const columna of [
      "Nombre",
      "RNC / Cédula",
      "Teléfono",
      "Tipo",
      "Crédito",
      "Límite",
      "Plazo",
      "Estado",
    ]) {
      expect(screen.getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }

    const acme = within(screen.getByTestId("cliente-fila-4"));
    expect(acme.getByText("Acme SRL")).toBeInTheDocument();
    expect(acme.getByText("131045677")).toBeInTheDocument();
    expect(acme.getByText("809-555-0000")).toBeInTheDocument();
    expect(acme.getByText("Mayorista")).toBeInTheDocument();
    expect(acme.getByText("Sí")).toBeInTheDocument();
    expect(acme.getByText("RD$ 20,000.00")).toBeInTheDocument();
    expect(acme.getByText("30 días")).toBeInTheDocument();
    expect(acme.getByText("Activo")).toBeInTheDocument();
  });

  it("S3: a view-only caller (Operador/Despachador) gets no manage markup and no credit fields", () => {
    montar({ puedeGestionar: false, puedeVerCredito: false });

    expect(screen.queryByRole("button", { name: "+ Nuevo cliente" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Desactivar/ })).toBeNull();

    // Credit fields are admin-only even in view mode (S3).
    for (const columna of ["Crédito", "Límite", "Plazo"]) {
      expect(screen.queryByRole("columnheader", { name: columna })).toBeNull();
    }
    expect(screen.queryByText("RD$ 20,000.00")).toBeNull();

    // The read side still works: they sell to and collect from these clients.
    expect(screen.getByLabelText("Buscar cliente")).toBeInTheDocument();
    expect(screen.getByTestId("cliente-fila-4")).toBeInTheDocument();

    // Rows plus an error alert cannot co-exist: the alert only replaces the
    // list (`inicial.ok === false`) or reports a failed re-query. The E2E
    // assertion this pins is scoped to `main` for that reason.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("S3: the manage caller sees the create control, the row actions and the credit columns", () => {
    montar();

    expect(screen.getByRole("button", { name: "+ Nuevo cliente" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Acme SRL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desactivar Acme SRL" })).toBeInTheDocument();
  });

  it("S1: the status filter re-queries from page 1 with the chosen estado", async () => {
    montar();
    resolverListado(salida({ items: [JUAN], total: 1 }));

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
        target: { value: "todos" },
      });
    });

    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "todos" });
    await waitFor(() => expect(screen.getByTestId("cliente-fila-5")).toBeInTheDocument());
  });

  it("S1: the search is debounced and searches by name or RNC/cédula", async () => {
    montar();
    jest.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Buscar cliente"), {
      target: { value: "  acme " },
    });
    expect(mockListar).not.toHaveBeenCalled();

    resolverListado(salida({ items: [ACME], total: 1 }));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mockListar).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      estado: "activos",
      buscar: "acme",
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

    expect(mockListar).toHaveBeenCalledWith({ page: 2, limit: 25, estado: "activos" });
    await waitFor(() => expect(screen.getByText("Página 2 de 3")).toBeInTheDocument());
  });

  it("shows the empty state and the server refusal message", () => {
    montar({ inicial: { ok: true, data: salida({ items: [], total: 0 }) } });
    expect(
      screen.getByText("No hay clientes que coincidan con los filtros."),
    ).toBeInTheDocument();
    cleanup();

    montar({ inicial: { ok: false, message: "No tiene permisos para listar clientes" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tiene permisos para listar clientes",
    );
  });
});

describe("ClientesScreen — create dialog (S1, S3)", () => {
  it("collects the contact, fiscal and credit fields and calls crearClienteAction", async () => {
    montar();
    mockCrear.mockResolvedValueOnce({ ok: true, data: ACME });
    resolverListado(salida({ items: [ACME], total: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo cliente" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("heading", { name: "Nuevo cliente" })).toBeInTheDocument();

    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Comercial Nueva SRL" },
    });
    fireEvent.change(within(dialogo).getByLabelText("RNC / Cédula"), {
      target: { value: "131045677" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-2222" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Dirección *"), {
      target: { value: "Calle 2" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Tipo de cliente *"), {
      target: { value: "MAYORISTA" },
    });
    fireEvent.click(within(dialogo).getByLabelText("Habilitar crédito"));
    fireEvent.change(within(dialogo).getByLabelText("Límite de crédito"), {
      target: { value: "15000.00" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Plazo de crédito (días)"), {
      target: { value: "15" },
    });

    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(mockCrear).toHaveBeenCalledWith({
      nombre: "Comercial Nueva SRL",
      identificacionFiscal: "131045677",
      telefono: "809-555-2222",
      direccion: "Calle 2",
      tipoCliente: "MAYORISTA",
      creditoHabilitado: true,
      limiteCredito: "15000.00",
      plazoCreditoDias: 15,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "activos" });
    expect(await screen.findByRole("status")).toHaveTextContent("Cliente creado.");
  });

  it("S3: credit fields are absent for a caller without credit visibility and never sent", async () => {
    montar({ puedeGestionar: true, puedeVerCredito: false });
    mockCrear.mockResolvedValueOnce({ ok: true, data: JUAN });

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo cliente" }));
    const dialogo = screen.getByRole("dialog");

    expect(within(dialogo).queryByLabelText("Habilitar crédito")).toBeNull();
    expect(within(dialogo).queryByLabelText("Límite de crédito")).toBeNull();
    expect(within(dialogo).queryByLabelText("Plazo de crédito (días)")).toBeNull();

    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Juan Pérez" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-1111" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Dirección *"), {
      target: { value: "Calle 3" },
    });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(mockCrear).toHaveBeenCalledWith({
      nombre: "Juan Pérez",
      identificacionFiscal: null,
      telefono: "809-555-1111",
      direccion: "Calle 3",
      tipoCliente: "MINORISTA",
    });
  });

  it("S4: an RNC/cédula the DGII rule refuses is stopped in the form (no action call)", async () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo cliente" }));
    const dialogo = screen.getByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Acme SRL" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-0000" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Dirección *"), {
      target: { value: "Av. 1" },
    });
    fireEvent.change(within(dialogo).getByLabelText("RNC / Cédula"), {
      target: { value: "123456789" },
    });

    expect(within(dialogo).getByText(/RNC .*cédula/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Guardar" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });
    expect(mockCrear).not.toHaveBeenCalled();
  });

  it("S4: a credit limit the server would refuse is stopped in the form", async () => {
    montar();

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo cliente" }));
    const dialogo = screen.getByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Acme SRL" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-0000" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Dirección *"), {
      target: { value: "Av. 1" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Límite de crédito"), {
      target: { value: "15,000" },
    });

    expect(within(dialogo).getByText(/Monto inválido/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("shows the server message and keeps the dialog open when creation is refused", async () => {
    montar();
    mockCrear.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CLIENTE_IDENTIFICACION_DUPLICADA",
        message: "Ya existe un cliente activo con esa identificación fiscal en la empresa",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo cliente" }));
    const dialogo = screen.getByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Nombre o razón social *"), {
      target: { value: "Acme SRL" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-0000" },
    });
    fireEvent.change(within(dialogo).getByLabelText("Dirección *"), {
      target: { value: "Av. 1" },
    });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(
      await within(dialogo).findByText(
        "Ya existe un cliente activo con esa identificación fiscal en la empresa",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ClientesScreen — edit dialog (S1, S4)", () => {
  it("prefills from a fresh single-client read and submits id + version", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({ ok: true, data: ACME });
    mockActualizar.mockResolvedValueOnce({ ok: true, data: { ...ACME, version: 4 } });
    resolverListado(salida());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar Acme SRL" }));
    });

    expect(mockObtener).toHaveBeenCalledWith({ id: 4 });
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByRole("heading", { name: "Editar cliente" })).toBeInTheDocument();
    expect(within(dialogo).getByLabelText("Nombre o razón social *")).toHaveValue("Acme SRL");
    expect(within(dialogo).getByLabelText("RNC / Cédula")).toHaveValue("131045677");
    expect(within(dialogo).getByLabelText("Teléfono *")).toHaveValue("809-555-0000");
    expect(within(dialogo).getByLabelText("Dirección *")).toHaveValue("Av. 1");
    expect(within(dialogo).getByLabelText("Tipo de cliente *")).toHaveValue("MAYORISTA");
    expect(within(dialogo).getByLabelText("Límite de crédito")).toHaveValue("20000.00");
    expect(within(dialogo).getByLabelText("Plazo de crédito (días)")).toHaveValue(30);

    fireEvent.change(within(dialogo).getByLabelText("Teléfono *"), {
      target: { value: "809-555-9999" },
    });
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(mockActualizar).toHaveBeenCalledWith({
      id: 4,
      version: 3,
      nombre: "Acme SRL",
      identificacionFiscal: "131045677",
      telefono: "809-555-9999",
      direccion: "Av. 1",
      tipoCliente: "MAYORISTA",
      creditoHabilitado: true,
      limiteCredito: "20000.00",
      plazoCreditoDias: 30,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("status")).toHaveTextContent("Cliente actualizado.");
  });

  it("S4: a stale version maps to the fixed conflict message and no silent overwrite", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({ ok: true, data: ACME });
    mockActualizar.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CONCURRENCIA_CONFLICTO",
        message: "Otro usuario modificó el cliente; recargue y reintente",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar Acme SRL" }));
    });
    const dialogo = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    });

    expect(
      await within(dialogo).findByText(
        "Otro usuario modificó el cliente; recargue y reintente",
      ),
    ).toBeInTheDocument();
  });

  it("shows the refusal when the fresh read fails and opens no dialog", async () => {
    montar();
    mockObtener.mockResolvedValueOnce({
      ok: false,
      error: { code: "CLIENTE_NO_ENCONTRADO", message: "El cliente no existe en la empresa" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Editar Acme SRL" }));
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("El cliente no existe en la empresa");
  });
});

describe("ClientesScreen — deactivate with confirmation (S4)", () => {
  it("asks first, then deactivates and refreshes; the client is never deleted", async () => {
    montar();
    mockDesactivar.mockResolvedValueOnce({ ok: true, data: { id: 4 } });
    resolverListado(salida({ items: [JUAN], total: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "Desactivar Acme SRL" }));
    const dialogo = screen.getByRole("dialog");
    expect(
      within(dialogo).getByRole("heading", { name: "Desactivar cliente" }),
    ).toBeInTheDocument();
    expect(dialogo.textContent).toContain("Acme SRL");
    expect(dialogo.textContent).toContain("No se elimina");
    expect(mockDesactivar).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    });

    expect(mockDesactivar).toHaveBeenCalledWith({ id: 4 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("status")).toHaveTextContent("Cliente desactivado.");
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "activos" });
  });

  it("keeps the dialog open with the server reason when deactivation is refused", async () => {
    montar();
    mockDesactivar.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CLIENTE_TIENE_VENTAS",
        message: "El cliente tiene ventas no canceladas y no puede desactivarse",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Desactivar Acme SRL" }));
    const dialogo = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialogo).getByRole("button", { name: "Desactivar" }));
    });

    expect(
      await within(dialogo).findByText(
        "El cliente tiene ventas no canceladas y no puede desactivarse",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockListar).not.toHaveBeenCalled();
  });
});
