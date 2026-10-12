/**
 * Integration — audit run-3 remediation: the confirmed-sale cancellation
 * repositions the NET quantity against VIGENTE devoluciones (real DB, RLS on).
 *
 * Finding `venta:cancelar-venta-confirmada:reposicion-ignora-devoluciones-vigentes`
 * (observed by the probe `app/scripts/stock-shape.probe.ts`: a sale of 10 with a
 * prior return of 4 re-credited the FULL +10 on cancel — VENDIBLE stock ended 4
 * units over the seed, DANADO merma'd units came back as sellable). Product
 * decision (2026-10) "solo reposición neta": the cancel-time reposition credits
 * ONLY `venta.cantidad − Σ VIGENTE NC line cantidad` per product, across ALL
 * TipoReposicion kinds, never a negative reposition, and NCs are NEVER touched
 * by the cancel (they stay VIGENTE against the ANULADA factura — no annulment
 * feature exists).
 *
 *   A (VENDIBLE): seed 100, sale 10, return 4 VENDIBLE, cancel →
 *                 100 − 10 + 4 + 6 = 100 exactly (no phantom +4).
 *   B (DANADO):   seed 100, sale 10, return 4 DANADO (merma −4), cancel →
 *                 100 − 10 − 4 + 6 = 92 (the 4 disposed units are a real loss;
 *                 reposition +6, NOT +10).
 *   C (full return edge): sale 10, return 10 VENDIBLE, cancel → NO
 *                 REPOSICION_CANCELACION movement at all; the cancel still
 *                 completes (venta CANCELADA, factura ANULADA, NC VIGENTE).
 *   D (no devolucion control): plain cancel → REPOSICION_CANCELACION +10, exactly
 *                 the pre-remediation behavior (regression guard).
 *
 * Real fixtures only (harness `truncateAll` guarantees ZERO rows survive before
 * every test): the sale is produced through the canonical `crearVenta` →
 * `confirmarVenta` path and the returns through the real `crearDevolucion`
 * (B04 burn, NC VIGENTE), all inside `withTenantTransaction` so RLS applies.
 *
 * Concurrency safety (asserted indirectly via case C + code contract): a
 * devolucion cannot interleave AFTER the cancel's state flip because
 * `crearDevolucion` requires the factura VIGENTE
 * (`crear-devolucion.ts` `FACTURA_NO_VIGENTE` gate) and the cancel transaction
 * already holds the FACTURA row lock (`leerFacturaVigenteDeVentaEnTx`, FOR
 * UPDATE), so the NC-devuelto aggregate read INSIDE the cancel tx can never
 * observe a half-committed return.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearVenta, cancelarVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { crearDevolucion } from "@/modules/devolucion/application/crear-devolucion";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");
const FECHA_VENTA = new Date("2026-09-01T15:00:00.000Z");
/** Fixed injected return instant: 4 calendar days after the sale date. */
const NOW_DEVOLUCION = new Date("2026-09-05T12:00:00.000Z");
const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;
/** Seed stock per case: big enough that the merma path never blocks. */
const STD = (i: number): string => `${i}.000`;

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

async function sembrarRango(empresaId: number): Promise<void> {
  const db = getHarnessDb();
  for (const [tipo, actual] of [["B02", 521], ["B04", 200]] as const) {
    await db.ncfSecuencia.create({
      data: {
        empresaId,
        tipoNcf: tipo,
        rangoInicio: BigInt(tipo === "B02" ? 500 : 201),
        rangoFin: BigInt(tipo === "B02" ? 1000 : 300),
        secuenciaActual: BigInt(actual),
        vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
        vigenciaFin: VIG_FIN,
        activa: true,
      },
    });
  }
  await db.configuracionEmpresa.create({
    data: {
      empresaId,
      clave: "PLAZO_DEVOLUCION",
      valor: "15",
      vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
      vigenciaFin: VIG_FIN,
      activa: true,
    },
  });
  await db.empresa.update({
    where: { id: empresaId },
    data: { facturaAutomatica: true },
  });
}

/** Priced product with `semilla` branch-A1 stock; id + seed value. */
async function productoConStock(
  codigo: string,
  semilla: number,
): Promise<{ id: number }> {
  const prod = await crearProductoVenta({
    empresaId: ctx.empresaId,
    categoriaId: catA,
    codigo,
    precioVenta: "100.00",
    tasa: 18,
  });
  await fijarStock(ctx.sucursalId, prod.id, STD(semilla));
  return prod;
}

