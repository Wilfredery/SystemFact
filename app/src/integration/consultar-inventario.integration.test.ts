/**
 * Integration tests — Inventario consulta (products + branch stock + status
 * filters + KPI cards) against the real `systemfact_test` database via
 * withTenantTransaction (app role + RLS).
 */

import { Prisma } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { consultarInventario } from "@/modules/inventario/application/consultar-inventario";
import { classifyStockKpi } from "@/modules/inventario/domain/inventario";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

function ctxFor(fixture: TenantFixture): TenantCtx {
  return {
    empresaId: fixture.empresaA.id,
    sucursalId: fixture.sucursalA1.id,
    usuarioId: fixture.usuarios.adminA.id,
    esAdmin: true,
  };
}

describe("consultarInventario (real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;
  let categoriaId: number;
  let otraCategoriaId: number;

  async function crearProducto(
    codigo: string,
    nombre: string,
    opts: { categoriaId: number; stockMinimo: number; cantidad?: string; costo?: string; activo?: boolean },
  ) {
    const db = getHarnessDb();
    const producto = await db.producto.create({
      data: {
        empresaId: fixture.empresaA.id,
        categoriaId: opts.categoriaId,
        nombre,
        codigo,
        codigoBarras: `BC-${codigo}`,
        unidadMedida: "UND",
        unidadEmpaque: "c",
        stockMinimo: opts.stockMinimo,
        precioCompra: new Prisma.Decimal(0),
        precioVenta: new Prisma.Decimal(0),
        costoPromedio: new Prisma.Decimal(opts.costo ?? "0"),
        tasaItbis: new Prisma.Decimal(18),
        itbisVigenteDesde: new Date(),
        activo: opts.activo ?? true,
      },
    });
    if (opts.cantidad !== undefined) {
      await db.inventario.create({
        data: {
          sucursalId: fixture.sucursalA1.id,
          productoId: producto.id,
          cantidad: new Prisma.Decimal(opts.cantidad),
        },
      });
    }
    return producto;
  }

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = ctxFor(fixture);
    const db = getHarnessDb();
    const prodA1 = await db.producto.findUniqueOrThrow({ where: { id: fixture.productos.prodA1.id } });
    categoriaId = prodA1.categoriaId;
    const otra = await db.categoria.create({
      data: { empresaId: fixture.empresaA.id, nombre: `otra-${Date.now()}` },
    });
    otraCategoriaId = otra.id;
    // prodA1 (fixture): stock 10, minimo 0 -> normal. Add the rest of the matrix.
    await crearProducto("Z-BAJO", "Aceite Vegetal", { categoriaId: otraCategoriaId, stockMinimo: 15, cantidad: "8", costo: "100.00" });
    await crearProducto("Z-IGUAL", "Azucar 100%_pura", { categoriaId, stockMinimo: 5, cantidad: "5", costo: "10.50" });
    await crearProducto("Z-CERO", "Leche Entera", { categoriaId: otraCategoriaId, stockMinimo: 10, cantidad: "0", costo: "50.00" });
    await crearProducto("Z-SINFILA", "Sin fila de inventario", { categoriaId, stockMinimo: 3, costo: "7.00" });
    await crearProducto("Z-INACTIVO", "Producto inactivo", { categoriaId, stockMinimo: 1, cantidad: "99", costo: "1.00", activo: false });
  });

  const consultar = (query: Parameters<typeof consultarInventario>[2]) =>
    withTenantTransaction(ctx, (tx) => consultarInventario(tx, ctx, query));

  it("lists active products with branch stock; inactive products and other companies never appear", async () => {
    const result = await consultar({ page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const codigos = result.data.items.map((i) => i.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["Z-BAJO", "Z-IGUAL", "Z-CERO", "Z-SINFILA"]));
    expect(codigos).not.toContain("Z-INACTIVO");
    expect(codigos.some((c) => c.startsWith("PB1-"))).toBe(false);
    // A product with no inventory row in this branch shows as stock 0 / agotado.
    const sinFila = result.data.items.find((i) => i.codigo === "Z-SINFILA");
    expect(sinFila).toMatchObject({ cantidad: "0", estado: "agotado", categoria: expect.any(String), unidadMedida: "UND" });
  });

  it("derives the same status in SQL (filter) and in the domain (badge)", async () => {
    const all = await consultar({ page: 1, limit: 100 });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    for (const estado of ["normal", "bajo_stock", "agotado"] as const) {
      const filtered = await consultar({ page: 1, limit: 100, estado });
      expect(filtered.ok).toBe(true);
      if (!filtered.ok) continue;
      expect(filtered.data.items.length).toBeGreaterThan(0);
      for (const item of filtered.data.items) {
        expect(classifyStockKpi(item.cantidad, item.stockMinimo)).toBe(estado);
        expect(item.estado).toBe(estado);
      }
      expect(filtered.data.total).toBe(all.data.items.filter((i) => i.estado === estado).length);
    }
    // Boundary: stock equal to the minimum is bajo_stock.
    expect(all.data.items.find((i) => i.codigo === "Z-IGUAL")?.estado).toBe("bajo_stock");
  });

  it("searches by name or code (case-insensitive) and treats % and _ literally", async () => {
    const porNombre = await consultar({ page: 1, limit: 25, busqueda: "aceite" });
    const porCodigo = await consultar({ page: 1, limit: 25, busqueda: "z-cero" });
    const comodin = await consultar({ page: 1, limit: 25, busqueda: "100%_" });
    const soloPorcentaje = await consultar({ page: 1, limit: 25, busqueda: "%" });

    expect(porNombre.ok && porNombre.data.items.map((i) => i.codigo)).toEqual(["Z-BAJO"]);
    expect(porCodigo.ok && porCodigo.data.items.map((i) => i.codigo)).toEqual(["Z-CERO"]);
    expect(comodin.ok && comodin.data.items.map((i) => i.codigo)).toEqual(["Z-IGUAL"]);
    expect(soloPorcentaje.ok && soloPorcentaje.data.items.map((i) => i.codigo)).toEqual(["Z-IGUAL"]);
  });

  it("filters by category and combines filters with AND", async () => {
    const porCategoria = await consultar({ page: 1, limit: 25, categoriaId: otraCategoriaId });
    const combinado = await consultar({ page: 1, limit: 25, categoriaId: otraCategoriaId, estado: "agotado" });

    expect(porCategoria.ok && porCategoria.data.items.map((i) => i.codigo)).toEqual(["Z-BAJO", "Z-CERO"]);
    expect(combinado.ok && combinado.data.items.map((i) => i.codigo)).toEqual(["Z-CERO"]);
  });

  it("paginates in a stable order and reports the filtered total", async () => {
    const p1 = await consultar({ page: 1, limit: 2 });
    const p2 = await consultar({ page: 2, limit: 2 });

    expect(p1.ok && p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;
    expect(p1.data.items).toHaveLength(2);
    expect(p1.data.total).toBeGreaterThanOrEqual(5);
    const codigos = [...p1.data.items, ...p2.data.items].map((i) => i.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(codigos).toEqual([...codigos].sort());
  });

  it("computes the KPI cards over the whole branch scope, ignoring the filters", async () => {
    const filtrado = await consultar({ page: 1, limit: 25, estado: "agotado", busqueda: "leche" });

    expect(filtrado.ok).toBe(true);
    if (!filtrado.ok) return;
    expect(filtrado.data.items).toHaveLength(1);
    // prodA1 normal, Z-BAJO bajo, Z-IGUAL bajo, Z-CERO agotado, Z-SINFILA agotado, and the
    // fixture's prodA2Only (stock only in branch A2) agotado here; inactive excluded.
    expect(filtrado.data.resumen).toMatchObject({ totalProductos: 6, bajoStock: 2, agotados: 3 });
    // Value = 8*100.00 + 5*10.50 + 0*50 + 0*7 + 10*0 = 852.50
    expect(filtrado.data.resumen.valorInventario).toBe("852.50");
  });

  it("offers the active categories of the company only", async () => {
    const result = await consultar({ page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.data.categorias.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([categoriaId, otraCategoriaId]));
    const db = getHarnessDb();
    const deOtraEmpresa = await db.categoria.count({
      where: { id: { in: ids }, empresaId: { not: fixture.empresaA.id } },
    });
    expect(deOtraEmpresa).toBe(0);
  });
});
