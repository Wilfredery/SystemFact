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
  listarSucursalesDeEmpresaAction,
  listarUsuariosAction,
  obtenerPermisosAdministracionAction,
} from "@/modules/tenant/http/actions.administracion";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
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

const redirect = jest.fn((destino: string): never => {
  throw new Error(`NEXT_REDIRECT:${destino}`);
});
jest.mock("next/navigation", () => ({
  __esModule: true,
  redirect: (destino: string) => redirect(destino),
  useRouter: () => ({ push: jest.fn() }),
}));

const mockListar = jest.mocked(listarUsuariosAction);
const mockSucursales = jest.mocked(listarSucursalesDeEmpresaAction);
const mockConfiguracion = jest.mocked(consultarConfiguracionAction);
const mockPermisos = jest.mocked(obtenerPermisosAdministracionAction);
const mockContexto = jest.mocked(getCurrentTenantContext);

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
  mockPermisos.mockReset();
  mockContexto.mockReset();
  redirect.mockClear();
  mockContexto.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
    esAdmin: false,
  } as Awaited<ReturnType<typeof getCurrentTenantContext>>);
  mockPermisos.mockResolvedValue({ ok: true, data: { puedeVer: true } });
  mockListar.mockResolvedValue({ ok: true, data: salidaUsuarios() });
  mockSucursales.mockResolvedValue({
    ok: true,
    data: [{ id: 1, nombre: "Sucursal Central" }],
  });
  mockConfiguracion.mockResolvedValue({
    ok: true,
    data: {
      retenciones: { isr15: "15", isr2: "2", itbis100: "100", itbis30: "30" },
      ncf: [],
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
    await renderizarPagina();

    expect(screen.getByRole("heading", { name: "Administración" })).toBeInTheDocument();
    expect(screen.getByTestId("usuario-fila-10")).toBeInTheDocument();
  });

  it("renders the access message and no data for an Operador/Despachador (puedeVer false)", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeVer: false } });

    await renderizarPagina();

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
    } as Awaited<ReturnType<typeof getCurrentTenantContext>>);
    mockListar.mockResolvedValue({
      ok: true,
      data: salidaUsuarios({ items: [usuario(), usuario({ id: 11, nombreUsuario: "jperez" })], total: 2 }),
    });

    await renderizarPagina();

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
  it("defaults to the Usuarios tab with page 1 and no filters", async () => {
    await renderizarPagina();

    expect(mockListar).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    expect(mockSucursales).not.toHaveBeenCalled();
    expect(mockConfiguracion).not.toHaveBeenCalled();
  });

  it("passes busqueda, page and the tri-state activo to the Usuarios action", async () => {
    await renderizarPagina({ busqueda: "ana", page: "2", activo: "false" });

    expect(mockListar).toHaveBeenCalledWith({
      page: 2,
      pageSize: 25,
      buscar: "ana",
      activo: false,
    });
  });

  it("sends activo=true for the active filter and drops an unknown value", async () => {
    await renderizarPagina({ activo: "true" });
    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, activo: true });

    await renderizarPagina({ activo: "verdadero" });
    expect(mockListar).toHaveBeenLastCalledWith({ page: 1, pageSize: 25 });
  });

  it("slices the search term to 100 characters", async () => {
    await renderizarPagina({ busqueda: "a".repeat(150) });

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

  it("reads the Configuración tab through its own action", async () => {
    await renderizarPagina({ tab: "configuracion" });

    expect(mockConfiguracion).toHaveBeenCalled();
    expect(mockListar).not.toHaveBeenCalled();
    expect(screen.getByText(/No disponible aún/)).toBeInTheDocument();
  });

  it("falls back to Usuarios for an unknown tab", async () => {
    await renderizarPagina({ tab: "bogus" });

    expect(mockListar).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    expect(mockSucursales).not.toHaveBeenCalled();
  });
});
