/**
 * Integration — F5 sale-date band (real DB, RLS on) for audit v2r-11,
 * `venta:crear-venta:backdated-fecha-devolucion-window`.
 *
 * The finding: `crearVenta` / `actualizarVenta` persisted the wire `fecha` after
 * a mere parseability check, so a client could date a sale arbitrarily far in
 * the past. That backdate is not cosmetic — it moves the B04 return-window
 * anchor (`limite = fechaVenta + PLAZO_DEVOLUCION`) and every period
 * attribution derived from it, i.e. a free extension of the return window. The
 * remediation bounds the sale date to `hoy_SD − RETROACTIVO_FECHA_VENTA_DIAS …
 * hoy_SD` (both bounds inclusive) against the SERVER clock.
 *
 * This suite overrides the shared harness' wide `999` horizon to the PRODUCTION
 * DEFAULT of `7` (the value `seed-venta-config.ts` provisions), so the shipped
 * behavior — not a relaxed test value — is what runs here. It pins:
 *
 *   A. the two rejections (past the horizon / future) write NOTHING of any
 *      kind (no venta, no factura, no audit row, no NCF burn);
 *   B. the lower edge is INCLUSIVE (exactly 7 SD days back saves);
 *   C. the B04 consequence: a maximally-backdated sale is returnable on its
 *      last legal day and NOT one day later — the backdate can no longer buy
 *      extra window, the extension is capped at the horizon.
 *
 * Dates are derived from the real clock (the band is validated against the
 * server instant, so fixed 2026 fixtures would be rejected); the return clock
 * is injected through `crearDevolucion({ now })` as elsewhere in the harness.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearVenta, actualizarVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { crearDevolucion } from "@/modules/devolucion/application/crear-devolucion";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");
const UN_DIA_MS = 86_400_000;
/** The production default provisioned by `seed-venta-config.ts`. */
const HORIZONTE_PRODUCCION = "7";
/** `PLAZO_DEVOLUCION` for empresa A — the return window the backdate abused. */
const PLAZO_DEVOLUCION_DIAS = 15;

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

/** `n` calendar days before NOW (SD has no DST, so this shifts the SD date by n). */
function diasAtras(n: number): Date {
  return new Date(Date.now() - n * UN_DIA_MS);
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
      rangoInicio: BigInt(s.rangoInicio),
      rangoFin: BigInt(s.rangoFin),
      secuenciaActual: BigInt(s.secuenciaActual),
      vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
      vigenciaFin: VIG_FIN,
      activa: true,
    },
  });
}

async function leerSecuenciaB04(empresaAId: number): Promise<bigint> {
  const row = await getHarnessDb().ncfSecuencia.findUnique({
    where: { empresaId_tipoNcf: { empresaId: empresaAId, tipoNcf: "B04" } },
  });
  return row?.secuenciaActual ?? -1n;
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

/** One counted (Consumidor Final) line on the per-test product. */
function lineaActual() {
  return {
    productoId: productoActual,
    cantidad: "5",
    precioUnitario: "100.00",
    descuento: { descuentoTipo: "PORCENTAJE" as const, descuentoValor: "0.00" },
  };
}

/** Save-only path (BORRADOR): isolates what the band gate does or does not write. */
function guardarVenta(fecha: Date) {
  return withTenantTransaction(ctx, (tx) =>
    crearVenta(tx, ctx, { clienteId: null, fecha, lineas: [lineaActual()] }),
  );
}

/** Sale → confirm in ONE transaction, ending in a VIGENTE B02 factura. */
async function crearVentaConfirmada(fecha: Date): Promise<{ ventaId: number; fecha: Date }> {
  const ventaId = await withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, { clienteId: null, fecha, lineas: [lineaActual()] });
    if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
    const c = await confirmarVenta(tx, ctx, { id: r.data.id });
    if (!c.ok) throw new Error(`confirmarVenta falló: ${c.code}`);
    return r.data.id;
  });
  const factura = (await getHarnessDb().factura.findFirst({ where: { ventaId } }))!;
  if ((factura?.estado ?? null) !== "VIGENTE") {
    throw new Error("la venta confirmada no tiene una FACTURA VIGENTE");
  }
  return { ventaId, fecha };
}

function devolver(ventaId: number, productoId: number, cantidad: string, now: Date) {
  return withTenantTransaction(ctx, (tx) =>
    crearDevolucion(tx, ctx, {
      ventaId,
      motivo: "devolucion F5 retroactivo",
      lineas: [{ productoId, cantidad, tipoReposicion: "VENDIBLE" }],
      now,
    }),
  );
}

let productoActual = 0;

