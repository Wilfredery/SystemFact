/**
 * Integration tests — company-wide user listing and other-branch movement authors
 * (no migration: `usuario_select` already reads the whole empresa when the branch
 * GUC is blank; the use cases widen it for an Administrador only), against the real
 * `systemfact_test` database through `withTenantTransaction` (app role + RLS GUCs).
 */

import { Prisma } from "@/generated/prisma/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { listarUsuarios } from "@/modules/tenant/application/listar-usuarios";
import { listarMovimientosInventario } from "@/modules/inventario/application/listar-movimientos-inventario";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const AHORA = new Date("2026-11-14T16:00:00.000Z");

function ctxA1(fixture: TenantFixture, esAdmin: boolean): TenantCtx {
  return {
    empresaId: fixture.empresaA.id,
    sucursalId: fixture.sucursalA1.id,
    usuarioId: fixture.usuarios.adminA.id,
    esAdmin,
  };
}

describe("company-wide user listing (real DB, app role + RLS)", () => {
  let fixture: TenantFixture;
  let usuarioA2: { id: number; nombre: string };

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    const db = getHarnessDb();
    usuarioA2 = await db.usuario.create({
      data: {
        empresaId: fixture.empresaA.id,
        sucursalId: fixture.sucursalA2.id,
        nombre: "Usuario de A2",
        nombreUsuario: `int-a2-${Date.now()}`,
        passwordHash: "test-hash",
      },
    });
  });

  it("an Administrador sees the users of every branch of the empresa, never another empresa", async () => {
    const ctx = ctxA1(fixture, true);
    const r = await withTenantTransaction(ctx, (tx) => listarUsuarios(tx, ctx, { pageSize: 100 }));

    const ids = r.data.items.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([fixture.usuarios.adminA.id, usuarioA2.id]));
    expect(ids).not.toContain(fixture.usuarios.adminB.id);
    const ajena = r.data.items.find((u) => u.id === usuarioA2.id);
    expect(ajena?.sucursalId).toBe(fixture.sucursalA2.id);
    expect(r.data.total).toBe(r.data.items.length);
  });

  it("a non-admin session stays on its own branch: the A2 user is invisible", async () => {
    const ctx = ctxA1(fixture, false);
    const r = await withTenantTransaction(ctx, (tx) => listarUsuarios(tx, ctx, { pageSize: 100 }));

    const ids = r.data.items.map((u) => u.id);
    expect(ids).toContain(fixture.usuarios.adminA.id);
    expect(ids).not.toContain(usuarioA2.id);
  });

  it("the widen is restored: a write right after the listing in the SAME transaction is still branch-pinned", async () => {
    const ctx = ctxA1(fixture, true);
    const afectadas = await withTenantTransaction(ctx, async (tx) => {
      await listarUsuarios(tx, ctx, {});
      return tx.usuario.updateMany({
        where: { id: usuarioA2.id, empresaId: ctx.empresaId },
        data: { nombre: "Cambiado" },
      });
    });

    expect(afectadas.count).toBe(0);
    const fila = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: usuarioA2.id } });
    expect(fila.nombre).toBe("Usuario de A2");
  });
});

describe("movement history author across branches (real DB, app role + RLS)", () => {
  let fixture: TenantFixture;
  let autorA2: { id: number };

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    const db = getHarnessDb();
    autorA2 = await db.usuario.create({
      data: {
        empresaId: fixture.empresaA.id,
        sucursalId: fixture.sucursalA2.id,
        nombre: "Autora de A2",
        nombreUsuario: `int-autor-a2-${Date.now()}`,
        passwordHash: "test-hash",
      },
    });
    await db.movimientoInventario.create({
      data: {
        inventarioId: fixture.inventarios.a1ProdA1.id,
        usuarioId: autorA2.id,
        tipoMovimiento: "AJUSTE",
        motivo: "a1-autor-a2",
        cantidadAnterior: new Prisma.Decimal("10"),
        cantidadMovida: new Prisma.Decimal("1"),
        cantidadNueva: new Prisma.Decimal("11"),
        fecha: new Date("2026-11-09T20:00:00.000Z"),
        idempotencyKey: `autor-a2-${Date.now()}`,
      },
    });
  });

  const RANGO = { desde: "2026-11-01", hasta: "2026-11-10" };

  async function autorDe(esAdmin: boolean): Promise<string | null | undefined> {
    const ctx = ctxA1(fixture, esAdmin);
    const r = await withTenantTransaction(ctx, (tx) =>
      listarMovimientosInventario(tx, ctx, { page: 1, limit: 100, ...RANGO }, AHORA),
    );
    if (!r.ok) throw new Error("unreachable");
    const fila = r.data.items.find((i) => i.motivo === "a1-autor-a2");
    expect(fila).toBeDefined();
    expect(fila).not.toHaveProperty("usuarioId");
    return fila?.usuarioNombre;
  }

  it("an Administrador sees the name of an author of another branch", async () => {
    expect(await autorDe(true)).toBe("Autora de A2");
  });

  it("a non-admin keeps the dash (null): no privacy change", async () => {
    expect(await autorDe(false)).toBeNull();
  });
});
