/**
 * Shared seeding helpers for the venta integration suites.
 *
 * These are ADDITIVE test tooling (they do NOT change `seedTenantFixture` or any
 * existing fixture data — per the venta-config R-C2 note that the seed must not
 * touch existing fixtures). The `PRODUCTO` table has several NOT NULL columns the
 * base fixture fills (codigoBarras, unidadMedida, unidadEmpaque, stockMinimo,
 * precioCompra, costoPromedio); venta tests create extra priced/expired-rate
 * products constantly, so this one builder keeps them valid and terse.
 */

import { Prisma } from "@/generated/prisma/client";
import { getHarnessDb } from "./fixtures";

export interface ProductoVentaSpec {
  readonly empresaId: number;
  readonly categoriaId: number;
  readonly codigo: string;
  /** ITBIS rate (18 / 16 / 0). */
  readonly tasa?: number;
  /** ITBIS-exclusive unit price (default "100.00"). */
  readonly precioVenta?: string;
  /** Upper bound of the rate's validity window; `null` = open-ended. */
  readonly vigenciaHasta?: Date | null;
}

/** Create a valid PRODUCTO row with the fields the base fixture would fill. */
export async function crearProductoVenta(
  spec: ProductoVentaSpec,
): Promise<{ id: number }> {
  const db = getHarnessDb();
  const nombre = `prod-${spec.codigo}`;
  return db.producto.create({
    data: {
      empresaId: spec.empresaId,
      categoriaId: spec.categoriaId,
      codigo: spec.codigo,
      nombre,
      codigoBarras: `BC-${spec.codigo}`,
      unidadMedida: "u",
      unidadEmpaque: "c",
      stockMinimo: 0,
      precioCompra: new Prisma.Decimal(0),
      precioVenta: new Prisma.Decimal(spec.precioVenta ?? "100.00"),
      costoPromedio: new Prisma.Decimal(0),
      tasaItbis: new Prisma.Decimal(spec.tasa ?? 18),
      itbisVigenteDesde: new Date("2000-01-01T00:00:00.000Z"),
      ...(spec.vigenciaHasta ? { itbisVigenteHasta: spec.vigenciaHasta } : {}),
    },
    select: { id: true },
  });
}

/** Seed branch stock for a product (creates or sets the INVENTARIO row). */
export async function fijarStock(
  sucursalId: number,
  productoId: number,
  cantidad: string,
): Promise<void> {
  const db = getHarnessDb();
  await db.inventario.upsert({
    where: { sucursalId_productoId: { sucursalId, productoId } },
    update: { cantidad: new Prisma.Decimal(cantidad) },
    create: { sucursalId, productoId, cantidad: new Prisma.Decimal(cantidad) },
  });
}

/** The empresa-A categoria id from the base fixture. */
export async function categoriaA(empresaAId: number): Promise<number> {
  const db = getHarnessDb();
  const cat = await db.categoria.findFirst({ where: { empresaId: empresaAId } });
  if (cat === null) throw new Error("categoria A missing from fixture");
  return cat.id;
}
