/**
 * Integration — refund idempotency with a client key (R-C3; real Postgres, RLS on).
 *
 * The code under test (`registrarReembolso`) always runs through the app role
 * inside `withTenantTransaction`; seeding uses the trusted superuser harness.
 *
 * Proves the two spec-critical scenarios plus the legitimate-repeat control:
 *   1. Replaying key K returns `PAGO_IDEMPOTENCIA_CONFLICTO`, writes NO second
 *      row, and burns NO receipt number (the key is checked before the
 *      allocation). A fresh-key refund of the SAME amount is then accepted, so
 *      the gate is the key, not amount identity.
 *   2. Two simultaneous first submits sharing a key: exactly one row commits and
 *      the loser receives the SAME stable code (the unique violation is
 *      translated, the loser's transaction rolls back — no duplicate receipt).
 */

import { Prisma } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { messageFor, PAGO_IDEMPOTENCIA_CONFLICTO } from "@/modules/cobros/domain/errors";
import { registrarReembolso } from "@/modules/cobros/application/registrar-reembolso";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

let fixture: TenantFixture | null = null;
let ctx: TenantCtx;
let facturaId: number;

function ctxA1(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId: f.sucursalA1.id,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

async function sembrarFactura(): Promise<number> {
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
      ncf: "B01000000020",
      correlativoInterno: "FAC-20",
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

/** One `registrarReembolso` through the real tenant wrapper. */
function reembolsar(fact: number, monto: string, idempotencyKey: string) {
  return withTenantTransaction(ctx, (tx) =>
    registrarReembolso(tx, ctx, { facturaId: fact, monto, idempotencyKey }),
  );
}

describe("cobros refund idempotency (real DB, RLS on; R-C3)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    facturaId = await sembrarFactura();
  });

  it("replay of a key conflicts with no row and no receipt burned; a fresh key is accepted", async () => {
    const primero = await reembolsar(facturaId, "500.00", "K-REPLAY");
    expect(primero.ok).toBe(true);
    if (!primero.ok) throw new Error("el primer reembolso debería comprometerse");
    expect(primero.data.correlativoRecibo).toBe(1);

    const db = getHarnessDb();
    const countAntes = await db.pago.count({ where: { idempotencyKey: "K-REPLAY" } });
    const correlativoAntes = (await db.pago.aggregate({
      where: { empresaId: ctx.empresaId },
      _max: { correlativoRecibo: true },
    }))!._max.correlativoRecibo;
    expect(countAntes).toBe(1);
    expect(correlativoAntes).toBe(1);

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
    const nuevo = await reembolsar(facturaId, "500.00", "K-FRESH");
    expect(nuevo.ok).toBe(true);
    if (!nuevo.ok) throw new Error("un key fresco debería aceptar el reembolso");
    expect(nuevo.data.correlativoRecibo).toBe(2);
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(2);
  });

  it("two simultaneous first submits on one key: exactly one row, loser stable code", async () => {
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
    // Only one PAGO exists at all (the loser burned no receipt that survived).
    expect(await db.pago.count({ where: { empresaId: ctx.empresaId } })).toBe(1);
  });
});
