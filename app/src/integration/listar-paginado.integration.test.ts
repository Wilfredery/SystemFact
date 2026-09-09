/**
 * Integration tests — paginated, tenant-scoped inventory listing.
 *
 * Seeds 30 products with inventory in Empresa A / Sucursal A1 plus one product
 * in Empresa B / Sucursal B1, then verifies pagination, stable ordering and
 * that the query never crosses the tenant boundary.
 */

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  contarInventarioEnTx,
  listarInventarioEnTx,
} from "@/modules/inventario/infrastructure/inventario-repository";
import { getHarnessDb } from "./setup/fixtures";

const TOTAL_A1 = 30;

interface PaginadoFixture {
  empresaAId: number;
  sucursalA1Id: number;
  usuarioAId: number;
  empresaBId: number;
  sucursalB1Id: number;
  usuarioBId: number;
  /** Product codes of A1 in seeded order (PG-000..PG-029). */
  codigosA1: string[];
  prodB1Codigo: string;
}

async function seedPaginadoFixture(): Promise<PaginadoFixture> {
  const db = getHarnessDb();
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const empresaA = await db.empresa.create({
    data: {
      nombreComercial: `PagA-${suffix}`,
      rnc: `RNC-PAGA-${suffix}`,
      razonSocial: `PagA-${suffix}`,
      direccionFiscal: "x",
      telefono: "0",
      correo: "paga@integration.test",
      logo: "",
      regimenFiscal: "NORMAL",
    },
  });
  const sucursalA1 = await db.sucursal.create({
    data: { empresaId: empresaA.id, nombre: "A1", direccion: "x", telefono: "0" },
  });
  const usuarioA = await db.usuario.create({
    data: {
      empresaId: empresaA.id,
      sucursalId: sucursalA1.id,
      nombre: "User A",
      nombreUsuario: `paguser-a-${suffix}`,
      passwordHash: "test-hash",
    },
  });

  const empresaB = await db.empresa.create({
    data: {
      nombreComercial: `PagB-${suffix}`,
      rnc: `RNC-PAGB-${suffix}`,
      razonSocial: `PagB-${suffix}`,
      direccionFiscal: "x",
      telefono: "0",
      correo: "pagb@integration.test",
      logo: "",
      regimenFiscal: "NORMAL",
    },
  });
  const sucursalB1 = await db.sucursal.create({
    data: { empresaId: empresaB.id, nombre: "B1", direccion: "x", telefono: "0" },
  });
  const usuarioB = await db.usuario.create({
    data: {
      empresaId: empresaB.id,
      sucursalId: sucursalB1.id,
      nombre: "User B",
      nombreUsuario: `paguser-b-${suffix}`,
      passwordHash: "test-hash",
    },
  });

  const catA = await db.categoria.create({
    data: { empresaId: empresaA.id, nombre: `catPagA-${suffix}` },
  });
  const catB = await db.categoria.create({
    data: { empresaId: empresaB.id, nombre: `catPagB-${suffix}` },
  });

  const itbisDesde = new Date();
  const codigosA1 = Array.from({ length: TOTAL_A1 }, (_, i) => `PG-${String(i).padStart(3, "0")}-${suffix}`);

  await db.producto.createMany({
    data: codigosA1.map((codigo) => ({
      empresaId: empresaA.id,
      categoriaId: catA.id,
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
      itbisVigenteDesde: itbisDesde,
    })),
  });
  const productosA1 = await db.producto.findMany({
    where: { empresaId: empresaA.id, categoriaId: catA.id },
    select: { id: true },
  });
  await db.inventario.createMany({
    data: productosA1.map((p) => ({
      sucursalId: sucursalA1.id,
      productoId: p.id,
      cantidad: new Prisma.Decimal("1.000"),
    })),
  });

  const prodB1 = await db.producto.create({
    data: {
      empresaId: empresaB.id,
      categoriaId: catB.id,
      nombre: `PGB1-${suffix}`,
      codigo: `PGB1-${suffix}`,
      codigoBarras: `BC-PGB1-${suffix}`,
      unidadMedida: "u",
      unidadEmpaque: "c",
      stockMinimo: 0,
      precioCompra: new Prisma.Decimal(0),
      precioVenta: new Prisma.Decimal(0),
      costoPromedio: new Prisma.Decimal(0),
      tasaItbis: new Prisma.Decimal(18),
      itbisVigenteDesde: itbisDesde,
    },
  });
  await db.inventario.create({
    data: { sucursalId: sucursalB1.id, productoId: prodB1.id, cantidad: new Prisma.Decimal("9.000") },
  });

  return {
    empresaAId: empresaA.id,
    sucursalA1Id: sucursalA1.id,
    usuarioAId: usuarioA.id,
    empresaBId: empresaB.id,
    sucursalB1Id: sucursalB1.id,
    usuarioBId: usuarioB.id,
    codigosA1,
    prodB1Codigo: prodB1.codigo,
  };
}

describe("listarInventarioEnTx pagination (real DB)", () => {
  let fixture: PaginadoFixture;

  beforeEach(async () => {
    fixture = await seedPaginadoFixture();
  });

  it("returns 25 rows on page 1 with stable codigo-asc ordering", async () => {
    const ctx: TenantCtx = {
      empresaId: fixture.empresaAId,
      sucursalId: fixture.sucursalA1Id,
      usuarioId: fixture.usuarioAId,
      esAdmin: false,
    };
    const rows = await withTenantTransaction(ctx, (tx: PrismaTx) =>
      listarInventarioEnTx(tx, ctx, { page: 1, limit: 25 }),
    );

    expect(rows).toHaveLength(25);
    const sortedCodes = [...rows.map((r) => r.codigo)].sort((a, b) => (a < b ? -1 : 1));
    expect(rows.map((r) => r.codigo)).toEqual(sortedCodes);
    expect(rows[0]?.codigo).toBe(fixture.codigosA1[0]);
  });

  it("returns the remaining 5 rows on page 2 and the count matches the tenant scope", async () => {
    const ctx: TenantCtx = {
      empresaId: fixture.empresaAId,
      sucursalId: fixture.sucursalA1Id,
      usuarioId: fixture.usuarioAId,
      esAdmin: false,
    };
    const [page2, total] = await withTenantTransaction(ctx, async (tx: PrismaTx) => {
      const rows = await listarInventarioEnTx(tx, ctx, { page: 2, limit: 25 });
      const count = await contarInventarioEnTx(tx, ctx);
      return [rows, count] as const;
    });

    expect(page2).toHaveLength(5);
    const total2 = await withTenantTransaction(ctx, (tx: PrismaTx) => contarInventarioEnTx(tx, ctx));
    expect(total).toBe(30);
    expect(total2).toBe(30);
  });

  it("never crosses the tenant: empresa B sees only its own rows", async () => {
    const ctxB: TenantCtx = {
      empresaId: fixture.empresaBId,
      sucursalId: fixture.sucursalB1Id,
      usuarioId: fixture.usuarioBId,
      esAdmin: false,
    };
    const [rowsB, totalB] = await withTenantTransaction(ctxB, async (tx: PrismaTx) => {
      const rows = await listarInventarioEnTx(tx, ctxB, { page: 1, limit: 25 });
      const count = await contarInventarioEnTx(tx, ctxB);
      return [rows, count] as const;
    });

    expect(totalB).toBe(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.codigo).toBe(fixture.prodB1Codigo);
  });
});
