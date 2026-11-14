/**
 * @jest-environment jsdom
 *
 * Administración screen island (odd/tasks/administracion.md, T2: S2, S6).
 * The `"use server"` action module is mocked at the HTTP boundary, so the island
 * is tested against the action result contract, never a database.
 *
 * S6: three tabs, 300 ms debounced search, tri-state `activo` filter, 25/page,
 * "Página X de Y", stale-result guard and `usuario-fila-${id}` test ids. Tab
 * switching is a URL navigation (server-first), never a client-side data load.
 */

import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  AdministracionScreen,
  type ConfiguracionInicial,
  type SucursalesInicial,
  type UsuariosInicial,
} from "../AdministracionScreen";
import type { FiltrosUsuarios } from "../administracion-tabs";
import { listarUsuariosAction } from "@/modules/tenant/http/actions.administracion";

const push = jest.fn(async () => undefined);
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

jest.mock("@/modules/tenant/http/actions.usuarios", () => ({
  cambiarRolesUsuarioAction: jest.fn(),
  cambiarEstadoUsuarioAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.administracion", () => ({
  listarUsuariosAction: jest.fn(),
  listarSucursalesDeEmpresaAction: jest.fn(),
  consultarConfiguracionAction: jest.fn(),
  obtenerPermisosAdministracionAction: jest.fn(),
}));

const mockListar = jest.mocked(listarUsuariosAction);

const FILTROS: FiltrosUsuarios = { busqueda: "", activo: "" };

function usuario(parcial: Record<string, unknown> = {}) {
  return {
    id: 10,
    nombreUsuario: "aperez",
    nombre: "Ana Pérez",
    activo: true,
    version: 1,
    sucursalNombre: "Sucursal Central",
    empresaNombre: "Empresa Demo",
    roles: ["Administrador"],
    rolIds: [1],
    ...parcial,
  };
}

function salidaUsuarios(parcial: Record<string, unknown> = {}) {
  return {
    items: [usuario(), usuario({ id: 11, nombreUsuario: "jperez", nombre: "Juan Pérez", activo: false, roles: ["Operador"], rolIds: [2] })],
    total: 2,
    page: 1,
    pageSize: 25,
    rolesCatalogo: [
      { id: 1, nombre: "Administrador" },
      { id: 2, nombre: "Operador" },
    ],
    ...parcial,
  };
}

function usuariosInicial(
  parcial: Record<string, unknown> = {},
): UsuariosInicial {
  return { ok: true, data: salidaUsuarios(parcial) };
}

