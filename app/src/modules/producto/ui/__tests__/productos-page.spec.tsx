/**
 * @jest-environment jsdom
 *
 * Productos route gating (odd/tasks/productos.md, T1: S3, S4). Session, tenant
 * resolution and the actions are mocked; the page is an async server component,
 * so it is awaited and its element tree rendered.
 *
 * S3: the Administrador manages, Operador and Despachador are view-only. The
 * manage controls come from the permission seam (`obtenerPermisosProductoAction`
 * reading the manage role group), never from a literal role name here.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import ProductosPage from "@/app/(app)/productos/page";
import {
  consultarProductosAction,
  obtenerPermisosProductoAction,
} from "@/modules/producto/http/actions";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { ConsultarProductosOutput } from "@/modules/producto/application/consultar-productos";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));

jest.mock("@/modules/producto/http/actions", () => ({
  consultarProductosAction: jest.fn(),
  obtenerProductoPorIdAction: jest.fn(),
  obtenerPermisosProductoAction: jest.fn(),
  crearProductoAction: jest.fn(),
  actualizarProductoAction: jest.fn(),
  desactivarProductoAction: jest.fn(),
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

const mockConsultar = jest.mocked(consultarProductosAction);
const mockPermisos = jest.mocked(obtenerPermisosProductoAction);
const mockContexto = jest.mocked(getCurrentTenantContext);

function salida(): ConsultarProductosOutput {
  return {
    items: [
      {
        id: 7,
        codigo: "P-007",
        nombre: "Arroz",
        descripcion: null,
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
      },
    ],
    total: 1,
    page: 1,
    limit: 25,
    categorias: [{ id: 3, nombre: "Granos" }],
  };
}

async function renderizarPagina(): Promise<void> {
  render(
    await ProductosPage({ searchParams: Promise.resolve({}) }),
  );
}

beforeEach(() => {
  mockConsultar.mockReset();
  mockPermisos.mockReset();
  redirect.mockClear();
  mockContexto.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
  } as Awaited<ReturnType<typeof getCurrentTenantContext>>);
  mockConsultar.mockResolvedValue({ ok: true, data: salida() });
});

afterEach(cleanup);

describe("ProductosPage — role gate (S3)", () => {
  it("renders the list and the manage controls for a caller who may manage", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: true } });

    await renderizarPagina();

    expect(screen.getByRole("heading", { name: "Productos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Nuevo producto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar P-007" })).toBeInTheDocument();
    // The first load goes through the screen's own action, not a direct query.
    expect(mockConsultar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "activos" });
  });

  it("renders a view-only list (no manage controls) for Operador and Despachador", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: false } });

    await renderizarPagina();

    expect(screen.getByTestId("producto-fila-7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Nuevo producto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar P-007" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desactivar P-007" })).toBeNull();
  });

  it("denies by default when the permission call rejects, and still shows the list", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("db down"));

    await renderizarPagina();

    expect(screen.getByTestId("producto-fila-7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Nuevo producto" })).toBeNull();
  });

  it("redirects to /login without a session and never asks for data", async () => {
    mockContexto.mockResolvedValueOnce(null);

    await expect(
      ProductosPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(redirect).toHaveBeenCalledWith("/login");
    expect(mockConsultar).not.toHaveBeenCalled();
    expect(mockPermisos).not.toHaveBeenCalled();
  });
});
