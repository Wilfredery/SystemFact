/**
 * Integration — devolucion cumulative cap across 2+ NCs (real DB, RLS on, R-D3).
 *
 * fase-5d PR-slice 3, task 3.1 [CRITICAL]: the cumulative returned quantity for
 * one (factura, producto) is enforced over EVERY prior VIGENTE NC line, not
 * just the last one. Two complementary scenarios from the devolucion spec:
 *
 *   A. sale line of 5, two prior NCs returned 2 + 1 (cumulative 3) → one more
 *      unit succeeds, cumulative = 4 ≤ 5;
 *   B. sale line of 5, two prior NCs already returned 3 + 2 (cumulative 5) → a
 *      further return is rejected with `CANTIDAD_EXCEDE_ORIGINAL` and NO row of
 *      any kind is written (NC / detalles / inventory movements / audit counts
 *      all unchanged) — crucially BEFORE the B04 NCF consume, so no sequence
 *      number is burned either.
 *
 * Real fixtures only: a confirmed sale is produced through the canonical
 * `crearVenta` → `confirmarVenta` path (B02 for the Consumidor Final invoice),
 * so the factura, venta state and frozen sale line exactly mirror production;
 * prior NCs are produced by calling `crearDevolucion` itself. The B04 range and
 * `PLAZO_DEVOLUCION` come from direct harness seeds (same windows as the
 * confirm suite seeds its B02 range). Clock injection (`now`) keeps the return
 * window deterministic regardless of the wall clock.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { crearDevolucion } from "@/modules/devolucion/application/crear-devolucion";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");
/** Fixed injected return instant: 4 calendar days after the sale date. */
const NOW_DEVOLUCION = new Date("2026-09-05T12:00:00.000Z");
const FECHA_VENTA = new Date("2026-09-01T15:00:00.000Z");

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

async function sembrarRango(
  empresaId: number,
  tipo: "B02" | "B04",
  s: { rangoInicio: number; rangoFin: number; secuenciaActual: number },
): Promise<void> {
  await getHarnessDb().ncfSecuencia.create({
    data: {
      empresaId,
      tipoNcf: tipo,
      rangoInicio: s.rangoInicio,
      rangoFin: s.rangoFin,
      secuenciaActual: s.secuenciaActual,
      vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
      vigenciaFin: VIG_FIN,
      activa: true,
    },
  });
}

/** The current B04 pointer for empresa A. */
async function leerSecuenciaB04(empresaAId: number): Promise<number> {
  const row = await getHarnessDb().ncfSecuencia.findUnique({
    where: { empresaId_tipoNcf: { empresaId: empresaAId, tipoNcf: "B04" } },
  });
  return row?.secuenciaActual ?? -1;
}

/** Priced product with branch-A1 stock; returns its id. */
async function productoConStock(codigo: string, stock: string): Promise<number> {
  const prod = await crearProductoVenta({
    empresaId: ctx.empresaId,
    categoriaId: catA,
    codigo,
    precioVenta: "100.00",
    tasa: 18,
  });
  await fijarStock(ctx.sucursalId, prod.id, stock);
  return prod.id;
}

/**
 * Canonical sale lifecycle: BORRADOR (fresh date so the 15-day window covers
 * the injected `now`) → CONFIRMADA with a VIGENTE B02 factura. `clienteId:
 * null` here resolves to Consumidor Final in the save pipeline, so the
 * persisted venta carries a real cliente id (the NC header needs one).
 */
async function crearVentaConfirmada(
  productoId: number,
  cantidad: string,
): Promise<{ ventaId: number; facturaId: number }> {
  const ventaId = await withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, {
      clienteId: null, // contado → Consumidor Final → B02 factura
      fecha: FECHA_VENTA,
      lineas: [{ productoId, cantidad, precioUnitario: "100.00", descuento: { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } }],
    });
    if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
    const c = await confirmarVenta(tx, ctx, { id: r.data.id });
    if (!c.ok) throw new Error(`confirmarVenta falló: ${c.code}`);
    return r.data.id;
  });
  const factura = (await getHarnessDb().factura.findFirst({ where: { ventaId } }))!;
  if ((factura?.estado ?? null) !== "VIGENTE") {
    throw new Error("la venta confirmada no tiene una FACTURA VIGENTE");
  }
  return { ventaId, facturaId: factura.id };
}

/** One `crearDevolucion` call through the real tenant wrapper. */
function devolver(
  ventaId: number,
  productoId: number,
  cantidad: string,
) {
  return withTenantTransaction(ctx, (tx) =>
    crearDevolucion(tx, ctx, {
      ventaId,
      motivo: "devolucion integration",
      lineas: [{ productoId, cantidad, tipoReposicion: "VENDIBLE" }],
      now: NOW_DEVOLUCION,
    }),
  );
}

