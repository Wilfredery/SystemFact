/**
 * Integration — refund idempotency with a client key (R-C3) + refund bound
 * (audit v2r-02; real Postgres, RLS on).
 *
 * The code under test (`registrarReembolso`) always runs through the app role
 * inside `withTenantTransaction`; seeding uses the trusted superuser harness.
 *
 * Proves the two spec-critical scenarios plus the legitimate-repeat control and
 * the refund bound (audit run-3):
 *   1. Replaying key K returns `PAGO_IDEMPOTENCIA_CONFLICTO`, writes NO second
 *      row, and burns NO receipt number (the key is checked before the
 *      allocation). A fresh-key refund of the SAME amount is then accepted, so
 *      the gate is the key, not amount identity (as long as the cumulative
 *      cash-out stays within the remaining NET cash — see scenario 5).
 *   2. Two simultaneous first submits sharing a key: exactly one row commits and
 *      the loser receives the SAME stable code (the unique violation is
 *      translated, the loser's transaction rolls back — no duplicate receipt).
 *   3. (bound) A refund against an invoice with ZERO net cash (zero cobros) is
 *      rejected with `REEMBOLSO_EXCEDE_SALDO`: no `PAGO` row is written and no
 *      receipt is burned.
 *   4. (bound) A refund EXACTLY equal to the net cash collected is accepted (the
 *      bound is `<=`, not `<`); one cent above is rejected on a fresh invoice.
 *   5. (audit run-3) The bound counts COMMITTED refunds (net cash): after a
 *      committed refund, a fresh-key refund that would push the cumulative
 *      payout past the collected cash is REJECTED with nothing persisted — then
 *      a refund exactly equal to the remaining net commits (boundary).
 *   6. (audit run-3 NC inflation) A VIGENTE nota de crédito does NOT soak into
 *      the bound: zero cobros + an NC against the invoice still rejects a
 *      refund of the NC amount (the old `total − saldoPendiente` bound would
 *      have allowed it because the NC shrinks `saldoPendiente`).
 *
 * Every refund scenario now runs against a PAYMENT-BACKED invoice (a full
 * COBRO of the 10,000.00 total is seeded first), so the refund amounts are
 * legitimate and the suite no longer defect-encodes the unbound behavior.
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  messageFor,
  PAGO_IDEMPOTENCIA_CONFLICTO,
  REEMBOLSO_EXCEDE_SALDO,
} from "@/modules/cobros/domain/errors";
import { registrarReembolso } from "@/modules/cobros/application/registrar-reembolso";
import { registrarCobro } from "@/modules/cobros/application/registrar-cobro";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;
let ctx: TenantCtx;

function ctxA1(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId: f.sucursalA1.id,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

/** A fresh VIGENTE 10,000.00 invoice with ZERO payments on it. */
async function sembrarFactura(ncf = "B01000000020", correlativo = "FAC-20"): Promise<number> {
  const db = getHarnessDb();
  const cliente = await db.cliente.create({
    data: {
      empresaId: ctx.empresaId,
      nombre: "Cliente Reembolso",
      telefono: "0",
      direccion: "x",
      tipoCliente: "CREDITO",
      creditoHabilitado: true,
      limiteCredito: new Prisma.Decimal("20000.00"),
      plazoCreditoDias: 30,
    },
    select: { id: true },
  });
  const f = await db.factura.create({
    data: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      clienteId: cliente.id,
      usuarioId: ctx.usuarioId,
      tipoNcf: "B01",
      ncf,
      correlativoInterno: correlativo,
      estado: "VIGENTE",
      subtotalGravado: new Prisma.Decimal("10000.00"),
      itbis: new Prisma.Decimal("0.00"),
      subtotalExento: new Prisma.Decimal("0.00"),
      descuento: new Prisma.Decimal("0.00"),
      total: new Prisma.Decimal("10000.00"),
      fechaEmision: new Date("2026-09-01T12:00:00.000Z"),
    },
    select: { id: true },
  });
  return f.id;
}

/**
 * A payment-backed invoice: the VIGENTE 10,000.00 invoice above with a COBRO of
 * the FULL total already applied (net cash = 10,000.00), so subsequent refunds
 * up to that amount are legitimate business states.
 */
async function sembrarFacturaCobrada(ncf?: string, correlativo?: string): Promise<number> {
  const facturaId = await sembrarFactura(ncf, correlativo);
  const cobro = await withTenantTransaction(ctx, (tx) =>
    registrarCobro(tx, ctx, { facturaId, monto: "10000.00" }),
  );
  expect(cobro.ok).toBe(true);
  return facturaId;
}

/** One `registrarReembolso` through the real tenant wrapper. */
function reembolsar(fact: number, monto: string, idempotencyKey: string) {
  return withTenantTransaction(ctx, (tx) =>
    registrarReembolso(tx, ctx, { facturaId: fact, monto, idempotencyKey }),
  );
}

