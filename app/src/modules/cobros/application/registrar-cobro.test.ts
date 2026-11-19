/**
 * Unit — `registrarCobro` date band + referencia (board-03 S14).
 *
 * No DB: every infrastructure seam is stubbed, so this pins the APPLICATION rules
 * only — the editable `Fecha del pago` is bounded against the SERVER's
 * `America/Santo_Domingo` clock (never the client's) BEFORE the invoice lock, the
 * receipt allocation or any write, and an optional `referencia` rides the `PAGO`
 * row. The clock is pinned with fake timers exactly as venta's fecha-venta tests
 * do, and the tenant horizon is stubbed (a per-empresa parameter, never a
 * constant).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { registrarCobro } from "./registrar-cobro";
import { bloquearYCalcularSaldoFacturaEnTx } from "../infrastructure/saldo-cxc.repository";
import { asignarCorrelativoReciboEnTx } from "../infrastructure/recibo.repository";
import { crearPagoEnTx } from "../infrastructure/pago-repository";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
import { leerRetroactivoFechaVentaEnTx } from "@/modules/venta/infrastructure/config-repository";
import {
  COBRO_EXCEDE_SALDO,
  FACTURA_COBRO_NO_VIGENTE,
  FECHA_COBRO_FUTURA,
  FECHA_COBRO_RETROACTIVA_EXCEDIDA,
  messageFor,
} from "../domain/errors";

jest.mock("../infrastructure/saldo-cxc.repository", () => ({
  bloquearYCalcularSaldoFacturaEnTx: jest.fn(),
}));
jest.mock("../infrastructure/recibo.repository", () => ({
  asignarCorrelativoReciboEnTx: jest.fn(),
}));
jest.mock("../infrastructure/pago-repository", () => ({
  crearPagoEnTx: jest.fn(),
}));
jest.mock("@/modules/auditoria/application/auditoria-write-port", () => ({
  registrarEventoAuditoriaEnTx: jest.fn(),
}));
jest.mock("@/modules/venta/infrastructure/config-repository", () => ({
  leerRetroactivoFechaVentaEnTx: jest.fn(),
}));

const mockSaldo = jest.mocked(bloquearYCalcularSaldoFacturaEnTx);
const mockRecibo = jest.mocked(asignarCorrelativoReciboEnTx);
const mockPago = jest.mocked(crearPagoEnTx);
const mockAuditoria = jest.mocked(registrarEventoAuditoriaEnTx);
const mockHorizonte = jest.mocked(leerRetroactivoFechaVentaEnTx);

const ctx: TenantCtx = { empresaId: 4, sucursalId: 5, usuarioId: 6, esAdmin: false };
const tx = {} as PrismaTx;

/** 10/08/2026 11:00 in America/Santo_Domingo. */
const AHORA = new Date("2026-08-10T15:00:00.000Z");

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(AHORA);
  mockSaldo.mockReset();
  mockRecibo.mockReset();
  mockPago.mockReset();
  mockAuditoria.mockReset();
  mockHorizonte.mockReset();
  mockHorizonte.mockResolvedValue(7);
  mockSaldo.mockResolvedValue({ total: "1000.00", saldoPendiente: "1000.00", cobradoNeto: "0.00" });
  mockRecibo.mockResolvedValue(42);
  mockPago.mockResolvedValue({ id: 500 });
  mockAuditoria.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

function nadaEscrito(): void {
  expect(mockSaldo).not.toHaveBeenCalled();
  expect(mockRecibo).not.toHaveBeenCalled();
  expect(mockPago).not.toHaveBeenCalled();
  expect(mockAuditoria).not.toHaveBeenCalled();
}