describe("F5 sale-date band: RETROACTIVO_FECHA_VENTA_DIAS (real DB, RLS on)", () => {
  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    const db = getHarnessDb();
    catA = (await db.categoria.findFirst({ where: { empresaId: ctx.empresaId } }))!.id;
    productoActual = await productoConStock(`f5-${Math.random().toString(36).slice(2, 9)}`, "50.000");

    // The production horizon, not the harness' wide 999.
    await db.configuracionEmpresa.update({
      where: { id: fixture.retroactivoFechaVenta.empresaAId },
      data: { valor: HORIZONTE_PRODUCCION },
    });
    // Emission gate + factura range + B04 return range.
    await db.empresa.update({ where: { id: ctx.empresaId }, data: { facturaAutomatica: true } });
    await sembrarRango(ctx.empresaId, "B02", { rangoInicio: 500, rangoFin: 1000, secuenciaActual: 521 });
    await sembrarRango(ctx.empresaId, "B04", { rangoInicio: 201, rangoFin: 300, secuenciaActual: 200 });
    await db.configuracionEmpresa.create({
      data: {
        empresaId: ctx.empresaId,
        clave: "PLAZO_DEVOLUCION",
        valor: String(PLAZO_DEVOLUCION_DIAS),
        vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
        vigenciaFin: VIG_FIN,
        activa: true,
      },
    });
  });

  it("the tenant parameter is what the reader sees (sanity: the 7-day default is live)", async () => {
    const fila = await getHarnessDb().configuracionEmpresa.findUniqueOrThrow({
      where: { id: fixture!.retroactivoFechaVenta.empresaAId },
    });
    expect(fila.clave).toBe("RETROACTIVO_FECHA_VENTA_DIAS");
    expect(fila.valor).toBe(HORIZONTE_PRODUCCION);
  });

  it("rejects a sale dated 8 SD days back (horizon 7) and writes NOTHING", async () => {
    const db = getHarnessDb();
    const ventasAntes = await db.venta.count();
    const facturasAntes = await db.factura.count();
    const auditAntes = await db.movimientoAuditoria.count();
    const ncfAntes = await leerSecuenciaB04(ctx.empresaId);

    const r = await guardarVenta(diasAtras(8));

    expect(!r.ok && r.code).toBe("FECHA_VENTA_RETROACTIVA_EXCEDIDA");
    // The gate precedes every write: no draft, no factura, no audit row, and
    // no NCF sequence burn.
    expect(await db.venta.count()).toBe(ventasAntes);
    expect(await db.factura.count()).toBe(facturasAntes);
    expect(await db.movimientoAuditoria.count()).toBe(auditAntes);
    expect(await leerSecuenciaB04(ctx.empresaId)).toBe(ncfAntes);
  });

  it("rejects a future-dated sale and writes NOTHING", async () => {
    const db = getHarnessDb();
    const ventasAntes = await db.venta.count();
    const auditAntes = await db.movimientoAuditoria.count();

    const r = await guardarVenta(diasAtras(-1));

    expect(!r.ok && r.code).toBe("FECHA_VENTA_FUTURA");
    expect(await db.venta.count()).toBe(ventasAntes);
    expect(await db.movimientoAuditoria.count()).toBe(auditAntes);
  });

  it("accepts the inclusive lower edge (exactly 7 SD days back) and persists that date verbatim", async () => {
    const borde = diasAtras(7);
    const r = await guardarVenta(borde);
    expect(r.ok).toBe(true);

    if (r.ok) {
      const guardada = await getHarnessDb().venta.findUniqueOrThrow({ where: { id: r.data.id } });
      // Bounded, never rewritten: the legal backdate is stored as sent.
      expect(guardada.fecha.getTime()).toBe(borde.getTime());
      expect(guardada.estado).toBe("BORRADOR");
    }
  });

  it("B04: a maximally-backdated sale returns on its LAST legal day", async () => {
    const fechaVenta = diasAtras(7);
    const { ventaId } = await crearVentaConfirmada(fechaVenta);

    // Last legal day = fechaVenta + PLAZO_DEVOLUCION (inclusive limit).
    const r = await devolver(ventaId, productoActual, "1", new Date(fechaVenta.getTime() + PLAZO_DEVOLUCION_DIAS * UN_DIA_MS));

    expect(r.ok).toBe(true);
    expect(await leerSecuenciaB04(ctx.empresaId)).toBe(201n);
  });

  it("B04 REGRESSION: one day past that, the backdate buys NO extra window", async () => {
    const fechaVenta = diasAtras(7);
    const { ventaId } = await crearVentaConfirmada(fechaVenta);
    const db = getHarnessDb();
    const ncsAntes = await db.notaCredito.count();
    const detallesAntes = await db.detalleNotaCredito.count();
    const movimientosAntes = await db.movimientoInventario.count();
    const ncfAntes = await leerSecuenciaB04(ctx.empresaId);

    // fechaVenta + 16 days: still a legal SALE (inside the 7-day band) but
    // outside the 15-day return window. Before the remediation an attacker
    // simply pushed `fecha` further back to land here; the band caps the
    // extension at 7 days, so the window is anchored and closes on schedule.
    const r = await devolver(ventaId, productoActual, "1", new Date(fechaVenta.getTime() + 16 * UN_DIA_MS));

    expect(!r.ok && r.code).toBe("DEVOLUCION_FUERA_DE_PLAZO");
    expect(await db.notaCredito.count()).toBe(ncsAntes);
    expect(await db.detalleNotaCredito.count()).toBe(detallesAntes);
    expect(await db.movimientoInventario.count()).toBe(movimientosAntes);
    // No B04 burn: the window check precedes the consume.
    expect(await leerSecuenciaB04(ctx.empresaId)).toBe(ncfAntes);
  });

  it("actualizarVenta enforces the same band (a draft cannot be re-dated out of it)", async () => {
    const original = diasAtras(1);
    const r = await guardarVenta(original);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const peor = await withTenantTransaction(ctx, (tx) =>
      actualizarVenta(tx, ctx, {
        id: r.data.id,
        fecha: diasAtras(8),
        lineas: [lineaActual()],
      }),
    );

    expect(!peor.ok && peor.code).toBe("FECHA_VENTA_RETROACTIVA_EXCEDIDA");
    // The draft keeps its legal date — a rejected re-date is not persisted.
    const guardada = await getHarnessDb().venta.findUniqueOrThrow({ where: { id: r.data.id } });
    expect(guardada.fecha.getTime()).toBe(original.getTime());
  });
});
