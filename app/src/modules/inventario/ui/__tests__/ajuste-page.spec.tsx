/**
 * @jest-environment jsdom
 *
 * Inventario adjust page gating (odd/tasks/inventario-ajuste.md, T2: S4, S6).
 * Session, tenant resolution and the actions are mocked; the page is an async
 * server component, so it is awaited and its element tree rendered.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import InventarioAjustePage from "@/app/(app)/inventario/ajuste/page";
import { obtenerPermisosInventarioAction } from "@/modules/inventario/http/actions";
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
  ajustarInventarioAction: jest.fn(),
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
const mockContexto = jest.mocked(getCurrentTenantContext);

const MENSAJE_ACCESO = "No tiene permisos para ajustar inventario.";

async function renderizarPagina(): Promise<void> {
  render(await InventarioAjustePage());
}

function esperarSoloMensajeDeAcceso(): void {
  expect(screen.getByRole("alert")).toHaveTextContent(MENSAJE_ACCESO);
  expect(screen.getByRole("link", { name: "Volver a Inventario" })).toHaveAttribute(
    "href",
    "/inventario",
  );
  expect(screen.queryByRole("heading", { name: "Ajuste de Inventario" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirmar Ajuste" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Producto *")).not.toBeInTheDocument();
}

beforeEach(() => {
  mockPermisos.mockReset();
  redirect.mockClear();
  mockContexto.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
  } as Awaited<ReturnType<typeof getCurrentTenantContext>>);
});

afterEach(cleanup);

describe("InventarioAjustePage — gating", () => {
  it("renders the form when the caller may adjust", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: true } });

    await renderizarPagina();

    expect(screen.getByRole("heading", { name: "Ajuste de Inventario" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar Ajuste" })).toBeInTheDocument();
    expect(screen.queryByText(MENSAJE_ACCESO)).not.toBeInTheDocument();
  });

  it("renders only the access message when the caller may not adjust", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeAjustar: false } });

    await renderizarPagina();

    esperarSoloMensajeDeAcceso();
  });

  it("denies by default when the permission call answers with an error", async () => {
    mockPermisos.mockResolvedValueOnce({
      ok: false,
      error: { code: "SESION_INVALIDA", message: "Sesión inválida" },
    });

    await renderizarPagina();

    esperarSoloMensajeDeAcceso();
  });

  it("denies by default when the permission call rejects", async () => {
    mockPermisos.mockRejectedValueOnce(new Error("db down"));

    await renderizarPagina();

    esperarSoloMensajeDeAcceso();
  });

  it("redirects to /login without a session and never asks for permissions", async () => {
    mockContexto.mockResolvedValueOnce(null);

    await expect(InventarioAjustePage()).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(redirect).toHaveBeenCalledWith("/login");
    expect(mockPermisos).not.toHaveBeenCalled();
  });
});
