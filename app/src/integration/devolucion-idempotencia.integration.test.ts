/**
 * Integration — R-D5 idempotency gate `DEVOLUCION_YA_REGISTRADA` (real DB,
 * RLS on, approved design amendment for task 3.3).
 *
 * GIVEN a confirmed sale with a VIGENTE factura and a return ALREADY persisted
 * (one VIGENTE B04 NC, one ENTRADA_DEVOLUCION movement, one NC audit row),
 * WHEN the IDENTICAL request is retried:
 *   THEN `DEVOLUCION_YA_REGISTRADA` (code 605) returns with the minimal
 *   (facturaId, productoId) locator, and NOTHING double-fires: the B04
 *   sequence value observed before the retry is UNCHANGED after it (no second
 *   burn), and the NC / detail / movement / audit counts are all unchanged.
 * A DIFFERENT quantity for the same product on the same factura still
 * succeeds afterwards (the negative control): the gate only blocks exact
 * (producto, cantidad, tipoReposicion) retries and never over-blocks legal
 * cumulative returns (mirrors task 3.1's cumulative semantics).
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { confirmarVenta } from "@/modules/venta/application/confirmar-venta";
import { crearDevolucion } from "@/modules/devolucion/application/crear-devolucion";
import { messageFor, DEVOLUCION_YA_REGISTRADA } from "@/modules/venta/domain/errors";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock } from "./setup/venta-helpers";

const VIG_FIN = new Date("2099-12-31T23:59:59.000Z");
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

/** Canonical CONFIRMADA sale with a VIGENTE B02 factura; returns its ids. */
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
      motivo: "idempotencia integration",
      lineas: [{ productoId, cantidad, tipoReposicion: "VENDIBLE" }],
      now: NOW_DEVOLUCION,
    }),
  );
}

describe("devolucion idempotent retry (real DB, RLS on)", () => {
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

  it("identical retry → DEVOLUCION_YA_REGISTRADA, NO second B04 burn, no duplicate rows; a different quantity still succeeds", async () => {
    // Sale line of 5: the retried return does NOT exhaust the cap, so this
    // isolates the idempotency gate from the cumulative-cap gate (1+1 ≤ 5).
    const prod = await productoConStock("idem-nc", "50.000");
    const { ventaId, facturaId } = await crearVentaConfirmada(prod, "5");

    const primero = await devolver(ventaId, prod, "1");
    expect(primero.ok).toBe(true);
    if (primero.ok) expect(primero.data.ncf).toBe("B0400000201");

    // Snapshot AFTER the first (only) confirmed return.
    const db = getHarnessDb();
    const secuenciaAntes = (await db.ncfSecuencia.findUnique({
      where: { empresaId_tipoNcf: { empresaId: ctx.empresaId, tipoNcf: "B04" } },
    }))!;
    expect(secuenciaAntes.secuenciaActual).toBe(201); // exactly one burn so far
    const ncsAntes = await db.notaCredito.findMany({ where: { facturaOriginalId: facturaId } });
    expect(ncsAntes).toHaveLength(1);
    const detallesAntes = await db.detalleNotaCredito.count();
    const movimientosAntes = await db.movimientoInventario.count();
    const auditAntes = await db.movimientoAuditoria.count();

    // The IDENTICAL request is a retry, whatever the remaining cap says.
    const retry = await devolver(ventaId, prod, "1");
    expect(!retry.ok && retry.code).toBe("DEVOLUCION_YA_REGISTRADA");
    if (!retry.ok) {
      expect(retry.message).toBe(messageFor(DEVOLUCION_YA_REGISTRADA));
      expect(retry.details).toEqual({ facturaId, productoId: prod }); // minimal locator
    }

    // Nothing double-fired: the sequence pointer did not move (still the one
    // 201 burn), no duplicate NC/detail/movement/audit rows.
    const secuenciaDespues = (await db.ncfSecuencia.findUnique({
      where: { empresaId_tipoNcf: { empresaId: ctx.empresaId, tipoNcf: "B04" } },
    }))!;
    expect(secuenciaDespues.secuenciaActual).toBe(secuenciaAntes.secuenciaActual);
    expect(await db.notaCredito.findMany({ where: { facturaOriginalId: facturaId } })).toEqual(ncsAntes);
    expect(await db.detalleNotaCredito.count()).toBe(detallesAntes);
    expect(await db.movimientoInventario.count()).toBe(movimientosAntes);
    expect(await db.movimientoAuditoria.count()).toBe(auditAntes);

    // Negative control: a DIFFERENT quantity for the same product is a legal
    // cumulative return (task 3.1 semantics), NOT a retry — it commits.
    const distinta = await devolver(ventaId, prod, "2");
    expect(distinta.ok).toBe(true);
    if (distinta.ok) {
      expect(distinta.data.ncf).toBe("B0400000202"); // the second burn
      expect(distinta.data.estado).toBe("VIGENTE");
    }
    const ncs = await db.notaCredito.findMany({ where: { facturaOriginalId: facturaId } });
    expect(ncs).toHaveLength(2);
    const total = await db.detalleNotaCredito.aggregate({
      _sum: { cantidad: true },
      where: { notaCredito: { facturaOriginalId: facturaId }, productoId: prod },
    });
    expect(total._sum?.cantidad?.toFixed(3)).toBe("3.000"); // 1 (retry blocked) + 2
  });
});
