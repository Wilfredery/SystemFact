/**
 * Integration tests — multi-tenant isolation of the inventory repositories.
 *
 * Runs every read/write through `withTenantTransaction` (app role + RLS GUCs)
 * with the context of Empresa A / Sucursal A1 and proves that neither the
 * same-empresa sibling branch (A2) nor the foreign empresa (B) leaks.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  listarInventarioEnTx,
  obtenerInventarioPorProductoEnTx,
} from "@/modules/inventario/infrastructure/inventario-repository";
import { ajustarInventario } from "@/modules/inventario/application/ajustar-inventario";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("tenant isolation (real DB)", () => {
  let fixture: TenantFixture;
  let ctxA1: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxA1 = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  it("lists ONLY sucursal A1 rows (sibling branch A2 and empresa B excluded)", async () => {
    const rows = await withTenantTransaction(ctxA1, (tx: PrismaTx) =>
      listarInventarioEnTx(tx, ctxA1, { page: 1, limit: 25 }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.productoId).toBe(fixture.productos.prodA1.id);
    expect(rows[0]?.inventarioId).toBe(fixture.inventarios.a1ProdA1.id);
    expect(rows.map((r) => r.productoId)).not.toContain(fixture.productos.prodA2Only.id);
    expect(rows.map((r) => r.productoId)).not.toContain(fixture.productos.prodB1.id);
  });

  it("cannot fetch by product id from another tenant (returns null)", async () => {
    const result = await withTenantTransaction(ctxA1, (tx: PrismaTx) =>
      obtenerInventarioPorProductoEnTx(tx, ctxA1, fixture.productos.prodB1.id),
    );
    expect(result).toBeNull();
  });

  it("cannot adjust another tenant's inventory and B1 stock stays untouched", async () => {
    const result = await withTenantTransaction(ctxA1, (tx: PrismaTx) =>
      ajustarInventario(tx, ctxA1, {
        productoId: fixture.productos.prodB1.id,
        cantidad: "100",
        motivo: "Intento cross-tenant",
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: "INVENTARIO_NO_ENCONTRADO",
      message: expect.any(String),
    });

    const db = getHarnessDb();
    const inventarioB1 = await db.inventario.findUnique({
      where: { id: fixture.inventarios.b1ProdB1.id },
    });
    expect(inventarioB1?.cantidad.toFixed(3)).toBe("7.000");
    const movimientosB1 = await db.movimientoInventario.count({
      where: { inventarioId: fixture.inventarios.b1ProdB1.id },
    });
    expect(movimientosB1).toBe(0);
  });
});
