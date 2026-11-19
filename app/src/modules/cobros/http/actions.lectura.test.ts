/**
 * Unit — `obtenerDetalleCxcAction` transport + authorization boundary (S13).
 *
 * Same convention as `categoria/http/actions.test.ts`: the session, the tenant
 * wrapper, the venta role lookup and the use case are all stubbed, so this pins
 * ONLY the adapter's three steps: zod (a malformed `facturaId` is rejected BEFORE
 * the server does any work), the session, and the cobros role gate before the
 * use case runs. Zero business logic is expected here.
 */

jest.mock("@/lib/supabase/client", () => ({
  createClient: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn(
    (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({}),
  ),
}));
jest.mock("@/modules/venta/infrastructure/venta-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));
jest.mock("../application/consultar-detalle-cxc", () => ({
  consultarDetalleCxc: jest.fn(),
}));

import { obtenerDetalleCxcAction } from "./actions.lectura";
import { consultarDetalleCxc } from "../application/consultar-detalle-cxc";
import { tieneRolPermitidoEnTx } from "@/modules/venta/infrastructure/venta-repository";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { PAGO_NO_AUTORIZADO, FACTURA_COBRO_NO_VIGENTE } from "../domain/errors";
import { VALIDATION_ERROR, SESION_INVALIDA } from "./validations";
import { ROLES_COBROS } from "./shared";

const mockDetalle = jest.mocked(consultarDetalleCxc);
const mockRol = jest.mocked(tieneRolPermitidoEnTx);
const mockSesion = jest.mocked(getCurrentTenantContext);
const mockWrapper = jest.mocked(withTenantTransaction);

const ctx = { empresaId: 4, sucursalId: 5, usuarioId: 6, esAdmin: false };

const DETALLE = {
  facturaId: 12,
  ncf: "B0200001218",
  correlativoInterno: "FAC-001218",
  fechaEmision: "2026-07-01T16:00:00.000Z",
  vencimiento: "2026-07-31",
  clienteId: 3,
  clienteNombre: "Ana Martínez",
  clienteRnc: "123-45678-9",
  tipoCliente: "CREDITO",
  total: "82500.00",
  abonado: "0.00",
  saldo: "82500.00",
  diasVencida: 36,
  enMora: true,
  historial: [],
};

beforeEach(() => {
  mockDetalle.mockReset();
  mockRol.mockReset();
  mockSesion.mockReset();
  mockWrapper.mockClear();
});

describe("obtenerDetalleCxcAction — zod rejection before the action's work", () => {
  it.each([
    ["zero", 0],
    ["negative", -3],
    ["fractional", 1.5],
    ["string", "7"],
    ["NaN", Number.NaN],
    ["missing", undefined],
  ])("rejects a %s facturaId with the stable transport code", async (_name, facturaId) => {
    const r = await obtenerDetalleCxcAction({ facturaId });

    expect(r).toEqual({
      ok: false,
      error: { code: VALIDATION_ERROR, message: "Datos de entrada inválidos" },
    });
    // Rejected client-side: no session read, no transaction, no use case.
    expect(mockSesion).not.toHaveBeenCalled();
    expect(mockWrapper).not.toHaveBeenCalled();
    expect(mockDetalle).not.toHaveBeenCalled();
  });

  it("rejects an absent payload with the same stable code", async () => {
    const r = await obtenerDetalleCxcAction(undefined);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error.code).toBe(VALIDATION_ERROR);
    expect(mockWrapper).not.toHaveBeenCalled();
  });
});

describe("obtenerDetalleCxcAction — session and role gate", () => {
  it("fails with SESION_INVALIDA when there is no tenant session", async () => {
    mockSesion.mockResolvedValue(null);

    const r = await obtenerDetalleCxcAction({ facturaId: 12 });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error.code).toBe(SESION_INVALIDA);
    expect(mockWrapper).not.toHaveBeenCalled();
  });

  it("denies an actor outside ROLES_COBROS BEFORE the use case runs", async () => {
    mockSesion.mockResolvedValue(ctx);
    mockRol.mockResolvedValue(false);

    const r = await obtenerDetalleCxcAction({ facturaId: 12 });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected fail");
    expect(r.error.code).toBe(PAGO_NO_AUTORIZADO);
    // The read is gated by the module's S9 role matrix, server-side.
    expect(mockRol).toHaveBeenCalledWith({}, ctx.usuarioId, ctx.empresaId, ROLES_COBROS);
    expect(mockDetalle).not.toHaveBeenCalled();
  });

  it("forwards the use case's typed failure verbatim", async () => {
    mockSesion.mockResolvedValue(ctx);
    mockRol.mockResolvedValue(true);
    mockDetalle.mockResolvedValue({
      ok: false,
      code: FACTURA_COBRO_NO_VIGENTE,
      message: "La factura no está vigente; no se puede registrar un cobro",
    });

    const r = await obtenerDetalleCxcAction({ facturaId: 12 });

    expect(r).toEqual({
      ok: false,
      error: {
        code: FACTURA_COBRO_NO_VIGENTE,
        message: "La factura no está vigente; no se puede registrar un cobro",
      },
    });
  });

  it("returns the detail payload for an authorized read", async () => {
    mockSesion.mockResolvedValue(ctx);
    mockRol.mockResolvedValue(true);
    mockDetalle.mockResolvedValue({ ok: true, data: DETALLE });

    const r = await obtenerDetalleCxcAction({ facturaId: 12 });

    expect(r).toEqual({ ok: true, data: DETALLE });
    expect(mockDetalle).toHaveBeenCalledWith({}, ctx, { facturaId: 12 });
  });
});
