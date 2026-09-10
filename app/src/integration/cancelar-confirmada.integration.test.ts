/**
 * Integration — confirmed-sale cancellation (R-V16 / 608) against the REAL
 * `systemfact_test` database, fase-5c pr5c3.
 *
 * Drives the full loop: confirm a draft (→ CONFIRMADA + VIGENTE FACTURA +
 * `SALIDA_VENTA`) then cancel it, asserting the sale flips to CANCELADA, the
 * invoice to ANULADA (never deleted), branch stock is restored by one
 * `REPOSICION_CANCELACION` movement, the consumed NCF is NOT rewound, and BOTH
 * reversals are audited (3.8). Plus: a repeated cancel is the stable
 * `VENTA_INMUTABLE` with zero effects (3.9), the draft-cancel path stays untouched
 * (no invoice/movement/NCF, R-V16 via R-V4), two parallel cancels admit exactly one
 * winner, and a cancel racing a confirm leaves a consistent state (R-V15/R-V16).
 *
 * LOCATION: real-DB suite under `src/integration/` (Phase 1/2 precedent).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearVenta, cancelarVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;
const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");

let fixture: TenantFixture | null = null;

function ctxA1(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}

async function marcarFacturaAutomatica(empresaId: number): Promise<void> {
  await getHarnessDb().empresa.update({ where: { id: empresaId }, data: { facturaAutomatica: true } });
}

async function sembrarRango(empresaId: number, tipo: "B01" | "B02", s: { rangoInicio: number; rangoFin: number; secuenciaActual: number }): Promise<void> {
  await getHarnessDb().ncfSecuencia.create({
    data: {
      empresaId, tipoNcf: tipo, rangoInicio: s.rangoInicio, rangoFin: s.rangoFin,
      secuenciaActual: s.secuenciaActual, vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
      vigenciaFin: VIG_FIN, activa: true,
    },
  });
}

async function leerSecuenciaActual(empresaId: number, tipo: "B01" | "B02"): Promise<number> {
  const row = await getHarnessDb().ncfSecuencia.findUnique({ where: { empresaId_tipoNcf: { empresaId, tipoNcf: tipo } } });
  return row?.secuenciaActual ?? -1;
}

async function crearBorrador(ctx: TenantCtx, productoId: number, cantidad = "5"): Promise<number> {
  return withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, {
      clienteId: null,
      fecha: new Date("2026-01-10T00:00:00.000Z"),
      lineas: [{ productoId, cantidad, precioUnitario: "100.00", descuento: CERO }],
    });
    if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
    return r.data.id;
  });
}

/** Prepare a fully-CONFIRMED sale (invoice VIGENTE, stock debited). Returns ids. */
async function confirmarVentaLista(ctx: TenantCtx): Promise<{ ventaId: number; productoId: number }> {
  const db = getHarnessDb();
  const cat = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
  const prod = await crearProductoVenta({ empresaId: ctx.empresaId, categoriaId: cat, codigo: `cc${Date.now()}`, precioVenta: "100.00" });
  await fijarStock(ctx.sucursalId, prod.id, "10.000");
  await marcarFacturaAutomatica(ctx.empresaId);
  await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
  const ventaId = await crearBorrador(ctx, prod.id, "5");
  const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: ventaId }));
  if (!r.ok) throw new Error(`confirmarVenta falló: ${r.code}`);
  return { ventaId, productoId: prod.id };
}

async function cantidadStock(ctx: TenantCtx, productoId: number): Promise<string> {
  const row = await getHarnessDb().inventario.findFirst({ where: { sucursalId: ctx.sucursalId, productoId }, select: { cantidad: true } });
  return row ? row.cantidad.toFixed(3) : "SIN_FILA";
}

