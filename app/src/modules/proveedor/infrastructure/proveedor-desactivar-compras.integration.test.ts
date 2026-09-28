/**
 * Integration — supplier-deactivation guard `tieneComprasNoCanceladas`
 * (real DB, RLS on).
 *
 * A supplier with a live (non-CANCELLED) purchase cannot be deactivated;
 * once the purchase is cancelled the guard clears. Purchases are seeded
 * directly through the harness DB so this module owns the complete story
 * without importing the compra module's application layer.
 */

import { Prisma } from "@/generated/prisma/client";
import { EstadoCompra, TipoCompra } from "@/generated/prisma/enums";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { desactivarProveedor } from "@/modules/proveedor/application/desactivar-proveedor";
import { PROVEEDOR_TIENE_COMPRAS } from "@/modules/proveedor/domain/errors";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "@/integration/setup/fixtures";

describe("proveedor deactivation guard (real DB)", () => {
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

  it("blocks deactivation while a purchase is live, clears once cancelled", async () => {
    const proveedorId = fixture.proveedores.formalJuridica.id;
    const db = getHarnessDb();
    const compra = await db.compra.create({
      data: {
        empresaId: ctx.empresaId,
        sucursalId: ctx.sucursalId,
        proveedorId,
        usuarioId: ctx.usuarioId,
        tipoCompra: TipoCompra.MERCANCIA,
        estado: EstadoCompra.BORRADOR,
        subtotal: new Prisma.Decimal("100.00"),
        subtotalGravado: new Prisma.Decimal("100.00"),
        itbis: new Prisma.Decimal("0"),
        subtotalExento: new Prisma.Decimal("0"),
        retencionIsr: new Prisma.Decimal("0"),
        retencionItbis: new Prisma.Decimal("0"),
        total: new Prisma.Decimal("100.00"),
        correlativoInterno: `CMP-GUARD-${ctx.empresaId}-${Date.now()}`,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
      },
      select: { id: true, estado: true },
    });

    // A live purchase in this tenant blocks deactivation.
    await withTenantTransaction(ctx, async (tx) => {
      const bloqueado = await desactivarProveedor(tx, ctx, { id: proveedorId });
      expect(bloqueado).toMatchObject({ ok: false, code: PROVEEDOR_TIENE_COMPRAS });
    });

    // Cancelling releases the guard for this tenant.
    await withTenantTransaction(ctx, async (tx) => {
      await tx.compra.update({
        where: { id: compra.id },
        data: { estado: EstadoCompra.CANCELADA },
      });
    });

    // Cross-tenant isolation: inject a live purchase under the SAME supplier id
    // but the OTHER company. It is now the only live row for this supplier, so
    // the count below must ignore it — a dropped tenant filter would count it
    // and report PROVEEDOR_TIENE_COMPRAS here, failing the final deactivation.
    await db.compra.create({
      data: {
        empresaId: fixture.empresaB.id,
        sucursalId: fixture.sucursalB1.id,
        proveedorId,
        usuarioId: fixture.usuarios.adminB.id,
        tipoCompra: TipoCompra.MERCANCIA,
        estado: EstadoCompra.BORRADOR,
        subtotal: new Prisma.Decimal("50.00"),
        subtotalGravado: new Prisma.Decimal("50.00"),
        itbis: new Prisma.Decimal("0"),
        subtotalExento: new Prisma.Decimal("0"),
        retencionIsr: new Prisma.Decimal("0"),
        retencionItbis: new Prisma.Decimal("0"),
        total: new Prisma.Decimal("50.00"),
        correlativoInterno: `CMP-GUARD-X-${ctx.empresaId}-${Date.now()}`,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
      },
    });

    // Only the cross-tenant row is live, so deactivation must succeed when the
    // guard is tenant-scoped; this is the single step with real isolation power.
    await withTenantTransaction(ctx, async (tx) => {
      const okDesactivar = await desactivarProveedor(tx, ctx, { id: proveedorId });
      expect(okDesactivar.ok).toBe(true);
    });
  });
});