describe("cobros refund idempotency + bound (real DB, RLS on; R-C3, v2r-02)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
  });

  it("replay of a key conflicts with no row and no receipt burned; a fresh key is accepted", async () => {
    const facturaId = await sembrarFacturaCobrada();
    const primero = await reembolsar(facturaId, "500.00", "K-REPLAY");
    expect(primero.ok).toBe(true);
    if (!primero.ok) throw new Error("el primer reembolso debería comprometerse");
    // Receipt 1 went to the seeded full COBRO; this refund takes receipt 2.
    expect(primero.data.correlativoRecibo).toBe(2);

    const db = getHarnessDb();
    const countAntes = await db.pago.count({ where: { idempotencyKey: "K-REPLAY" } });
    const correlativoAntes = (await db.pago.aggregate({
      where: { empresaId: ctx.empresaId },
      _max: { correlativoRecibo: true },
    }))!._max.correlativoRecibo;
    expect(countAntes).toBe(1);
    expect(correlativoAntes).toBe(2);

    // Replay of the SAME key: stable conflict, nothing written, no receipt burned.
    const replay = await reembolsar(facturaId, "500.00", "K-REPLAY");
    expect(!replay.ok && replay.code).toBe(PAGO_IDEMPOTENCIA_CONFLICTO);
    if (!replay.ok) expect(replay.message).toBe(messageFor(PAGO_IDEMPOTENCIA_CONFLICTO));

    expect(await db.pago.count({ where: { idempotencyKey: "K-REPLAY" } })).toBe(countAntes);
    const correlativoTrasReplay = (await db.pago.aggregate({
      where: { empresaId: ctx.empresaId },
      _max: { correlativoRecibo: true },
    }))!._max.correlativoRecibo;
    // N+1 was NOT consumed by the replay (allocation happens only after the key gate).
    expect(correlativoTrasReplay).toBe(correlativoAntes);

    // Negative control: a DIFFERENT key for the SAME amount is a legitimate
    // second refund — keys gate de-duplication, not amount identity (R-C3).
    // It stays within the remaining net cash (10,000.00 COBRO − 500.00 refund
    // #1 = 9,500.00), so the net-cash bound permits it (audit run-3).
    const nuevo = await reembolsar(facturaId, "500.00", "K-FRESH");
    expect(nuevo.ok).toBe(true);
    if (!nuevo.ok) throw new Error("un key fresco debería aceptar el reembolso");
    expect(nuevo.data.correlativoRecibo).toBe(3);
    // COBRO + two refunds.
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(3);
  });

  it("the net-cash bound counts COMMITTED refunds: sequential fresh-key refunds cannot drain past the collected cash (audit run-3)", async () => {
    const facturaId = await sembrarFacturaCobrada(); // net cash 10,000.00
    const db = getHarnessDb();

    // Refund #1 commits: 500.00 paid back → remaining net cash 9,500.00.
    const primero = await reembolsar(facturaId, "500.00", "K-NET-1");
    expect(primero.ok).toBe(true);
    const correlativoAntes = (await db.pago.aggregate({
      where: { empresaId: ctx.empresaId },
      _max: { correlativoRecibo: true },
    }))!._max.correlativoRecibo;
    expect(correlativoAntes).toBe(2);

    // The old bound (total − saldoPendiente, refund-blind) would ACCEPT a
    // fresh-key refund of 9,500.01 (it never shrank after refund #1): a
    // second 9,500+ payout on top of the 10,000 collected. The net-cash
    // bound rejects it BEFORE allocation — no PAGO row, no receipt burned.
    const excedido = await reembolsar(facturaId, "9500.01", "K-NET-2");
    expect(!excedido.ok && excedido.code).toBe(REEMBOLSO_EXCEDE_SALDO);
    if (!excedido.ok) expect(excedido.message).toBe(messageFor(REEMBOLSO_EXCEDE_SALDO));
    expect(await db.pago.count({ where: { facturaId, estado: "APLICADO" } })).toBe(2); // COBRO + refund #1
    expect(
      (await db.pago.aggregate({
        where: { empresaId: ctx.empresaId },
        _max: { correlativoRecibo: true },
      }))!._max.correlativoRecibo,
    ).toBe(correlativoAntes);

    // Boundary: a refund EXACTLY equal to the remaining net cash (9,500.00)
    // commits (the bound is <=, not <). COBRO + refund #1 + refund #2.
    const justo = await reembolsar(facturaId, "9500.00", "K-NET-3");
    expect(justo.ok).toBe(true);
    if (!justo.ok) throw new Error("el reembolso igual al neto debería aceptarse");
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(3);
  });

  it("a VIGENTE nota de crédito does NOT inflate the bound: zero cobros still rejects a refund of the NC amount (audit run-3)", async () => {
    // Zero cobros, plus an NC of 4,000.00 against the 10,000.00 invoice. The
    // OLD bound derived cobrado = total − saldoPendiente = 10,000 − 6,000 =
    // 4,000.00 (the NC shrank saldoPendiente) and would have ACCEPTED a
    // refund of the full NC amount — 4,000 of real cash out with ZERO cash in.
    // The net-cash bound is refound-blind to NCs: cobradoNeto = 0.00.
    const facturaId = await sembrarFactura("B01000000022", "FAC-22");
    const db = getHarnessDb();
    const factura = await db.factura.findUnique({ where: { id: facturaId } });
    expect(factura).not.toBeNull();
    await db.notaCredito.create({
      data: {
        empresaId: ctx.empresaId,
        sucursalId: ctx.sucursalId,
        clienteId: factura!.clienteId,
        usuarioId: ctx.usuarioId,
        facturaOriginalId: facturaId,
        ncf: "B04000000030",
        estado: "VIGENTE",
        motivo: "Devolución parcial",
        monto: new Prisma.Decimal("4000.00"),
        itbis: new Prisma.Decimal("0.00"),
        fechaEmision: new Date("2026-09-02T12:00:00.000Z"),
      },
    });

    const rechazo = await reembolsar(facturaId, "4000.00", "K-NC");
    expect(!rechazo.ok && rechazo.code).toBe(REEMBOLSO_EXCEDE_SALDO);
    if (!rechazo.ok) expect(rechazo.message).toBe(messageFor(REEMBOLSO_EXCEDE_SALDO));

    // Zero cash collected → nothing persisted at all (and no receipt burned).
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(0);
  });

  it("two simultaneous first submits on one key: exactly one row, loser stable code", async () => {
    const facturaId = await sembrarFacturaCobrada();
    type ReembolsoResult = Awaited<ReturnType<typeof registrarReembolso>>;
    const settled = await Promise.allSettled([
      reembolsar(facturaId, "500.00", "K-RACE"),
      reembolsar(facturaId, "500.00", "K-RACE"),
    ]);
    // Business rejections resolve as typed results, never a rejected promise.
    for (const outcome of settled) {
      expect(outcome.status).toBe("fulfilled");
    }
    const results = settled.map(
      (o) => (o as PromiseFulfilledResult<ReembolsoResult>).value,
    );
    const exitos = results.filter((r) => r.ok);
    const conflictos = results.filter((r) => !r.ok && r.code === PAGO_IDEMPOTENCIA_CONFLICTO);
    expect(exitos).toHaveLength(1);
    expect(conflictos).toHaveLength(1);

    const db = getHarnessDb();
    // Exactly one committed row for the raced key; the loser rolled back.
    expect(await db.pago.count({ where: { idempotencyKey: "K-RACE" } })).toBe(1);
    // Seeded COBRO + one raced refund; the loser burned no receipt that survived.
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(2);
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId, estado: "APLICADO" } })).toBe(2);
  });

  it("rejects a refund against a zero-payment invoice with REEMBOLSO_EXCEDE_SALDO (v2r-02)", async () => {
    // Audit dummy equivalent: VIGENTE 10,000.00 invoice, ZERO payments →
    // cobrado = 0.00 → any positive refund exceeds what the client paid.
    const facturaId = await sembrarFactura();
    const rechazo = await reembolsar(facturaId, "500.00", "K-OVER");
    expect(!rechazo.ok && rechazo.code).toBe(REEMBOLSO_EXCEDE_SALDO);
    if (!rechazo.ok) expect(rechazo.message).toBe(messageFor(REEMBOLSO_EXCEDE_SALDO));

    const db = getHarnessDb();
    // Nothing was written for this invoice AND no receipt number was burned
    // (the bound rejects BEFORE the allocation — like the key gate).
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(0);
    expect(
      await db.pago.count({ where: { facturaId, estado: "APLICADO" } }),
    ).toBe(0);
  });

  it("accepts a refund exactly equal to the amount collected (bound is <=, v2r-02)", async () => {
    const facturaId = await sembrarFacturaCobrada();
    const justo = await reembolsar(facturaId, "10000.00", "K-IGUAL");
    expect(justo.ok).toBe(true);
    if (!justo.ok) throw new Error("un reembolso igual al cobrado debería aceptarse");

    // An amount one cent above is then rejected on a fresh invoice (sanity).
    const factura2 = await sembrarFacturaCobrada("B01000000021", "FAC-21");
    const excedido = await reembolsar(factura2, "10000.01", "K-EXCEDE");
    expect(!excedido.ok && excedido.code).toBe(REEMBOLSO_EXCEDE_SALDO);
  });
});