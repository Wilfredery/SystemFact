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
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { desactivarProveedor } from "@/modules/proveedor/application/desactivar-proveedor";
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
        tipoCompra: "MERCANCIA",
        estado: "BORRADOR",
        subtotal: new Prisma.Decimal("100.00"),
        subtotalGravado: new Prisma.Decimal("100.00"),
        itbis: new Prisma.Decimal(0),
        subtotalExento: new Prisma.Decimal(0),
        retencionIsr: new Prisma.Decimal(0),
        retencionItbis: new Prisma.Decimal(0),
        total: new Prisma.Decimal("100.00"),
        correlativoInterno: `CMP-GUARD-${ctx.empresaId}-${Date.now()}`,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
      },
      select: { id: true, estado: true },
    });
    // Render the RLS-scoped context over the actual transaction used by the guard.
    await withTenantTransaction(ctx, async (tx) => {
      const bloqueado = await desactivarProveedor(tx, ctx, { id: proveedorId });
      expect(bloqueado.ok === false && bloqueado.code).toBe("PROVEEDOR_TIENE_COMPRAS");
    });

    // Cross-tenant isolation: a purchase injected under the SAME supplier but the
// OTHER company must not block this tenant's supplier — the guard is scoped by
// empresaId, so a dropped tenant filter would surface here as a false block.
    await db.compra.create({
      data: {
        empresaId: fixture.empresaB.id,
        sucursalId: fixture.sucursalB1.id,
        proveedorId,
        usuarioId: fixture.usuarios.adminB.id,
        tipoCompra: "MERCANCIA",
        estado: "BORRADOR",
        subtotal: new Prisma.Decimal("50.00"),
        subtotalGravado: new Prisma.Decimal("50.00"),
        itbis: new Prisma.Decimal(0),
        subtotalExento: new Prisma.Decimal(0),
        retencionIsr: new Prisma.Decimal(0),
        retencionItbis: new Prisma.Decimal(0),
        total: new Prisma.Decimal("50.00"),
        correlativoInterno: `CMP-GUARD-X-${ctx.empresaId}-${Date.now()}`,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
      },
    });
    // The live purchase in THIS tenant still blocks (the cross-tenant row above
    // must not count), so the guard keeps reporting PROVEEDOR_TIENE_COMPRAS.
    await withTenantTransaction(ctx, async (tx) => {
      const sigueBloqueado = await desactivarProveedor(tx, ctx, { id: proveedorId });
      expect(sigueBloqueado.ok === false && sigueBloqueado.code).toBe("PROVEEDOR_TIENE_COMPRAS");
    });

    // Cancelling releases the guard, so deactivation now succeeds.
    // (The cross-tenant purchase remains live and must stay invisible here.)
    await withTenantTransaction(ctx, async (tx) => {
      await tx.compra.update({
        where: { id: compra.id },
        data: { estado: "CANCELADA" },
      });
      const okDesactivar = await desactivarProveedor(tx, ctx, { id: proveedorId });
      expect(okDesactivar.ok).toBe(true);
    });
  });
});