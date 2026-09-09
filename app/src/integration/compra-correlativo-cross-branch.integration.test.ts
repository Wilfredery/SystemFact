/**
 * Integration — cross-branch correlativo allocation (real DB, RLS on).
 *
 * The CMP-%06d counter is per EMPRESA (EMPRESA row lock + MAX+1), shared
 * across sucursales. Two drafts from DIFFERENT branches of the same empresa,
 * confirmed concurrently, must both succeed with distinct sequential
 * correlativos, and each compra must carry its own sucursalId.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { crearCompra } from "@/modules/compra/application/crear-compra";
import { confirmarCompra } from "@/modules/compra/application/confirmar-compra";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("compra correlativo across branches (real DB)", () => {
  let fixture: TenantFixture;
  let ctxA1: TenantCtx;
  let ctxA2: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();

    // The fixture's adminA lives in A1; create a dedicated Administrador
    // usuario anchored to A2 so each branch has its own operator.
    const db = getHarnessDb();
    const rolAdmin = await db.rol.findFirst({ where: { nombre: "Administrador" } });
    if (rolAdmin === null) throw new Error("Administrador role not seeded by fixture");
    const adminA2 = await db.usuario.create({
      data: {
        empresaId: fixture.empresaA.id,
        sucursalId: fixture.sucursalA2.id,
        nombre: "Admin A2",
        nombreUsuario: `intadmin-a2-corr-${fixture.usuarios.adminA.nombreUsuario}`,
        passwordHash: "test-hash",
        roles: { create: { rolId: rolAdmin.id } },
      },
    });

    ctxA1 = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxA2 = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA2.id,
      usuarioId: adminA2.id,
      esAdmin: true,
    };
  });

  function crearDraft(ctx: TenantCtx, productoId: number): Promise<number> {
    return withTenantTransaction(ctx, async (tx) => {
      const r = await crearCompra(tx, ctx, {
        proveedorId: fixture.proveedores.formalJuridica.id,
        tipoCompra: "MERCANCIA",
        fecha: new Date("2026-01-10T00:00:00.000Z"),
        lineas: [
          { productoId, cantidad: "1.000", costoUnitario: "50.00" },
        ],
      });
      if (!r.ok) throw new Error(`create failed: ${r.code}`);
      return r.data.id;
    });
  }

  const confirmOnce = (ctx: TenantCtx, id: number) =>
    withTenantTransaction(ctx, (tx) => confirmarCompra(tx, ctx, { id }));

  it("two branches of one empresa raced: unique sequential correlativos, own sucursalId", async () => {
    const idA1 = await crearDraft(ctxA1, fixture.productos.prodA1.id);
    const idA2 = await crearDraft(ctxA2, fixture.productos.prodA2Only.id);

    type ConfirmResult = Awaited<ReturnType<typeof confirmarCompra>>;
    const settled = await Promise.allSettled([
      confirmOnce(ctxA1, idA1),
      confirmOnce(ctxA2, idA2),
    ]);
    for (const outcome of settled) {
      // Business rejections resolve as typed results, never a thrown promise.
      expect(outcome.status).toBe("fulfilled");
    }
    const results = settled.map(
      (o) => (o as PromiseFulfilledResult<ConfirmResult>).value,
    );
    const okResults = results.filter((r) => r.ok === true);
    expect(okResults).toHaveLength(2);

    // Unique AND sequential, regardless of which branch won the race.
    const correlativos = okResults
      .map((r) => (r.ok ? r.data.correlativoInterno : ""))
      .sort();
    expect(new Set(correlativos).size).toBe(2);
    expect(correlativos).toEqual(["CMP-000001", "CMP-000002"]);

    // Each compra carries its own branch anchor (never crossed).
    const db = getHarnessDb();
    const compraA1 = await db.compra.findUnique({ where: { id: idA1 } });
    const compraA2 = await db.compra.findUnique({ where: { id: idA2 } });
    expect(compraA1?.sucursalId).toBe(fixture.sucursalA1.id);
    expect(compraA2?.sucursalId).toBe(fixture.sucursalA2.id);
  });
});
