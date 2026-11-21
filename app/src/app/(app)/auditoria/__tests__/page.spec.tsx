/**
 * @jest-environment jsdom
 *
 * Board 09 S1 header + S6 access-denied alert, on the server page rendered with the
 * boundary mocked (no DB, no Supabase).
 */

import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import AuditoriaPage from "../page";
import { consultarAuditoriaAction } from "@/modules/auditoria/http/actions";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href ?? "#"}>{children}</a>
  ),
}));
jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn(async () => ({})) }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(async () => ({ empresaId: 1 })),
}));
jest.mock("@/modules/auditoria/http/actions", () => ({
  consultarAuditoriaAction: jest.fn(),
}));

const accion = consultarAuditoriaAction as jest.Mock;
afterEach(cleanup);

describe("/auditoria page (Board 09)", () => {
  it("S1: title, admin badge and the exact subtitle", async () => {
    accion.mockResolvedValue({
      ok: true,
      data: { filas: [], total: 0, page: 1, pageSize: 25, totalPages: 0 },
    });
    render(await AuditoriaPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1, name: /Auditoría/ })).toBeInTheDocument();
    const badge = screen.getByText("Solo Administrador");
    expect(badge.className).toContain("bg-warn-bg");
    expect(badge.className).toContain("text-warn");
    expect(
      screen.getByText("Consulta el registro de movimientos del sistema"),
    ).toBeInTheDocument();
  });

  it("S6: a denied user sees only the access alert, no filters or table", async () => {
    accion.mockResolvedValue({
      ok: false,
      error: { code: "AUDITORIA_NO_AUTORIZADO", message: "x" },
    });
    render(await AuditoriaPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Solo el administrador puede consultar el registro de auditoría.",
    );
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
