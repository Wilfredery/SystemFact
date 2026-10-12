/**
 * Integration — M1 batched product-ownership guard (R-INV-B1) against the
 * REAL `systemfact_test` database via `withTenantTransaction` (app role + RLS).
 *
 * Pins the two guard modes on the purchase-entry path:
 *   1. a 40-product listing-guard batch executes EXACTLY ONE ownership query
 *      (N+1 replaced: `tx.producto.findMany` called once, `findFirst` never);
 *   2. a foreign-tenant id among owned ones is denied BY DEFAULT, the typed
 *      error names ONLY the missing id, and nothing is written.
 *
 * The `FOR UPDATE` per-row lock loops are NOT exercised here — they are the
 * locking invariant untouched by this change (R-INV-B1's locking scenario is a
 * code diff/grep guard, which the PR carries).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { Prisma } from "@/generated/prisma/client";
import { registrarEntradasCompraEnTx } from "@/modules/inventario/infrastructure/inventario-repository";
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

/** Fresh owned (empresa-A) product for a batch line, zero pre-receipt stock. */
async function crearProductoOwned(
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

/** The PRODUCTO-delegate call record the batched-guard assertion reads. */
interface CensusProducto {
  findMany: number;
  findFirst: number;
}

/**
 * A tx lens that PRESERVES all behavior (property getters delegated) while
 * counting `producto.findMany`/`findFirst` calls into the supplied census —
 * the ownership-query counter the R-INV-B1 scenario asserts. The batching
 * ships as `calls.findMany === 1` and `calls.findFirst === 0` on the
 * 40-product batch (N+1 replaced).
 */
function txContandoProducto(
  tx: PrismaTx,
  calls: CensusProducto,
): PrismaTx {
  const bridge = tx.producto as unknown as {
    findMany: (args: never, extra?: unknown) => unknown;
    findFirst: (args: never, extra?: unknown) => unknown;
  };
  const producto: unknown = new Proxy(tx.producto as object, {
    get(target, prop, receiver) {
      if (prop === "findMany") {
        return (first: unknown) => {
          calls.findMany += 1;
          return bridge.findMany(first as never);
        };
      }
      if (prop === "findFirst") {
        return (first: unknown) => {
          calls.findFirst += 1;
          return bridge.findFirst(first as never);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return Object.create(tx as object, {
    producto: { value: producto, writable: true, configurable: true },
  }) as PrismaTx;
}

describe("guardarPertenenciaProductosEnTx — batched ownership guard (R-INV-B1, real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxA(fixture);
  });

  it("a 40-product batch resolves the guard in EXACTLY ONE ownership query (no N+1 findFirst loop)", async () => {
    const compraId = await seedCompra(fixture);
    const productos: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      productos.push(await crearProductoOwned(fixture, `BATCH-GUARD-${Date.now()}-${i}`));
    }
    const lineas = productos.map((productoId) => ({
      productoId,
      cantidad: "0.100",
      costoUnitarioSinItbis: "1.00",
    }));

    const calls: CensusProducto = { findMany: 0, findFirst: 0 };
    const resultado = await withTenantTransaction(ctx, (tx) => {
      const lente = txContandoProducto(tx, calls);
      return registrarEntradasCompraEnTx(lente, ctx, {
        compraId,
        motivo: "Recepcion de lote de 40 productos",
        lineas,
      });
    });

    expect(resultado).toHaveLength(40);
    expect(calls.findMany).toBe(1);
    expect(calls.findFirst).toBe(0);
  });

  it("a foreign id among owned ones is denied by DEFAULT naming ONLY that id, with zero writes", async () => {
    const compraId = await seedCompra(fixture);
    const ownedIds: number[] = [];
    for (let i = 0; i < 39; i += 1) {
      ownedIds.push(await crearProductoOwned(fixture, `DENY-GUARD-${Date.now()}-${i}`));
    }
    // The empresa-B fixture product: owned by ANOTHER tenant, never the caller's.
    const foreignId = fixture.productos.prodB1.id;
    const lineas = [...ownedIds, foreignId].map((productoId) => ({
      productoId,
      cantidad: "0.100",
      costoUnitarioSinItbis: "1.00",
    }));

    await expect(
      withTenantTransaction(ctx, (tx) =>
        registrarEntradasCompraEnTx(tx, ctx, {
          compraId,
          motivo: "Intento cross-tenant con un id ajeno",
          lineas,
        }),
      ),
    ).rejects.toMatchObject({
      name: "InventarioDomainError",
      code: "INVENTARIO_NO_ENCONTRADO",
      details: { productoId: foreignId },
    });

    const db = getHarnessDb();
    const movimientos = await db.movimientoInventario.count({
      where: { compraId },
    });
    expect(movimientos).toBe(0);
  });
});
