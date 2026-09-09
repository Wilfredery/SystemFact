/**
 * Integration — purchase-receipt inventory entry (fase-3-4b tasks 1.2 / 1.5)
 * against the REAL `systemfact_test` database via `withTenantTransaction`
 * (app role + RLS).
 *
 * Requires the `sf-postgres` container on :5433. When the DB is unavailable the
 * suite errors out (blocked-environment); it is NOT faked.
 *
 * A `Compra` row is seeded directly on the superuser harness client ONLY to
 * satisfy `MOVIMIENTO_INVENTARIO.compraId`'s foreign key — PR-1 does not wire the
 * compra receipt use case (that is PR-2); it realizes the inventario entry port.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Prisma } from "@/generated/prisma/client";
import {
  registrarEntradaCompra,
  registrarEntradasCompra,
} from "@/modules/inventario/application/registrar-entrada-compra";
import { ajustarInventario } from "@/modules/inventario/application/ajustar-inventario";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

function ctxA(fixture: TenantFixture): TenantCtx {
  return {
    empresaId: fixture.empresaA.id,
    sucursalId: fixture.sucursalA1.id,
    usuarioId: fixture.usuarios.adminA.id,
    esAdmin: true,
  };
}

/** Seed a minimal PENDIENTE compra of empresa A to satisfy the movement FK. */
async function seedCompra(fixture: TenantFixture): Promise<number> {
  const db = getHarnessDb();
  const compra = await db.compra.create({
    data: {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      proveedorId: fixture.proveedores.formalJuridica.id,
      usuarioId: fixture.usuarios.adminA.id,
      tipoCompra: "MERCANCIA",
      estado: "PENDIENTE",
      correlativoInterno: `CMP-INT-${Date.now()}`,
      subtotal: new Prisma.Decimal(0),
      subtotalGravado: new Prisma.Decimal(0),
      itbis: new Prisma.Decimal(0),
      subtotalExento: new Prisma.Decimal(0),
      retencionIsr: new Prisma.Decimal(0),
      retencionItbis: new Prisma.Decimal(0),
      total: new Prisma.Decimal(0),
      fecha: new Date("2026-01-10T00:00:00.000Z"),
    },
    select: { id: true },
  });
  return compra.id;
}

/**
 * Create a fresh empresa-A product with NO inventory rows in ANY branch and
 * costoPromedio 0. The "first receipt sets CP to the net unit cost" and
 * "duplicate lines aggregate over zero pre-receipt stock" scenarios require a
 * company-wide-zero starting stock; the shared fixture's products all carry at
 * least one branch inventory row, so a clean product must be created per test.
 */
async function crearProductoSinInventario(
  fixture: TenantFixture,
  codigo: string,
): Promise<number> {
  const db = getHarnessDb();
  const base = await db.producto.findUnique({
    where: { id: fixture.productos.prodA1.id },
    select: { empresaId: true, categoriaId: true },
  });
  const producto = await db.producto.create({
    data: {
      empresaId: base!.empresaId,
      categoriaId: base!.categoriaId,
      nombre: codigo,
      codigo,
      codigoBarras: `BC-${codigo}`,
      unidadMedida: "u",
      unidadEmpaque: "c",
      stockMinimo: 0,
      precioCompra: new Prisma.Decimal(0),
      precioVenta: new Prisma.Decimal(0),
      costoPromedio: new Prisma.Decimal(0),
      tasaItbis: new Prisma.Decimal(18),
      itbisVigenteDesde: new Date(),
    },
    select: { id: true },
  });
  return producto.id;
}