describe("devolucion cumulative cap (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    const db = getHarnessDb();
    catA = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    // Emission gate + factura range + B04 return range + the 15-day window.
    await db.empresa.update({ where: { id: ctx.empresaId }, data: { facturaAutomatica: true } });
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    await sembrarRango(ctx.empresaId, "B04", { rangoInicio: 201, rangoFin: 300, secuenciaActual: 200 });
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

  it("cap has room: two prior NCs returned 2+1 of 5; a 4th NC of 1 succeeds (cumulative 4)", async () => {
    const prod = await productoConStock("cap-ok", "50.000");
    const { ventaId, facturaId } = await crearVentaConfirmada(prod, "5");

    // Two prior NCs, 2 and 1 units — the cumulative builds ACROSS documents.
    const r1 = await devolver(ventaId, prod, "2");
    expect(r1.ok).toBe(true);
    const r2 = await devolver(ventaId, prod, "1");
    expect(r2.ok).toBe(true);
    const secuenciaTrasPriors = await leerSecuenciaB04(ctx.empresaId);
    expect(secuenciaTrasPriors).toBe(202); // B04 range seeded at 200, two burns

    const db = getHarnessDb();
    const priorSum = await db.detalleNotaCredito.aggregate({
      _sum: { cantidad: true },
      where: { notaCredito: { facturaOriginalId: facturaId }, productoId: prod },
    });
    expect(priorSum._sum?.cantidad?.toFixed(3)).toBe("3.000");

    // One more unit: cumulative 4 ≤ 5 → the third NC commits.
    const r3 = await devolver(ventaId, prod, "1");
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.data.ncf).toBe("B0400000203"); // 11-char composition, next in range
      expect(r3.data.estado).toBe("VIGENTE");
    }

    // Three NCs / 3 lines; the grouped total now reads 4, never 5.
    const ncs = await db.notaCredito.findMany({ where: { facturaOriginalId: facturaId } });
    expect(ncs).toHaveLength(3);
    for (const nc of ncs) expect(nc.estado).toBe("VIGENTE");
    const total = await db.detalleNotaCredito.aggregate({
      _sum: { cantidad: true },
      where: { notaCredito: { facturaOriginalId: facturaId }, productoId: prod },
    });
    expect(total._sum?.cantidad?.toFixed(3)).toBe("4.000");
    // One VENDIBLE movement per NC (prices frozen at 100.00).
    expect(await db.movimientoInventario.count({ where: { notaCreditoId: { in: ncs.map((n) => n.id) } } })).toBe(3);
    expect(await leerSecuenciaB04(ctx.empresaId)).toBe(203); // exactly three burns
  });

  it("cap exhausted: prior NCs returned 3+2 of 5; a 6th unit rejects and writes NOTHING (incl. no NCF burn)", async () => {
    const prod = await productoConStock("cap-full", "50.000");
    const { ventaId, facturaId } = await crearVentaConfirmada(prod, "5");

    const r1 = await devolver(ventaId, prod, "3");
    expect(r1.ok).toBe(true);
    const r2 = await devolver(ventaId, prod, "2");
    expect(r2.ok).toBe(true);

    const db = getHarnessDb();
    const secuenciaAntes = await leerSecuenciaB04(ctx.empresaId);
    expect(secuenciaAntes).toBe(202);
    const ncsAntes = await db.notaCredito.findMany({ where: { facturaOriginalId: facturaId } });
    expect(ncsAntes).toHaveLength(2);
    const detallesAntes = await db.detalleNotaCredito.count();
    const movimientosAntes = await db.movimientoInventario.count();
    const auditAntes = await db.movimientoAuditoria.count();
    expect(
      await db.movimientoAuditoria.count({ where: { entidad: "NotaCredito" } }),
    ).toBe(2);

    // No remaining capacity: cumulative 5 + 1 > 5.
    const rechazado = await devolver(ventaId, prod, "1");
    expect(!rechazado.ok && rechazado.code).toBe("CANTIDAD_EXCEDE_ORIGINAL");

    // Zero writes of ANY kind — NC/detalles/movements/audit counts unchanged,
    // and critically NO new B04 burn (the cap check precedes the consume).
    expect(await db.notaCredito.findMany({ where: { facturaOriginalId: facturaId } })).toEqual(ncsAntes);
    expect(await db.detalleNotaCredito.count()).toBe(detallesAntes);
    expect(await db.movimientoInventario.count()).toBe(movimientosAntes);
    expect(await db.movimientoAuditoria.count()).toBe(auditAntes);
    expect(await db.movimientoAuditoria.count({ where: { entidad: "NotaCredito" } })).toBe(2);
    expect(await leerSecuenciaB04(ctx.empresaId)).toBe(202);
  });
});
