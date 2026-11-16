/**
 * Integration — purchase validates each line's rate against the per-empresa
 * TASA_ITBIS list at the purchase date (feature itbis-tasas-config, slice 3e).
 *
 * Real DB. Proves:
 *   - a full confirmed purchase with lines at 18, 16 and 0 succeeds;
 *   - a purchase whose product carries a well-formed rate OUTSIDE the active
 *     list ("7") is REFUSED at draft/prepare (S13) with `LINEA_INVALIDA` and
 *     ZERO writes;
 *   - a missing TASA_ITBIS key fails loud with `TASA_ITBIS_CONFIG_FALTANTE`
 *     (S15) and ZERO writes — never a silent hardcoded default.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { confirmarCompra } from "@/modules/compra/application/confirmar-compra";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, categoriaA } from "./setup/venta-helpers";

const FECHA = new Date("2026-01-10T00:00:00.000Z");

describe("compra line rates validated against the empresa list (real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  it("confirms a full purchase with lines at 18, 16 and 0", async () => {
    const db = getHarnessDb();
    const catA = await categoriaA(fixture.empresaA.id);
    const p16 = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "C16", tasa: 16 });
    const p0 = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "C00", tasa: 0 });
    const creado = await withTenantTransaction(ctx, (tx) =>
      crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: FECHA,
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "100.00" },
          { productoId: p16.id, cantidad: "1.000", costoUnitario: "100.00" },
          { productoId: p0.id, cantidad: "1.000", costoUnitario: "100.00" },
        ],
      }),
    );
    expect(creado.ok).toBe(true);
    if (!creado.ok) return;
    const confirm = await withTenantTransaction(ctx, (tx) =>
      confirmarCompra(tx, ctx, { id: creado.data.id }),
    );
    expect(confirm.ok).toBe(true);
    const compra = await db.compra.findUnique({
      where: { id: creado.data.id },
      include: { detalles: { orderBy: { id: "asc" } } },
    });
    expect(compra?.detalles.map((l) => l.tasaItbis.toString())).toEqual(["18", "16", "0"]);
    expect(compra?.total.toFixed(2)).toBe("334.00");
  });

  it("refuses a retired rate ('7', well-formed but outside the list) with zero writes", async () => {
    const db = getHarnessDb();
    const catA = await categoriaA(fixture.empresaA.id);
    const retirado = await crearProductoVenta({ empresaId: fixture.empresaA.id, categoriaId: catA, codigo: "CRE7", tasa: 7 });
    const antes = await db.compra.count({ where: { empresaId: fixture.empresaA.id } });

    const r = await withTenantTransaction(ctx, (tx) =>
      crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: FECHA,
        lineas: [{ productoId: retirado.id, cantidad: "1.000", costoUnitario: "100.00" }],
      }),
    );
    expect(!r.ok && r.code).toBe("LINEA_INVALIDA");
    expect(await db.compra.count({ where: { empresaId: fixture.empresaA.id } })).toBe(antes);
  });

  it("fails loud with TASA_ITBIS_CONFIG_FALTANTE when the key is missing (S15)", async () => {
    const db = getHarnessDb();
    await db.configuracionEmpresa.deleteMany({
      where: { empresaId: fixture.empresaA.id, clave: "TASA_ITBIS" },
    });
    const antes = await db.compra.count({ where: { empresaId: fixture.empresaA.id } });

    const r = await withTenantTransaction(ctx, (tx) =>
      crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: FECHA,
        lineas: [{ productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "100.00" }],
      }),
    );
    expect(!r.ok && r.code).toBe("TASA_ITBIS_CONFIG_FALTANTE");
    expect(await db.compra.count({ where: { empresaId: fixture.empresaA.id } })).toBe(antes);
  });
});
