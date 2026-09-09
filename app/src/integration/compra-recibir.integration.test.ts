/**
 * Integration — purchase receipt wiring (fase-3-4b task 2.6) against the REAL
 * `systemfact_test` database via withTenantTransaction (app role + RLS).
 *
 * Requires the `sf-postgres` container on :5433 (blocked-environment otherwise).
 *
 * Covers the spec's receipt scenarios end-to-end: happy path (RECIBIDA, stock at
 * the session branch only, ENTRADA_COMPRA with compraId, one cost update, one
 * audit row), idempotent duplicate click, concurrent-receipt race (exactly one
 * commits → one inventory entry total), wrong-state rejection, branch/tenant
 * isolation, and that cancel-after-receipt stays frozen (TRANSICION_INVALIDA).
 *
 * Compra never writes stock/cost; all inventory effects are asserted to come
 * from inventario via the port — here we assert the persisted OUTCOME.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Prisma } from "@/generated/prisma/client";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { confirmarCompra } from "@/modules/compra/application/confirmar-compra";
import { cancelarCompra } from "@/modules/compra/application/cancelar-compra";
import { recibirCompra } from "@/modules/compra/application/recibir-compra";
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

/** A product with NO inventory rows anywhere and costoPromedio 0. */
async function crearProductoSinInventario(
  fixture: TenantFixture,
  codigo: string,
): Promise<number> {
  const db = getHarnessDb();
  const base = await db.producto.findUnique({
    where: { id: fixture.productos.prodA1.id },
    select: { empresaId: true, categoriaId: true },
  });
  const p = await db.producto.create({
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
  return p.id;
}

/**
 * Create + confirm a MERCANCIA purchase from a FORMAL legal supplier (zero
 * retentions, no config needed) at the session branch. Returns the PENDIENTE id.
 */
async function crearYConfirmar(
  ctx: TenantCtx,
  fixture: TenantFixture,
  productoIds: readonly number[],
): Promise<number> {
  const id = await withTenantTransaction(ctx, async (tx) => {
    const r = await crearCompra(tx, ctx, {
      proveedorId: fixture.proveedores.formalJuridica.id,
      tipoCompra: "MERCANCIA",
      fecha: new Date("2026-01-10T00:00:00.000Z"),
      ncf: null,
      lineas: productoIds.map((productoId) => ({
        productoId,
        cantidad: "10.000",
        costoUnitario: "100.00",
      })),
    });
    if (!r.ok) throw new Error(`create failed: ${r.code}`);
    return r.data.id;
  });
  await withTenantTransaction(ctx, (tx) => confirmarCompra(tx, ctx, { id }));
  return id;
}

describe("recibirCompra (real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA(fixture);
  });

  it("happy path: RECIBIDA, stock only at session branch, ENTRADA_COMPRA with compraId, one cost update, one audit row", async () => {
    const productoId = await crearProductoSinInventario(fixture, `RCV-${Date.now()}`);
    const compraId = await crearYConfirmar(ctx, fixture, [productoId]);

    const result = await withTenantTransaction(ctx, (tx) =>
      recibirCompra(tx, ctx, { id: compraId }),
    );
    expect(result).toEqual({
      ok: true,
      data: { id: compraId, estado: "RECIBIDA", movimientosAplicados: 1 },
    });

    const db = getHarnessDb();
    expect((await db.compra.findUnique({ where: { id: compraId } }))?.estado).toBe(
      "RECIBIDA",
    );
    // Stock entered at the session branch (A1) with the received quantity.
    const inv = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId },
    });
    expect(inv?.cantidad.toFixed(3)).toBe("10.000");
    // One ENTRADA_COMPRA movement carrying compraId.
    const movs = await db.movimientoInventario.findMany({
      where: { inventarioId: inv!.id },
    });
    expect(movs).toHaveLength(1);
    expect(movs[0].tipoMovimiento).toBe("ENTRADA_COMPRA");
    expect(movs[0].compraId).toBe(compraId);
    // First receipt on a zero-stock product sets CP to the net unit cost, exactly once.
    const prod = await db.producto.findUnique({ where: { id: productoId } });
    expect(prod?.costoPromedio.toFixed(2)).toBe("100.00");
    // One compra audit row for the receipt (valorNuevo RECIBIDA).
    const aud = await db.movimientoAuditoria.findMany({
      where: { entidad: "Compra", idEntidad: String(compraId) },
    });
    const receive = aud.filter((a) =>
      (a.valorNuevo ?? "").includes("RECIBIDA"),
    );
    expect(receive).toHaveLength(1);
  });

  it("R4 duplicate click: second receive conflicts and leaves stock/movements/cost unchanged", async () => {
    const productoId = await crearProductoSinInventario(fixture, `DUP2-${Date.now()}`);
    const compraId = await crearYConfirmar(ctx, fixture, [productoId]);

    const first = await withTenantTransaction(ctx, (tx) =>
      recibirCompra(tx, ctx, { id: compraId }),
    );
    expect(first.ok).toBe(true);

    const second = await withTenantTransaction(ctx, (tx) =>
      recibirCompra(tx, ctx, { id: compraId }),
    );
    expect(second.ok === false && second.code).toBe("CONCURRENCIA_CONFLICTO");

    const db = getHarnessDb();
    const inv = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId },
    });
    expect(inv?.cantidad.toFixed(3)).toBe("10.000"); // not doubled
    const movs = await db.movimientoInventario.count({ where: { compraId } });
    expect(movs).toBe(1);
    const prod = await db.producto.findUnique({ where: { id: productoId } });
    expect(prod?.costoPromedio.toFixed(2)).toBe("100.00"); // not reweighted
  });

  it("concurrent receipts race: exactly one commits, one inventory entry total", async () => {
    const productoId = await crearProductoSinInventario(fixture, `RACE-${Date.now()}`);
    const compraId = await crearYConfirmar(ctx, fixture, [productoId]);

    const [a, b] = await Promise.all([
      withTenantTransaction(ctx, (tx) => recibirCompra(tx, ctx, { id: compraId })),
      withTenantTransaction(ctx, (tx) => recibirCompra(tx, ctx, { id: compraId })),
    ]);

    const exitosos = [a, b].filter((r) => r.ok).length;
    const conflictos = [a, b].filter((r) => !r.ok && r.code === "CONCURRENCIA_CONFLICTO").length;
    expect(exitosos).toBe(1);
    expect(conflictos).toBe(1);

    const db = getHarnessDb();
    // Exactly one stock entry and one movement, despite two parallel requests.
    const movs = await db.movimientoInventario.count({ where: { compraId } });
    expect(movs).toBe(1);
    const inv = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId },
    });
    expect(inv?.cantidad.toFixed(3)).toBe("10.000");
    const prod = await db.producto.findUnique({ where: { id: productoId } });
    expect(prod?.costoPromedio.toFixed(2)).toBe("100.00");
  });

  it("wrong state (BORRADOR, not confirmed) is rejected with TRANSICION_INVALIDA and zero writes", async () => {
    const productoId = await crearProductoSinInventario(fixture, `BORR-${Date.now()}`);
    const id = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        ncf: null,
        lineas: [{ productoId, cantidad: "10.000", costoUnitario: "100.00" }],
      });
      if (!r.ok) throw new Error(r.code);
      return r.data.id;
    });

    const result = await withTenantTransaction(ctx, (tx) =>
      recibirCompra(tx, ctx, { id }),
    );
    expect(result.ok === false && result.code).toBe("TRANSICION_INVALIDA");

    const db = getHarnessDb();
    const inv = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId },
    });
    expect(inv).toBeNull();
  });

  it("cross-tenant receive (empresa B acting on an empresa A purchase) is rejected with zero writes", async () => {
    const productoId = await crearProductoSinInventario(fixture, `XT-${Date.now()}`);
    const compraId = await crearYConfirmar(ctx, fixture, [productoId]);

    const ctxB: TenantCtx = {
      empresaId: fixture.empresaB.id,
      sucursalId: fixture.sucursalB1.id,
      usuarioId: fixture.usuarios.adminB.id,
      esAdmin: true,
    };
    const result = await withTenantTransaction(ctxB, (tx) =>
      recibirCompra(tx, ctxB, { id: compraId }),
    );
    expect(result.ok === false && result.code).toBe("COMPRA_NO_ENCONTRADA");

    const db = getHarnessDb();
    const compra = await db.compra.findUnique({ where: { id: compraId } });
    expect(compra?.estado).toBe("PENDIENTE"); // untouched
    const movs = await db.movimientoInventario.count({ where: { compraId } });
    expect(movs).toBe(0);
  });

  it("cancel-after-receipt stays frozen: cancelar on a RECIBIDA purchase → TRANSICION_INVALIDA", async () => {
    const productoId = await crearProductoSinInventario(fixture, `CAN-${Date.now()}`);
    const compraId = await crearYConfirmar(ctx, fixture, [productoId]);
    await withTenantTransaction(ctx, (tx) => recibirCompra(tx, ctx, { id: compraId }));

    const result = await withTenantTransaction(ctx, (tx) =>
      cancelarCompra(tx, ctx, { id: compraId, motivo: "intento post-recepción" }),
    );
    expect(result.ok === false && result.code).toBe("TRANSICION_INVALIDA");

    const db = getHarnessDb();
    expect((await db.compra.findUnique({ where: { id: compraId } }))?.estado).toBe(
      "RECIBIDA",
    );
  });

  it("receive enters stock at ONLY the session branch when the same product also lives elsewhere", async () => {
    const db = getHarnessDb();
    const productoId = fixture.productos.prodA1.id; // 10 at A1, plus we add A2 = 40
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

    // A purchase of prodA1 (qty 50 @ 100 net) received at A1.
    const compraId = await crearYConfirmar(ctx, fixture, [productoId]); // 10.000 @ 100
    // Note crearYConfirmar uses cantidad 10.000; company stock 50, CP 80 →
    // (50*80 + 10*100)/(50+10) = (4000+1000)/60 = 83.33.
    const result = await withTenantTransaction(ctx, (tx) =>
      recibirCompra(tx, ctx, { id: compraId }),
    );
    expect(result.ok).toBe(true);

    const a1 = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA1.id, productoId },
    });
    const a2 = await db.inventario.findFirst({
      where: { sucursalId: fixture.sucursalA2.id, productoId },
    });
    expect(a1?.cantidad.toFixed(3)).toBe("20.000"); // 10 + 10 at session branch
    expect(a2?.cantidad.toFixed(3)).toBe("40.000"); // NOT touched
    const prod = await db.producto.findUnique({ where: { id: productoId } });
    expect(prod?.costoPromedio.toFixed(2)).toBe("83.33");
  });
});
