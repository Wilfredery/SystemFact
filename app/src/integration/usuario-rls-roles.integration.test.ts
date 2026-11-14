/**
 * Integration — role-aware RLS on USUARIO / USUARIO_ROL (real DB, app role).
 *
 * Migration `20261114120000_usuario_writes_admin_only` (odd/tasks/
 * administracion-writes.md S2): writes need `app.current_es_admin = 'true'`
 * plus the tenant/branch scope; SELECT is unchanged; the login flow keeps its
 * minimal lazy `authUserId` bind; bootstrap keeps full write access.
 *
 * Everything under test runs through `@/lib/prisma` (least-privilege
 * `systemfact_app`, FORCE RLS). The harness superuser client only seeds and
 * reads back stored data, so every "refused" assertion also proves that the
 * stored rows are unchanged.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { setLoginFlow } from "@/modules/tenant/infrastructure/login-flow";
import { enlazarAuthSub } from "@/modules/auth/infrastructure/auth-identity";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const RLS_VIOLATION = /row-level security|violates|policy/i;

describe("USUARIO / USUARIO_ROL role-aware RLS (real DB)", () => {
  let fx: TenantFixture;
  let rolAdminId: number;
  let rolOperadorId: number;
  let operadorId: number;
  let objetivoId: number; // plain user of A1 (target of the writes)
  let usuarioA2Id: number; // user of branch A2 (outside the A1 branch scope)
  let ctxAdmin: TenantCtx;
  let ctxOperador: TenantCtx;

  beforeEach(async () => {
    fx = await seedTenantFixture();
    const db = getHarnessDb();

    const rolAdmin = await db.rol.findFirstOrThrow({ where: { nombre: "Administrador" } });
    rolAdminId = rolAdmin.id;
    let rolOperador = await db.rol.findFirst({ where: { nombre: "Operador" } });
    if (rolOperador === null) {
      rolOperador = await db.rol.create({
        data: { nombre: "Operador", descripcion: "Integration harness operador role" },
      });
    }
    rolOperadorId = rolOperador.id;

    const suffix = randomUUID();
    const crear = (empresaId: number, sucursalId: number, tag: string) =>
      db.usuario.create({
        data: {
          empresaId,
          sucursalId,
          nombre: tag,
          nombreUsuario: `${tag}-${suffix}`,
          passwordHash: "test-hash",
          roles: { create: { rolId: rolOperador.id } },
        },
      });
    const operador = await crear(fx.empresaA.id, fx.sucursalA1.id, "operador-a1");
    const objetivo = await crear(fx.empresaA.id, fx.sucursalA1.id, "objetivo-a1");
    const a2 = await crear(fx.empresaA.id, fx.sucursalA2.id, "usuario-a2");
    operadorId = operador.id;
    objetivoId = objetivo.id;
    usuarioA2Id = a2.id;

    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxOperador = { ...ctxAdmin, usuarioId: operadorId, esAdmin: false };
  });

  const rolesDe = async (usuarioId: number): Promise<number[]> => {
    const rows = await getHarnessDb().usuarioRol.findMany({
      where: { usuarioId },
      orderBy: { rolId: "asc" },
    });
    return rows.map((r) => r.rolId);
  };

  // ── (1) Administrador can write inside its own branch ─────────────────
  describe("Administrador (esAdmin: true)", () => {
    it("updates usuario.activo of a user of its own branch", async () => {
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuario.updateMany({
          where: { id: objetivoId, empresaId: fx.empresaA.id },
          data: { activo: false },
        }),
      );
      expect(res.count).toBe(1);
      const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: objetivoId } });
      expect(stored.activo).toBe(false);
    });

    it("inserts and deletes a USUARIO_ROL row for a user of its own branch", async () => {
      await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuarioRol.create({ data: { usuarioId: objetivoId, rolId: rolAdminId } }),
      );
      expect(await rolesDe(objetivoId)).toEqual([rolAdminId, rolOperadorId].sort((a, b) => a - b));

      const del = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuarioRol.deleteMany({ where: { usuarioId: objetivoId, rolId: rolOperadorId } }),
      );
      expect(del.count).toBe(1);
      expect(await rolesDe(objetivoId)).toEqual([rolAdminId]);
    });

    it("cannot write a user of ANOTHER branch of the same empresa (branch scope kept)", async () => {
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuario.updateMany({ where: { id: usuarioA2Id }, data: { activo: false } }),
      );
      expect(res.count).toBe(0);
      const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: usuarioA2Id } });
      expect(stored.activo).toBe(true);
    });
  });

  // ── (2) Non-admin is refused by the DATABASE ──────────────────────────
  describe("Operador (esAdmin: false) is refused by the database", () => {
    it("UPDATE USUARIO touches zero rows and stored data is unchanged", async () => {
      const res = await withTenantTransaction(ctxOperador, (tx) =>
        tx.usuario.updateMany({ where: { id: objetivoId }, data: { activo: false } }),
      );
      expect(res.count).toBe(0);
      const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: objetivoId } });
      expect(stored.activo).toBe(true);
      expect(stored.version).toBe(1);
    });

    it("cannot even update its own USUARIO row", async () => {
      const res = await withTenantTransaction(ctxOperador, (tx) =>
        tx.usuario.updateMany({ where: { id: operadorId }, data: { activo: false } }),
      );
      expect(res.count).toBe(0);
      const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: operadorId } });
      expect(stored.activo).toBe(true);
    });

    it("INSERT USUARIO_ROL raises an RLS violation and stores nothing", async () => {
      await expect(
        withTenantTransaction(ctxOperador, (tx) =>
          tx.usuarioRol.create({ data: { usuarioId: operadorId, rolId: rolAdminId } }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      expect(await rolesDe(operadorId)).toEqual([rolOperadorId]);
    });

    it("DELETE USUARIO_ROL deletes zero rows and stored roles are unchanged", async () => {
      const res = await withTenantTransaction(ctxOperador, (tx) =>
        tx.usuarioRol.deleteMany({ where: { usuarioId: objetivoId } }),
      );
      expect(res.count).toBe(0);
      expect(await rolesDe(objetivoId)).toEqual([rolOperadorId]);
    });

    it("INSERT USUARIO raises an RLS violation and stores nothing", async () => {
      const before = await getHarnessDb().usuario.count();
      await expect(
        withTenantTransaction(ctxOperador, (tx) =>
          tx.usuario.create({
            data: {
              empresaId: fx.empresaA.id,
              sucursalId: fx.sucursalA1.id,
              nombre: "intruso",
              nombreUsuario: `intruso-${randomUUID()}`,
              passwordHash: "x",
            },
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      expect(await getHarnessDb().usuario.count()).toBe(before);
    });

    it("DELETE USUARIO deletes zero rows", async () => {
      const res = await withTenantTransaction(ctxOperador, (tx) =>
        tx.usuario.deleteMany({ where: { id: objetivoId } }),
      );
      expect(res.count).toBe(0);
      expect(await getHarnessDb().usuario.count({ where: { id: objetivoId } })).toBe(1);
    });
  });

  // ── (3) Cross-tenant ──────────────────────────────────────────────────
  describe("cross-tenant: admin of empresa A vs empresa B", () => {
    it("cannot UPDATE / DELETE a user of B nor its USUARIO_ROL, and B stays unchanged", async () => {
      const db = getHarnessDb();
      const adminBId = fx.usuarios.adminB.id;
      await db.usuarioRol.create({ data: { usuarioId: adminBId, rolId: rolOperadorId } });

      const upd = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuario.updateMany({ where: { id: adminBId }, data: { activo: false } }),
      );
      const delRoles = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuarioRol.deleteMany({ where: { usuarioId: adminBId } }),
      );
      const delUser = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuario.deleteMany({ where: { id: adminBId } }),
      );
      expect([upd.count, delRoles.count, delUser.count]).toEqual([0, 0, 0]);

      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.usuarioRol.create({ data: { usuarioId: adminBId, rolId: rolAdminId } }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);

      const stored = await db.usuario.findUniqueOrThrow({ where: { id: adminBId } });
      expect(stored.activo).toBe(true);
      expect(await rolesDe(adminBId)).toEqual([rolOperadorId]);
    });

    it("cannot move a user's empresaId to B (WITH CHECK) and the row is unchanged", async () => {
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.usuario.updateMany({
            where: { id: objetivoId },
            data: { empresaId: fx.empresaB.id, sucursalId: fx.sucursalB1.id },
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: objetivoId } });
      expect(stored.empresaId).toBe(fx.empresaA.id);
      expect(stored.sucursalId).toBe(fx.sucursalA1.id);
    });

    it("cannot INSERT a USUARIO into empresa B", async () => {
      const before = await getHarnessDb().usuario.count();
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.usuario.create({
            data: {
              empresaId: fx.empresaB.id,
              sucursalId: fx.sucursalB1.id,
              nombre: "cross",
              nombreUsuario: `cross-${randomUUID()}`,
              passwordHash: "x",
            },
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      expect(await getHarnessDb().usuario.count()).toBe(before);
    });
  });

  // ── (4) SELECT unchanged ──────────────────────────────────────────────
  describe("SELECT behaviour is unchanged", () => {
    it.each([
      ["admin", () => ctxAdmin],
      ["non-admin", () => ctxOperador],
    ])("%s sees the same USUARIO and USUARIO_ROL rows (own branch only)", async (_label, pick) => {
      const ctx = pick();
      const { usuarios, roles } = await withTenantTransaction(ctx, async (tx) => ({
        usuarios: await tx.usuario.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
        roles: await tx.usuarioRol.findMany({ orderBy: [{ usuarioId: "asc" }, { rolId: "asc" }] }),
      }));
      const visibles = [fx.usuarios.adminA.id, operadorId, objetivoId].sort((a, b) => a - b);
      expect(usuarios.map((u) => u.id)).toEqual(visibles);
      expect(roles.map((r) => r.usuarioId).sort((a, b) => a - b)).toEqual(
        [fx.usuarios.adminA.id, operadorId, objetivoId].sort((a, b) => a - b),
      );
      expect(usuarios.map((u) => u.id)).not.toContain(usuarioA2Id);
      expect(usuarios.map((u) => u.id)).not.toContain(fx.usuarios.adminB.id);
    });
  });

  // ── (5) Login flow and bootstrap exceptions ───────────────────────────
  describe("login-flow exception (minimal)", () => {
    const anchor = () => ({ usuarioId: objetivoId, empresaId: fx.empresaA.id });

    it("enlazarAuthSub still binds authUserId under a non-admin session, idempotently", async () => {
      const sub = randomUUID();
      expect(await enlazarAuthSub({ authSub: sub, ...anchor() })).toEqual({ ok: true });
      let stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: objetivoId } });
      expect(stored.authUserId).toBe(sub);

      expect(await enlazarAuthSub({ authSub: sub, ...anchor() })).toEqual({ ok: true });

      const otro = await enlazarAuthSub({ authSub: randomUUID(), ...anchor() });
      expect(otro.ok).toBe(false);
      stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: objetivoId } });
      expect(stored.authUserId).toBe(sub);
    });

    it("login flow cannot change anything else: activo, unbind, rebind, other empresa, roles", async () => {
      const db = getHarnessDb();
      const sub = randomUUID();
      await db.usuario.update({ where: { id: objetivoId }, data: { authUserId: sub } });

      const pinned = async <T>(empresaId: number, fn: (tx: Parameters<typeof setLoginFlow>[0]) => Promise<T>) =>
        prisma.$transaction(async (tx) => {
          await setLoginFlow(tx);
          await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${String(empresaId)}, true)`;
          return fn(tx);
        });

      // activo flip on an UNBOUND row (operador has no authUserId): refused. The
      // column-guard trigger (20261114130000) fires BEFORE the WITH CHECK, so the
      // refusal is either the trigger's or the policy's.
      await expect(
        pinned(fx.empresaA.id, (tx) =>
          (tx as typeof prisma).usuario.updateMany({ where: { id: operadorId }, data: { activo: false } }),
        ),
      ).rejects.toThrow(/login flow may only change|row-level security|violates|policy/i);
      // Rebind / unbind of an already bound row: zero rows (USING needs authUserId IS NULL).
      const rebind = await pinned(fx.empresaA.id, (tx) =>
        (tx as typeof prisma).usuario.updateMany({ where: { id: objetivoId }, data: { authUserId: randomUUID() } }),
      );
      expect(rebind.count).toBe(0);
      // Binding a row of ANOTHER empresa under A's pin: zero rows.
      const foreign = await pinned(fx.empresaA.id, (tx) =>
        (tx as typeof prisma).usuario.updateMany({
          where: { id: fx.usuarios.adminB.id },
          data: { authUserId: randomUUID() },
        }),
      );
      expect(foreign.count).toBe(0);
      // No write on USUARIO_ROL and no delete on USUARIO.
      await expect(
        pinned(fx.empresaA.id, (tx) =>
          (tx as typeof prisma).usuarioRol.create({ data: { usuarioId: operadorId, rolId: rolAdminId } }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
      const delRoles = await pinned(fx.empresaA.id, (tx) =>
        (tx as typeof prisma).usuarioRol.deleteMany({ where: { usuarioId: operadorId } }),
      );
      expect(delRoles.count).toBe(0);
      const delUser = await pinned(fx.empresaA.id, (tx) =>
        (tx as typeof prisma).usuario.deleteMany({ where: { id: operadorId } }),
      );
      expect(delUser.count).toBe(0);

      const op = await db.usuario.findUniqueOrThrow({ where: { id: operadorId } });
      expect(op.activo).toBe(true);
      expect(op.authUserId).toBeNull();
      expect((await db.usuario.findUniqueOrThrow({ where: { id: objetivoId } })).authUserId).toBe(sub);
      expect((await db.usuario.findUniqueOrThrow({ where: { id: fx.usuarios.adminB.id } })).authUserId).toBeNull();
      expect(await rolesDe(operadorId)).toEqual([rolOperadorId]);
    });
  });

  describe("bootstrap exception", () => {
    it("is_bootstrap can still INSERT / UPDATE / DELETE USUARIO and USUARIO_ROL (no tenant, no admin)", async () => {
      const db = getHarnessDb();
      const nombreUsuario = `boot-${randomUUID()}`;
      const creadoId = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
        const u = await tx.usuario.create({
          data: {
            empresaId: fx.empresaB.id,
            sucursalId: fx.sucursalB1.id,
            nombre: "boot",
            nombreUsuario,
            passwordHash: "x",
          },
        });
        await tx.usuarioRol.create({ data: { usuarioId: u.id, rolId: rolAdminId } });
        const upd = await tx.usuario.updateMany({ where: { id: u.id }, data: { activo: false } });
        expect(upd.count).toBe(1);
        return u.id;
      });
      const stored = await db.usuario.findUniqueOrThrow({ where: { id: creadoId } });
      expect(stored.activo).toBe(false);
      expect(await rolesDe(creadoId)).toEqual([rolAdminId]);

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
        expect((await tx.usuarioRol.deleteMany({ where: { usuarioId: creadoId } })).count).toBe(1);
        expect((await tx.usuario.deleteMany({ where: { id: creadoId } })).count).toBe(1);
      });
      expect(await db.usuario.count({ where: { id: creadoId } })).toBe(0);
    });
  });
});
