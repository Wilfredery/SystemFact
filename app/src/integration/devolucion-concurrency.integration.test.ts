/**
 * Integration — two parallel `crearDevolucion` calls on the SAME
 * factura+producto serialize through the INVENTARIO row lock (real DB, RLS on,
 * devolucion spec "Concurrent same-factura returns serialize").
 *
 * fase-5d PR-slice 3, task 3.2 [CRITICAL]. The cumulative cap's serialization
 * point is deliberately the branch INVENTARIO row locked FOR UPDATE BEFORE the
 * prior-NC read (see `devolucion-repository` module doc): under READ
 * COMMITTED, two concurrent returns of the same product both stack on that row,
 * and the post-block re-evaluation observes the winner's committed NC.
 *
 * Determinism protocol — the venta-lifecycle parking pattern (blocker
 * transaction + `pg_stat_activity` waiter poll), reused verbatim:
 * a blocker connection parks on a *separate* row so it never blocks the racers
 * directly... actually NO: the blocker HOLDS the product's INVENTARIO row
 * WITHOUT changing any data; both racer transactions park on it while a
 * `pg_stat_activity` poll confirms BOTH are already behind their initial
 * reads; only then the blocker rolls back. The race is parked before release —
 * never scheduler-dependent. The sale line sells exactly 1 unit and both
 * racers request that same 1 unit, so after the winner commits its line the
 * loser deterministically re-reads the cumulative cap (1 + 1 > 1) and is
 * rejected with `CANTIDAD_EXCEDE_ORIGINAL` — exactly-one-winner, no negative
 * stock, no reservation above the original quantity, no lost update.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { crearDevolucion } from "@/modules/devolucion/application/crear-devolucion";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");
const NOW_DEVOLUCION = new Date("2026-09-05T12:00:00.000Z");
const FECHA_VENTA = new Date("2026-09-01T15:00:00.000Z");
const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;

let fixture: TenantFixture | null = null;
let ctx: TenantCtx;
let catA: number;

function ctxA1(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId: f.sucursalA1.id,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

/** Dedicated single-connection blocker client (the venta-lifecycle pattern). */
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
 * Poll until BOTH racer transactions are parked on the INVENTARIO row lock
 * (wait_event_type = 'Lock', excluding the poller itself). The venta-lifecycle
 * determinism guarantee: once parked, release order can no longer change the
 * outcome snapshot — the loser's post-block cumulative read observes the
 * winner's committed NC line. Fails loudly on timeout with the lock dump
 * instead of proceeding non-deterministically.
 */
