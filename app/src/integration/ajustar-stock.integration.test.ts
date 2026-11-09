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
        claveIdempotencia: "k-rationtestts-31",
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
        claveIdempotencia: "k-rationtestts-78",
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

  it("accepts an entry that lands exactly on the column ceiling and rejects one thousandth more, rolling back", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);
    const db = getHarnessDb();

    // Stock is 10.000; +999999989.999 lands exactly on 999999999.999 (Decimal(12,3) max).
    const enElTecho = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodA1.id,
        cantidad: "999999989.999",
        motivo: "Entrada hasta el techo",
        claveIdempotencia: "k-rationtestts-109",
      }),
    );
    expect(enElTecho.ok).toBe(true);

    const pasado = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodA1.id,
        cantidad: "0.001",
        motivo: "Una milesima de mas",
        claveIdempotencia: "k-rationtestts-118",
      }),
    );
    expect(pasado).toEqual({
      ok: false,
      code: "STOCK_MAXIMO_EXCEDIDO",
      message: expect.any(String),
    });

    const inventario = await db.inventario.findUnique({
      where: { id: fixture.inventarios.a1ProdA1.id },
    });
    expect(inventario?.cantidad.toFixed(3)).toBe("999999999.999");
    const movimientos = await db.movimientoInventario.count({
      where: { inventarioId: fixture.inventarios.a1ProdA1.id },
    });
    expect(movimientos).toBe(1);
  });

  it("applies a repeated request once: the replay returns the first result and writes nothing", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);
    const db = getHarnessDb();
    const input = {
      productoId: fixture.productos.prodA1.id,
      cantidad: "4",
      motivo: "Reintento del mismo clic",
      claveIdempotencia: "idem-replay-0001",
    };

    const primero = await withTenantTransaction(ctx, (tx) => ajustarInventario(tx, ctx, input));
    const repetido = await withTenantTransaction(ctx, (tx) => ajustarInventario(tx, ctx, input));

    expect(primero).toEqual({
      ok: true,
      data: {
        inventarioId: fixture.inventarios.a1ProdA1.id,
        productoId: fixture.productos.prodA1.id,
        cantidadAnterior: "10.000",
        cantidadNueva: "14.000",
      },
    });
    // Same answer as the first call, NOT 14.000 -> 18.000.
    expect(repetido).toEqual(primero);

    const inventario = await db.inventario.findUnique({
      where: { id: fixture.inventarios.a1ProdA1.id },
    });
    expect(inventario?.cantidad.toFixed(3)).toBe("14.000");
    const movimientos = await db.movimientoInventario.findMany({
      where: { inventarioId: fixture.inventarios.a1ProdA1.id },
    });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].idempotencyKey).toBe("idem-replay-0001");
    const auditorias = await db.movimientoAuditoria.count({
      where: { idEntidad: String(fixture.inventarios.a1ProdA1.id), entidad: "Inventario", accion: "AJUSTAR" },
    });
    expect(auditorias).toBe(1);
  });

  it("refuses the same key with a different amount (IDEMPOTENCIA_CONFLICTO) and changes nothing", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);
    const db = getHarnessDb();
    const base = {
      productoId: fixture.productos.prodA1.id,
      motivo: "Misma clave",
      claveIdempotencia: "idem-conflict-0002",
    };

    const primero = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, { ...base, cantidad: "4" }),
    );
    const distinto = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, { ...base, cantidad: "5" }),
    );

    expect(primero.ok).toBe(true);
    expect(distinto).toEqual({
      ok: false,
      code: "IDEMPOTENCIA_CONFLICTO",
      message: expect.any(String),
    });
    const inventario = await db.inventario.findUnique({
      where: { id: fixture.inventarios.a1ProdA1.id },
    });
    expect(inventario?.cantidad.toFixed(3)).toBe("14.000");
    expect(
      await db.movimientoInventario.count({ where: { inventarioId: fixture.inventarios.a1ProdA1.id } }),
    ).toBe(1);
  });

  it("scopes the key to the inventory row: the same key on another product is a separate adjustment", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);
    const db = getHarnessDb();
    const clave = "idem-scope-0003";

    const enA1 = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodA1.id,
        cantidad: "1",
        motivo: "Producto uno",
        claveIdempotencia: clave,
      }),
    );
    const enOtro = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodA2Only.id,
        cantidad: "1",
        motivo: "Producto dos",
        claveIdempotencia: clave,
      }),
    );

    expect(enA1.ok).toBe(true);
    expect(enOtro.ok).toBe(true);
    const claves = await db.movimientoInventario.findMany({
      where: { idempotencyKey: clave },
      select: { inventarioId: true },
    });
    expect(new Set(claves.map((c) => c.inventarioId)).size).toBe(2);
  });

  it("rejects an empty motivo with MOTIVO_VACIO without touching the database", async () => {
    const ctx = ctxFor(fixture, fixture.usuarios.adminA.id);

    const result = await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId: fixture.productos.prodA1.id,
        cantidad: "-1",
        motivo: "   ",
        claveIdempotencia: "k-rationtestts-144",
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
        claveIdempotencia: "k-rationtestts-172",
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
