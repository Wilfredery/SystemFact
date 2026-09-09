/**
 * Integration — tenant isolation, pagination bounds and deterministic order
 * (real DB, RLS on).
 *
 * Proves a >100 page size is rejected by the use case, a cross-empresa detail
 * and list read never leak, and the listing order is deterministic.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { listarCompras } from "@/modules/compra/application/listar-compras";
import { obtenerCompra } from "@/modules/compra/application/obtener-compra";
import { seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("compra tenant isolation (real DB)", () => {
  let fixture: TenantFixture;
  let ctxA: TenantCtx;
  let ctxB: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxA = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxB = {
      empresaId: fixture.empresaB.id,
      sucursalId: fixture.sucursalB1.id,
      usuarioId: fixture.usuarios.adminB.id,
      esAdmin: true,
    };
  });

  async function crear(
    ctx: TenantCtx,
    proveedorId: number,
    productoId: number,
    costo: string,
  ): Promise<number> {
    return withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        proveedorId,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId, cantidad: "1.000", costoUnitario: costo }],
      });
      if (!r.ok) throw new Error(`create failed: ${r.code}`);
      return r.data.id;
    });
  }

  it("rejects a page size above the 100 ceiling", async () => {
    const result = await withTenantTransaction(ctxA, (tx) =>
      listarCompras(tx, ctxA, { page: 1, limit: 500 }),
    );
    expect(result.ok === false && result.code).toBe("VALIDATION_ERROR");
  });

  it("detail of another empresa's purchase returns COMPRA_NO_ENCONTRADA", async () => {
    const idA = await crear(ctxA, fixture.proveedores.formalJuridica.id, fixture.productos.prodA1.id, "10.00");
    const detalle = await withTenantTransaction(ctxB, (tx) =>
      obtenerCompra(tx, ctxB, { id: idA }),
    );
    expect(detalle.ok === false && detalle.code).toBe("COMPRA_NO_ENCONTRADA");
  });

  it("list returns only the caller's empresa", async () => {
    const idA = await crear(ctxA, fixture.proveedores.formalJuridica.id, fixture.productos.prodA1.id, "10.00");
    const idB = await crear(ctxB, fixture.proveedores.proveedorB.id, fixture.productos.prodB1.id, "20.00");

    const listA = await withTenantTransaction(ctxA, (tx) =>
      listarCompras(tx, ctxA, { page: 1, limit: 25 }),
    );
    expect(listA.ok).toBe(true);
    if (!listA.ok) return;
    const idsA = listA.data.items.map((c) => c.id);
    expect(idsA).toContain(idA);
    expect(idsA).not.toContain(idB);
    expect(listA.data.total).toBe(1);
  });

  it("orders deterministically by fecha desc then id desc", async () => {
    // Same fecha: the tie-break is id desc (newest id first).
    const first = await crear(ctxA, fixture.proveedores.formalJuridica.id, fixture.productos.prodA1.id, "10.00");
    const second = await crear(ctxA, fixture.proveedores.formalJuridica.id, fixture.productos.prodA1.id, "20.00");

    const list = await withTenantTransaction(ctxA, (tx) =>
      listarCompras(tx, ctxA, { page: 1, limit: 25 }),
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.items.map((c) => c.id)).toEqual([second, first]);
  });
});
