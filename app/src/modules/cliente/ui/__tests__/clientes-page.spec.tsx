/**
 * @jest-environment jsdom
 *
 * Clientes route gating (odd/tasks/clientes.md, T1: S3, S4). Session, tenant
 * resolution and the actions are mocked; the page is an async server component,
 * so it is awaited and its element tree rendered.
 *
 * S3: the Administrador manages, Operador and Despachador are view-only. The
 * manage controls and the credit fields come from the permission seam
 * (`obtenerPermisosClienteAction` reading the named role groups), never from a
 * literal role name here.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import ClientesPage from "@/app/(app)/clientes/page";
import {
  listarClientesAction,
  obtenerPermisosClienteAction,
} from "@/modules/cliente/http/actions";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { ClienteDto } from "@/modules/cliente/http/shared";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));

jest.mock("@/modules/cliente/http/actions", () => ({
  listarClientesAction: jest.fn(),
  obtenerClienteAction: jest.fn(),
  obtenerPermisosClienteAction: jest.fn(),
  crearClienteAction: jest.fn(),
  actualizarClienteAction: jest.fn(),
  desactivarClienteAction: jest.fn(),
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

const mockListar = jest.mocked(listarClientesAction);
const mockPermisos = jest.mocked(obtenerPermisosClienteAction);
const mockContexto = jest.mocked(getCurrentTenantContext);

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

function salida() {
  return { items: [ACME], total: 1, page: 1, limit: 25 };
}

async function renderizarPagina(): Promise<void> {
  render(await ClientesPage({ searchParams: Promise.resolve({}) }));
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

describe("ClientesPage — role gate (S3)", () => {
  it("renders the list, the credit columns and the manage controls for Administrador", async () => {
    mockPermisos.mockResolvedValueOnce({
      ok: true,
      data: { puedeGestionar: true, puedeVerCredito: true },
    });

    await renderizarPagina();

    expect(screen.getByRole("heading", { name: "Clientes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Nuevo cliente" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Acme SRL" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Límite" })).toBeInTheDocument();
    // The first load goes through the screen's own action, not a direct query.
    expect(mockListar).toHaveBeenCalledWith({ page: 1, limit: 25, estado: "activos" });
  });

  it("renders a view-only list with no manage controls and no credit fields", async () => {
    mockPermisos.mockResolvedValueOnce({
      ok: true,
      data: { puedeGestionar: false, puedeVerCredito: false },
    });

    await renderizarPagina();

    expect(screen.getByTestId("cliente-fila-4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Nuevo cliente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar Acme SRL" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desactivar Acme SRL" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Límite" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Plazo" })).toBeNull();
  });

  it("denies by default when the permission call rejects, and still shows the list", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("db down"));

    await renderizarPagina();

    expect(screen.getByTestId("cliente-fila-4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Nuevo cliente" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Límite" })).toBeNull();
  });

  it("forwards the search and estado query parameters to the listing action", async () => {
    mockPermisos.mockResolvedValue({
      ok: true,
      data: { puedeGestionar: false, puedeVerCredito: false },
    });

    render(
      await ClientesPage({
        searchParams: Promise.resolve({ page: "2", busqueda: " acme ", estado: "inactivos" }),
      }),
    );

    expect(mockListar).toHaveBeenCalledWith({
      page: 2,
      limit: 25,
      estado: "inactivos",
      buscar: "acme",
    });
  });

  it("redirects to /login without a session and never asks for data", async () => {
    mockContexto.mockResolvedValueOnce(null);

    await expect(ClientesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );

    expect(redirect).toHaveBeenCalledWith("/login");
    expect(mockListar).not.toHaveBeenCalled();
    expect(mockPermisos).not.toHaveBeenCalled();
  });
});
