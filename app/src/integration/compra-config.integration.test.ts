/**
 * Integration — config-driven retention blocks confirm (real DB, RLS on).
 *
 * An informal supplier makes RET_ITBIS_100 applicable; with that key absent,
 * confirmation MUST fail with CONFIG_RETENCION_FALTANTE and the purchase MUST
 * remain BORRADOR (no state change, no CMP number, no audit transition). There
 * is intentionally no legal-default fallback.
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

describe("compra config-driven retention (real DB)", () => {
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

  async function crearDraftInformal(): Promise<number> {
    return withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.informalFisica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "100.00" },
        ],
      });
      if (!r.ok) throw new Error(`create failed: ${r.code}`);
      return r.data.id;
    });
  }

  it("with the key present, an informal purchase confirms with ITBIS 100%", async () => {
    const id = await crearDraftInformal();
    const confirm = await withTenantTransaction(ctx, (tx) =>
      confirmarCompra(tx, ctx, { id }),
    );
    // itbis 18.00 -> informal withhold 100% => retencionItbis 18.00.
    expect(confirm.ok === true && confirm.data.retencionItbis).toBe("18.00");
    expect(confirm.ok === true && confirm.data.estado).toBe("PENDIENTE");
  });

  it("with RET_ITBIS_100 absent, confirm is blocked and state stays BORRADOR", async () => {
    const id = await crearDraftInformal();

    // Remove the applicable key as the superuser harness (RLS-bypassing).
    const db = getHarnessDb();
    await db.configuracionEmpresa.deleteMany({
      where: {
        empresaId: fixture.empresaA.id,
        clave: "RET_ITBIS_100",
      },
    });

    const confirm = await withTenantTransaction(ctx, (tx) =>
      confirmarCompra(tx, ctx, { id }),
    );
    expect(confirm.ok === false && confirm.code).toBe("CONFIG_RETENCION_FALTANTE");

    const compra = await db.compra.findUnique({ where: { id } });
    expect(compra?.estado).toBe("BORRADOR");
    // Draft correlativo stays empty (never assigned).
    expect(compra?.correlativoInterno).toBe("");
    // Only the original CREAR audit row; the blocked confirm added nothing.
    expect(
      await db.movimientoAuditoria.count({
        where: { entidad: "Compra", idEntidad: String(id) },
      }),
    ).toBe(1);
  });
});
