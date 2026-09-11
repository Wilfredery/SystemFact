/**
 * Integration — `confirmarVenta` → FACTURA emission against the REAL test DB
 * (RLS on, app role via `withTenantTransaction`), Phase 2 / pr5c2.
 *
 * Covers the R-V15 confirm boundary and R-F1..R-F4 emission: the emission gate
 * firing before any NCF burn (2.4), the HARD pre-consume stock block and the
 * foreign-branch not-found (2.5), the stable NCF codes surfaced through venta's
 * catalog with the sale left untouched (2.6), confirm idempotency on a retried
 * and a racing CONFIRMADA (2.7), the mixed-rate recomputed breakdown + atomic
 * FAC correlativo under parallel confirms on the SAME empresa (2.8, 2.9), and the
 * VIGENTE / 1:1 / branch-scoped / no-stored-balance invariants (2.10).
 *
 * LOCATION: real-DB suites live under `src/integration/` (the only harness with a
 * DB), matching Phase 1's `ncf-consume.integration.test.ts`; the unit config would
 * not reach the database.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;
const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");

let fixture: TenantFixture | null = null;

function ctxA1(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}
/** Same company + user, but the session is bound to branch A2 (for the guard test). */
function ctxA2(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}

async function marcarFacturaAutomatica(empresaId: number, valor: boolean): Promise<void> {
  await getHarnessDb().empresa.update({ where: { id: empresaId }, data: { facturaAutomatica: valor } });
}

async function sembrarRango(
  empresaId: number,
  tipo: "B01" | "B02",
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

async function leerSecuenciaActual(empresaId: number, tipo: "B01" | "B02"): Promise<number> {
  const row = await getHarnessDb().ncfSecuencia.findUnique({ where: { empresaId_tipoNcf: { empresaId, tipoNcf: tipo } } });
  return row?.secuenciaActual ?? -1;
}

async function crearBorrador(
  ctx: TenantCtx,
  productoId: number,
  opts: { cantidad?: string; descuentoCabecera?: typeof CERO | { descuentoTipo: "PORCENTAJE"; descuentoValor: string } } = {},
): Promise<number> {
  return withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, {
      clienteId: null, // contado → Consumidor Final → B02
      fecha: new Date("2026-01-10T00:00:00.000Z"),
      lineas: [{ productoId, cantidad: opts.cantidad ?? "1", precioUnitario: "100.00", descuento: CERO }],
      descuentoCabecera: opts.descuentoCabecera,
    });
    if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
    return r.data.id;
  });
}

