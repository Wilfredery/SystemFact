/**
 * Unit — Caja read actions (S6). All collaborators mocked, no DB.
 *
 * The three-step thin-adapter contract: zod → tenant context → `withTenantTransaction` { SERVER-SIDE
 * role gate, then delegate }. These tests pin that a non-Administrador is refused BEFORE the use
 * case runs (deny-by-default, "hiding the UI is not the control"), that the role group is the ONLY
 * place the literal role name appears, and that the use-case result crosses into the
 * `{ok:false,error}` / `{ok:true,data}` envelope unchanged.
 */

import {
  consultarCierreCajaAction,
  consultarResumenDiaAction,
  obtenerPermisosCajaAction,
} from "./actions";
import { ROLES_VER_CAJA } from "./shared";
import { consultarCierreDiario } from "../application/consultar-cierre-diario";
import { consultarResumenDia } from "../application/consultar-resumen-dia";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn((_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({})),
}));
jest.mock("../application/consultar-cierre-diario", () => ({
  consultarCierreDiario: jest.fn(),
}));
jest.mock("../application/consultar-resumen-dia", () => ({
  consultarResumenDia: jest.fn(),
}));
jest.mock("@/modules/venta/infrastructure/venta-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

const ctx = { empresaId: 7, sucursalId: 3, usuarioId: 11, esAdmin: true };

const cierre = {
  fechaSD: "2026-11-11",
  totalFacturado: "2000.00",
  totalCobrado: "1500.50",
  efectivoEsperado: "1000.25",
  diferencia: "-499.50",
  metodos: [{ metodo: "EFECTIVO", cobros: "1500.50", cantidad: 3 }],
  corte: { cobros: "1500.50", devoluciones: "500.25" },
};

const resumen = {
  fechaSD: "2026-11-11",
  ventas: "1000.00",
  costoVendido: "674.00",
  margenBruto: "326.00",
  margenPorcentaje: "32.6",
};

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(ctx);
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
  (consultarCierreDiario as jest.Mock).mockResolvedValue({ ok: true, data: cierre });
  (consultarResumenDia as jest.Mock).mockResolvedValue({ ok: true, data: resumen });
});

describe("role group", () => {
  it("is Administrador-only per the wireframe's 'Roles que la ven' (both boards)", () => {
    expect(ROLES_VER_CAJA).toEqual(["Administrador"]);
  });
});

describe("consultarCierreCajaAction", () => {
  it("rejects a retroactive-date payload before touching the session", async () => {
    const result = await consultarCierreCajaAction({ fecha: "2026-11-10" });

    expect(result).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.any(String) },
    });
    expect(getCurrentTenantContext).not.toHaveBeenCalled();
  });

  it("rejects when the session is missing", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await consultarCierreCajaAction({});

    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
    expect(consultarCierreDiario).not.toHaveBeenCalled();
  });

  it("refuses a non-Administrador BEFORE the use case runs (deny-by-default)", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await consultarCierreCajaAction(undefined);

    expect(result.ok === false && result.error.code).toBe("CAJA_NO_AUTORIZADO");
    expect(result.ok === false && result.error.message.length).toBeGreaterThan(0);
    expect(consultarCierreDiario).not.toHaveBeenCalled();
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      11,
      7,
      ["Administrador"],
    );
  });

  it("delegates to the use case and returns its data in the ActionResult envelope", async () => {
    const result = await consultarCierreCajaAction({});

    expect(result).toEqual({ ok: true, data: cierre });
    expect(consultarCierreDiario).toHaveBeenCalledWith(expect.anything(), ctx);
  });

  it("forwards a use-case typed failure as the same stable code + message", async () => {
    (consultarCierreDiario as jest.Mock).mockResolvedValue({
      ok: false,
      code: "CAJA_VALIDACION",
      message: "La fecha del cierre de caja no es válida; revísela e intente de nuevo",
    });

    const result = await consultarCierreCajaAction({});

    expect(result).toEqual({
      ok: false,
      error: {
        code: "CAJA_VALIDACION",
        message: "La fecha del cierre de caja no es válida; revísela e intente de nuevo",
      },
    });
  });
});

describe("consultarResumenDiaAction", () => {
  it("rejects an extra input key (no paging, no scope override on 06b)", async () => {
    const result = await consultarResumenDiaAction({ page: 2 });

    expect(result.ok === false && result.error.code).toBe("VALIDATION_ERROR");
    expect(consultarResumenDia).not.toHaveBeenCalled();
  });

  it("refuses a non-Administrador BEFORE the use case runs", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await consultarResumenDiaAction({});

    expect(result.ok === false && result.error.code).toBe("CAJA_NO_AUTORIZADO");
    expect(consultarResumenDia).not.toHaveBeenCalled();
  });

  it("delegates and returns the 06b KPIs", async () => {
    const result = await consultarResumenDiaAction({});

    expect(result).toEqual({ ok: true, data: resumen });
    expect(consultarResumenDia).toHaveBeenCalledWith(expect.anything(), ctx);
  });

  it("rejects when the session is missing", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await consultarResumenDiaAction({});

    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
  });
});

describe("obtenerPermisosCajaAction", () => {
  it("reports the view capability from the named group", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);

    const result = await obtenerPermisosCajaAction();

    expect(result).toEqual({ ok: true, data: { puedeVer: true } });
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      11,
      7,
      ["Administrador"],
    );
  });

  it("a non-viewer gets puedeVer=false (deny-by-default, no use case run)", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);

    const result = await obtenerPermisosCajaAction();

    expect(result).toEqual({ ok: true, data: { puedeVer: false } });
    expect(consultarCierreDiario).not.toHaveBeenCalled();
  });

  it("no session returns SESION_INVALIDA", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await obtenerPermisosCajaAction();

    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
  });
});
