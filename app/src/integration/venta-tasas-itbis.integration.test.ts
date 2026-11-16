/**
 * Integration — sale validates each line's rate against the per-empresa
 * TASA_ITBIS list at the sale date (feature itbis-tasas-config, slice 3d).
 *
 * Real DB. Proves:
 *   - a product whose stored rate is numerically equal to a list entry
 *     ("18.00" vs "18") is accepted at the sale (numeric equality);
 *   - a product with a well-formed rate OUTSIDE the active list ("7") is
 *     REFUSED at draft/prepare (S13: "Refuse until the product's rate is
 *     current") with `LINEA_INVALIDA` and ZERO writes;
 *   - a missing TASA_ITBIS key fails loud with `TASA_ITBIS_CONFIG_FALTANTE`
 *     (S15) and ZERO writes — never a silent hardcoded default.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, categoriaA } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;

describe("venta line rates validated against the empresa list (real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;
  let catA: number;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = { empresaId: fixture.empresaA.id, sucursalId: fixture.sucursalA1.id, usuarioId: fixture.usuarios.adminA.id, esAdmin: true };
    catA = await categoriaA(fixture.empresaA.id);
  });

  it("accepts a product whose stored rate is numerically in the list ('18.00' ≡ '18')", async () => {
    const db = getHarnessDb();
    // The write path (3b) canonicalizes, but a legacy row can carry '18.00'.
    const p = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "EQ18", tasa: 18 });
    await db.producto.update({ where: { id: p.id }, data: { tasaItbis: "18.00" } });

    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: p.id, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const venta = await db.venta.findUnique({ where: { id: r.data.id } });
    expect(venta?.itbis.toFixed(2)).toBe("18.00");
    expect(venta?.total.toFixed(2)).toBe("118.00");
  });

  it("refuses a retired rate ('7', well-formed but outside the list) with zero writes", async () => {
    const db = getHarnessDb();
    const p = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "RET7", tasa: 7 });
    const antes = await db.venta.count({ where: { empresaId: fixture.empresaA.id } });

    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: p.id, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(!r.ok && r.code).toBe("LINEA_INVALIDA");
    expect(await db.venta.count({ where: { empresaId: fixture.empresaA.id } })).toBe(antes);
    expect(await db.detalleVenta.count()).toBe(0);
  });

  it("fails loud with TASA_ITBIS_CONFIG_FALTANTE when the key is missing (S15)", async () => {
    const db = getHarnessDb();
    const p = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "TASA18", tasa: 18 });
    await db.configuracionEmpresa.deleteMany({ where: { empresaId: fixture.empresaA.id, clave: "TASA_ITBIS" } });
    const antes = await db.venta.count({ where: { empresaId: fixture.empresaA.id } });

    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: p.id, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(!r.ok && r.code).toBe("TASA_ITBIS_CONFIG_FALTANTE");
    expect(await db.venta.count({ where: { empresaId: fixture.empresaA.id } })).toBe(antes);
    expect(await db.detalleVenta.count()).toBe(0);
  });
});
