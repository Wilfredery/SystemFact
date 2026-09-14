/**
 * Integration — venta guarded lifecycle races + double-cancel (spec R-V3, R-V4).
 *
 * Real DB. Proves the guarded-predicate optimistic lock actually serialises:
 *   - two PARALLEL updates on one draft → exactly one commits; the loser gets
 *     `CONCURRENCIA_CONFLICTO` and the draft's line-set is the WINNER's only (no
 *     mixing), with only ONE update audit row;
 *   - a SECOND cancel (serial) is `VENTA_INMUTABLE` with NO second audit;
 *   - two PARALLEL cancels → exactly one commits, loser `CONCURRENCIA_CONFLICTO`,
 *     no second audit, and stock/config are untouched.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  crearVenta,
  actualizarVenta,
  cancelarVenta,
} from "@/modules/venta/application/venta-service";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;

let fixture: TenantFixture | null = null;

function ctxA1(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}

/** A priced, stocked empresa-A product; returns its id. */
async function crearProductoConStock(
  empresaId: number,
  sucursalId: number,
  categoriaId: number,
  codigo: string,
  stock: string,
): Promise<number> {
  const prod = await crearProductoVenta({ empresaId, categoriaId, codigo, precioVenta: "100.00" });
  await fijarStock(sucursalId, prod.id, stock);
  return prod.id;
}

/**
 * Dedicated blocker connection for the parking race — same superuser access as
 * `getHarnessDb` but a SEPARATE PrismaPg pool with `max: 1`. The blocker's
 * transaction must stay open holding the `VENTA` row lock for the whole parking
 * window, while other clients (harness poller, tenant racers) work in parallel;
 * sharing the harness pool could serialize against itself or steal the polling
 * connections, so a dedicated single-connection client is the robust choice.
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

interface LockRow {
  readonly pid: number;
  readonly locktype: string;
  readonly granted: boolean;
  readonly mode: string;
  readonly query: string | null;
}

/**
 * Poll until BOTH racer transactions are parked: waiting backends (lock waits
 * excluding our own poller connection) recorded in `pg_stat_activity`, joined
 * with `pg_locks` for diagnosis. Being parked is the guarantee that both racers
 * already read their `estado`/`updatedAt` snapshot, so after the blocker rolls
 * back the guarded `updateMany` predicates re-evaluate deterministically: the
 * first delivered waiter commits, the second matches zero rows →
 * `CONCURRENCIA_CONFLICTO`. Fails loudly on timeout (dumping the full lock
 * state) instead of proceeding non-deterministically.
 */
