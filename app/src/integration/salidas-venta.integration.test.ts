/**
 * Integration — confirmed-sale exit batch + cancellation reposition (inventario
 * side, fase-5c pr5c3) against the REAL `systemfact_test` database via
 * `withTenantTransaction` (app role + RLS).
 *
 * Covers the inventario spec "Confirmed-sale exit batch" and "Cancellation
 * reposition batch": the two-product batch debit with one `SALIDA_VENTA` per line
 * (3.1), the mid-batch shortage that rolls back the WHOLE batch with a typed
 * `STOCK_INSUFICIENTE_BLOQUEO` and zero side effects (3.2), the row-lock
 * serialization of two parallel exits on stock 10 (3.3, the "Concurrent exits
 * serialize" case mirroring the entry-path three-phase precedent), the reposition
 * that restores the exact quantity under a non-empty reason without touching
 * `costoPromedio` (3.7), and the cross-tenant + cost-boundary invariants (3.10).
 *
 * LOCATION: real-DB suites live under `src/integration/` (the only harness with a
 * DB), matching `inventario-entrada-compra.integration.test.ts`.
 *
 * A real `VENTA` row is created (as a draft via `crearVenta`) ONLY to satisfy
 * `MOVIMIENTO_INVENTARIO.ventaId`'s foreign key — the exit primitive itself has no
 * state precondition (the confirm orchestrator owns the flip); this suite tests
 * the inventario unit of work in isolation.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Prisma } from "@/generated/prisma/client";
import {
  registrarSalidasVenta,
  registrarReposicionCancelacion,
} from "@/modules/inventario/application/registrar-salidas-venta";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, categoriaA } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;

let fixture: TenantFixture | null = null;

function ctxA1(f: TenantFixture): TenantCtx {
  return {
    empresaId: f.empresaA.id,
    sucursalId: f.sucursalA1.id,
    usuarioId: f.usuarios.adminA.id,
    esAdmin: true,
  };
}

/** Create a priced empresa-A product with the given branch-A1 stock. */
async function productoConStock(
  ctx: TenantCtx,
  categoriaId: number,
  codigo: string,
  stock: string,
): Promise<number> {
  const db = getHarnessDb();
  const prod = await crearProductoVenta({
    empresaId: ctx.empresaId,
    categoriaId,
    codigo,
    precioVenta: "100.00",
  });
  await db.inventario.upsert({
    where: { sucursalId_productoId: { sucursalId: ctx.sucursalId, productoId: prod.id } },
    update: { cantidad: new Prisma.Decimal(stock) },
    create: { sucursalId: ctx.sucursalId, productoId: prod.id, cantidad: new Prisma.Decimal(stock) },
  });
  return prod.id;
}

/** A draft sale of the given lines, returning its id (for the movement FK). */
async function crearVentaId(
  ctx: TenantCtx,
  lineas: readonly { productoId: number; cantidad: string }[],
): Promise<number> {
  return withTenantTransaction(ctx, async (tx) => {
    const r = await crearVenta(tx, ctx, {
      clienteId: null,
      fecha: new Date("2026-01-10T00:00:00.000Z"),
      lineas: lineas.map((l) => ({
        productoId: l.productoId,
        cantidad: l.cantidad,
        precioUnitario: "100.00",
        descuento: CERO,
      })),
    });
    if (!r.ok) throw new Error(`crearVenta falló: ${r.code}`);
    return r.data.id;
  });
}

async function cantidadEnSucursal(ctx: TenantCtx, productoId: number): Promise<string> {
  const row = await getHarnessDb().inventario.findFirst({
    where: { sucursalId: ctx.sucursalId, productoId },
    select: { cantidad: true },
  });
  return row ? new Prisma.Decimal(row.cantidad).toFixed(3) : "SIN_FILA";
}

async function movimientosSalida(ctx: TenantCtx, productoId: number, tipo: string) {
  const db = getHarnessDb();
  const inv = await db.inventario.findFirst({
    where: { sucursalId: ctx.sucursalId, productoId },
    select: { id: true },
  });
  if (inv === null) return [];
  const all = await db.movimientoInventario.findMany({ where: { inventarioId: inv.id } });
  return all.filter((m) => m.tipoMovimiento === tipo);
}

