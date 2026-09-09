/**
 * Integration tests — manual stock adjustment (ajustarInventario) against the
 * real `systemfact_test` database via withTenantTransaction (app role + RLS).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { ajustarInventario } from "@/modules/inventario/application/ajustar-inventario";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

function ctxFor(fixture: TenantFixture, usuarioId: number): TenantCtx {
  return {
    empresaId: fixture.empresaA.id,
    sucursalId: fixture.sucursalA1.id,
    usuarioId,
    esAdmin: true,
  };
}

describe("ajustarInventario (real DB)", () => {
  let fixture: TenantFixture;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
  });

  it("applies the adjustment, appends an AJUSTE movement and an audit row", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);

    const result = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodA1.id,
        cantidad: "-3.500",
        motivo: "Correccion de conteo fisico",
      }),
    );

    expect(result).toEqual({
      ok: true,
      data: {
        inventarioId: fixture.inventarios.a1ProdA1.id,
        productoId: fixture.productos.prodA1.id,
        cantidadAnterior: "10.000",
        cantidadNueva: "6.500",
      },
    });

    const db = getHarnessDb();
    const inventario = await db.inventario.findUnique({
      where: { id: fixture.inventarios.a1ProdA1.id },
    });
    expect(inventario?.cantidad.toFixed(3)).toBe("6.500");

    const movimiento = await db.movimientoInventario.findFirst({
      where: { inventarioId: fixture.inventarios.a1ProdA1.id },
    });
    expect(movimiento).not.toBeNull();
    expect(movimiento?.tipoMovimiento).toBe("AJUSTE");
    expect(movimiento?.cantidadMovida.toFixed(3)).toBe("-3.500");
    expect(movimiento?.cantidadAnterior.toFixed(3)).toBe("10.000");
    expect(movimiento?.cantidadNueva.toFixed(3)).toBe("6.500");
    expect(movimiento?.motivo).toBe("Correccion de conteo fisico");
    expect(movimiento?.usuarioId).toBe(fixture.usuarios.adminA.id);

    const auditoria = await db.movimientoAuditoria.findFirst({
      where: { idEntidad: String(fixture.inventarios.a1ProdA1.id), entidad: "Inventario" },
    });
    expect(auditoria).not.toBeNull();
    expect(auditoria?.accion).toBe("AJUSTAR");
    expect(auditoria?.valorAnterior).toBe("10.000");
    expect(auditoria?.valorNuevo).toBe("6.500");
  });

  it("rejects a negative delta below stock with STOCK_INSUFICIENTE and rolls back everything", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);

    const result = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodA1.id,
        cantidad: "-10.001",
        motivo: "Salida mayor al stock",
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: "STOCK_INSUFICIENTE",
      message: expect.any(String),
    });

    const db = getHarnessDb();
    const inventario = await db.inventario.findUnique({
      where: { id: fixture.inventarios.a1ProdA1.id },
    });
    expect(inventario?.cantidad.toFixed(3)).toBe("10.000");

    const movimientos = await db.movimientoInventario.count({
      where: { inventarioId: fixture.inventarios.a1ProdA1.id },
    });
    expect(movimientos).toBe(0);
  });

  it("rejects an empty motivo with MOTIVO_VACIO without touching the database", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);

    const result = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodA1.id,
        cantidad: "-1",
        motivo: "   ",
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: "MOTIVO_VACIO",
      message: expect.any(String),
    });

    const db = getHarnessDb();
    const inventario = await db.inventario.findUnique({
      where: { id: fixture.inventarios.a1ProdA1.id },
    });
    expect(inventario?.cantidad.toFixed(3)).toBe("10.000");
    const movimientos = await db.movimientoInventario.count({
      where: { inventarioId: fixture.inventarios.a1ProdA1.id },
    });
    expect(movimientos).toBe(0);
  });

  it("rejects a product outside the caller tenant with INVENTARIO_NO_ENCONTRADO and leaves B1 untouched", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);

    const result = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodB1.id,
        cantidad: "5",
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
    // No phantom inventory row must have been created under empresa A.
    const phantom = await db.inventario.findFirst({
      where: { productoId: fixture.productos.prodB1.id, sucursalId: fixture.sucursalA1.id },
    });
    expect(phantom).toBeNull();
  });
});
