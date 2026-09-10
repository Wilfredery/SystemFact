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

    // Two concurrent edits on the SAME draft, each a different line-set.
    const [a, b] = await Promise.all([
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
    ]);

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

    const [a, b] = await Promise.all([
      withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id })),
      withTenantTransaction(ctx, (tx) => cancelarVenta(tx, ctx, { id })),
    ]);
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