describe("cancelarVenta confirmada (real DB, RLS on)", () => {
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
  });

  it("3.8 — cancel restocks, annuls the invoice (never deletes), keeps the NCF, audits both flips", async () => {
    const { ventaId, productoId } = await confirmarVentaLista(ctx);
    const db = getHarnessDb();
    expect(await cantidadStock(ctx, productoId)).toBe("5.000"); // 10 - 5 debited at confirm
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(522); // burned
    const secuenciaAntes = await leerSecuenciaActual(ctx.empresaId, "B02");

    const r = await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId, motivo: "Devolución cliente" }));
    expect(r.ok).toBe(true);
    expect((await db.venta.findUnique({ where: { id: ventaId } }))?.estado).toBe("CANCELADA");

    // Invoice VIGENTE → ANULADA, never deleted (exactly one row remains).
    const facs = await db.factura.findMany({ where: { ventaId } });
    expect(facs).toHaveLength(1);
    expect(facs[0].estado).toBe("ANULADA");

    // Stock restored +5 via exactly one REPOSICION_CANCELACION carrying ventaId.
    expect(await cantidadStock(ctx, productoId)).toBe("10.000");
    const rep = await db.movimientoInventario.findMany({ where: { ventaId, tipoMovimiento: "REPOSICION_CANCELACION" } });
    expect(rep).toHaveLength(1);
    expect(rep[0].cantidadNueva.toFixed(3)).toBe("10.000");
    expect(rep[0].motivo).toBe("Devolución cliente");

    // The consumed NCF is NEVER rewound (608: the invoice stays reported).
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(secuenciaAntes);

    // Both state reversals are audited.
    expect(await db.movimientoAuditoria.findFirst({ where: { entidad: "Venta", idEntidad: String(ventaId), accion: "CANCELAR" } })).not.toBeNull();
    expect(await db.movimientoAuditoria.findFirst({ where: { entidad: "Factura", idEntidad: String(facs[0].id), accion: "ANULAR" } })).not.toBeNull();
  });

  it("3.9 — repeated cancel of a CANCELADA sale is VENTA_INMUTABLE with zero effects", async () => {
    const { ventaId, productoId } = await confirmarVentaLista(ctx);
    const db = getHarnessDb();

    await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId }));
    const repsTrasPrimera = await db.movimientoInventario.count({ where: { ventaId, tipoMovimiento: "REPOSICION_CANCELACION" } });

    const segundo = await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId }));
    expect(!segundo.ok && segundo.code).toBe("VENTA_INMUTABLE");

    // No second reversal: still exactly one reposition, invoice still ANULADA, stock still restored.
    expect(await db.movimientoInventario.count({ where: { ventaId, tipoMovimiento: "REPOSICION_CANCELACION" } })).toBe(repsTrasPrimera);
    expect((await db.factura.findFirst({ where: { ventaId } }))?.estado).toBe("ANULADA");
    expect(await cantidadStock(ctx, productoId)).toBe("10.000");
  });

  it("3.9 — the DRAFT-cancel path is untouched (no invoice, no movement, no NCF)", async () => {
    const db = getHarnessDb();
    const cat = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    const prod = await crearProductoVenta({ empresaId: ctx.empresaId, categoriaId: cat, codigo: `cd${Date.now()}`, precioVenta: "100.00" });
    await fijarStock(ctx.sucursalId, prod.id, "10.000");
    await marcarFacturaAutomatica(ctx.empresaId);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });

    const ventaId = await crearBorrador(ctx, prod.id, "5");
    const r = await withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId, motivo: "Cancelé el borrador" }));
    expect(r.ok).toBe(true);
    expect((await db.venta.findUnique({ where: { id: ventaId } }))?.estado).toBe("CANCELADA");

    // Draft cancel never reaches the confirmed side effects.
    expect(await db.factura.count({ where: { ventaId } })).toBe(0);
    expect(await db.movimientoInventario.count({ where: { ventaId } })).toBe(0);
    expect(await cantidadStock(ctx, prod.id)).toBe("10.000"); // unchanged
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(521); // no NCF burn
  });

  it("concurrency — two parallel cancels of one confirmed sale admit exactly one winner", async () => {
    const { ventaId, productoId } = await confirmarVentaLista(ctx);
    const db = getHarnessDb();

    const cancel = () => withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId }));
    const [a, b] = await Promise.allSettled([cancel(), cancel()]);
    const valores = [a, b].map((x) => (x.status === "fulfilled" ? x.value : null));
    const exitos = valores.filter((v) => v?.ok === true);
    const fracasos = valores.filter((v) => v !== null && v.ok === false);
    expect(exitos).toHaveLength(1);
    expect(fracasos).toHaveLength(1);
    // The loser's stable code (a lost guarded flip or a state already CANCELADA).
    const codigo = (fracasos[0] as { code: string }).code;
    expect(["CONCURRENCIA_CONFLICTO", "VENTA_INMUTABLE"]).toContain(codigo);

    // Exactly one reposition movement and a single restored stock value.
    expect(await db.movimientoInventario.count({ where: { ventaId, tipoMovimiento: "REPOSICION_CANCELACION" } })).toBe(1);
    expect(await cantidadStock(ctx, productoId)).toBe("10.000");
    expect((await db.venta.findUnique({ where: { id: ventaId } }))?.estado).toBe("CANCELADA");
  });

  it("cancel racing a confirm leaves a consistent state (R-V15/R-V16)", async () => {
    const db = getHarnessDb();
    const cat = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    const prod = await crearProductoVenta({ empresaId: ctx.empresaId, categoriaId: cat, codigo: `cr${Date.now()}`, precioVenta: "100.00" });
    await fijarStock(ctx.sucursalId, prod.id, "10.000");
    await marcarFacturaAutomatica(ctx.empresaId);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const ventaId = await crearBorrador(ctx, prod.id, "5");

    const [a, b] = await Promise.allSettled([
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: ventaId })),
      withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id: ventaId })),
    ]);
    // At most one of the two lifecycles fully commits its guarded flip.
    const okCount = [a, b].filter((x) => x.status === "fulfilled" && x.value.ok).length;
    expect(okCount).toBeLessThanOrEqual(1);

    const estado = (await db.venta.findUnique({ where: { id: ventaId } }))?.estado;
    const invoiceCount = await db.factura.count({ where: { ventaId } });
    const movCount = await db.movimientoInventario.count({ where: { ventaId } });
    // The two outcomes are mutually exclusive and never mixed.
    if (estado === "CONFIRMADA") {
      expect(invoiceCount).toBe(1); // a winner confirm emitted exactly one invoice
      expect(movCount).toBe(1); // and exactly one exit
    } else {
      expect(estado).toBe("CANCELADA");
      expect(invoiceCount).toBe(0); // a draft-cancel winner leaves no fiscal doc
      expect(movCount).toBe(0); // and no movement
      expect(await cantidadStock(ctx, prod.id)).toBe("10.000"); // stock untouched
    }
  });
});
