/**
 * @jest-environment jsdom
 *
 * Proveedores route gating (odd/tasks/proveedores.md, T1: S3, S4). Session,
 * tenant resolution and the actions are mocked; the page is an async server
 * component, so it is awaited and its element tree rendered.
 *
 * S3: the Administrador manages, Operador and Despachador are view-only. The
 * manage controls come from the permission seam
 * (`obtenerPermisosProveedorAction` reading the named role groups), never from
 * a literal role name here, and a failed permission call denies by default
 * without breaking the read-only list.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import ProveedoresPage from "@/app/(app)/proveedores/page";
import {
  listarProveedoresAction,
  obtenerPermisosProveedorAction,
} from "@/modules/proveedor/http/actions";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { ProveedorDto } from "@/modules/proveedor/http/shared";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));

jest.mock("@/modules/proveedor/http/actions", () => ({
  listarProveedoresAction: jest.fn(),
  obtenerProveedorAction: jest.fn(),
  obtenerPermisosProveedorAction: jest.fn(),
  crearProveedorAction: jest.fn(),
  actualizarProveedorAction: jest.fn(),
  desactivarProveedorAction: jest.fn(),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    readonly href?: string;
    readonly children?: React.ReactNode;
  }) => (
    <a href={href ?? "#"} {...rest}>
      {children}
    </a>
  ),
}));

const redirect = jest.fn((destino: string): never => {
  throw new Error(`NEXT_REDIRECT:${destino}`);
});
jest.mock("next/navigation", () => ({
  __esModule: true,
  redirect: (destino: string) => redirect(destino),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

const mockListar = jest.mocked(listarProveedoresAction);
const mockPermisos = jest.mocked(obtenerPermisosProveedorAction);
const mockContexto = jest.mocked(getCurrentTenantContext);

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

function salida() {
  return { items: [NORTE], total: 1, page: 1 };
}

async function renderizarPagina(): Promise<void> {
  render(await ProveedoresPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  mockListar.mockReset();
  mockPermisos.mockReset();
  redirect.mockClear();
  mockContexto.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
  } as Awaited<ReturnType<typeof getCurrentTenantContext>>);
  mockListar.mockResolvedValue({ ok: true, data: salida() });
});

afterEach(cleanup);

describe("ProveedoresPage — role gate (S3)", () => {
  it("renders the list and the manage controls for Administrador", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: true } });

    await renderizarPagina();

    expect(screen.getByRole("heading", { name: "Proveedores" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Nuevo proveedor" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editar Distribuidora Norte" }),
    ).toBeInTheDocument();
    // The first load goes through the screen's own action, not a direct query.
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, incluirInactivos: false });
  });

  it("renders a view-only list with no manage controls", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: false } });

    await renderizarPagina();

    expect(screen.getByTestId("proveedor-fila-4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Nuevo proveedor" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Editar Distribuidora Norte" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Desactivar Distribuidora Norte" }),
    ).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
  });

  it("denies by default when the permission call rejects, and still shows the list", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("db down"));

    await renderizarPagina();

    expect(screen.getByTestId("proveedor-fila-4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Nuevo proveedor" })).toBeNull();
  });

  it("forwards the search and estado query parameters to the listing action", async () => {
    mockPermisos.mockResolvedValue({ ok: true, data: { puedeGestionar: false } });

    render(
      await ProveedoresPage({
        searchParams: Promise.resolve({ page: "2", busqueda: " norte ", estado: "todos" }),
      }),
    );

    expect(mockListar).toHaveBeenCalledWith({
      page: 2,
      limit: 25,
      incluirInactivos: true,
      buscar: "norte",
    });
  });

  it("redirects to /login without a session and never asks for data", async () => {
    mockContexto.mockResolvedValueOnce(null);

    await expect(
      ProveedoresPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(redirect).toHaveBeenCalledWith("/login");
    expect(mockListar).not.toHaveBeenCalled();
    expect(mockPermisos).not.toHaveBeenCalled();
  });
});