describe("registrarSalidasVenta / reposition (real DB, RLS on)", () => {
  let ctx: TenantCtx;
  let cat: number;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA1(fixture);
    cat = await categoriaA(fixture.empresaA.id);
  });

  it("3.1 — batch-debits two products once each with one SALIDA_VENTA per line + ventaId", async () => {
    const p1 = await productoConStock(ctx, cat, "s1a", "10.000");
    const p2 = await productoConStock(ctx, cat, "s1b", "8.000");
    const ventaId = await crearVentaId(ctx, [
      { productoId: p1, cantidad: "3.000" },
      { productoId: p2, cantidad: "2.000" },
    ]);

    await withTenantTransaction(ctx, (tx) =>
      registrarSalidasVenta(tx, ctx, {
        ventaId,
        lineas: [
          { productoId: p1, cantidad: "3.000" },
          { productoId: p2, cantidad: "2.000" },
        ],
      }),
    );

    expect(await cantidadEnSucursal(ctx, p1)).toBe("7.000"); // 10 - 3
    expect(await cantidadEnSucursal(ctx, p2)).toBe("6.000"); // 8 - 2

    const m1 = await movimientosSalida(ctx, p1, "SALIDA_VENTA");
    expect(m1).toHaveLength(1);
    expect(m1[0].ventaId).toBe(ventaId);
    expect(m1[0].cantidadAnterior.toFixed(3)).toBe("10.000");
    expect(m1[0].cantidadNueva.toFixed(3)).toBe("7.000");
    expect(m1[0].cantidadMovida.toFixed(3)).toBe("-3.000"); // negative delta
    expect(m1[0].motivo.length).toBeGreaterThan(0);
    expect(m1[0].motivo).toContain(String(ventaId));

    const m2 = await movimientosSalida(ctx, p2, "SALIDA_VENTA");
    expect(m2).toHaveLength(1);
    expect(m2[0].ventaId).toBe(ventaId);
    expect(m2[0].cantidadMovida.toFixed(3)).toBe("-2.000");
  });

  it("3.2 — a mid-batch shortage throws STOCK_INSUFICIENTE_BLOQUEO and changes NOTHING", async () => {
    const p1 = await productoConStock(ctx, cat, "s2a", "10.000");
    const pCorto = await productoConStock(ctx, cat, "s2c", "3.000");
    const p3 = await productoConStock(ctx, cat, "s2b", "10.000");
    const ventaId = await crearVentaId(ctx, [
      { productoId: p1, cantidad: "2.000" },
      { productoId: pCorto, cantidad: "5.000" },
      { productoId: p3, cantidad: "2.000" },
    ]);

    await expect(
      withTenantTransaction(ctx, (tx) =>
        registrarSalidasVenta(tx, ctx, {
          ventaId,
          lineas: [
            { productoId: p1, cantidad: "2.000" },
            { productoId: pCorto, cantidad: "5.000" }, // 5 > 3 available
            { productoId: p3, cantidad: "2.000" },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      code: "STOCK_INSUFICIENTE_BLOQUEO",
      details: { productoId: pCorto, available: "3.000", requested: "5.000" },
    });

    // NO stock moved and NO movement persisted for ANY line (whole batch rolled back).
    expect(await cantidadEnSucursal(ctx, p1)).toBe("10.000");
    expect(await cantidadEnSucursal(ctx, pCorto)).toBe("3.000");
    expect(await cantidadEnSucursal(ctx, p3)).toBe("10.000");
    const totalMovs = await getHarnessDb().movimientoInventario.count({ where: { ventaId } });
    expect(totalMovs).toBe(0);
  });

  it("3.3 — two parallel 6-unit exits on stock 10 serialize: one wins, loser blocked, never negative", async () => {
    const p = await productoConStock(ctx, cat, "s3", "10.000");
    const v1 = await crearVentaId(ctx, [{ productoId: p, cantidad: "6.000" }]);
    const v2 = await crearVentaId(ctx, [{ productoId: p, cantidad: "6.000" }]);

    const exit = (ventaId: number) =>
      withTenantTransaction(ctx, (tx) =>
        registrarSalidasVenta(tx, ctx, { ventaId, lineas: [{ productoId: p, cantidad: "6.000" }] }),
      );

    const [a, b] = await Promise.allSettled([exit(v1), exit(v2)]);
    const exitos = [a, b].filter((x) => x.status === "fulfilled");
    const bloqueados = [a, b].filter(
      (x) => x.status === "rejected" && (x as PromiseRejectedResult).reason?.code === "STOCK_INSUFICIENTE_BLOQUEO",
    );
    expect(exitos).toHaveLength(1);
    expect(bloqueados).toHaveLength(1);

    // Exactly one committed debit; committed stock is never negative.
    expect(await cantidadEnSucursal(ctx, p)).toBe("4.000");
    expect(await getHarnessDb().movimientoInventario.count({ where: { tipoMovimiento: "SALIDA_VENTA" } })).toBe(1);
  });

  it("3.7 — reposition restores the exact quantity, requires a non-empty reason, and never changes costoPromedio", async () => {
    const db = getHarnessDb();
    const p = await productoConStock(ctx, cat, "s7", "10.000");
    await db.producto.update({ where: { id: p }, data: { costoPromedio: new Prisma.Decimal("42.00") } });
    const ventaId = await crearVentaId(ctx, [{ productoId: p, cantidad: "4.000" }]);

    // Debit then restore: net back to the pre-sale value.
    await withTenantTransaction(ctx, (tx) =>
      registrarSalidasVenta(tx, ctx, { ventaId, lineas: [{ productoId: p, cantidad: "4.000" }] }),
    );
    expect(await cantidadEnSucursal(ctx, p)).toBe("6.000");

    await withTenantTransaction(ctx, (tx) =>
      registrarReposicionCancelacion(tx, ctx, {
        ventaId,
        motivo: "Reposición por cancelación",
        lineas: [{ productoId: p, cantidad: "4.000" }],
      }),
    );
    expect(await cantidadEnSucursal(ctx, p)).toBe("10.000");

    const rep = await movimientosSalida(ctx, p, "REPOSICION_CANCELACION");
    expect(rep).toHaveLength(1);
    expect(rep[0].ventaId).toBe(ventaId);
    expect(rep[0].cantidadMovida.toFixed(3)).toBe("4.000"); // positive delta
    expect(rep[0].cantidadAnterior.toFixed(3)).toBe("6.000");
    expect(rep[0].cantidadNueva.toFixed(3)).toBe("10.000");
    expect(rep[0].motivo).toBe("Reposición por cancelación");

    // Average cost is a purchase-path concern: exit + reposition never reweight it.
    const prod = await db.producto.findUnique({ where: { id: p } });
    expect(prod?.costoPromedio.toFixed(2)).toBe("42.00");

    // A blank/whitespace reason is rejected (MOTIVO_VACIO) with no effect.
    await expect(
      withTenantTransaction(ctx, (tx) =>
        registrarReposicionCancelacion(tx, ctx, {
          ventaId,
          motivo: "   ",
          lineas: [{ productoId: p, cantidad: "4.000" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "MOTIVO_VACIO" });
    expect(await cantidadEnSucursal(ctx, p)).toBe("10.000");
  });

  it("3.10 — an exit touching a foreign-tenant product throws INVENTARIO_NO_ENCONTRADO with zero changes", async () => {
    const pValido = await productoConStock(ctx, cat, "s10", "10.000");
    const prodB = fixture!.productos.prodB1.id; // belongs to empresa B
    const ventaId = await crearVentaId(ctx, [{ productoId: pValido, cantidad: "1.000" }]);

    // The sale id is a valid FK; the BATCH references empresa B's product.
    await expect(
      withTenantTransaction(ctx, (tx) =>
        registrarSalidasVenta(tx, ctx, { ventaId, lineas: [{ productoId: prodB, cantidad: "1.000" }] }),
      ),
    ).rejects.toMatchObject({ code: "INVENTARIO_NO_ENCONTRADO" });

    // Empresa B's branch stock untouched and no phantom A row/movement created.
    const b1 = await getHarnessDb().inventario.findUnique({ where: { id: fixture!.inventarios.b1ProdB1.id } });
    expect(b1?.cantidad.toFixed(3)).toBe("7.000");
    expect(await getHarnessDb().movimientoInventario.count({ where: { ventaId } })).toBe(0);
    expect(await cantidadEnSucursal(ctx, pValido)).toBe("10.000");
  });
});