/** Canonical sale lifecycle: BORRADOR → CONFIRMADA with a VIGENTE B02 factura. */
async function crearVentaConfirmada(
  productoId: number,
  cantidad: string,
): Promise<{ ventaId: number; facturaId: number }> {
  const ventaId = await withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, {
      clienteId: null, // contado → Consumidor Final → B02 factura
      fecha: FECHA_VENTA,
      lineas: [{ productoId, cantidad, precioUnitario: "100.00", descuento: CERO }],
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
  tipoReposicion: "VENDIBLE" | "DANADO",
): Promise<{ ok: true } | { ok: false; code: string }> {
  return withTenantTransaction(ctx, async (tx) => {
    const r = await crearDevolucion(tx, ctx, {
      ventaId,
      motivo: "devolucion integration",
      lineas: [{ productoId, cantidad, tipoReposicion }],
      now: NOW_DEVOLUCION,
    });
    return r.ok ? { ok: true } : { ok: false, code: r.code };
  });
}

async function openerId(productoId: number): Promise<number> {
  const inv = await getHarnessDb().inventario.findFirst({
    where: { sucursalId: ctx.sucursalId, productoId },
    select: { id: true },
  });
  if (inv === null) throw new Error("INVENTARIO row missing");
  return inv.id;
}

async function leerStock(productoId: number): Promise<string> {
  const inv = await getHarnessDb().inventario.findFirst({
    where: { sucursalId: ctx.sucursalId, productoId },
    select: { cantidad: true },
  });
  if (inv === null) throw new Error("INVENTARIO row missing");
  return inv.cantidad.toFixed(3);
}

/** Movements signed-delta projection in creation order (delta, tipo). */
async function movimientos(inventarioId: number): Promise<{
  readonly tipoMovimiento: string;
  readonly cantidadMovida: string;
}[]> {
  const rows = await getHarnessDb().movimientoInventario.findMany({
    where: { inventarioId },
    orderBy: { id: "asc" },
    select: { tipoMovimiento: true, cantidadMovida: true },
  });
  return rows.map((r) => ({
    tipoMovimiento: r.tipoMovimiento,
    cantidadMovida: r.cantidadMovida.toFixed(3),
  }));
}

describe("cancelarVenta vs VIGENTE devoluciones — reposición neta (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    const db = getHarnessDb();
    catA = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    await sembrarRango(ctx.empresaId);
  });

  it("case A (VENDIBLE): sale 10, return 4, cancel → net +6, seed restored exactly, no phantom (+4) credit", async () => {
    const prod = await productoConStock("cancel-net-a", 100);
    const { ventaId, facturaId } = await crearVentaConfirmada(prod.id, "10");
    expect(await leerStock(prod.id)).toBe("90.000");

    const dev = await devolver(ventaId, prod.id, "4", "VENDIBLE");
    expect(dev.ok).toBe(true);
    expect(await leerStock(prod.id)).toBe("94.000");

    const cancel = await withTenantTransaction(ctx, (tx) =>
      cancelarVenta(tx, ctx, { id: ventaId, motivo: "Devolucion integration" }));
    expect(cancel.ok).toBe(true);

    // 100 − 10 + 4 + 6 = 100 → the seed, NOT 104 (phantom credit gone).
    expect(await leerStock(prod.id)).toBe("100.000");
    // Movement ledger: SALIDA_VENTA −10 | ENTRADA_DEVOLUCION +4 | REPOSICION_CANCELACION +6.
    const movs = await movimientos(await openerId(prod.id));
    expect(movs.map((m) => `${m.tipoMovimiento} ${m.cantidadMovida}`)).toEqual([
      "SALIDA_VENTA -10.000",
      "ENTRADA_DEVOLUCION 4.000",
      "REPOSICION_CANCELACION 6.000",
    ]);

    // Fiscal outcome: factura ANULADA (never deleted), NCs stay VIGENTE.
    const ventaPost = await getHarnessDb().venta.findUnique({ where: { id: ventaId } });
    expect(ventaPost?.estado).toBe("CANCELADA");
    const facs = await getHarnessDb().factura.findMany({ where: { ventaId } });
    expect(facs).toHaveLength(1);
    expect(facs[0].estado).toBe("ANULADA");
    const ncs = await getHarnessDb().notaCredito.findMany({
      where: { facturaOriginalId: facturaId },
    });
    expect(ncs).toHaveLength(1); // one NC per devolucion flow
    for (const nc of ncs) expect(nc.estado).toBe("VIGENTE");
  });

  it("case B (DANADO): sale 10, merma 4, cancel → net +6; stock keeps the 4 disposed units missing (92)", async () => {
    const prod = await productoConStock("cancel-net-b", 100);
    const { ventaId } = await crearVentaConfirmada(prod.id, "10");
    const dev = await devolver(ventaId, prod.id, "4", "DANADO");
    expect(dev.ok).toBe(true);
    // 100 − 10 (sale) − 4 (merma disposal) = 86.
    expect(await leerStock(prod.id)).toBe("86.000");

    const cancel = await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId }));
    expect(cancel.ok).toBe(true);

    // 100 − 10 − 4 + 6 = 92: the DANADO-disposed units are physically gone and
    // NOT re-credited as sellable stock (reposition 6, NOT the full 10).
    expect(await leerStock(prod.id)).toBe("92.000");
    const movs = await movimientos(await openerId(prod.id));
    expect(movs.map((m) => `${m.tipoMovimiento} ${m.cantidadMovida}`)).toEqual([
      "SALIDA_VENTA -10.000",
      "SALIDA_MERMA -4.000",
      "REPOSICION_CANCELACION 6.000",
    ]);

    // The DANADO NC also stays VIGENTE against the ANULADA factura.
    const facs = await getHarnessDb().factura.findMany({ where: { ventaId } });
    expect(facs[0].estado).toBe("ANULADA");
    const ncs = await getHarnessDb().notaCredito.findMany({
      where: { facturaOriginalId: facs[0].id },
    });
    for (const nc of ncs) expect(nc.estado).toBe("VIGENTE");
  });

  it("case C (full return edge): sale 10, return 10, cancel → ZERO reposition movement, cancel still completes", async () => {
    const prod = await productoConStock("cancel-net-c", 100);
    const { ventaId, facturaId } = await crearVentaConfirmada(prod.id, "10");
    const dev = await devolver(ventaId, prod.id, "10", "VENDIBLE");
    expect(dev.ok).toBe(true);
    expect(await leerStock(prod.id)).toBe("100.000"); // fully restocked by the NC

    const cancel = await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId }));
    expect(cancel.ok).toBe(true);

    // Net is 0 → the ledger gets NO REPOSICION_CANCELACION row at all.
    expect(await leerStock(prod.id)).toBe("100.000");
    expect(
      await getHarnessDb().movimientoInventario.count({
        where: { ventaId, tipoMovimiento: "REPOSICION_CANCELACION" },
      }),
    ).toBe(0);
    // The remaining ledger still shows exactly the sale exit and the NC restock.
    const movs = await movimientos(await openerId(prod.id));
    expect(movs.map((m) => `${m.tipoMovimiento} ${m.cantidadMovida}`)).toEqual([
      "SALIDA_VENTA -10.000",
      "ENTRADA_DEVOLUCION 10.000",
    ]);

    // Rollback-free completion: venta CANCELADA, factura ANULADA, NC VIGENTE.
    expect((await getHarnessDb().venta.findUnique({ where: { id: ventaId } }))?.estado).toBe("CANCELADA");
    expect((await getHarnessDb().factura.findFirst({ where: { ventaId } }))?.estado).toBe("ANULADA");
    const ncs = await getHarnessDb().notaCredito.findMany({
      where: { facturaOriginalId: facturaId },
    });
    for (const nc of ncs) expect(nc.estado).toBe("VIGENTE");
  });

  it("case D (no devolucion control): plain cancel repositions the FULL +10 (pre-remediation behavior preserved)", async () => {
    const prod = await productoConStock("cancel-net-d", 100);
    const { ventaId } = await crearVentaConfirmada(prod.id, "10");
    expect(await leerStock(prod.id)).toBe("90.000");

    const cancel = await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId }));
    expect(cancel.ok).toBe(true);

    // No NC exists → net == raw line → the exact legacy +10 reposition.
    expect(await leerStock(prod.id)).toBe("100.000");
    const movs = await movimientos(await openerId(prod.id));
    expect(movs.map((m) => `${m.tipoMovimiento} ${m.cantidadMovida}`)).toEqual([
      "SALIDA_VENTA -10.000",
      "REPOSICION_CANCELACION 10.000",
    ]);
  });
});
