/**
 * Integration — concurrency of confirm (real DB, RLS on).
 *
 * (a) The same draft confirmed twice in parallel: exactly one transition wins,
 *     the loser gets a stable error and no duplicate CMP / audit / inventory.
 * (b) Two distinct drafts confirmed in parallel: both succeed and receive
 *     distinct sequential CMP numbers (the EMPRESA row lock serializes the
 *     company-wide MAX+1 allocation).
 * (c) v2r-03: confirm vs a concurrent draft edit, parked deterministically. The
 *     confirm must serialize the edit through the COMPRA row lock and re-derive
 *     its totals from a converged re-read — the final persisted header must
 *     ALWAYS equal a recompute over the FINAL persisted lines (the TOCTOU the
 *     finding closed). See test (c) for the two-stage parking protocol.
 */

import { Decimal } from "decimal.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { confirmarCompra } from "@/modules/compra/application/confirmar-compra";
import { actualizarCompra } from "@/modules/compra/application/actualizar-compra";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

/**
 * Dedicated single-connection blocker client (the devolucion/venta-lifecycle
 * pattern): needs DIRECT_URL (superuser) because the harness connection would
 * be used by the racers too, and `max: 1` keeps the parked lock on ONE socket.
 */
function crearClienteBloqueador(): PrismaClient {
  const directUrl = process.env.DIRECT_URL;
  if (directUrl === undefined || directUrl === "") {
    throw new Error("DIRECT_URL is not set; the blocker needs a superuser connection.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: directUrl, max: 1 }) });
}

interface WaitingPid {
  readonly pid: number;
}

/**
 * Poll `pg_stat_activity` until at least `cuantos` transactions are parked on a
 * lock (`wait_event_type='Lock'`, excluding the poller itself). The parking
 * protocol makes the interleave deterministic: once the expected number of
 * waiters is observed, release order can no longer change the winner (v2r-03).
 * Fails loudly on timeout instead of proceeding non-deterministically.
 */
async function esperarEsperando(
  db: PrismaClient,
  cuantos: number,
  contexto: string,
): Promise<void> {
  const inicio = Date.now();
  for (;;) {
    const esperando = await db.$queryRaw<WaitingPid[]>`
      SELECT a.pid
      FROM pg_stat_activity a
      WHERE a.wait_event_type = 'Lock'
        AND a.wait_event IS NOT NULL
        AND a.datname = current_database()
        AND a.pid <> pg_backend_pid()`;
    if (esperando.length >= cuantos) return;
    if (Date.now() - inicio > 15_000) {
      throw new Error(
        `Race parking failed (${contexto}): fewer than ${cuantos} transaction(s) waiting ` +
          `after 15s. waiters: ${JSON.stringify(esperando)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe("compra confirm concurrency (real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  async function crearDraft(): Promise<number> {
    return withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "50.00" },
        ],
      });
      if (!r.ok) throw new Error(`create failed: ${r.code}`);
      return r.data.id;
    });
  }

  const confirmOnce = (id: number) =>
    withTenantTransaction(ctx, (tx) => confirmarCompra(tx, ctx, { id }));

  it("(a) same draft raced: one wins, loser stable error, no duplicate effects", async () => {
    const id = await crearDraft();

    type ConfirmResult = Awaited<ReturnType<typeof confirmarCompra>>;
    const settled = await Promise.allSettled([confirmOnce(id), confirmOnce(id)]);
    for (const outcome of settled) {
      // Business rejections resolve as typed results, never a thrown promise.
      expect(outcome.status).toBe("fulfilled");
    }
    const results = settled.map(
      (o) => (o as PromiseFulfilledResult<ConfirmResult>).value,
    );
    const okResults = results.filter((r) => r.ok === true);
    const errorResults = results.filter(
      (r) => !r.ok && (r.code === "COMPRA_INMUTABLE" || r.code === "CONCURRENCIA_CONFLICTO"),
    );
    expect(okResults).toHaveLength(1);
    expect(errorResults).toHaveLength(1);

    const db = getHarnessDb();
    const compra = await db.compra.findUnique({ where: { id } });
    expect(compra?.estado).toBe("PENDIENTE");
    expect(compra?.correlativoInterno).toBe("CMP-000001");

    // Exactly one confirm audit row (CREAR + one ACTUALIZAR).
    const auditCount = await db.movimientoAuditoria.count({
      where: { entidad: "Compra", idEntidad: String(id) },
    });
    expect(auditCount).toBe(2);
    // No inventory movement, no second purchase row.
    expect(await db.movimientoInventario.count({ where: { compraId: id } })).toBe(0);
    expect(await db.compra.count({ where: { correlativoInterno: "CMP-000001" } })).toBe(1);
  });

  it("(b) two drafts raced: distinct sequential correlativos", async () => {
    const idA = await crearDraft();
    const idB = await crearDraft();

    const [ra, rb] = await Promise.all([confirmOnce(idA), confirmOnce(idB)]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) throw new Error("both confirms should succeed");

    const correlativos = [ra.data.correlativoInterno, rb.data.correlativoInterno].sort();
    // Distinct and sequentially allocated from the empresa counter.
    expect(new Set(correlativos).size).toBe(2);
    expect(correlativos).toEqual(["CMP-000001", "CMP-000002"]);

    const db = getHarnessDb();
    const totalConfirmadas = await db.compra.count({
      where: { empresaId: fixture.empresaA.id, estado: "PENDIENTE" },
    });
    expect(totalConfirmadas).toBe(2);
  });

  it("(c) confirm vs concurrent draft edit: CONFLICT for the edit, converged header == final lines (v2r-03)", async () => {
    // Seed 1.000 × 50.00 @18 → header 50.00 + 9.00 = 59.00.
    const id = await crearDraft();
    const db = getHarnessDb();
    const blockerDb = crearClienteBloqueador();

    let releaseBlocker!: () => void;
    const unlocked = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    let signalLockHeld!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      signalLockHeld = resolve;
    });

    // TWO-STAGE PARKING (deterministic): the blocker parks the confirm on the
    // EMPRESA row — the confirm's FIRST write lock — AFTER its step-1 read and
    // its COMPRA FOR UPDATE + POST-LOCK RE-READ (v2r-03) have already run.
    // Stage 2 then launches the draft edit, which POST-FIX parks on the COMPRA
    // row the confirm holds (the edit's guarded header UPDATE). Releasing parks
    // BOTH at exactly the interleave v2r-03 describes: the edit committed
    // between the confirm's primal read and its guarded UPDATE would previously
    // have been confirmed OVER with stale totals (the TOCTOU). Post-fix the
    // confirm holds the row for its whole identity — the edit can never land.
    const blockerPromise = blockerDb.$transaction(
      async (btx) => {
        await btx.$executeRaw`SELECT "id" FROM "EMPRESA" WHERE "id" = ${fixture.empresaA.id}::int FOR UPDATE`;
        signalLockHeld();
        await unlocked;
        throw new Error("blocker released (intentional rollback trigger)");
      },
      { timeout: 60_000 }, // idle timeout must outlive the whole orchestration
    );
    void blockerPromise.catch(() => undefined);

    const confirmar = () =>
      withTenantTransaction(ctx, (tx) => confirmarCompra(tx, ctx, { id }));
    const editar = () =>
      withTenantTransaction(ctx, (tx) =>
        actualizarCompra(tx, ctx, {
          id,
          lineas: [
            { productoId: fixture.productos.prodA1.id, cantidad: "3.000", costoUnitario: "25.00" },
          ],
        }),
      );

    type ConfirmResult = Awaited<ReturnType<typeof confirmarCompra>>;
    type EditResult = Awaited<ReturnType<typeof actualizarCompra>>;
    let confirmResult: ConfirmResult | null = null;
    let editResult: EditResult | null = null;
    try {
      await lockHeld;
      const confirmPromise = confirmar();
      await esperarEsperando(db, 1, "confirm parked at EMPRESA");
      const editPromise = editar();
      await esperarEsperando(db, 2, "confirm at EMPRESA + edit at COMPRA");
      releaseBlocker();
      [confirmResult, editResult] = await Promise.all([confirmPromise, editPromise]);
    } catch (err) {
      releaseBlocker();
      throw err;
    } finally {
      releaseBlocker();
      await Promise.allSettled([blockerPromise]);
      await blockerDb.$disconnect();
    }

    // The confirm wins with the totals it derived UNDER the COMPRA lock (the
    // pre-edit 1×50.00 snapshot); the edit loses the guarded header UPDATE.
    expect(confirmResult?.ok).toBe(true);
    if (confirmResult?.ok) expect(confirmResult.data.total).toBe("59.00");
    expect(editResult?.ok).toBe(false);
    if (editResult && !editResult.ok) expect(editResult.code).toBe("CONCURRENCIA_CONFLICTO");

    // THE v2r-03 INVARIANT: the persisted header ALWAYS equals a recompute over
    // the FINAL persisted lines — the mixed state (stale header over edited
    // lines) the finding closed can never be recreated.
    const compra = await db.compra.findUnique({
      where: { id },
      include: { detalles: true },
    });
    expect(compra?.estado).toBe("PENDIENTE");
    expect(compra?.correlativoInterno).toBe("CMP-000001");
    expect(compra?.detalles).toHaveLength(1); // the losing edit replaced nothing
    expect(compra?.detalles[0].cantidad.toFixed(3)).toBe("1.000");
    expect(compra?.detalles[0].costoUnitario.toFixed(2)).toBe("50.00");
    let subtotal = new Decimal(0);
    let itbis = new Decimal(0);
    for (const l of compra!.detalles) {
      const base = new Decimal(l.cantidad).times(l.costoUnitario);
      subtotal = subtotal.plus(base);
      itbis = itbis.plus(base.times(l.tasaItbis).div(100));
    }
    expect(compra!.subtotal.toFixed(2)).toBe(subtotal.toFixed(2));
    expect(compra!.itbis.toFixed(2)).toBe(itbis.toFixed(2));
    // formal-juridica + MERCANCIA → no retentions → total = gravado + itbis.
    expect(compra!.total.toFixed(2)).toBe(subtotal.plus(itbis).toFixed(2));
    expect(compra!.total.toFixed(2)).toBe("59.00");
    // Exactly one confirm audit row (CREAR + one ACTUALIZAR). The losing edit
    // appended nothing.
    expect(
      await db.movimientoAuditoria.count({
        where: { entidad: "Compra", idEntidad: String(id) },
      }),
    ).toBe(2);
  });
});
