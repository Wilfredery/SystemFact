/**
 * @jest-environment jsdom
 *
 * Historial de movimientos route gating + the permission-gated link on the stock
 * list (odd/tasks/inventario-historial.md, T2: S1, S2, S7). Session, tenant
 * resolution and the actions are mocked; the pages are async server components,
 * so each is awaited and its element tree rendered.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import InventarioMovimientosPage from "@/app/(app)/inventario/movimientos/page";
import InventarioPage from "@/app/(app)/inventario/page";
import {
  consultarInventarioAction,
  listarMovimientosInventarioAction,
  obtenerPermisosInventarioAction,
} from "@/modules/inventario/http/actions";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));

jest.mock("@/modules/inventario/http/actions", () => ({
  obtenerPermisosInventarioAction: jest.fn(),
  consultarInventarioAction: jest.fn(),
  listarMovimientosInventarioAction: jest.fn(),
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

const mockPermisos = jest.mocked(obtenerPermisosInventarioAction);
const mockMovimientos = jest.mocked(listarMovimientosInventarioAction);
const mockConsultar = jest.mocked(consultarInventarioAction);
const mockContexto = jest.mocked(getCurrentTenantContext);

const MENSAJE_ACCESO = "No tiene permisos para ver el historial de movimientos.";

const DATA = {
  items: [
    {
      id: 5,
      fecha: "2026-11-05T15:00:00.000Z",
      tipo: "AJUSTE" as const,
      productoCodigo: "P-007",
      productoNombre: "Arroz",
      cantidadMovida: "5",
      cantidadAnterior: "10",
      cantidadNueva: "15",
      usuarioNombre: "Ana",
      motivo: "Conteo",
    },
  ],
  total: 1,
  page: 1,
  limit: 25,
  desde: "2026-10-16",
  hasta: "2026-11-14",
};

async function renderizarMovimientos(searchParams: Record<string, string> = {}): Promise<void> {
  render(await InventarioMovimientosPage({ searchParams: Promise.resolve(searchParams) }));
}

function esperarSoloMensajeDeAcceso(): void {
  expect(screen.getByRole("alert")).toHaveTextContent(MENSAJE_ACCESO);
  expect(screen.getByRole("link", { name: "Volver a Inventario" })).toHaveAttribute("href", "/inventario");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Desde")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Historial de movimientos" })).not.toBeInTheDocument();
  // The history is never even requested for a caller that may not see it.
  expect(mockMovimientos).not.toHaveBeenCalled();
}

beforeEach(() => {
  mockPermisos.mockReset();
  mockMovimientos.mockReset();
  mockConsultar.mockReset();
  redirect.mockClear();
  mockContexto.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
  } as Awaited<ReturnType<typeof getCurrentTenantContext>>);
});

afterEach(cleanup);

describe("InventarioMovimientosPage — gating", () => {
  it("renders the history for the manage group, reading the first page with the URL filters", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: true } });
    mockMovimientos.mockResolvedValueOnce({ ok: true, data: DATA });

    await renderizarMovimientos({ tipo: "AJUSTE", producto: " arroz ", desde: "2026-11-01", hasta: "2026-11-10", page: "2" });

    expect(screen.getByRole("heading", { name: "Historial de movimientos" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toContain("Cantidad movida");
    expect(screen.getByTestId("movimiento-fila-5")).toBeInTheDocument();
    expect(screen.queryByText(MENSAJE_ACCESO)).not.toBeInTheDocument();
    expect(mockMovimientos).toHaveBeenCalledWith({
      page: 2,
      limit: 25,
      tipo: "AJUSTE",
      producto: "arroz",
      desde: "2026-11-01",
      hasta: "2026-11-10",
    });
  });

  it("ignores malformed URL filters instead of forwarding them", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: true } });
    mockMovimientos.mockResolvedValueOnce({ ok: true, data: DATA });

    await renderizarMovimientos({ tipo: "DROP", desde: "ayer", hasta: "2026-1-1", page: "-4" });

    expect(mockMovimientos).toHaveBeenCalledWith({ page: 1, limit: 25 });
  });

  it("shows an action error from the first load in an alert, with the filters still on screen", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: true } });
    mockMovimientos.mockResolvedValueOnce({
      ok: false,
      error: { code: "RANGO_FECHAS_EXCEDIDO", message: "El rango de fechas no puede superar 90 días." },
    });

    await renderizarMovimientos({ desde: "2026-01-01", hasta: "2026-11-01" });

    expect(screen.getByRole("alert")).toHaveTextContent("El rango de fechas no puede superar 90 días.");
    expect(screen.getByLabelText("Desde")).toBeInTheDocument();
  });

  it("renders only the access message when the caller is outside the manage group (Operador/Despachador)", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: false } });

    await renderizarMovimientos();

    esperarSoloMensajeDeAcceso();
  });

  it("denies by default when the permission call answers with an error", async () => {
    mockPermisos.mockResolvedValueOnce({
      ok: false,
      error: { code: "SESION_INVALIDA", message: "Sesión inválida" },
    });

    await renderizarMovimientos();

    esperarSoloMensajeDeAcceso();
  });

  it("denies by default when the permission call rejects", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("db down"));

    await renderizarMovimientos();

    esperarSoloMensajeDeAcceso();
  });

  it("redirects to /login without a session and asks for nothing", async () => {
    mockContexto.mockResolvedValueOnce(null);

    await expect(
      InventarioMovimientosPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(redirect).toHaveBeenCalledWith("/login");
    expect(mockPermisos).not.toHaveBeenCalled();
    expect(mockMovimientos).not.toHaveBeenCalled();
  });
});

describe("InventarioPage — link to the history", () => {
  const CONSULTA = {
    items: [],
    total: 0,
    page: 1,
    limit: 25,
    resumen: { totalProductos: 0, bajoStock: 0, agotados: 0, valorInventario: "0.00" },
    categorias: [],
  };

  async function renderizarInventario(): Promise<void> {
    mockConsultar.mockResolvedValueOnce({ ok: true, data: CONSULTA });
    render(await InventarioPage({ searchParams: Promise.resolve({}) }));
  }

  it("shows 'Ver historial de movimientos' (to /inventario/movimientos) when the caller may manage", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: true } });

    await renderizarInventario();

    expect(screen.getByRole("link", { name: "Ver historial de movimientos" })).toHaveAttribute(
      "href",
      "/inventario/movimientos",
    );
    expect(screen.getByRole("link", { name: "+ Ajustar" })).toHaveAttribute("href", "/inventario/ajuste");
  });

  it("asks the permission only once: the link reuses the same answer as + Ajustar", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: true } });

    await renderizarInventario();

    expect(mockPermisos).toHaveBeenCalledTimes(1);
  });

  it("hides the link (and + Ajustar) when the caller may not manage", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: false } });

    await renderizarInventario();

    expect(screen.queryByRole("link", { name: "Ver historial de movimientos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ Ajustar" })).not.toBeInTheDocument();
  });

  it("hides the link when the permission call fails (deny by default)", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("db down"));

    await renderizarInventario();

    expect(screen.queryByRole("link", { name: "Ver historial de movimientos" })).not.toBeInTheDocument();
  });
});
