/**
 * Integration — confirm happy path (real DB, RLS on).
 *
 * Proves a draft confirm transitions to PENDIENTE with an assigned CMP number,
 * appends exactly one audit row, writes ZERO MovimientoInventario (core never
 * touches stock), and that a retry is idempotent: no duplicate transition,
 * number or audit row.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { confirmarCompra } from "@/modules/compra/application/confirmar-compra";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

describe("compra confirm (real DB)", () => {
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

  async function crearDraft(ncf?: string): Promise<number> {
    return withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        // Formal legal entity + merchandise => zero retentions (no config needed).
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        ncf: ncf ?? null,
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "2.000", costoUnitario: "100.00" },
        ],
      });
      if (!r.ok) throw new Error(`draft create failed: ${r.code}`);
      return r.data.id;
    });
  }

  it("PENDIENTE + CMP number + exactly one audit row + zero inventory", async () => {
    const id = await crearDraft();
    // One audit row already exists (CREAR).
    const db = getHarnessDb();
    const auditBefore = await db.movimientoAuditoria.count({
      where: { entidad: "Compra", idEntidad: String(id) },
    });
    expect(auditBefore).toBe(1);

    const confirm = await withTenantTransaction(ctx, (tx) =>
      confirmarCompra(tx, ctx, { id }),
    );
    expect(confirm).toEqual({
      ok: true,
      data: expect.objectContaining({
        id,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000001",
        total: "236.00",
        retencionIsr: "0.00",
        retencionItbis: "0.00",
      }),
    });

    const compra = await db.compra.findUnique({ where: { id } });
    expect(compra?.estado).toBe("PENDIENTE");
    expect(compra?.correlativoInterno).toBe("CMP-000001");

    // Confirm appended exactly ONE more audit row (CREAR -> ACTUALIZAR).
    const auditAfter = await db.movimientoAuditoria.count({
      where: { entidad: "Compra", idEntidad: String(id) },
    });
    expect(auditAfter).toBe(2);

    // Core confirm never writes inventory.
    const movimientos = await db.movimientoInventario.count({
      where: { compraId: id },
    });
    expect(movimientos).toBe(0);
  });

  it("re-confirm is idempotent (no duplicate transition, number or audit)", async () => {
    const id = await crearDraft();
    const first = await withTenantTransaction(ctx, (tx) =>
      confirmarCompra(tx, ctx, { id }),
    );
    expect(first.ok).toBe(true);

    const second = await withTenantTransaction(ctx, (tx) =>
      confirmarCompra(tx, ctx, { id }),
    );
    expect(second.ok === false && second.code).toBe("COMPRA_INMUTABLE");

    const db = getHarnessDb();
    const compra = await db.compra.findUnique({ where: { id } });
    expect(compra?.correlativoInterno).toBe("CMP-000001");
    const auditCount = await db.movimientoAuditoria.count({
      where: { entidad: "Compra", idEntidad: String(id) },
    });
    // Still just CREAR + one confirm — the retry added nothing.
    expect(auditCount).toBe(2);
  });
});