/** Seed an active DESC_MAX window so a header-discount draft can be created. */
async function sembrarDescMax(empresaId: number, valor: string): Promise<void> {
  await getHarnessDb().configuracionEmpresa.create({
    data: { empresaId, clave: "DESC_MAX", valor, vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"), vigenciaFin: VIG_FIN, activa: true },
  });
}

describe("confirmarVenta (real DB, RLS on)", () => {
  let catA: number;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    const db = getHarnessDb();
    catA = (await db.categoria.findFirst({ where: { empresaId: fixture.empresaA.id } }))!.id;
    ctx = ctxA1(fixture);
  });

  /** A priced product with branch-A1 stock; returns its id. */
  async function productoConStock(codigo: string, stock: string, tasa = 18): Promise<number> {
    const prod = await crearProductoVenta({ empresaId: fixture!.empresaA.id, categoriaId: catA, codigo, precioVenta: "100.00", tasa });
    await fijarStock(ctx.sucursalId, prod.id, stock);
    return prod.id;
  }

  it("emission gate: facturaAutomatica=false → FACTURA_AUTOMATICA_FALTA before any NCF burn (R-F1, 2.4)", async () => {
    const prod = await productoConStock("gate", "50.000");
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    await marcarFacturaAutomatica(ctx.empresaId, false); // default false, explicit for intent
    const id = await crearBorrador(ctx, prod);

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FACTURA_AUTOMATICA_FALTA");

    // Sale untouched, no invoice, and the seeded sequence was NOT advanced.
    expect((await getHarnessDb().venta.findUnique({ where: { id } }))?.estado).toBe("BORRADOR");
    expect(await getHarnessDb().factura.count({ where: { ventaId: id } })).toBe(0);
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(521);
  });

  it("HARD stock preview rejects BEFORE burning (R-V15, 2.5) and a foreign-branch sale is not confirmable", async () => {
    const prod = await productoConStock("short", "2.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod, { cantidad: "5" }); // 5 > 2 available

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("STOCK_INSUFICIENTE_BLOQUEO");
    expect(await getHarnessDb().factura.count({ where: { ventaId: id } })).toBe(0);
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(521); // no burn

    // Foreign branch: same tenant, but the session is bound to A2 while the sale is A1's.
    const ctx2 = ctxA2(fixture!);
    const r2 = await withTenantTransaction(ctx2, (tx) => confirmarVenta(tx, ctx2, { id }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("VENTA_NO_ENCONTRADO"); // behaves as not-found, zero disclosure
    expect((await getHarnessDb().venta.findUnique({ where: { id } }))?.estado).toBe("BORRADOR");
  });

  it("absent range → NCF_SEC_INEXISTENTE; exhausted → NCF_AGOTADA, typed via venta (R-V13, 2.6)", async () => {
    const prod = await productoConStock("ncf", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);

    // No B02 row at all.
    const id1 = await crearBorrador(ctx, prod);
    const r1 = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: id1 }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("NCF_SEC_INEXISTENTE");

    // Exhausted range (secuenciaActual === rangoFin).
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 600, secuenciaActual: 600 });
    const id2 = await crearBorrador(ctx, prod);
    const r2 = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: id2 }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("NCF_AGOTADA");
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(600); // unchanged
    expect((await getHarnessDb().venta.findUnique({ where: { id: id2 } }))?.estado).toBe("BORRADOR");
  });

  it("guarded flip: retried CONFIRMADA → VENTA_INMUTABLE with no second NCF/invoice (R-V15, 2.7)", async () => {
    const prod = await productoConStock("idem", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod);

    const primero = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(primero.ok).toBe(true);
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(522);

    const segundo = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.code).toBe("VENTA_INMUTABLE");
    // No second burn, exactly one invoice still.
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(522);
    expect(await getHarnessDb().factura.count({ where: { ventaId: id } })).toBe(1);
  });

  it("double-click (parallel confirm of one sale): single flip, one NCF, one invoice", async () => {
    const prod = await productoConStock("race", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod);

    const [a, b] = await Promise.allSettled([
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id })),
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id })),
    ]);

    const exitos = [a, b].filter((x) => x.status === "fulfilled" && x.value.ok);
    expect(exitos).toHaveLength(1); // exactly one transaction commits the flip
    // The loser's post-consume race THREW (un-burning its sequence number on rollback),
    // so the net effect is a single advance and a single invoice.
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(522);
    expect(await getHarnessDb().factura.count({ where: { ventaId: id } })).toBe(1);
    expect((await getHarnessDb().venta.findUnique({ where: { id } }))?.estado).toBe("CONFIRMADA");
  });

  it("mixed 18/16/0% lines + header discount → recomputed breakdown, exact identity, FAC correlativo (R-F3, 2.8)", async () => {
    const p18 = await productoConStock("m18", "50.000", 18);
    const p16 = await productoConStock("m16", "50.000", 16);
    const p0 = await productoConStock("m0", "50.000", 0);
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    await sembrarDescMax(ctx.empresaId, "20");

    const id = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: p18, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
          { productoId: p16, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
          { productoId: p0, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
        ],
        descuentoCabecera: { descuentoTipo: "PORCENTAJE", descuentoValor: "10" },
      });
      if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
      return r.data.id;
    });

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(true);
    const db = getHarnessDb();
    const fac = (await db.factura.findFirst({ where: { ventaId: id } }))!;
    // gravado = 18% + 16% bases, exento = 0% base; total = subtotal − descuento + itbis, exactly.
    const subtotal = fac.subtotalGravado.plus(fac.subtotalExento).plus(fac.descuento);
    const identidad = fac.subtotalGravado.plus(fac.subtotalExento).plus(fac.itbis);
    expect(fac.total.toFixed(2)).toBe(identidad.toFixed(2)); // gravado+exento+itbis
    expect(fac.correlativoInterno).toMatch(/^FAC-\d{6}$/); // never from payload
    expect(subtotal.greaterThan(0)).toBe(true);
  });

  it("parallel confirms across two sales allocate distinct FAC correlativos, branch-scoped (R-F3, 2.9)", async () => {
    const prod = await productoConStock("fac", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const idA = await crearBorrador(ctx, prod);
    const idB = await crearBorrador(ctx, prod);

    await Promise.all([
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: idA })),
      withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id: idB })),
    ]);

    const db = getHarnessDb();
    const facs = await db.factura.findMany({ where: { empresaId: ctx.empresaId }, orderBy: { correlativoInterno: "asc" } });
    expect(facs).toHaveLength(2);
    expect(new Set(facs.map((f) => f.correlativoInterno)).size).toBe(2); // atomic, no dup
    // Sucursal GUC restored in the allocator's finally → both invoices land on A1.
    for (const f of facs) expect(f.sucursalId).toBe(ctx.sucursalId);
    expect(await leerSecuenciaActual(ctx.empresaId, "B02")).toBe(523); // two burns, serialized
  });

  it("emitted invoice is VIGENTE, 1:1 ventaId, correct branch, no stored balance (R-F1/R-F4, 2.10)", async () => {
    const prod = await productoConStock("vig", "50.000");
    await marcarFacturaAutomatica(ctx.empresaId, true);
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    const id = await crearBorrador(ctx, prod);

    const r = await withTenantTransaction(ctx, (tx) => confirmarVenta(tx, ctx, { id }));
    expect(r.ok).toBe(true);
    const db = getHarnessDb();
    const facs = await db.factura.findMany({ where: { ventaId: id } });
    expect(facs).toHaveLength(1); // 1:1 (DB @@unique([ventaId]))
    const fac = facs[0];
    expect(fac.estado).toBe("VIGENTE");
    expect(fac.sucursalId).toBe(ctx.sucursalId);
    expect(fac.ncf).toBe("B0200000522"); // 11-char composition via the consume port
    // No persisted paid/balance state: no Pago rows and no balance column on FACTURA.
    expect(await db.pago.count({ where: { facturaId: fac.id } })).toBe(0);
    expect(Object.keys(fac)).not.toContain("saldo");
    expect(Object.keys(fac)).not.toContain("totalPagado");
  });
});
