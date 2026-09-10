/**
 * Integration — per-line ITBIS rate frozen at draft with validity window (R-V2).
 *
 * Real DB. Proves:
 *   - a draft freezes each line's `tasaItbis` FROM the product (mixed 18/16/0
 *     rates persist exactly, and the stored header identity holds);
 *   - a product whose ITBIS validity window ended before the sale date FAILS the
 *     whole save with `TASA_ITBIS_VIGENCIA_FALTA` and writes ZERO rows (config-style
 *     hard-fail parity with compra).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearVenta } from "@/modules/venta/application/venta-service";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, categoriaA } from "./setup/venta-helpers";

const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;

describe("venta per-line rate freeze + validity (real DB, R-V2)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;
  let catA: number;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = { empresaId: fixture.empresaA.id, sucursalId: fixture.sucursalA1.id, usuarioId: fixture.usuarios.adminA.id, esAdmin: true };
    catA = await categoriaA(fixture.empresaA.id);
  });

  it("freezes mixed 18/16/0 rates from the products onto the lines", async () => {
    const db = getHarnessDb();
    const p18 = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "R18", tasa: 18 });
    const p16 = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "R16", tasa: 16 });
    const p0 = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "R00", tasa: 0 });

    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: p18.id, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
          { productoId: p16.id, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
          { productoId: p0.id, cantidad: "1", precioUnitario: "100.00", descuento: CERO },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lineas = await db.detalleVenta.findMany({ where: { ventaId: r.data.id }, orderBy: { id: "asc" } });
    expect(lineas.map((l) => l.tasaItbis.toString())).toEqual(["18", "16", "0"]);
    // Identity: subtotal 300, itbis 34 (18 + 16 + 0), total 334.
    const venta = await db.venta.findUnique({ where: { id: r.data.id } });
    expect(venta?.subtotal.toFixed(2)).toBe("300.00");
    expect(venta?.itbis.toFixed(2)).toBe("34.00");
    expect(venta?.total.toFixed(2)).toBe("334.00");
  });

  it("an expired ITBIS window (before the sale date) fails the save with zero writes", async () => {
    const db = getHarnessDb();
    const vencido = await crearProductoVenta({
      empresaId: fixture.empresaA.id,
      categoriaId: catA,
      codigo: "VENC",
      tasa: 18,
      vigenciaHasta: new Date("2005-01-01T00:00:00.000Z"), // ended before 2026 sale date
    });
    const antes = await db.venta.count({ where: { empresaId: fixture.empresaA.id } });

    const r = await withTenantTransaction(ctx, (tx) =>
      crearVenta(tx, ctx, {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: vencido.id, cantidad: "1", precioUnitario: "100.00", descuento: CERO }],
      }),
    );
    expect(!r.ok && r.code).toBe("TASA_ITBIS_VIGENCIA_FALTA");
    expect(await db.venta.count({ where: { empresaId: fixture.empresaA.id } })).toBe(antes);
    expect(await db.detalleVenta.count()).toBe(0);
  });
});
