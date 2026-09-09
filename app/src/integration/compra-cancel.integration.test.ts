/**
 * Integration — cancel pre-receipt purchases (real DB, RLS on).
 *
 * Proves cancel records the motivo in an append-only audit row, touches NO
 * inventory, and does NOT free the per-empresa NCF uniqueness slot (a second
 * purchase reusing the cancelled NCF is rejected). It also gives the first
 * coverage of the supplier-deactivation guard `tieneComprasNoCanceladas`, now
 * that compras actually exist: a supplier with a live purchase cannot be
 * deactivated, but once the purchase is cancelled the guard clears.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { confirmarCompra } from "@/modules/compra/application/confirmar-compra";
import { cancelarCompra } from "@/modules/compra/application/cancelar-compra";
import { desactivarProveedor } from "@/modules/proveedor/application/desactivar-proveedor";
import {
  getHarnessDb,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

describe("compra cancel (real DB)", () => {
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

  it("cancels with motivo, touches no inventory, and retains the NCF slot", async () => {
    const ncf = `B01-KEEP-${fixture.empresaA.id}`;
    const id = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        ncf,
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "100.00" },
        ],
      });
      if (!r.ok) throw new Error(`create failed: ${r.code}`);
      return r.data.id;
    });
    await withTenantTransaction(ctx, (tx) => confirmarCompra(tx, ctx, { id }));

    const cancel = await withTenantTransaction(ctx, (tx) =>
      cancelarCompra(tx, ctx, { id, motivo: "Doble registro" }),
    );
    expect(cancel).toEqual({ ok: true, data: { id, estado: "CANCELADA" } });

    const db = getHarnessDb();
    const compra = await db.compra.findUnique({ where: { id } });
    expect(compra?.estado).toBe("CANCELADA");
    // motivo audited on the CANCELAR row.
    const audit = await db.movimientoAuditoria.findFirst({
      where: { entidad: "Compra", idEntidad: String(id), accion: "CANCELAR" },
    });
    expect(audit?.motivo).toBe("Doble registro");
    // No inventory reversal.
    expect(await db.movimientoInventario.count({ where: { compraId: id } })).toBe(0);

    // NCF slot retained: reusing the same ncf on a new purchase is rejected.
    const dup = await withTenantTransaction(ctx, async (tx) =>
      crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-11T00:00:00.000Z"),
        ncf,
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "10.00" },
        ],
      }),
    );
    expect(dup.ok === false && dup.code).toBe("NFC_DUPLICADO");
  });

  it("blocks supplier deactivation while a purchase is live, clears after cancel", async () => {
    const proveedorId = fixture.proveedores.formalJuridica.id;
    const id = await withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        proveedorId,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId: fixture.productos.prodA1.id, cantidad: "1.000", costoUnitario: "100.00" },
        ],
      });
      if (!r.ok) throw new Error(`create failed: ${r.code}`);
      return r.data.id;
    });

    // A live (BORRADOR) purchase blocks deactivation.
    const bloqueado = await withTenantTransaction(ctx, (tx) =>
      desactivarProveedor(tx, ctx, { id: proveedorId }),
    );
    expect(bloqueado.ok === false && bloqueado.code).toBe("PROVEEDOR_TIENE_COMPRAS");

    // Cancelling releases the guard, so deactivation now succeeds.
    await withTenantTransaction(ctx, (tx) =>
      cancelarCompra(tx, ctx, { id, motivo: "sin efecto" }),
    );
    const okDesactivar = await withTenantTransaction(ctx, (tx) =>
      desactivarProveedor(tx, ctx, { id: proveedorId }),
    );
    expect(okDesactivar.ok).toBe(true);
  });
});
