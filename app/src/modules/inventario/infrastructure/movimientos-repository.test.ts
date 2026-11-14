/**
 * Repository unit test — movement history reads (odd/tasks/inventario-historial.md S3/S4).
 * A recording fake `tx` stands in for Prisma: the assertions are about the QUERY the
 * repository builds (tenant anchor, filters, select, order, paging) and the row mapping.
 * The real-database proof lives in src/integration/inventario-movimientos.integration.test.ts.
 */

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  contarMovimientosEnTx,
  listarMovimientosEnTx,
  type MovimientosFiltros,
} from "./movimientos-repository";

const ctx: TenantCtx = { empresaId: 7, sucursalId: 3, usuarioId: 11, esAdmin: true };

const filtros: MovimientosFiltros = {
  inicio: new Date("2026-11-01T04:00:00.000Z"),
  fin: new Date("2026-11-11T04:00:00.000Z"),
};

function fakeTx(rows: unknown[] = [], total = 0) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(total);
  const tx = { movimientoInventario: { findMany, count } } as unknown as PrismaTx;
  return { tx, findMany, count };
}

describe("listarMovimientosEnTx", () => {
  it("anchors on the session branch AND its empresa inside the query itself", async () => {
    const { tx, findMany } = fakeTx();
    await listarMovimientosEnTx(tx, ctx, filtros, { page: 1, limit: 25 });

    const where = findMany.mock.calls[0][0].where;
    expect(where.inventario).toEqual({ sucursalId: 3, sucursal: { empresaId: 7 } });
    expect(where.fecha).toEqual({ gte: filtros.inicio, lt: filtros.fin });
    expect(where.tipoMovimiento).toBeUndefined();
  });

  it("adds the tipo filter and a case-insensitive contains over codigo OR nombre", async () => {
    const { tx, findMany } = fakeTx();
    await listarMovimientosEnTx(
      tx,
      ctx,
      { ...filtros, tipo: "AJUSTE", producto: "Arr" },
      { page: 1, limit: 25 },
    );

    const where = findMany.mock.calls[0][0].where;
    expect(where.tipoMovimiento).toBe("AJUSTE");
    expect(where.inventario).toEqual({
      sucursalId: 3,
      sucursal: { empresaId: 7 },
      producto: {
        OR: [
          { codigo: { contains: "Arr", mode: "insensitive" } },
          { nombre: { contains: "Arr", mode: "insensitive" } },
        ],
      },
    });
  });

  it("escapes LIKE wildcards so % and _ in the text match literally", async () => {
    const { tx, findMany } = fakeTx();
    await listarMovimientosEnTx(tx, ctx, { ...filtros, producto: "100%_a\\b" }, { page: 1, limit: 25 });

    const or = findMany.mock.calls[0][0].where.inventario.producto.OR;
    expect(or[0].codigo.contains).toBe("100\\%\\_a\\\\b");
    expect(or[1].nombre.contains).toBe("100\\%\\_a\\\\b");
  });

  it("renders a missing usuario (row hidden by RLS: user of another branch) as null, never throws", async () => {
    const { tx } = fakeTx([
      {
        id: 1,
        fecha: new Date("2026-11-05T15:00:00.000Z"),
        tipoMovimiento: "AJUSTE",
        motivo: "m",
        cantidadMovida: new Prisma.Decimal("1"),
        cantidadAnterior: new Prisma.Decimal("1"),
        cantidadNueva: new Prisma.Decimal("2"),
        usuario: null,
        inventario: { producto: { codigo: "P-1", nombre: "Arroz" } },
      },
    ]);
    const rows = await listarMovimientosEnTx(tx, ctx, filtros, { page: 1, limit: 25 });

    expect(rows[0].usuarioNombre).toBeNull();
  });

  it("orders fecha desc, id desc and pages with skip/take", async () => {
    const { tx, findMany } = fakeTx();
    await listarMovimientosEnTx(tx, ctx, filtros, { page: 3, limit: 25 });

    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ fecha: "desc" }, { id: "desc" }]);
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
  });

  it("uses an explicit select that never reaches idempotencyKey, costs or other columns", async () => {
    const { tx, findMany } = fakeTx();
    await listarMovimientosEnTx(tx, ctx, filtros, { page: 1, limit: 25 });

    const select = findMany.mock.calls[0][0].select;
    expect(findMany.mock.calls[0][0].include).toBeUndefined();
    expect(select).toEqual({
      id: true,
      fecha: true,
      tipoMovimiento: true,
      motivo: true,
      cantidadMovida: true,
      cantidadAnterior: true,
      cantidadNueva: true,
      usuario: { select: { nombre: true } },
      inventario: { select: { producto: { select: { codigo: true, nombre: true } } } },
    });
    expect(JSON.stringify(select)).not.toMatch(/idempotencyKey|costo|precio/i);
  });

  it("maps rows: Decimals as strings, fecha as ISO, flat producto/usuario", async () => {
    const { tx } = fakeTx([
      {
        id: 9,
        fecha: new Date("2026-11-05T15:00:00.000Z"),
        tipoMovimiento: "SALIDA_VENTA",
        motivo: "Venta #1",
        cantidadMovida: new Prisma.Decimal("-2.500"),
        cantidadAnterior: new Prisma.Decimal("10.000"),
        cantidadNueva: new Prisma.Decimal("7.500"),
        usuario: { nombre: "Ana" },
        inventario: { producto: { codigo: "P-1", nombre: "Arroz" } },
      },
    ]);
    const rows = await listarMovimientosEnTx(tx, ctx, filtros, { page: 1, limit: 25 });

    expect(rows).toEqual([
      {
        id: 9,
        fecha: "2026-11-05T15:00:00.000Z",
        tipo: "SALIDA_VENTA",
        productoCodigo: "P-1",
        productoNombre: "Arroz",
        cantidadMovida: "-2.5",
        cantidadAnterior: "10",
        cantidadNueva: "7.5",
        usuarioNombre: "Ana",
        motivo: "Venta #1",
      },
    ]);
    expect(typeof rows[0].cantidadMovida).toBe("string");
  });
});

describe("contarMovimientosEnTx", () => {
  it("counts with EXACTLY the same where as the page query", async () => {
    const { tx, findMany, count } = fakeTx([], 4);
    const f: MovimientosFiltros = { ...filtros, tipo: "AJUSTE", producto: "x" };
    await listarMovimientosEnTx(tx, ctx, f, { page: 1, limit: 25 });
    const total = await contarMovimientosEnTx(tx, ctx, f);

    expect(total).toBe(4);
    expect(count).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0][0]).toEqual({ where: findMany.mock.calls[0][0].where });
  });
});
