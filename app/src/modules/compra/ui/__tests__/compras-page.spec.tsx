/**
 * @jest-environment jsdom
 *
 * Compras route (odd/tasks/compras.md, T2: S4, S6). Session, tenant resolution
 * and the actions are mocked; the page is an async server component, so it is
 * awaited and its element tree rendered.
 *
 * S4: the route reads its filters from the URL, validates them against the
 * frozen enums, and hands the first page to the island through the same
 * `listarComprasAction` the island re-queries. The manage controls come from
 * `obtenerPermisosCompraAction` (deny-by-default on failure) and never from a
 * literal role name here.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import ComprasPage from "@/app/(app)/compras/page";
import {
  listarComprasAction,
  obtenerPermisosCompraAction,
} from "@/modules/compra/http/actions";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { CompraFila } from "@/modules/compra/ui/compras-filtros";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantHeader: jest.fn(),
}));

jest.mock("@/modules/proveedor/http/actions", () => ({
  listarProveedoresAction: jest.fn(),
}));

jest.mock("@/modules/producto/http/actions", () => ({
  consultarProductosAction: jest.fn(),
}));

jest.mock("@/modules/compra/http/actions", () => ({
  listarComprasAction: jest.fn(),
  obtenerCompraAction: jest.fn(),
  obtenerPermisosCompraAction: jest.fn(),
}));

const redirect = jest.fn((destino: string): never => {
  throw new Error(`NEXT_REDIRECT:${destino}`);
});
jest.mock("next/navigation", () => ({
  __esModule: true,
  redirect: (destino: string) => redirect(destino),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

const mockListar = jest.mocked(listarComprasAction);
const mockPermisos = jest.mocked(obtenerPermisosCompraAction);
const mockContexto = jest.mocked(getCurrentTenantHeader);

const BORRADOR: CompraFila = {
  id: 7,
  correlativoInterno: "C-000007",
  tipoCompra: "MERCANCIA",
  estado: "BORRADOR",
  ncf: "B0100000001",
  total: "1234.50",
  fecha: "2026-11-10T14:00:00.000Z",
  proveedorNombre: "Distribuidora Norte",
};

function salida() {
  return { items: [BORRADOR], total: 1, page: 1 };
}

async function renderizarPagina(
  params: Record<string, string | string[]> = {},
): Promise<void> {
  render(await ComprasPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  mockListar.mockReset();
  mockPermisos.mockReset();
  redirect.mockClear();
  mockContexto.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
    esAdmin: true,
    empresaNombre: "Empresa Demo",
    sucursalNombre: "Sucursal Central",
  } as Awaited<ReturnType<typeof getCurrentTenantHeader>>);
  mockListar.mockResolvedValue({ ok: true, data: salida() });
});

afterEach(cleanup);

describe("ComprasPage — manage gate (S4)", () => {
  it("renders the heading, the rows and the Acciones column for a manage caller", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: true } });

    await renderizarPagina();

    expect(screen.getByRole("heading", { name: "Compras" })).toBeInTheDocument();
    expect(screen.getByTestId("compra-fila-7")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    // The first load goes through the screen's own action, not a direct query.
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25 });
  });

  it("renders a view-only list with no Acciones column", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: false } });

    await renderizarPagina();

    expect(screen.getByTestId("compra-fila-7")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
  });

  it("denies by default when the permission call rejects, and still shows the list", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("db down"));

    await renderizarPagina();

    expect(screen.getByTestId("compra-fila-7")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
  });
});

describe("ComprasPage — URL filters (S4)", () => {
  it("forwards page, estado, tipoCompra and the supplier search to the action", async () => {
    mockPermisos.mockResolvedValue({ ok: true, data: { puedeGestionar: false } });

    await renderizarPagina({
      page: "2",
      estado: "RECIBIDA",
      tipoCompra: "ALQUILER",
      proveedorBusqueda: "  norte ",
    });

    expect(mockListar).toHaveBeenCalledWith({
      page: 2,
      limit: 25,
      estado: "RECIBIDA",
      tipoCompra: "ALQUILER",
      proveedorBusqueda: "norte",
    });
  });

  it("drops unknown enum values and slices the supplier search to 100 chars", async () => {
    mockPermisos.mockResolvedValue({ ok: true, data: { puedeGestionar: false } });

    await renderizarPagina({
      estado: "PAGADA",
      tipoCompra: "OTRA_COSA",
      proveedorBusqueda: "x".repeat(150),
    });

    expect(mockListar).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      proveedorBusqueda: "x".repeat(100),
    });
  });

  it("redirects to /login when there is no session context", async () => {
    mockContexto.mockResolvedValueOnce(null);

    await expect(renderizarPagina()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockListar).not.toHaveBeenCalled();
  });
});
