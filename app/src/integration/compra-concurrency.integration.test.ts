/**
 * Integration — concurrency of confirm (real DB, RLS on).
 *
 * (a) The same draft confirmed twice in parallel: exactly one transition wins,
 *     the loser gets a stable error and no duplicate CMP / audit / inventory.
 * (b) Two distinct drafts confirmed in parallel: both succeed and receive
 *     distinct sequential CMP numbers (the EMPRESA row lock serializes the
 *     company-wide MAX+1 allocation).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { confirmarCompra } from "@/modules/compra/application/confirmar-compra";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("compra confirm concurrency (real DB)", () => {
  let fixture: TenantFixture;
  let ctx: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctx = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  async function crearDraft(): Promise<number> {
    return withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "50.00" },
        ],
      });
      if (!r.ok) throw new Error(`create failed: ${r.code}`);
      return r.data.id;
    });
  }

  const confirmOnce = (id: number) =>
    withTenantTransaction(ctx, (tx) => confirmarCompra(tx, ctx, { id }));

  it("(a) same draft raced: one wins, loser stable error, no duplicate effects", async () => {
    const id = await crearDraft();

    type ConfirmResult = Awaited<ReturnType<typeof confirmarCompra>>;
    const settled = await Promise.allSettled([confirmOnce(id), confirmOnce(id)]);
    for (const outcome of settled) {
      // Business rejections resolve as typed results, never a thrown promise.
      expect(outcome.status).toBe("fulfilled");
    }
    const results = settled.map(
      (o) => (o as PromiseFulfilledResult<ConfirmResult>).value,
    );
    const okResults = results.filter((r) => r.ok === true);
    const errorResults = results.filter(
      (r) => !r.ok && (r.code === "COMPRA_INMUTABLE" || r.code === "CONCURRENCIA_CONFLICTO"),
    );
    expect(okResults).toHaveLength(1);
    expect(errorResults).toHaveLength(1);

    const db = getHarnessDb();
    const compra = await db.compra.findUnique({ where: { id } });
    expect(compra?.estado).toBe("PENDIENTE");
    expect(compra?.correlativoInterno).toBe("CMP-000001");

    // Exactly one confirm audit row (CREAR + one ACTUALIZAR).
    const auditCount = await db.movimientoAuditoria.count({
      where: { entidad: "Compra", idEntidad: String(id) },
    });
    expect(auditCount).toBe(2);
    // No inventory movement, no second purchase row.
    expect(await db.movimientoInventario.count({ where: { compraId: id } })).toBe(0);
    expect(await db.compra.count({ where: { correlativoInterno: "CMP-000001" } })).toBe(1);
  });

  it("(b) two drafts raced: distinct sequential correlativos", async () => {
    const idA = await crearDraft();
    const idB = await crearDraft();

    const [ra, rb] = await Promise.all([confirmOnce(idA), confirmOnce(idB)]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) throw new Error("both confirms should succeed");

    const correlativos = [ra.data.correlativoInterno, rb.data.correlativoInterno].sort();
    // Distinct and sequentially allocated from the empresa counter.
    expect(new Set(correlativos).size).toBe(2);
    expect(correlativos).toEqual(["CMP-000001", "CMP-000002"]);

    const db = getHarnessDb();
    const totalConfirmadas = await db.compra.count({
      where: { empresaId: fixture.empresaA.id, estado: "PENDIENTE" },
    });
    expect(totalConfirmadas).toBe(2);
  });
});
