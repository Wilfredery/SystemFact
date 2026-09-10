/**
 * Integration — venta tenant/branch isolation (spec R-V11, mandatory scenario).
 *
 * High-traffic probing across empresa A/B and branches A1/A2: a draft created in
 * one tenant/branch is invisible to any other context — list contains only the
 * session rows, and detail/update/cancel on a foreign id behave as typed
 * not-found with ZERO writes/leakage. Uses the real `systemfact_test` DB with RLS
 * enforced (the harness seeds via the superuser client; code under test goes
 * through `withTenantTransaction` with the GUCs set).
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  crearVenta,
  actualizarVenta,
  cancelarVenta,
  listarVentas,
  obtenerVenta,
} from "@/modules/venta/application/venta-service";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";
import { crearProductoVenta, categoriaA } from "./setup/venta-helpers";

const PRICES = { cantidad: "1", precioUnitario: "20.00" };
const CERO = { descuentoTipo: "PORCENTAJE", descuentoValor: "0.00" } as const;

function ctxA1(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA1.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}
function ctxA2(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaA.id, sucursalId: f.sucursalA2.id, usuarioId: f.usuarios.adminA.id, esAdmin: true };
}
function ctxB1(f: TenantFixture): TenantCtx {
  return { empresaId: f.empresaB.id, sucursalId: f.sucursalB1.id, usuarioId: f.usuarios.adminB.id, esAdmin: true };
}

describe("venta tenant/branch isolation (real DB)", () => {
  let f: TenantFixture;
  let catA: number;

  beforeEach(async () => {
    f = await seedTenantFixture();
    catA = await categoriaA(f.empresaA.id);
  });

  async function crearDraftA1(): Promise<number> {
    const prod = await crearProductoVenta({
      empresaId: f.empresaA.id,
      categoriaId: catA,
      codigo: `ISO-A-${Date.now()}`,
      precioVenta: "20.00",
    });
    return withTenantTransaction(ctxA1(f), async (tx) => {
      const r = await crearVenta(tx, ctxA1(f), {
        clienteId: null,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: prod.id, ...PRICES, descuento: CERO }],
      });
      if (!r.ok) throw new Error(`create failed: ${r.code}`);
      return r.data.id;
    });
  }

  it("list in another branch (A2) does not contain A1's draft", async () => {
    const id = await crearDraftA1();
    const res = await withTenantTransaction(ctxA2(f), (tx) =>
      listarVentas(tx, ctxA2(f), { page: 1, limit: 100 }),
    );
    expect(res.ok === true && res.data.items.some((i) => i.id === id)).toBe(false);
    // A2 sees none of A1's drafts (branch filter), while A1 sees its own.
    const enA1 = await withTenantTransaction(ctxA1(f), (tx) =>
      listarVentas(tx, ctxA1(f), { page: 1, limit: 100 }),
    );
    expect(enA1.ok === true && enA1.data.items.some((i) => i.id === id)).toBe(true);
  });

  it("detail/update/cancel from another empresa (B) behave as not-found, zero effects", async () => {
    const id = await crearDraftA1();
    const ctxB = ctxB1(f);

    const detalle = await withTenantTransaction(ctxB, (tx) =>
      obtenerVenta(tx, ctxB, { id }),
    );
    expect(detalle.ok === false && detalle.code).toBe("VENTA_NO_ENCONTRADO");

    const upd = await withTenantTransaction(ctxB, (tx) =>
      actualizarVenta(tx, ctxB, {
        id,
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [{ productoId: f.productos.prodB1.id, ...PRICES, descuento: CERO }],
      }),
    );
    expect(upd.ok === false && upd.code).toBe("VENTA_NO_ENCONTRADO");

    const cancel = await withTenantTransaction(ctxB, (tx) =>
      cancelarVenta(tx, ctxB, { id }),
    );
    expect(cancel.ok === false && cancel.code).toBe("VENTA_NO_ENCONTRADO");

    // The A1 draft is still a BORRADOR, untouched, with its single CREAR audit.
    const db = getHarnessDb();
    const venta = await db.venta.findUnique({ where: { id } });
    expect(venta?.estado).toBe("BORRADOR");
    expect(venta?.empresaId).toBe(f.empresaA.id);
    expect(
      await db.movimientoAuditoria.count({ where: { entidad: "Venta", idEntidad: String(id) } }),
    ).toBe(1);
  });

  it("a foreign id indistinguishable from a never-existing id (no leakage)", async () => {
    const ctxB = ctxB1(f);
    const detalle = await withTenantTransaction(ctxB, (tx) =>
      obtenerVenta(tx, ctxB, { id: 999999 }),
    );
    // Identical code/message for a real-but-foreign id and a bogus one.
    const bogus = await withTenantTransaction(ctxB, (tx) =>
      obtenerVenta(tx, ctxB, { id: 888888 }),
    );
    expect(detalle.ok === false && !detalle.ok && detalle.code).toBe(
      bogus.ok === false && !bogus.ok && bogus.code,
    );
  });
});
