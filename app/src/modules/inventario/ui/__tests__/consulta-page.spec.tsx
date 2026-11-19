/**
 * @jest-environment jsdom
 *
 * Inventario consulta page wiring (board-04 regression pin, JD-A-005): the
 * page MUST forward `puedeAjustar` to the screen — the bug 636337c fixed was
 * invisible to unit tests because they rendered the screen directly. The
 * actions are mocked; the page is an async server component.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import InventarioPage from "@/app/(app)/inventario/page";
import {
  consultarInventarioAction,
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
}));

const mockPermisos = jest.mocked(obtenerPermisosInventarioAction);
const mockConsultar = jest.mocked(consultarInventarioAction);
const mockContexto = jest.mocked(getCurrentTenantContext);

function salida(): Parameters<typeof mockConsultar.mockResolvedValue>[0] {
  return {
    ok: true,
    data: {
      items: [
        {
          productoId: 7,
          codigo: "P-007",
          nombre: "Arroz",
          categoria: "Granos",
          unidadMedida: "LB",
          cantidad: "120.000",
          stockMinimo: 10,
          estado: "normal",
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
      resumen: { totalProductos: 1, bajoStock: 0, agotados: 0, valorInventario: "100.00" },
      categorias: [],
    },
  };
}

async function renderizarPagina(): Promise<void> {
  render(await InventarioPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  mockPermisos.mockReset();
  mockConsultar.mockReset();
  redirect.mockClear();
  mockContexto.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
  } as Awaited<ReturnType<typeof getCurrentTenantContext>>);
  mockConsultar.mockResolvedValue(salida());
});

afterEach(cleanup);

describe("InventarioPage — puedeAjustar forwarding (board-04 pin)", () => {
  it("forwards the manage permission: the row Acciones column renders", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: true } });

    await renderizarPagina();

    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(screen.getByTestId("menu-fila-P-007")).toBeInTheDocument();
  });

  it("withholds the permission: no Acciones column and no header CTAs", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: false } });

    await renderizarPagina();

    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("menu-fila-P-007")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ Ajustar" })).not.toBeInTheDocument();
  });

  it("denies by default when the permission call fails (links and column hidden)", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("db down"));

    await renderizarPagina();

    expect(screen.queryByRole("columnheader", { name: "Acciones" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ Ajustar" })).not.toBeInTheDocument();
  });
});
