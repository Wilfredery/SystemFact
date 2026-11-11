/**
 * @jest-environment jsdom
 *
 * /caja route (S7). Session, tenant header and the three read actions are mocked; the page is an
 * async server component, so it is awaited and its element tree rendered.
 *
 * Pins the shell contract: no session → `/login`; Administrador → both boards (06a + 06b) with the
 * DTO figures; ANY other permission answer → the access message and NO board data (deny by
 * default). The page must never read a date from the URL (S1: today only) and never render a date
 * selector — the day comes from the action's SD-pinned DTO.
 */

import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import CajaPage from "@/app/(app)/caja/page";
import {
  consultarCierreCajaAction,
  consultarResumenDiaAction,
  obtenerPermisosCajaAction,
} from "@/modules/caja/http/actions.lectura";
import { getCurrentTenantHeader } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { CierreDiarioDto, ResumenDiaDto } from "@/modules/caja/http/shared";

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn().mockResolvedValue({}),
}));

jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantHeader: jest.fn(),
}));

jest.mock("@/modules/caja/http/actions.lectura", () => ({
  consultarCierreCajaAction: jest.fn(),
  consultarResumenDiaAction: jest.fn(),
  obtenerPermisosCajaAction: jest.fn(),
}));

const redirect = jest.fn((destino: string): never => {
  throw new Error(`NEXT_REDIRECT:${destino}`);
});
jest.mock("next/navigation", () => ({
  __esModule: true,
  redirect: (destino: string) => redirect(destino),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

const mockPermisos = jest.mocked(obtenerPermisosCajaAction);
const mockCierre = jest.mocked(consultarCierreCajaAction);
const mockResumen = jest.mocked(consultarResumenDiaAction);
const mockHeader = jest.mocked(getCurrentTenantHeader);

const CIERRE: CierreDiarioDto = {
  fechaSD: "2026-11-11",
  totalFacturado: "2000.00",
  totalCobrado: "1500.50",
  efectivoEsperado: "1000.25",
  diferencia: "-499.50",
  metodos: [{ metodo: "EFECTIVO", cobros: "1500.50", cantidad: 3 }],
  corte: { cobros: "1500.50", devoluciones: "500.25" },
};

const RESUMEN: ResumenDiaDto = {
  fechaSD: "2026-11-11",
  ventas: "2000.00",
  costoVendido: "1348.00",
  margenBruto: "652.00",
  margenPorcentaje: "32.6",
};

async function renderizarPagina(): Promise<ReturnType<typeof render>> {
  return render(await CajaPage());
}

beforeEach(() => {
  mockPermisos.mockReset();
  mockCierre.mockReset();
  mockResumen.mockReset();
  mockHeader.mockReset();
  redirect.mockClear();

  mockHeader.mockResolvedValue({
    empresaId: 1,
    sucursalId: 1,
    usuarioId: 1,
    esAdmin: true,
    empresaNombre: "Comercial Demo SRL",
    sucursalNombre: "Central",
  } as Awaited<ReturnType<typeof getCurrentTenantHeader>>);
  mockPermisos.mockResolvedValue({ ok: true, data: { puedeVer: true } });
  mockCierre.mockResolvedValue({ ok: true, data: CIERRE });
  mockResumen.mockResolvedValue({ ok: true, data: RESUMEN });
});

afterEach(cleanup);

describe("CajaPage — session (S7)", () => {
  it("redirects to /login when there is no tenant context", async () => {
    mockHeader.mockResolvedValueOnce(null);

    await expect(renderizarPagina()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

describe("CajaPage — permitted caller (S7)", () => {
  it("renders the Caja heading and both boards", async () => {
    await renderizarPagina();

    expect(screen.getByRole("heading", { name: "Caja" })).toBeInTheDocument();
    expect(screen.getByTestId("caja-cierre")).toBeInTheDocument();
    expect(screen.getByTestId("caja-resumen")).toBeInTheDocument();
    expect(screen.getByTestId("caja-kpi-total-facturado")).toHaveTextContent("RD$ 2,000.00");
    expect(screen.getByTestId("caja-resumen-margen-pct")).toHaveTextContent("32.6%");
  });

  it("shows the tenant names read-only and NO date selector", async () => {
    mockHeader.mockResolvedValueOnce({
      empresaId: 1,
      sucursalId: 1,
      usuarioId: 1,
      esAdmin: false,
      empresaNombre: "Comercial Demo SRL",
      sucursalNombre: "Central",
    } as Awaited<ReturnType<typeof getCurrentTenantHeader>>);
    const { container } = await renderizarPagina();

    expect(screen.getByTestId("caja-tenant")).toHaveTextContent(
      "Comercial Demo SRL · Sucursal Central",
    );
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it("labels an Administrador's company-wide figures as Todas las sucursales (JD-A-002)", async () => {
    await renderizarPagina();

    expect(screen.getByTestId("caja-tenant")).toHaveTextContent(
      "Empresa Comercial Demo SRL · Todas las sucursales",
    );
    expect(screen.getByTestId("caja-tenant")).not.toHaveTextContent("Sucursal Central");
  });

  it("reads the day through the actions with an EMPTY payload (today only, no date)", async () => {
    await renderizarPagina();

    expect(mockCierre).toHaveBeenCalledWith({});
    expect(mockResumen).toHaveBeenCalledWith({});
  });
});

describe("CajaPage — deny by default (S7)", () => {
  it("renders the access message and NO data for a non-Administrador", async () => {
    mockPermisos.mockResolvedValueOnce({ ok: true, data: { puedeVer: false } });
    mockCierre.mockResolvedValueOnce({
      ok: false,
      error: { code: "CAJA_NO_AUTORIZADO", message: "No tiene permisos para consultar la caja del día" },
    });
    mockResumen.mockResolvedValueOnce({
      ok: false,
      error: { code: "CAJA_NO_AUTORIZADO", message: "No tiene permisos para consultar la caja del día" },
    });

    await renderizarPagina();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tiene permisos para ver la Caja.",
    );
    expect(screen.queryByTestId("caja-cierre")).not.toBeInTheDocument();
    expect(screen.queryByTestId("caja-resumen")).not.toBeInTheDocument();
    expect(screen.queryByText("Total facturado")).not.toBeInTheDocument();
  });

  it("denies when the permission read itself fails", async () => {
    mockPermisos.mockResolvedValueOnce({
      ok: false,
      error: { code: "SESION_INVALIDA", message: "La sesión no es válida" },
    });

    await renderizarPagina();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo cargar la Caja. Intenta de nuevo.",
    );
    expect(screen.queryByTestId("caja-cierre")).not.toBeInTheDocument();
  });

  it("renders the action's stable message when a permitted read fails", async () => {
    mockCierre.mockResolvedValueOnce({
      ok: false,
      error: { code: "CAJA_VALIDACION", message: "No se pudo calcular el cierre del día" },
    });

    await renderizarPagina();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo calcular el cierre del día",
    );
    expect(screen.queryByTestId("caja-cierre")).not.toBeInTheDocument();
  });
});
