/**
 * Integration — user-management writes against real Postgres (Step 7b, T2).
 *
 * Runs the use cases through `withTenantTransaction` as the least-privilege
 * `systemfact_app` role (FORCE RLS), exactly the way the Server Actions do. The
 * harness superuser client only seeds and reads back, so every "refused"
 * assertion also proves the stored rows, version and audit are unchanged.
 *
 * Note on TEN_ULTIMO_ADMINISTRADOR: with a single Administrador role the actor
 * is always counted among the branch's active administrators, so "last admin"
 * can only be the actor himself and S7a (TEN_AUTO_PROTECCION) fires first; the
 * last-admin rule itself is pinned in the domain/use-case unit tests, and here
 * its OBSERVABLE guarantee is asserted: the branch always keeps one active
 * Administrador, including under concurrency.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { tieneRolPermitidoEnTx } from "@/modules/tenant/infrastructure/usuario-repository";
import {
  cambiarEstadoUsuario,
  cambiarRolesUsuario,
} from "@/modules/tenant/application/gestion-usuarios";
import {
  TEN_AUTO_PROTECCION,
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_ROL_NO_VALIDO,
  TEN_ULTIMO_ADMINISTRADOR,
  TEN_USUARIO_NO_ENCONTRADO,
} from "@/modules/tenant/domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { ROLES_GESTION_USUARIOS } from "@/modules/tenant/http/shared";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("cambiarRolesUsuario / cambiarEstadoUsuario (real DB)", () => {
  let fx: TenantFixture;
  let rolAdminId: number;
  let rolOperadorId: number;
  let rolDespachadorId: number;
  let rolInactivoId: number;
  let admin2Id: number; // second active Administrador of A1
  let objetivoId: number; // Operador of A1
  let a2UserId: number; // user of branch A2
  let ctxAdmin: TenantCtx; // adminA of A1
  let ctxAdmin2: TenantCtx;

  const db = () => getHarnessDb();

  async function findOrCreateRol(nombre: string): Promise<number> {
    const existente = await db().rol.findFirst({ where: { nombre, activo: true } });
    if (existente !== null) return existente.id;
    const creado = await db().rol.create({
      data: { nombre, descripcion: `Integration ${nombre}` },
    });
    return creado.id;
  }

  async function crearUsuario(
    empresaId: number,
    sucursalId: number,
    tag: string,
    rolId: number,
  ): Promise<number> {
    const u = await db().usuario.create({
      data: {
        empresaId,
        sucursalId,
        nombre: tag,
        nombreUsuario: `${tag}-${randomUUID()}`,
        passwordHash: "test-hash",
        roles: { create: { rolId } },
      },
    });
    return u.id;
  }

  async function estado(id: number) {
    const u = await db().usuario.findUniqueOrThrow({
      where: { id },
      select: { activo: true, version: true, roles: { select: { rolId: true } } },
    });
    return {
      activo: u.activo,
      version: u.version,
      rolIds: u.roles.map((r) => r.rolId).sort((a, b) => a - b),
    };
  }

  async function auditoriaUsuario(id: number) {
    return db().movimientoAuditoria.findMany({
      where: { entidad: "Usuario", idEntidad: String(id) },
      orderBy: { id: "asc" },
    });
  }

  async function administradoresActivosA1(): Promise<number> {
    return db().usuario.count({
      where: {
        empresaId: fx.empresaA.id,
        sucursalId: fx.sucursalA1.id,
        activo: true,
        roles: { some: { rol: { nombre: "Administrador" } } },
      },
    });
  }

  const roles = (
    ctx: TenantCtx,
    input: { usuarioId: number; rolIds: number[]; versionEsperada: number },
  ) =>
    withTenantTransaction(ctx, (tx) =>
      cambiarRolesUsuario(tx, ctx, input, ROLES_GESTION_USUARIOS),
    );
  const activo = (
    ctx: TenantCtx,
    input: { usuarioId: number; activo: boolean; versionEsperada: number },
  ) =>
    withTenantTransaction(ctx, (tx) =>
      cambiarEstadoUsuario(tx, ctx, input, ROLES_GESTION_USUARIOS),
    );

  beforeEach(async () => {
    fx = await seedTenantFixture();
    rolAdminId = await findOrCreateRol("Administrador");
    rolOperadorId = await findOrCreateRol("Operador");
    rolDespachadorId = await findOrCreateRol("Despachador");
    rolInactivoId = (
      await db().rol.create({
        data: { nombre: `Inactivo-${randomUUID()}`, descripcion: "inactivo", activo: false },
      })
    ).id;
    admin2Id = await crearUsuario(fx.empresaA.id, fx.sucursalA1.id, "admin2", rolAdminId);
    objetivoId = await crearUsuario(fx.empresaA.id, fx.sucursalA1.id, "objetivo", rolOperadorId);
    a2UserId = await crearUsuario(fx.empresaA.id, fx.sucursalA2.id, "enA2", rolOperadorId);
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxAdmin2 = { ...ctxAdmin, usuarioId: admin2Id };
  });

  describe("S4 roles (SET semantics)", () => {
    it("replaces the role set, bumps the version once and writes ONE audit row with before/after", async () => {
      expect(await estado(objetivoId)).toEqual({
        activo: true,
        version: 1,
        rolIds: [rolOperadorId],
      });

      const result = await roles(ctxAdmin, {
        usuarioId: objetivoId,
        rolIds: [rolDespachadorId, rolOperadorId],
        versionEsperada: 1,
      });

      expect(result).toEqual({
        ok: true,
        data: { usuarioId: objetivoId, version: 2, cambio: true },
      });
      expect(await estado(objetivoId)).toEqual({
        activo: true,
        version: 2,
        rolIds: [rolOperadorId, rolDespachadorId].sort((a, b) => a - b),
      });
      const audit = await auditoriaUsuario(objetivoId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        empresaId: fx.empresaA.id,
        sucursalId: fx.sucursalA1.id,
        usuarioId: fx.usuarios.adminA.id,
        accion: "ACTUALIZAR",
        entidad: "Usuario",
        idEntidad: String(objetivoId),
        valorAnterior: JSON.stringify({ roles: ["Operador"] }),
        valorNuevo: JSON.stringify({ roles: ["Despachador", "Operador"] }),
      });
    });

    it("a repeat with the same set and the CURRENT version is a no-op: no second audit row, no version bump", async () => {
      await roles(ctxAdmin, {
        usuarioId: objetivoId,
        rolIds: [rolDespachadorId],
        versionEsperada: 1,
      });

      const repetido = await roles(ctxAdmin, {
        usuarioId: objetivoId,
        rolIds: [rolDespachadorId],
        versionEsperada: 2,
      });

      expect(repetido).toEqual({
        ok: true,
        data: { usuarioId: objetivoId, version: 2, cambio: false },
      });
      expect((await estado(objetivoId)).version).toBe(2);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(1);
    });

    it("a stale version conflicts and changes nothing — even if the requested set is already in place", async () => {
      await roles(ctxAdmin, {
        usuarioId: objetivoId,
        rolIds: [rolDespachadorId],
        versionEsperada: 1,
      });
      const despues = await estado(objetivoId);

      const otroSet = await roles(ctxAdmin, {
        usuarioId: objetivoId,
        rolIds: [rolOperadorId],
        versionEsperada: 1,
      });
      const mismoSet = await roles(ctxAdmin, {
        usuarioId: objetivoId,
        rolIds: [rolDespachadorId],
        versionEsperada: 1,
      });

      expect(otroSet).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
      expect(mismoSet).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
      expect(await estado(objetivoId)).toEqual(despues);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(1);
    });

    it.each([
      ["inactive rol id", () => [rolInactivoId]],
      ["unknown rol id", () => [2147483000]],
      ["duplicate rol id", () => [rolOperadorId, rolOperadorId]],
      ["empty list", () => []],
    ])("%s => TEN_ROL_NO_VALIDO, data unchanged", async (_n, ids) => {
      const antes = await estado(objetivoId);
      const result = await roles(ctxAdmin, {
        usuarioId: objetivoId,
        rolIds: ids(),
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_ROL_NO_VALIDO });
      expect(await estado(objetivoId)).toEqual(antes);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });
  });

  describe("S5 activo", () => {
    it("deactivates then reactivates (never deletes), one audit row each, version +1 each", async () => {
      const off = await activo(ctxAdmin, {
        usuarioId: objetivoId,
        activo: false,
        versionEsperada: 1,
      });
      expect(off).toEqual({
        ok: true,
        data: { usuarioId: objetivoId, version: 2, cambio: true },
      });
      expect(await estado(objetivoId)).toMatchObject({
        activo: false,
        version: 2,
        rolIds: [rolOperadorId],
      });

      const on = await activo(ctxAdmin, {
        usuarioId: objetivoId,
        activo: true,
        versionEsperada: 2,
      });
      expect(on).toEqual({
        ok: true,
        data: { usuarioId: objetivoId, version: 3, cambio: true },
      });
      expect(await estado(objetivoId)).toMatchObject({ activo: true, version: 3 });

      const audit = await auditoriaUsuario(objetivoId);
      expect(audit.map((a) => [a.valorAnterior, a.valorNuevo])).toEqual([
        [JSON.stringify({ activo: true }), JSON.stringify({ activo: false })],
        [JSON.stringify({ activo: false }), JSON.stringify({ activo: true })],
      ]);
      expect(
        audit.every((a) => a.usuarioId === fx.usuarios.adminA.id && a.accion === "ACTUALIZAR"),
      ).toBe(true);
    });

    it("repeat with the same target state is a no-op: no audit row, no version bump", async () => {
      await activo(ctxAdmin, { usuarioId: objetivoId, activo: false, versionEsperada: 1 });
      const repetido = await activo(ctxAdmin, {
        usuarioId: objetivoId,
        activo: false,
        versionEsperada: 2,
      });
      expect(repetido).toEqual({
        ok: true,
        data: { usuarioId: objetivoId, version: 2, cambio: false },
      });
      expect((await estado(objetivoId)).version).toBe(2);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(1);
    });

    it("stale version conflicts and changes nothing", async () => {
      const result = await activo(ctxAdmin, {
        usuarioId: objetivoId,
        activo: false,
        versionEsperada: 7,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
      expect(await estado(objetivoId)).toMatchObject({ activo: true, version: 1 });
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });
  });

  describe("S7a self-guard", () => {
    it("self-deactivation is refused, data unchanged", async () => {
      const antes = await estado(ctxAdmin.usuarioId);
      const result = await activo(ctxAdmin, {
        usuarioId: ctxAdmin.usuarioId,
        activo: false,
        versionEsperada: antes.version,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_AUTO_PROTECCION });
      expect(await estado(ctxAdmin.usuarioId)).toEqual(antes);
      expect(await auditoriaUsuario(ctxAdmin.usuarioId)).toHaveLength(0);
    });

    it("self-demotion is refused, data unchanged (even with another administrator available)", async () => {
      const antes = await estado(ctxAdmin.usuarioId);
      const result = await roles(ctxAdmin, {
        usuarioId: ctxAdmin.usuarioId,
        rolIds: [rolOperadorId],
        versionEsperada: antes.version,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_AUTO_PROTECCION });
      expect(await estado(ctxAdmin.usuarioId)).toEqual(antes);
      expect(await auditoriaUsuario(ctxAdmin.usuarioId)).toHaveLength(0);
    });
  });

  describe("S7b the branch keeps an active Administrador", () => {
    it("the sole remaining administrator cannot be removed by himself nor by a former administrator", async () => {
      // adminA deactivates admin2 (allowed: adminA stays). adminA is now the only one.
      expect(
        await activo(ctxAdmin, { usuarioId: admin2Id, activo: false, versionEsperada: 1 }),
      ).toMatchObject({ ok: true });
      expect(await administradoresActivosA1()).toBe(1);
      const antes = await estado(ctxAdmin.usuarioId);

      const porSiMismo = await activo(ctxAdmin, {
        usuarioId: ctxAdmin.usuarioId,
        activo: false,
        versionEsperada: antes.version,
      });
      // admin2 is inactive: the actor is re-proved under the lock and refused.
      const porInactivo = await roles(ctxAdmin2, {
        usuarioId: ctxAdmin.usuarioId,
        rolIds: [rolOperadorId],
        versionEsperada: antes.version,
      });

      expect(porSiMismo).toMatchObject({ ok: false, code: TEN_AUTO_PROTECCION });
      expect(porInactivo).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await estado(ctxAdmin.usuarioId)).toEqual(antes);
      expect(await administradoresActivosA1()).toBe(1);
    });

    it("two administrators concurrently deactivating each other end with exactly ONE active Administrador", async () => {
      const resultados = await Promise.all([
        activo(ctxAdmin, { usuarioId: admin2Id, activo: false, versionEsperada: 1 }),
        activo(ctxAdmin2, {
          usuarioId: fx.usuarios.adminA.id,
          activo: false,
          versionEsperada: 1,
        }),
      ]);

      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const fallo = resultados.find((r) => !r.ok);
      // The loser was refused after the winner committed: his authority is gone
      // (actor re-check) or the last-admin rule applies — never a second success.
      expect([TEN_OPS_NO_AUTORIZADO, TEN_ULTIMO_ADMINISTRADOR]).toContain(
        fallo !== undefined && !fallo.ok ? fallo.code : null,
      );
      expect(await administradoresActivosA1()).toBe(1);
    });

    it("the same race through role demotion also leaves exactly ONE active Administrador", async () => {
      const resultados = await Promise.all([
        roles(ctxAdmin, { usuarioId: admin2Id, rolIds: [rolOperadorId], versionEsperada: 1 }),
        roles(ctxAdmin2, {
          usuarioId: fx.usuarios.adminA.id,
          rolIds: [rolOperadorId],
          versionEsperada: 1,
        }),
      ]);

      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      expect(await administradoresActivosA1()).toBe(1);
    });
  });

  describe("S7c tenant-blind targets", () => {
    it("a foreign-empresa target => TEN_USUARIO_NO_ENCONTRADO, data unchanged, for both writes", async () => {
      const antes = await estado(fx.usuarios.adminB.id);
      const r1 = await roles(ctxAdmin, {
        usuarioId: fx.usuarios.adminB.id,
        rolIds: [rolOperadorId],
        versionEsperada: antes.version,
      });
      const r2 = await activo(ctxAdmin, {
        usuarioId: fx.usuarios.adminB.id,
        activo: false,
        versionEsperada: antes.version,
      });
      expect(r1).toMatchObject({ ok: false, code: TEN_USUARIO_NO_ENCONTRADO });
      expect(r2).toMatchObject({ ok: false, code: TEN_USUARIO_NO_ENCONTRADO });
      expect(await estado(fx.usuarios.adminB.id)).toEqual(antes);
      expect(await auditoriaUsuario(fx.usuarios.adminB.id)).toHaveLength(0);
    });

    it("an other-branch (A2) target of the same empresa => TEN_USUARIO_NO_ENCONTRADO, data unchanged", async () => {
      const antes = await estado(a2UserId);
      const r1 = await roles(ctxAdmin, {
        usuarioId: a2UserId,
        rolIds: [rolAdminId],
        versionEsperada: antes.version,
      });
      const r2 = await activo(ctxAdmin, {
        usuarioId: a2UserId,
        activo: false,
        versionEsperada: antes.version,
      });
      expect(r1).toMatchObject({ ok: false, code: TEN_USUARIO_NO_ENCONTRADO });
      expect(r2).toMatchObject({ ok: false, code: TEN_USUARIO_NO_ENCONTRADO });
      expect(await estado(a2UserId)).toEqual(antes);
      expect(await auditoriaUsuario(a2UserId)).toHaveLength(0);
    });

    it("an unknown id behaves exactly like a foreign one", async () => {
      const r = await activo(ctxAdmin, {
        usuarioId: 2147483000,
        activo: false,
        versionEsperada: 1,
      });
      expect(r).toMatchObject({ ok: false, code: TEN_USUARIO_NO_ENCONTRADO });
    });
  });

  describe("S3 Operador (app guard + DB-wall smoke)", () => {
    it("the action guard flow refuses an Operador: the write is never reached", async () => {
      const antes = await estado(objetivoId);
      const ctxOperador: TenantCtx = { ...ctxAdmin, usuarioId: objetivoId, esAdmin: false };
      const result = await withTenantTransaction(ctxOperador, async (tx) => {
        const permitido = await tieneRolPermitidoEnTx(
          tx,
          ctxOperador.usuarioId,
          ctxOperador.empresaId,
          ROLES_GESTION_USUARIOS,
        );
        if (!permitido) return { ok: false as const, code: TEN_OPS_NO_AUTORIZADO };
        return cambiarEstadoUsuario(
          tx,
          ctxOperador,
          { usuarioId: objetivoId, activo: false, versionEsperada: 1 },
          ROLES_GESTION_USUARIOS,
        );
      });
      expect(result).toEqual({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await estado(objetivoId)).toEqual(antes);
    });

    it("with the app guard bypassed, an Operador session still writes nothing", async () => {
      const antes = await estado(objetivoId);
      const otroOperador = await crearUsuario(
        fx.empresaA.id,
        fx.sucursalA1.id,
        "oper2",
        rolOperadorId,
      );
      const ctxOperador: TenantCtx = { ...ctxAdmin, usuarioId: otroOperador, esAdmin: false };
      const result = await activo(ctxOperador, {
        usuarioId: objetivoId,
        activo: false,
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await estado(objetivoId)).toEqual(antes);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });
  });

  describe("S9 deactivation is effective on the next request", () => {
    it("getCurrentTenantContext resolves the user before and returns null after activo=false", async () => {
      const sub = randomUUID();
      await db().usuario.update({ where: { id: objetivoId }, data: { authUserId: sub } });
      const supabase = {
        auth: { getUser: async () => ({ data: { user: { id: sub } }, error: null }) },
      } as unknown as SupabaseClient;

      expect(await getCurrentTenantContext(supabase)).toMatchObject({
        usuarioId: objetivoId,
        empresaId: fx.empresaA.id,
      });

      const result = await activo(ctxAdmin, {
        usuarioId: objetivoId,
        activo: false,
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: true });
      expect(await getCurrentTenantContext(supabase)).toBeNull();

      await activo(ctxAdmin, { usuarioId: objetivoId, activo: true, versionEsperada: 2 });
      expect(await getCurrentTenantContext(supabase)).toMatchObject({ usuarioId: objetivoId });
    });
  });
});
