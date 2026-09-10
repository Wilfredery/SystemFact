/**
 * Integration — venta stock WARN, never a block (spec R-V9).
 *
 * Real DB. A draft line whose quantity exceeds branch availability still SAVES,
 * and the result payload carries exactly one structured `STOCK_INSUFICIENTE`
 * warning `{ code, productoId, available, requested }`. No `MOVIMIENTO_INVENTARIO`
 * is written and `INVENTARIO` is untouched (5b never debits — the hard block is a
 * 5c-confirm reserved seam).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, fijarStock, categoriaA } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;

describe("venta stock warning (real DB, R-V9)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = { empresaId: fixture.empresaA.id, sucursalId: fixture.sucursalA1.id, usuarioId: fixture.usuarios.adminA.id, esAdmin: true };
  });

  it("short stock saves the draft and returns exactly one warning, no inventory write", async () => {
    const db = getHarnessDb();
    const cat = await categoriaA(fixture.empresaA.id);
    const prod = await crearProductoVenta({
      empresaId: fixture.empresaA.id,
      categoriaId: cat,
      codigo: `STOCK-${Date.now()}`,
      precioVenta: "10.00",
    });
    // Only 2 units at A1; we request 5.
    await fijarStock(fixture.sucursalA1.id, prod.id, "2.000");

    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prod.id, cantidad: "5", precioUnitario: "10.00", descuento: CERO }],
      }),
    );

    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings?.[0]).toEqual({
      code: "STOCK_INSUFICIENTE",
      productoId: prod.id,
      available: "2.000",
      requested: "5",
    });

    // The draft persisted; inventory is untouched and no movement exists.
    const id = (r.ok && r.data.id) || -1;
    expect((await db.venta.findUnique({ where: { id } }))?.estado).toBe("BORRADOR");
    expect(
      (await db.inventario.findFirst({ where: { sucursalId: fixture.sucursalA1.id, productoId: prod.id } }))!
        .cantidad.toFixed(3),
    ).toBe("2.000");
    expect(await db.movimientoInventario.count({ where: { ventaId: id } })).toBe(0);
  });

  it("sufficient stock saves with NO warning", async () => {
    // Own product (2000-window rate) + ample stock, so the 2026-01-10 sale date
    // is inside every validity window and only the stock path is under test.
    const cat = await categoriaA(fixture.empresaA.id);
    const prod = await crearProductoVenta({
      empresaId: fixture.empresaA.id,
      categoriaId: cat,
      codigo: `OKSTOCK-${Date.now()}`,
      precioVenta: "10.00",
    });
    await fijarStock(fixture.sucursalA1.id, prod.id, "10.000");
    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prod.id, cantidad: "3", precioUnitario: "10.00", descuento: CERO }],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.warnings ?? []).toHaveLength(0);
  });
});