async function esperarAmbosEsperando(db: PrismaClient): Promise<void> {
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
        "Race parking failed: fewer than two devolucion transactions are waiting " +
          `on the INVENTARIO row lock after 5s. Current lock state: ${JSON.stringify(dump)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/**
 * Fire the two parallel `crearDevolucion` calls while a blocker transaction
 * holds the product's INVENTARIO row WITHOUT changing data
 * (`SELECT ... FOR UPDATE` — exactly the row `leerStockSucursalEnTx` locks).
 * Wait until both racers are parked, then roll the blocker back. The winner
 * runs against cumulative 0 and commits; the loser, released after the
 * winner's COMMIT, re-reads the cap (1 + 1 > 1) and is rejected.
 */
async function conRazaDevolucionBloqueada<T>(
  inventarioId: number,
  crearRaza: () => Promise<T>,
): Promise<T> {
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
      await btx.$executeRaw`SELECT id FROM "INVENTARIO" WHERE id = ${inventarioId} FOR UPDATE`;
      signalLockHeld();
      // Hold the serialization row while both devolucion transactions stack up.
      await unlocked;
      throw new Error("blocker released (intentional rollback trigger)");
    },
    { timeout: 15_000 },
  );
  // The rollback trigger rejection is intentional; swallow it eagerly.
  void blockerPromise.catch(() => undefined);
  try {
    await lockHeld;
    const racePromise = crearRaza();
    try {
      await esperarAmbosEsperando(getHarnessDb());
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

describe("devolucion same-factura race (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    const db = getHarnessDb();
    catA = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    await db.empresa.update({ where: { id: ctx.empresaId }, data: { facturaAutomatica: true } });
    await db.ncfSecuencia.createMany({
      data: [
        {
          empresaId: ctx.empresaId,
          tipoNcf: "B02",
          rangoInicio: 500,
          rangoFin: 1000,
          secuenciaActual: 521,
          vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
          vigenciaFin: VIG_FIN,
          activa: true,
        },
        {
          empresaId: ctx.empresaId,
          tipoNcf: "B04",
          rangoInicio: 201,
          rangoFin: 300,
          secuenciaActual: 200,
          vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
          vigenciaFin: VIG_FIN,
          activa: true,
        },
      ],
    });
    await db.configuracionEmpresa.create({
      data: {
        empresaId: ctx.empresaId,
        clave: "PLAZO_DEVOLUCION",
        valor: "15",
        vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
        vigenciaFin: VIG_FIN,
        activa: true,
      },
    });
  });

  it("two parallel returns of the same unit: exactly one commits, loser CANTIDAD_EXCEDE_ORIGINAL, one B04 burn, no negative stock", async () => {
    // Stock 10 at branch A1; the confirm debits the 1 sold unit → 9 left.
    const prod = (
      await crearProductoVenta({
        empresaId: ctx.empresaId,
        categoriaId: catA,
        codigo: "race-nc",
        precioVenta: "100.00",
        tasa: 18,
      })
    ).id;
    await fijarStock(ctx.sucursalId, prod, "10.000");

    const ventaId = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearVenta(tx, ctx, {
        clienteId: null,
        fecha: FECHA_VENTA,
        lineas: [{ productoId: prod, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      });
      if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
      const c = await confirmarVenta(tx, ctx, { id: r.data.id });
      if (!c.ok) throw new Error(`confirmarVenta falló: ${c.code}`);
      return r.data.id;
    });
    const db = getHarnessDb();
    const factura = (await db.factura.findFirst({ where: { ventaId } }))!;
    const inventario = (await db.inventario.findFirst({
      where: { productoId: prod, sucursalId: ctx.sucursalId },
    }))!;
    expect(inventario.cantidad.toFixed(3)).toBe("9.000"); // confirm debited the sale

    // Both racers request THE SAME sold unit; parked on the INVENTARIO row.
    const correr = () =>
      withTenantTransaction(ctx, (tx) =>
        crearDevolucion(tx, ctx, {
          ventaId,
          motivo: "race devolucion",
          lineas: [{ productoId: prod, cantidad: "1", tipoReposicion: "VENDIBLE" }],
          now: NOW_DEVOLUCION,
        }),
      );
    const [a, b] = await conRazaDevolucionBloqueada(inventario.id, () =>
      Promise.all([correr(), correr()]),
    );

    // Exactly one commits; the loser gets the typed cumulative-cap error.
    const oks = [a.ok, b.ok];
    expect(oks.filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    const winner = a.ok ? a : b;
    expect(!loser.ok && loser.code).toBe("CANTIDAD_EXCEDE_ORIGINAL");
    expect(winner.ok && winner.data.ncf).toBe("B0400000201"); // range seeded at 200

    // No reservation above the original quantity: ONE NC of exactly 1 unit.
    const ncs = await db.notaCredito.findMany({ where: { facturaOriginalId: factura.id } });
    expect(ncs).toHaveLength(1);
    const totalDevuelto = await db.detalleNotaCredito.aggregate({
      _sum: { cantidad: true },
      where: { notaCredito: { facturaOriginalId: factura.id }, productoId: prod },
    });
    expect(totalDevuelto._sum?.cantidad?.toFixed(3)).toBe("1.000");

    // Exactly ONE B04 burn across both racers; no lost update.
    const seq = (await db.ncfSecuencia.findUnique({
      where: { empresaId_tipoNcf: { empresaId: ctx.empresaId, tipoNcf: "B04" } },
    }))!;
    expect(seq.secuenciaActual).toBe(201);

    // Stock: the winner's VENDIBLE return restored the one debited unit → 10;
    // the loser wrote nothing. No negative stock anywhere.
    const invFinal = (await db.inventario.findFirst({
      where: { productoId: prod, sucursalId: ctx.sucursalId },
    }))!;
    expect(invFinal.cantidad.toFixed(3)).toBe("10.000");
    expect(await db.movimientoInventario.count({ where: { notaCreditoId: ncs[0].id } })).toBe(1);
    expect(await db.movimientoAuditoria.count({ where: { entidad: "NotaCredito" } })).toBe(1);
  });
});