async function esperarAmbasEsperando(db: PrismaClient): Promise<void> {
  const inicio = Date.now();
  for (;;) {
    const esperando = await db.$queryRaw<WaitingPid[]>`
      SELECT a.pid
      FROM pg_stat_activity a
      WHERE a.wait_event_type = 'Lock'
        AND a.wait_event IS NOT NULL
        AND a.datname = current_database()
        AND a.pid <> pg_backend_pid()`;
    if (esperando.length >= 2) return;
    if (Date.now() - inicio > 5_000) {
      const dump = await db.$queryRaw<LockRow[]>`
        SELECT l.pid, l.locktype, l.granted, l.mode, left(s.query, 120) AS query
        FROM pg_locks l
        LEFT JOIN pg_stat_activity s ON s.pid = l.pid
        WHERE l.pid IN (
          SELECT pid FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event IS NOT NULL
        ) OR NOT l.granted`;
      throw new Error(
        "Race parking failed: fewer than two transactions are waiting on the " +
          `row lock after 5s. Current lock state: ${JSON.stringify(dump)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/**
 * Fire `crearRaza()` (the two parallel use cases) while a blocker transaction
 * holds the `Venta` row lock WITHOUT changing any data (`SELECT ... FOR
 * UPDATE`), wait until BOTH racers are parked on it, then roll the blocker back
 * (a rollback transforms nothing). From then on the race is deterministic: the
 * first delivered waiter passes its guarded predicate and commits (advancing
 * the row's `updatedAt`/`estado`), so the second waiter's re-evaluated
 * predicate matches zero rows → `CONCURRENCIA_CONFLICTO`. Scheduler-dependent
 * flakiness is gone; every existing assertion stays untouched.
 *
 * The blocker's Prisma interactive transaction gets a 15s timeout (its default
 * 5s would kill it mid-parking); the rollback is triggered by throwing after
 * the unlock signal, and its rejection is deliberately swallowed.
 */
async function conRazaBloqueada<T>(ventaId: number, crearRaza: () => Promise<T>): Promise<T> {
  const blockerDb = crearClienteBloqueador();
  let releaseBlocker!: () => void;
  const unlocked = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });
  let signalLockHeld!: () => void;
  const lockHeld = new Promise<void>((resolve) => {
    signalLockHeld = resolve;
  });
  const blockerPromise = blockerDb.$transaction(
    async (btx) => {
      await btx.$executeRaw`SELECT id FROM "VENTA" WHERE id = ${ventaId} FOR UPDATE`;
      signalLockHeld();
      // Hold the row lock while both racers stack up on it, then roll back.
      await unlocked;
      throw new Error("blocker released (intentional rollback trigger)");
    },
    { timeout: 15_000 },
  );
  // The rollback trigger rejection is intentional; swallow it eagerly so Jest
  // never observes it as an unhandled rejection (allSettled below re-awaits it).
  void blockerPromise.catch(() => undefined);
  try {
    await lockHeld;
    const racePromise = crearRaza();
    try {
      await esperarAmbasEsperando(getHarnessDb());
    } catch (err) {
      // Never leave the racers parked on a failure path.
      releaseBlocker();
      await Promise.allSettled([racePromise]);
      throw err;
    }
    releaseBlocker();
    return await racePromise;
  } finally {
    releaseBlocker();
    await Promise.allSettled([blockerPromise]);
    await blockerDb.$disconnect();
  }
}

describe("venta guarded lifecycle (real DB)", () => {
  let catA: number;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    const db = getHarnessDb();
    catA = (await db.categoria.findFirst({ where: { empresaId: fixture.empresaA.id } }))!.id;
  });

  it("two parallel updates: exactly one commits, loser CONCURRENCIA_CONFLICTO, no mixed lines", async () => {
    const prod = await crearProductoConStock(fixture!.empresaA.id, fixture!.sucursalA1.id, catA, "RACE-A", "50.000");
    const ctx = ctxA1(fixture!);
    const id = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prod, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      });
      if (!r.ok) throw new Error(r.code);
      return r.data.id;
    });

    // Two concurrent edits on the SAME draft, each a different line-set. A
    // blocker transaction parks both racers on the row lock first, so the
    // winner/loser split no longer depends on the scheduler's ordering.
    const [a, b] = await conRazaBloqueada(id, () =>
      Promise.all([
        withTenantTransaction(ctx, (tx) =>
          actualizarVenta(tx, ctx, {
            id,
            fecha: new Date("2026-01-10T00:00:00.000Z"),
            lineas: [{ productoId: prod, cantidad: "3", precioUnitario: "100.00", descuento: CERO }],
          }),
        ),
        withTenantTransaction(ctx, (tx) =>
          actualizarVenta(tx, ctx, {
            id,
            fecha: new Date("2026-01-10T00:00:00.000Z"),
            lineas: [{ productoId: prod, cantidad: "7", precioUnitario: "100.00", descuento: CERO }],
          }),
        ),
      ]),
    );

    // Exactly one commits; the loser is a concurrency conflict.
    const oks = [a.ok, b.ok];
    expect(oks.filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(!loser.ok && loser.code).toBe("CONCURRENCIA_CONFLICTO");

    // No mixed line-set: exactly ONE line remains, equal to the winner's qty.
    const db = getHarnessDb();
    const lineas = await db.detalleVenta.findMany({ where: { ventaId: id } });
    expect(lineas).toHaveLength(1);
    const ganadora = a.ok ? a : b;
    const venta = await db.venta.findUnique({ where: { id } });
    expect(venta?.total.toFixed(2)).toBe(
      ganadora.ok === true ? ganadora.data.total : "",
    );
    expect(ganadora.ok).toBe(true);
    // Only the winner's update appended an ACTUALIZAR (CREAR + 1 update = 2).
    expect(
      await db.movimientoAuditoria.count({ where: { entidad: "Venta", idEntidad: String(id) } }),
    ).toBe(2);
  });

  it("serial double-cancel: VENTA_INMUTABLE, no second audit, config/stock untouched", async () => {
    const prod = await crearProductoConStock(fixture!.empresaA.id, fixture!.sucursalA1.id, catA, "RACE-B", "50.000");
    const ctx = ctxA1(fixture!);
    const db = getHarnessDb();
    const id = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prod, cantidad: "5", precioUnitario: "100.00", descuento: CERO }],
      });
      if (!r.ok) throw new Error(r.code);
      return r.data.id;
    });
    const stockAntes = (await db.inventario.findFirst({ where: { productoId: prod } }))!.cantidad.toString();
    const auditTrasCrear = await db.movimientoAuditoria.count({ where: { entidad: "Venta", idEntidad: String(id) } });

    const primero = await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id }));
    expect(primero.ok).toBe(true);
    expect(
      (await db.venta.findUnique({ where: { id } }))?.estado,
    ).toBe("CANCELADA");

    const segundo = await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id }));
    expect(!segundo.ok && segundo.code).toBe("VENTA_INMUTABLE");

    // No second audit; stock unchanged (5b never debits); still just CREAR + CANCELAR.
    expect(
      await db.movimientoAuditoria.count({ where: { entidad: "Venta", idEntidad: String(id) } }),
    ).toBe(auditTrasCrear + 1);
    expect(
      (await db.inventario.findFirst({ where: { productoId: prod } }))!.cantidad.toString(),
    ).toBe(stockAntes);
    expect(await db.movimientoInventario.count({ where: { ventaId: id } })).toBe(0);
  });

  it("two parallel cancels: exactly one commits, loser CONCURRENCIA_CONFLICTO, no second audit", async () => {
    const prod = await crearProductoConStock(fixture!.empresaA.id, fixture!.sucursalA1.id, catA, "RACE-C", "50.000");
    const ctx = ctxA1(fixture!);
    const id = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prod, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      });
      if (!r.ok) throw new Error(r.code);
      return r.data.id;
    });

    // Parked race: the blocker guarantees both cancels read `BORRADOR` before
    // contending, so exactly one flips the row deterministically.
    const [a, b] = await conRazaBloqueada(id, () =>
      Promise.all([
        withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id })),
        withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id })),
      ]),
    );
    const oks = [a.ok, b.ok];
    expect(oks.filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(!loser.ok && loser.code).toBe("CONCURRENCIA_CONFLICTO");

    const db = getHarnessDb();
    expect((await db.venta.findUnique({ where: { id } }))?.estado).toBe("CANCELADA");
    // One CREAR + exactly one CANCELAR audit.
    expect(
      await db.movimientoAuditoria.count({ where: { entidad: "Venta", idEntidad: String(id) } }),
    ).toBe(2);
  });
});