describe("registrarCobro — Fecha del pago band (S14)", () => {
  it("rejects a FUTURE SD date with the catalog code and writes nothing", async () => {
    const r = await registrarCobro(tx, ctx, {
      facturaId: 12,
      monto: "100.00",
      fechaCobro: "2026-08-11",
    });
    expect(r).toStrictEqual({
      ok: false,
      code: FECHA_COBRO_FUTURA,
      message: messageFor(FECHA_COBRO_FUTURA),
    });
    nadaEscrito();
  });

  it("rejects a date beyond the tenant horizon with the catalog code and writes nothing", async () => {
    const r = await registrarCobro(tx, ctx, {
      facturaId: 12,
      monto: "100.00",
      fechaCobro: "2026-08-02",
    });
    expect(r).toStrictEqual({
      ok: false,
      code: FECHA_COBRO_RETROACTIVA_EXCEDIDA,
      message: messageFor(FECHA_COBRO_RETROACTIVA_EXCEDIDA),
    });
    nadaEscrito();
  });

  it("persists the band-legal SD date at SD noon, not the client clock", async () => {
    const r = await registrarCobro(tx, ctx, {
      facturaId: 12,
      monto: "400.00",
      fechaCobro: "2026-08-03",
    });
    expect(r.ok).toBe(true);
    expect(mockPago).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({
        fecha: new Date("2026-08-03T16:00:00.000Z"),
      }),
    );
  });

  it("defaults to the server instant and stays legal when no date is sent", async () => {
    const r = await registrarCobro(tx, ctx, { facturaId: 12, monto: "400.00" });
    expect(r.ok).toBe(true);
    expect(mockPago).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({ fecha: AHORA }),
    );
  });
});

describe("registrarCobro — optional Referencia (S14)", () => {
  it("carries the reference onto the PAGO row", async () => {
    await registrarCobro(tx, ctx, {
      facturaId: 12,
      monto: "400.00",
      referencia: "  REF-9  ",
    });
    expect(mockPago).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({ referencia: "REF-9" }),
    );
  });

  it("stores NULL when the reference is absent or blank (never an empty string)", async () => {
    await registrarCobro(tx, ctx, { facturaId: 12, monto: "400.00" });
    expect(mockPago).toHaveBeenLastCalledWith(
      tx,
      ctx,
      expect.objectContaining({ referencia: null }),
    );

    await registrarCobro(tx, ctx, { facturaId: 12, monto: "400.00", referencia: "   " });
    expect(mockPago).toHaveBeenLastCalledWith(
      tx,
      ctx,
      expect.objectContaining({ referencia: null }),
    );
  });
});

describe("registrarCobro — preserved behaviour", () => {
  it("still rejects an over-payment against the in-transaction balance", async () => {
    mockSaldo.mockResolvedValue({ total: "1000.00", saldoPendiente: "1000.00", cobradoNeto: "0.00" });
    const r = await registrarCobro(tx, ctx, { facturaId: 12, monto: "1000.01" });
    expect(r).toStrictEqual({
      ok: false,
      code: COBRO_EXCEDE_SALDO,
      message: messageFor(COBRO_EXCEDE_SALDO),
    });
    expect(mockRecibo).not.toHaveBeenCalled();
    expect(mockPago).not.toHaveBeenCalled();
  });

  it("still rejects a missing / non-VIGENTE invoice", async () => {
    mockSaldo.mockResolvedValue(null);
    const r = await registrarCobro(tx, ctx, { facturaId: 12, monto: "100.00" });
    expect(r).toStrictEqual({
      ok: false,
      code: FACTURA_COBRO_NO_VIGENTE,
      message: messageFor(FACTURA_COBRO_NO_VIGENTE),
    });
    expect(mockPago).not.toHaveBeenCalled();
  });

  it("returns the derived pending balance and appends exactly one PAGAR audit row", async () => {
    mockSaldo.mockResolvedValue({ total: "1000.00", saldoPendiente: "1000.00", cobradoNeto: "0.00" });
    const r = await registrarCobro(tx, ctx, { facturaId: 12, monto: "250.50" });
    expect(r).toStrictEqual({
      ok: true,
      data: {
        pagoId: 500,
        correlativoRecibo: 42,
        total: "1000.00",
        saldoPendiente: "749.50",
      },
    });
    expect(mockAuditoria).toHaveBeenCalledTimes(1);
  });
});
