/**
 * Unit — per-invoice CxC detail (board-03 S13).
 *
 * No DB: the repository reads are stubbed so this pins ONLY the application
 * derivation — the SD due date, the SIGNED days-past-due count and the mora flag
 * come from the SAME pure `en-mora` helpers the board uses, so the detail screen
 * and the board can never disagree. Money crosses verbatim as `Decimal(12,2)`
 * strings (no float, no re-computation of the canonical balance here).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { consultarDetalleCxc } from "./consultar-detalle-cxc";
import { consultarDetalleCxcEnTx } from "../infrastructure/saldo-cxc.repository";
import { leerHistorialPagosFacturaEnTx } from "../infrastructure/pago-repository";
import { FACTURA_COBRO_NO_VIGENTE } from "../domain/errors";
import { enMora } from "../domain/en-mora";

jest.mock("../infrastructure/saldo-cxc.repository", () => ({
  consultarDetalleCxcEnTx: jest.fn(),
}));
jest.mock("../infrastructure/pago-repository", () => ({
  leerHistorialPagosFacturaEnTx: jest.fn(),
}));

const mockDetalle = jest.mocked(consultarDetalleCxcEnTx);
const mockHistorial = jest.mocked(leerHistorialPagosFacturaEnTx);

const ctx: TenantCtx = { empresaId: 4, sucursalId: 5, usuarioId: 6, esAdmin: false };
const tx = {} as PrismaTx;

// Wireframe board 03: emitted 01/07/2026, 30-day term → due 31/07/2026.
const FECHA_EMISION = new Date("2026-07-01T16:00:00.000Z");

function fila(over: Record<string, unknown> = {}) {
  return {
    facturaId: 12,
    clienteId: 3,
    ncf: "B0200001218",
    correlativoInterno: "FAC-001218",
    fechaEmision: FECHA_EMISION,
    total: "82500.00",
    cobrosAplicados: "0.00",
    saldoPendiente: "82500.00",
    clienteNombre: "Ana Martínez",
    clienteIdentificacionFiscal: "123-45678-9",
    clienteTipoCliente: "CREDITO",
    plazoCreditoDias: 30,
    ...over,
  };
}

function pago(over: Record<string, unknown> = {}) {
  return {
    correlativoRecibo: 42,
    fecha: new Date("2026-08-02T14:00:00.000Z"),
    tipo: "COBRO" as const,
    estado: "APLICADO" as const,
    monto: "1500.00",
    metodoPago: "EFECTIVO",
    usuarioNombre: "Ana",
    ...over,
  };
}

beforeEach(() => {
  mockDetalle.mockReset();
  mockHistorial.mockReset();
});

describe("consultarDetalleCxc (S13 invoice header)", () => {
  it("derives the SD due date, the signed days-past-due count and the mora flag", async () => {
    mockDetalle.mockResolvedValue(fila());
    mockHistorial.mockResolvedValue([pago()]);

    // 2026-09-05 SD is 36 full days past the 2026-07-31 SD due date.
    const r = await consultarDetalleCxc(tx, ctx, {
      facturaId: 12,
      now: new Date("2026-09-05T12:00:00.000Z"),
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.vencimiento).toBe("2026-07-31");
    expect(r.data.diasVencida).toBe(36);
    expect(r.data.enMora).toBe(true);
    // The header facts ride verbatim — money is never recomputed here.
    expect(r.data).toMatchObject({
      facturaId: 12,
      ncf: "B0200001218",
      correlativoInterno: "FAC-001218",
      clienteId: 3,
      clienteNombre: "Ana Martínez",
      clienteRnc: "123-45678-9",
      tipoCliente: "CREDITO",
      total: "82500.00",
      abonado: "0.00",
      saldo: "82500.00",
    });
    // ISO instant so the UI resolves the SD calendar day itself.
    expect(r.data.fechaEmision).toBe(FECHA_EMISION.toISOString());
  });

  it("keeps mora parity with the board rule at the due-day boundary", async () => {
    mockDetalle.mockResolvedValue(fila());
    mockHistorial.mockResolvedValue([]);

    // Due day itself (2026-07-31 SD): 0 days past due → not in mora.
    const enVencimiento = await consultarDetalleCxc(tx, ctx, {
      facturaId: 12,
      now: new Date("2026-07-31T16:00:00.000Z"),
    });
    if (!enVencimiento.ok) throw new Error("expected ok");
    expect(enVencimiento.data.diasVencida).toBe(0);
    expect(enVencimiento.data.enMora).toBe(false);

    // One full SD day later → in mora, 1 day past due (the board's flags agree).
    const now = new Date("2026-08-01T16:00:00.000Z");
    const unDia = await consultarDetalleCxc(tx, ctx, { facturaId: 12, now });
    if (!unDia.ok) throw new Error("expected ok");
    expect(unDia.data.diasVencida).toBe(1);
    expect(unDia.data.enMora).toBe(true);
    expect(unDia.data.enMora).toBe(
      enMora({ fechaEmision: FECHA_EMISION, plazoCreditoDias: 30, now }),
    );
  });

  it("keeps the day count SIGNED while the invoice is still within its term", async () => {
    mockDetalle.mockResolvedValue(fila());
    mockHistorial.mockResolvedValue([]);

    // Due 2026-07-31; today 2026-07-10 → 21 SD days REMAINING (negative count).
    const r = await consultarDetalleCxc(tx, ctx, {
      facturaId: 12,
      now: new Date("2026-07-10T12:00:00.000Z"),
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.diasVencida).toBe(-21);
    expect(r.data.enMora).toBe(false);
  });

  it("carries the payment history newest-first as the repository serves it", async () => {
    mockDetalle.mockResolvedValue(fila({ cobrosAplicados: "1500.00", saldoPendiente: "81000.00" }));
    mockHistorial.mockResolvedValue([
      pago({ correlativoRecibo: 43, fecha: new Date("2026-08-03T10:00:00.000Z"), monto: "500.00" }),
      pago(),
    ]);

    const r = await consultarDetalleCxc(tx, ctx, {
      facturaId: 12,
      now: new Date("2026-09-05T12:00:00.000Z"),
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.abonado).toBe("1500.00");
    expect(r.data.saldo).toBe("81000.00");
    expect(r.data.historial.map((p) => p.correlativoRecibo)).toEqual([43, 42]);
    expect(r.data.historial[0]).toEqual({
      correlativoRecibo: 43,
      fecha: "2026-08-03T10:00:00.000Z",
      tipo: "COBRO",
      estado: "APLICADO",
      monto: "500.00",
      metodoPago: "EFECTIVO",
      // V1's PAGO carries no referencia column; the field rides as null until
      // S14/T10 adds it, so the history renders it unchanged when it lands.
      referencia: null,
      usuarioNombre: "Ana",
    });
    // The invoice read is tenant-pinned by the repository signature.
    expect(mockDetalle).toHaveBeenCalledWith(tx, ctx, 12);
    expect(mockHistorial).toHaveBeenCalledWith(tx, ctx, 12);
  });

  it("maps a missing/foreign/non-VIGENTE invoice to the catalog code without reading history", async () => {
    mockDetalle.mockResolvedValue(null);

    const r = await consultarDetalleCxc(tx, ctx, { facturaId: 99 });

    expect(r).toEqual({
      ok: false,
      code: FACTURA_COBRO_NO_VIGENTE,
      message: expect.stringContaining("no está vigente"),
    });
    expect(mockHistorial).not.toHaveBeenCalled();
  });
});