function montar({
  tab = "usuarios" as const,
  filtros = FILTROS,
  usuarios = usuariosInicial(),
  sucursales = null,
  configuracion = null,
}: {
  tab?: "usuarios" | "sucursales" | "configuracion";
  filtros?: FiltrosUsuarios;
  usuarios?: UsuariosInicial | null;
  sucursales?: SucursalesInicial | null;
  configuracion?: ConfiguracionInicial | null;
} = {}) {
  return render(
    <AdministracionScreen
      tab={tab}
      filtrosIniciales={filtros}
      usuarios={usuarios}
      sucursales={sucursales}
      configuracion={configuracion}
      puedeGestionar={false}
      sesionUsuarioId={1}
    />,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  push.mockResolvedValue(undefined);
  mockListar.mockResolvedValue({ ok: true, data: salidaUsuarios() });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("AdministracionScreen — Usuarios tab (S2a)", () => {
  it("renders the wireframe columns, one row per user, state badges and NO Acciones column", () => {
    montar();

    for (const columna of ["Usuario", "Nombre", "Rol", "Empresa/Sucursal", "Estado"]) {
      expect(screen.getByRole("columnheader", { name: columna })).toBeInTheDocument();
    }
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();

    const fila = screen.getByTestId("usuario-fila-10");
    expect(within(fila).getByText("aperez")).toBeInTheDocument();
    expect(within(fila).getByText("Ana Pérez")).toBeInTheDocument();
    expect(within(fila).getByText("Administrador")).toBeInTheDocument();
    expect(within(fila).getByText("Empresa Demo / Sucursal Central")).toBeInTheDocument();
    expect(within(fila).getByText("Activo")).toBeInTheDocument();
    expect(within(screen.getByTestId("usuario-fila-11")).getByText("Inactivo")).toBeInTheDocument();
  });

  it("shows the empty state when no user matches the filters", () => {
    montar({ usuarios: { ok: true, data: salidaUsuarios({ items: [], total: 0 }) } });

    expect(
      screen.getByText("No hay usuarios que coincidan con los filtros."),
    ).toBeInTheDocument();
  });

  it("debounces the search 300 ms and re-queries page 1 with the trimmed term", async () => {
    jest.useFakeTimers();
    montar();

    fireEvent.change(screen.getByLabelText("Buscar usuario"), {
      target: { value: "  ana  " },
    });
    expect(mockListar).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mockListar).toHaveBeenCalledWith({ page: 1, pageSize: 25, buscar: "ana" });
  });

  it("sends activo=true and activo=false for the tri-state filter", async () => {
    montar();

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
      target: { value: "false" },
    });
    await act(async () => {});

    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, activo: false });

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
      target: { value: "true" },
    });
    await act(async () => {});

    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, activo: true });
  });

  it("omits activo entirely for the 'Todos' option", async () => {
    montar({ filtros: { busqueda: "", activo: "true" } });

    fireEvent.change(screen.getByLabelText("Filtrar por estado"), {
      target: { value: "" },
    });
    await act(async () => {});

    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, pageSize: 25 });
  });

  it("paginates 25 per page with 'Página X de Y' and disables the buttons while pending", async () => {
    montar({ usuarios: usuariosInicial({ total: 60 }) });

    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();

    mockListar.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    });

    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
    expect(mockListar).toHaveBeenCalledWith({ page: 2, pageSize: 25 });
  });
});

describe("AdministracionScreen — tabs (S2/S6)", () => {
  it("switches to Sucursales by pushing the URL, never by loading data client-side", async () => {
    montar();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Sucursales" }));
    });

    expect(push).toHaveBeenCalledWith("/administracion?tab=sucursales");
    expect(mockListar).not.toHaveBeenCalled();
  });

  it("renders the read-only branch list of the Sucursales tab", () => {
    montar({
      tab: "sucursales",
      usuarios: null,
      sucursales: {
        ok: true,
        data: [
          { id: 1, nombre: "Sucursal Central" },
          { id: 2, nombre: "Sucursal Norte" },
        ],
      },
    });

    expect(screen.getByTestId("sucursal-fila-1")).toHaveTextContent("Sucursal Central");
    expect(screen.getByTestId("sucursal-fila-2")).toHaveTextContent("Sucursal Norte");
  });

  it("renders NCF sequences, retentions and the explicit ITBIS gap note (S2c)", () => {
    montar({
      tab: "configuracion",
      usuarios: null,
      configuracion: {
        ok: true,
        data: {
          retenciones: { isr15: "15", isr2: "2", itbis100: "100", itbis30: "30" },
          ncf: [
            {
              tipo: "B01",
              rangoInicio: "1",
              rangoFin: "100",
              secuenciaActual: "10",
              vigenciaFin: "2027-12-31T00:00:00.000Z",
              porcentajeUsado: 10,
            },
          ],
        },
      },
    });

    const fila = screen.getByTestId("ncf-fila-B01");
    expect(within(fila).getByText("B01")).toBeInTheDocument();
    expect(within(fila).getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("Ret. ISR servicios profesionales")).toBeInTheDocument();
    expect(screen.getByText("15%")).toBeInTheDocument();
    expect(screen.getByText(/No disponible aún/)).toBeInTheDocument();
  });
});
