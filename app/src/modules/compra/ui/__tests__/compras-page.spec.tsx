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
import { cleanup, render, screen, within } from "@testing-library/react";
import ComprasPage from "@/app/(app)/compras/page";
import {
  listarComprasAction,
  obtenerPermisosCompraAction,
} from "@/modules/compra/http/actions";
import { consultarCxPAction } from "@/modules/reportes/http/actions.lectura";
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

jest.mock("@/modules/reportes/http/actions.lectura", () => ({
  consultarCxPAction: jest.fn(),
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
const mockCxP = jest.mocked(consultarCxPAction);
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

function salidaCxP() {
  return {
    filas: [
      {
        compraId: 31,
        proveedorId: 4,
        proveedorNombre: "Distribuidora Norte",
        sucursalId: 1,
        sucursalNombre: "Sucursal Central",
        fechaSD: "2026-11-09",
        estado: "PENDIENTE" as const,
        total: "1234.50",
        pagado: "234.50",
        saldoPendiente: "1000.00",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    resumen: { saldoTotal: "1000.00", comprasAbiertas: "1" },
  };
}

async function renderizarPagina(
  params: Record<string, string | string[]> = {},
): Promise<void> {
  render(await ComprasPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  mockListar.mockReset();
  mockPermisos.mockReset();
  mockCxP.mockReset();
  redirect.mockClear();
  mockCxP.mockResolvedValue({ ok: true, data: salidaCxP() });
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

describe("ComprasPage — CxP section (T4: S8)", () => {
  it("renders the read-only CxP table for an Administrador caller", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: true } });

    await renderizarPagina();

    const seccion = screen.getByRole("region", { name: "Cuentas por pagar" });
    expect(within(seccion).getByTestId("cxp-fila-31")).toBeInTheDocument();
    expect(within(seccion).getByText("Distribuidora Norte")).toBeInTheDocument();
    // The Compras list stays intact beside it (smaller diff: a second section).
    expect(screen.getByTestId("compra-fila-7")).toBeInTheDocument();
    // Pagination follows the report action's own contract (25/page, unbounded window).
    expect(mockCxP).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
  });

  it("forwards the CxP page from the URL", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: true } });

    await renderizarPagina({ cxpPage: "2" });

    expect(mockCxP).toHaveBeenCalledWith({ page: 2, pageSize: 25 });
  });

  it("renders no CxP section and never reads it for a non-Administrador caller (FIN-3)", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: false } });

    await renderizarPagina();

    expect(screen.queryByRole("region", { name: "Cuentas por pagar" })).toBeNull();
    expect(mockCxP).not.toHaveBeenCalled();
  });

  it("renders no CxP section when the report gate refuses the read", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: true } });
    mockCxP.mockResolvedValueOnce({
      ok: false,
      error: { code: "REPORTE_NO_AUTORIZADO", message: "No tiene permisos" },
    });

    await renderizarPagina();

    expect(screen.queryByRole("region", { name: "Cuentas por pagar" })).toBeNull();
  });

  it("exposes no write control inside the CxP section", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeGestionar: true } });

    await renderizarPagina();

    const seccion = screen.getByRole("region", { name: "Cuentas por pagar" });
    expect(within(seccion).queryAllByRole("button")).toHaveLength(0);
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
