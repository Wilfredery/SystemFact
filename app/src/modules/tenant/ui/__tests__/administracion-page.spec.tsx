/**
 * @jest-environment jsdom
 *
 * Administración route (odd/tasks/administracion.md, T2: S2, S6, S7). Session,
 * tenant resolution and the actions are mocked; the page is an async server
 * component, so it is awaited and its element tree rendered.
 *
 * S6: the route validates `tab`/`page`/`busqueda`/`activo` from the URL and hands
 * the first load to the island through the same action the island re-queries.
 * Deny-by-default: only `obtenerPermisosAdministracionAction().puedeVer` opens the
 * data; every other answer renders the access message and no rows.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import AdministracionPage from "@/app/(app)/administracion/page";
import {
  consultarConfiguracionAction,
  listarRolesAdministracionAction,
  listarSucursalesAdministracionAction,
  listarUsuariosAction,
  obtenerPermisosAdministracionAction,
} from "@/modules/tenant/http/actions.administracion";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantHeader: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.usuarios", () => ({
  cambiarRolesUsuarioAction: jest.fn(),
  cambiarEstadoUsuarioAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.sucursal", () => ({
  crearSucursalAction: jest.fn(),
  editarSucursalAction: jest.fn(),
}));

jest.mock("@/modules/tenant/http/actions.administracion", () => ({
  listarUsuariosAction: jest.fn(),
  listarSucursalesDeEmpresaAction: jest.fn(),
  listarSucursalesAdministracionAction: jest.fn(),
  listarRolesAdministracionAction: jest.fn(),
  consultarConfiguracionAction: jest.fn(),
  obtenerPermisosAdministracionAction: jest.fn(),
}));

const redirect = jest.fn((destino: string): never => {
  throw new Error(`NEXT_REDIRECT:${destino}`);
});
jest.mock("next/navigation", () => ({
  __esModule: true,
  redirect: (destino: string) => redirect(destino),
  useRouter: () => ({ push: jest.fn() }),
}));

// The new config write action (feature itbis-tasas-edit) is mocked at the
// HTTP boundary like the other write actions; its real module graph pulls
// the server-only Prisma client that jsdom cannot load.
jest.mock("@/modules/tenant/http/actions.configuracion", () => ({
  editarTasasItbisAction: jest.fn(),
}));

const mockListar = jest.mocked(listarUsuariosAction);
const mockSucursales = jest.mocked(listarSucursalesAdministracionAction);
const mockRoles = jest.mocked(listarRolesAdministracionAction);
const mockConfiguracion = jest.mocked(consultarConfiguracionAction);
const mockPermisos = jest.mocked(obtenerPermisosAdministracionAction);
const mockContexto = jest.mocked(getCurrentTenantHeader);

function usuario(parcial: Record<string, unknown> = {}) {
  return {
    id: 10,
    nombreUsuario: "aperez",
    nombre: "Ana Pérez",
    activo: true,
    version: 1,
    sucursalNombre: "Sucursal Central",
    sucursalId: 1,
    esDeOtraSucursal: false,
    empresaNombre: "Empresa Demo",
    roles: ["Administrador"],
    rolIds: [1],
    ...parcial,
  };
}

function salidaUsuarios(parcial: Record<string, unknown> = {}) {
  return {
    items: [usuario()],
    total: 1,
    page: 1,
    pageSize: 25,
    rolesCatalogo: [{ id: 1, nombre: "Administrador" }],
    ...parcial,
  };
}

async function renderizarPagina(
  params: Record<string, string | string[]> = {},
): Promise<void> {
  render(await AdministracionPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  mockListar.mockReset();
  mockSucursales.mockReset();
  mockConfiguracion.mockReset();
  mockRoles.mockReset();
  mockPermisos.mockReset();
  mockContexto.mockReset();
  redirect.mockClear();
  mockContexto.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
    esAdmin: false,
    empresaNombre: "Empresa Demo",
    sucursalNombre: "Sucursal Central",
  } as Awaited<ReturnType<typeof getCurrentTenantHeader>>);
  mockPermisos.mockResolvedValue({ ok: true, data: { puedeVer: true } });
  mockRoles.mockResolvedValue({
    ok: true,
    data: [
      { id: 1, nombre: "Administrador" },
      { id: 2, nombre: "Operador" },
    ],
  });
  mockListar.mockResolvedValue({ ok: true, data: salidaUsuarios() });
  mockSucursales.mockResolvedValue({
    ok: true,
    data: [{ id: 1, nombre: "Sucursal Central", direccion: "Calle 1", telefono: "809-555-0001", activa: true, version: 1 }],
  });
  mockConfiguracion.mockResolvedValue({
    ok: true,
    data: {
      retenciones: { isr15: "15", isr2: "2", itbis100: "100", itbis30: "30" },
      ncf: [],
      itbisEnUso: [],
      tasaItbis: null,
    },
  });
});

afterEach(cleanup);

describe("AdministracionPage — access gate (S6)", () => {
  it("redirects to /login when there is no session context", async () => {
    mockContexto.mockResolvedValueOnce(null);

    await expect(renderizarPagina()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("renders the directory for a permitted caller", async () => {
    await renderizarPagina({ tab: "usuarios" });

    expect(screen.getByRole("heading", { name: "Administración" })).toBeInTheDocument();
    expect(screen.getByTestId("usuario-fila-10")).toBeInTheDocument();
  });

  it("renders the access message and no data for an Operador/Despachador (puedeVer false)", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeVer: false } });

    await renderizarPagina({ tab: "usuarios" });

    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent("No tiene permisos para ver la Administración.");
    expect(screen.queryByTestId("usuario-fila-10")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Secciones de Administración" })).not.toBeInTheDocument();
  });

  it("denies by default when the permission probe fails", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("boom"));

    await renderizarPagina();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tiene permisos para ver la Administración.",
    );
    expect(screen.queryByTestId("usuario-fila-10")).not.toBeInTheDocument();
  });
});

describe("AdministracionPage — write affordances (administracion-writes S11)", () => {
  it("gives the Administrador the Acciones column, with the session user's own row disabled", async () => {
    mockContexto.mockResolvedValue({
      empresaId: 1,
      sucursalId: 1,
      usuarioId: 10,
      esAdmin: true,
      empresaNombre: "Empresa Demo",
      sucursalNombre: "Sucursal Central",
    } as Awaited<ReturnType<typeof getCurrentTenantHeader>>);
    mockListar.mockResolvedValue({
      ok: true,
      data: salidaUsuarios({ items: [usuario(), usuario({ id: 11, nombreUsuario: "jperez" })], total: 2 }),
    });

    await renderizarPagina({ tab: "usuarios" });

    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("usuario-fila-10")).getByRole("button", { name: "Cambiar roles" }),
    ).toBeDisabled();
    expect(
      within(screen.getByTestId("usuario-fila-11")).getByRole("button", { name: "Cambiar roles" }),
    ).toBeEnabled();
  });

  it("renders no controls at all for a caller the server does not permit (access message only)", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeVer: false } });

    await renderizarPagina();

    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("AdministracionPage — URL contract (S6)", () => {
  it("defaults to the Empresas tab (S1): branches read, no user/config/role read", async () => {
    await renderizarPagina();

    expect(mockSucursales).toHaveBeenCalled();
    expect(mockListar).not.toHaveBeenCalled();
    expect(mockConfiguracion).not.toHaveBeenCalled();
    expect(mockRoles).not.toHaveBeenCalled();
    expect(screen.getByTestId("empresa-fila")).toHaveTextContent("Empresa Demo");
  });

  it("reads Usuarios with page 1 and no filters when tab=usuarios", async () => {
    await renderizarPagina({ tab: "usuarios" });

    expect(mockListar).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    expect(mockSucursales).not.toHaveBeenCalled();
    expect(mockConfiguracion).not.toHaveBeenCalled();
  });

  it("passes busqueda, page and the tri-state activo to the Usuarios action", async () => {
    await renderizarPagina({ tab: "usuarios", busqueda: "ana", page: "2", activo: "false" });

    expect(mockListar).toHaveBeenCalledWith({
      page: 2,
      pageSize: 25,
      buscar: "ana",
      activo: false,
    });
  });

  it("sends activo=true for the active filter and drops an unknown value", async () => {
    await renderizarPagina({ tab: "usuarios", activo: "true" });
    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, activo: true });

    await renderizarPagina({ tab: "usuarios", activo: "verdadero" });
    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, pageSize: 25 });
  });

  it("slices the search term to 100 characters", async () => {
    await renderizarPagina({ tab: "usuarios", busqueda: "a".repeat(150) });

    expect(mockListar).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      buscar: "a".repeat(100),
    });
  });

  it("reads the Sucursales tab through its own action", async () => {
    await renderizarPagina({ tab: "sucursales" });

    expect(mockSucursales).toHaveBeenCalled();
    expect(mockListar).not.toHaveBeenCalled();
    expect(screen.getByTestId("sucursal-fila-1")).toBeInTheDocument();
  });

  it("passes the session branch from the tenant context: Desactivar is disabled on it", async () => {
    mockSucursales.mockResolvedValue({
      ok: true,
      data: [
        { id: 1, nombre: "Sucursal Central", direccion: "Calle 1", telefono: "809-555-0001", activa: true, version: 1 },
        { id: 2, nombre: "Sucursal Norte", direccion: "Calle 2", telefono: "809-555-0002", activa: true, version: 1 },
      ],
    });
    await renderizarPagina({ tab: "sucursales" });

    expect(within(screen.getByTestId("sucursal-fila-1")).getByRole("button", { name: "Desactivar" })).toBeDisabled();
    expect(within(screen.getByTestId("sucursal-fila-2")).getByRole("button", { name: "Desactivar" })).toBeEnabled();
  });

  it("reads the Configuración tab through its own action", async () => {
    await renderizarPagina({ tab: "configuracion" });

    expect(mockConfiguracion).toHaveBeenCalled();
    expect(mockListar).not.toHaveBeenCalled();
    expect(
      screen.getByText("Sin productos activos: no hay tasas de ITBIS en uso."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No disponible aún/)).not.toBeInTheDocument();
  });

  it("falls back to Empresas for an unknown tab (S1)", async () => {
    await renderizarPagina({ tab: "bogus" });

    expect(mockListar).not.toHaveBeenCalled();
    expect(mockSucursales).toHaveBeenCalled();
    expect(screen.getByTestId("empresa-fila")).toBeInTheDocument();
  });

  it("shows the new tab's rows when the tab changes on the same route (remount per tab)", async () => {
    const { rerender } = render(
      await AdministracionPage({ searchParams: Promise.resolve({ tab: "empresas" }) }),
    );
    expect(screen.getByTestId("empresa-fila")).toBeInTheDocument();

    rerender(await AdministracionPage({ searchParams: Promise.resolve({ tab: "usuarios" }) }));

    expect(screen.getByTestId("usuario-fila-10")).toBeInTheDocument();
    expect(screen.queryByTestId("empresa-fila")).not.toBeInTheDocument();
  });

  it("reads the Roles tab through its own action (S3)", async () => {
    await renderizarPagina({ tab: "roles" });

    expect(mockRoles).toHaveBeenCalled();
    expect(mockListar).not.toHaveBeenCalled();
    expect(mockSucursales).not.toHaveBeenCalled();
    expect(screen.getByTestId("rol-fila-1")).toHaveTextContent("Administrador");
  });
});

describe("AdministracionPage — legacy links without tab (board 08 follow-up S2)", () => {
  it.each([
    [{ busqueda: "x" }, { page: 1, pageSize: 25, buscar: "x" }],
    [{ activo: "false" }, { page: 1, pageSize: 25, activo: false }],
    [{ page: "2" }, { page: 2, pageSize: 25 }],
  ])("opens Usuarios for %j", async (params, query) => {
    await renderizarPagina(params);

    expect(mockListar).toHaveBeenCalledWith(query);
    expect(mockSucursales).not.toHaveBeenCalled();
    expect(screen.getByTestId("usuario-fila-10")).toBeInTheDocument();
  });

  it("still opens Empresas with no params", async () => {
    await renderizarPagina({});

    expect(mockListar).not.toHaveBeenCalled();
    expect(mockSucursales).toHaveBeenCalled();
  });

  it("an explicit unknown tab wins over legacy params and falls back to Empresas", async () => {
    await renderizarPagina({ tab: "bogus", busqueda: "x" });

    expect(mockListar).not.toHaveBeenCalled();
    expect(mockSucursales).toHaveBeenCalled();
  });
});

describe("AdministracionPage — Empresas and Roles are Administrador-only (S9)", () => {
  it.each(["empresas", "roles"])(
    "renders only the access alert and no data on tab=%s when the server denies",
    async (tab) => {
      mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeVer: false } });

      await renderizarPagina({ tab });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "No tiene permisos para ver la Administración.",
      );
      expect(screen.queryByTestId("empresa-fila")).not.toBeInTheDocument();
      expect(screen.queryByTestId("rol-fila-1")).not.toBeInTheDocument();
      expect(screen.queryByText("Empresa Demo")).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it.each(["empresas", "roles"])(
    "denies by default on tab=%s when the permission probe fails",
    async (tab) => {
      mockPermisos.mockRejectedValueOnce(new Error("boom"));

      await renderizarPagina({ tab });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "No tiene permisos para ver la Administración.",
      );
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    },
  );
});