describe("registrarEntradaCompra (real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA(fixture);
  });

  it("entry for an UNSEEN product creates the branch row + one ENTRADA_COMPRA movement with compraId", async () => {
    const compraId = await seedCompra(fixture);
    // A product with NO inventory row in ANY branch and CP 0, so the receipt is
    // genuinely the first-ever company stock (denominator starts at zero).
    const productoId = await crearProductoSinInventario(fixture, `SIN-${Date.now()}`);

    const result = await withTenantTransaction(ctx, (tx) =>
      registrarEntradaCompra(tx, ctx, {
        productoId,
        compraId,
        cantidad: "25.000",
        costoUnitarioSinItbis: "10.00",
        motivo: "Recepción compra",
      }),
    );

    expect(result.ok).toBe(true);

    const db = getHarnessDb();
    // A new branch row was created at A1 (previously absent).
    const inventario = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId },
    });
    expect(inventario).not.toBeNull();
    expect(inventario?.cantidad.toFixed(3)).toBe("25.000");

    // Exactly one ENTRADA_COMPRA movement, carrying compraId, before 0 -> after 25.
    const movimientos = await db.movimientoInventario.findMany({
      where: { inventarioId: inventario!.id },
    });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].tipoMovimiento).toBe("ENTRADA_COMPRA");
    expect(movimientos[0].compraId).toBe(compraId);
    expect(movimientos[0].cantidadAnterior.toFixed(3)).toBe("0.000");
    expect(movimientos[0].cantidadNueva.toFixed(3)).toBe("25.000");
    expect(movimientos[0].cantidadMovida.toFixed(3)).toBe("25.000");

    // The unseen product had CP 0; first receipt sets it to the net unit cost.
    const producto = await db.producto.findUnique({ where: { id: productoId } });
    expect(producto?.costoPromedio.toFixed(2)).toBe("10.00");

    // One audit row for the entry.
    const auditoria = await db.movimientoAuditoria.findFirst({
      where: { entidad: "Inventario", idEntidad: String(inventario!.id) },
    });
    expect(auditoria?.accion).toBe("CREAR");
  });

  it("uses the ALL-BRANCH denominator for the company-wide cost (branch-A row is not the only stock)", async () => {
    const db = getHarnessDb();
    const productoId = fixture.productos.prodA1.id; // already 10 at A1

    // Give the SAME product 40 units at branch A2 and set CP = 80 pre-receipt,
    // so the company total (across branches) is 50, not branch A's 10.
    await db.inventario.create({
      data: {
        sucursalId: fixture.sucursalA2.id,
        productoId,
        cantidad: new Prisma.Decimal("40.000"),
      },
    });
    await db.producto.update({
      where: { id: productoId },
      data: { costoPromedio: new Prisma.Decimal("80.00") },
    });

    const compraId = await seedCompra(fixture);

    const result = await withTenantTransaction(ctx, (tx) =>
      registrarEntradaCompra(tx, ctx, {
        productoId,
        compraId,
        cantidad: "50.000",
        costoUnitarioSinItbis: "100.00",
        motivo: "Recepción compra multi-sucursal",
      }),
    );
    expect(result.ok).toBe(true);

    // (50*80 + 50*100)/(50+50) = 90.00. A single-branch denominator (10) would
    // give 96.67; a branch-only stock update would also mis-set A2.
    const producto = await db.producto.findUnique({ where: { id: productoId } });
    expect(producto?.costoPromedio.toFixed(2)).toBe("90.00");

    const a1 = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId },
    });
    expect(a1?.cantidad.toFixed(3)).toBe("60.000"); // 10 + 50 at session branch
    const a2 = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA2.id, productoId },
    });
    expect(a2?.cantidad.toFixed(3)).toBe("40.000"); // untouched (not the entry branch)
  });

  it("duplicate product lines in one batch accumulate into ONE cost update but keep one movement per line", async () => {
    const db = getHarnessDb();
    // Clean product with zero company-wide pre-receipt stock so the aggregate
    // weighted cost over both lines is exactly total value / total quantity.
    const productoId = await crearProductoSinInventario(fixture, `DUP-${Date.now()}`);
    const compraId = await seedCompra(fixture);

    await withTenantTransaction(ctx, (tx) =>
      registrarEntradasCompra(tx, ctx, {
        compraId,
        motivo: "Recepción con líneas duplicadas",
        lineas: [
          { productoId, cantidad: "10.000", costoUnitarioSinItbis: "100.00" },
          { productoId, cantidad: "10.000", costoUnitarioSinItbis: "200.00" },
        ],
      }),
    );

    const inventario = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId },
    });
    expect(inventario?.cantidad.toFixed(3)).toBe("20.000"); // 10 + 10
    // One movement per line.
    const movimientos = await db.movimientoInventario.count({
      where: { inventarioId: inventario!.id },
    });
    expect(movimientos).toBe(2);
    // One weighted cost over 20 net value 10*100 + 10*200 = 3000 -> 3000/20 = 150.
    const producto = await db.producto.findUnique({ where: { id: productoId } });
    expect(producto?.costoPromedio.toFixed(2)).toBe("150.00");
  });

  it("rejects a cross-tenant productoId with INVENTARIO_NO_ENCONTRADO and zero changes", async () => {
    const compraId = await seedCompra(fixture);
    const prodB1 = fixture.productos.prodB1.id; // belongs to empresa B

    const result = await withTenantTransaction(ctx, (tx) =>
      registrarEntradaCompra(tx, ctx, {
        productoId: prodB1,
        compraId,
        cantidad: "5.000",
        costoUnitarioSinItbis: "100.00",
        motivo: "Intento cross-tenant",
      }),
    );

    expect(result).toEqual({
      ok: false,
      code: "INVENTARIO_NO_ENCONTRADO",
      message: expect.any(String),
    });

    const db = getHarnessDb();
    // B's inventory untouched.
    const b1 = await db.inventario.findUnique({
      where: { id: fixture.inventarios.b1ProdB1.id },
    });
    expect(b1?.cantidad.toFixed(3)).toBe("7.000");
    // No phantom row created under empresa A for B's product.
    const phantom = await db.inventario.findFirst({
      where: { productoId: prodB1, sucursalId: fixture.sucursalA1.id },
    });
    expect(phantom).toBeNull();
    // No movement referencing the compra at all.
    const movs = await db.movimientoInventario.count({ where: { compraId } });
    expect(movs).toBe(0);
  });

  it("a later failed line rolls back the whole batch (mid-line failure rolls back)", async () => {
    const db = getHarnessDb();
    const compraId = await seedCompra(fixture);
    const productoOk = fixture.productos.prodA2Only.id; // valid at A1
    const productoMalo = fixture.productos.prodB1.id; // empresa B -> rejected in guard phase

    await expect(
      withTenantTransaction(ctx, async (tx) => {
        const r = await registrarEntradasCompra(tx, ctx, {
          compraId,
          motivo: "Batch con línea inválida",
          // The foreign product is rejected in the ownership-guard phase (before
          // any stock/movement/cost write), so the good line must not persist.
          lineas: [
            { productoId: productoOk, cantidad: "10.000", costoUnitarioSinItbis: "50.00" },
            { productoId: productoMalo, cantidad: "10.000", costoUnitarioSinItbis: "50.00" },
          ],
        });
        return r;
      }),
    ).rejects.toMatchObject({ code: "INVENTARIO_NO_ENCONTRADO" });

    // The valid product's branch row must NOT exist (the whole tx rolled back).
    const inventarioOk = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId: productoOk },
    });
    expect(inventarioOk).toBeNull();
    // prodA2Only's CP was set to 0 by the first receipt in an earlier green run
    // would not apply here: it must still be the fixture default 0.00.
    const producto = await db.producto.findUnique({ where: { id: productoOk } });
    expect(producto?.costoPromedio.toFixed(2)).toBe("0.00");
    // No movement for the aborted compra.
    const movs = await db.movimientoInventario.count({ where: { compraId } });
    expect(movs).toBe(0);
  });

  it("serializes two concurrent receipts of the SAME product (no lost cost update)", async () => {
    const db = getHarnessDb();
    // Clean product with zero company-wide pre-receipt stock so the weighted
    // average over both concurrent receipts is order-independent:
    //   (10*100 + 10*200) / 20 = 150.00. Without the PRODUCTO row lock both
    //   transactions would read CP=0/stock=0 and the last writer would win,
    //   persisting 100.00 or 200.00 (a lost update) instead of 150.00.
    const productoId = await crearProductoSinInventario(fixture, `SER-${Date.now()}`);
    const compraA = await seedCompra(fixture);
    const compraB = await seedCompra(fixture);

    await Promise.all([
      withTenantTransaction(ctx, (tx) =>
        registrarEntradasCompra(tx, ctx, {
          compraId: compraA,
          motivo: "Recepción concurrente A",
          lineas: [{ productoId, cantidad: "10.000", costoUnitarioSinItbis: "100.00" }],
        }),
      ),
      withTenantTransaction(ctx, (tx) =>
        registrarEntradasCompra(tx, ctx, {
          compraId: compraB,
          motivo: "Recepción concurrente B",
          lineas: [{ productoId, cantidad: "10.000", costoUnitarioSinItbis: "200.00" }],
        }),
      ),
    ]);

    // Company-wide cost reflects BOTH receipts applied sequentially (serialized).
    const producto = await db.producto.findUnique({ where: { id: productoId } });
    expect(producto?.costoPromedio.toFixed(2)).toBe("150.00");
    // Both inbound quantities landed (20 units) via two movements at the branch.
    const inventario = await db.inventario.findFirst({
      where: { sucursalId: ctx.sucursalId, productoId },
    });
    expect(inventario?.cantidad.toFixed(3)).toBe("20.000");
    const movimientos = await db.movimientoInventario.count({
      where: { inventarioId: inventario!.id },
    });
    expect(movimientos).toBe(2);
  });

  it("the manual-adjustment path still never mutates costoPromedio (3.4a boundary)", async () => {
    const db = getHarnessDb();
    const productoId = fixture.productos.prodA1.id;
    await db.producto.update({
      where: { id: productoId },
      data: { costoPromedio: new Prisma.Decimal("55.00") },
    });

    await withTenantTransaction(ctx, (tx) =>
      ajustarInventario(tx, ctx, {
        productoId,
        cantidad: "-1.000",
        motivo: "Ajuste manual de conteo",
      }),
    );

    const producto = await db.producto.findUnique({ where: { id: productoId } });
    // Manual adjustment moves stock but leaves the weighted cost untouched.
    expect(producto?.costoPromedio.toFixed(2)).toBe("55.00");
  });
});
