/**
 * Integration — move a user to another branch against real Postgres
 * (odd/tasks/administracion-mover-usuario.md, T1, S1-S9/S11).
 *
 * Runs the use case through `withTenantTransaction` as the least-privilege
 * `systemfact_app` role (FORCE RLS), the way the Server Action does. The
 * harness superuser client only seeds and reads back, so every "refused"
 * assertion also proves that the stored rows, version and audit are unchanged.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { tieneRolPermitidoEnTx } from "@/modules/tenant/infrastructure/usuario-repository";
import { liberarSucursalActivaEnTx } from "@/modules/tenant/infrastructure/repo-sucursal";
import { moverUsuarioDeSucursal } from "@/modules/tenant/application/gestion-usuarios";
import {
  TEN_AUTO_PROTECCION,
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_ULTIMO_ADMINISTRADOR,
  TEN_USUARIO_NO_ENCONTRADO,
} from "@/modules/tenant/domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { ROLES_GESTION_USUARIOS } from "@/modules/tenant/http/shared";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("moverUsuarioDeSucursal (real DB)", () => {
  let fx: TenantFixture;
  let rolAdminId: number;
  let rolOperadorId: number;
  let sucursalA3InactivaId: number;
  let admin2A1Id: number; // second active Administrador of A1
  let objetivoId: number; // Operador of A1
  let enA2Id: number; // Operador of A2
  let ctxAdmin: TenantCtx; // adminA, session branch A1
  let ctxOperador: TenantCtx;

  const db = () => getHarnessDb();

  async function findOrCreateRol(nombre: string): Promise<number> {
    const existente = await db().rol.findFirst({ where: { nombre, activo: true } });
    if (existente !== null) return existente.id;
    return (
      await db().rol.create({ data: { nombre, descripcion: `Integration ${nombre}` } })
    ).id;
  }

  async function crearUsuario(
    sucursalId: number,
    tag: string,
    rolId: number,
    empresaId = fx.empresaA.id,
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
    return db().usuario.findUniqueOrThrow({
      where: { id },
      select: { sucursalId: true, version: true, activo: true },
    });
  }

  async function auditoriaUsuario(id: number) {
    return db().movimientoAuditoria.findMany({
      where: { entidad: "Usuario", idEntidad: String(id) },
      orderBy: { id: "asc" },
    });
  }

  const mover = (
    ctx: TenantCtx,
    input: { usuarioId: number; sucursalDestinoId: number; versionEsperada: number },
  ) =>
    withTenantTransaction(ctx, (tx) =>
      moverUsuarioDeSucursal(tx, ctx, input, ROLES_GESTION_USUARIOS),
    );

  beforeEach(async () => {
    fx = await seedTenantFixture();
    rolAdminId = await findOrCreateRol("Administrador");
    rolOperadorId = await findOrCreateRol("Operador");
    sucursalA3InactivaId = (
      await db().sucursal.create({
        data: {
          empresaId: fx.empresaA.id,
          nombre: "A3-inactiva",
          direccion: "x",
          telefono: "0",
          activa: false,
        },
      })
    ).id;
    admin2A1Id = await crearUsuario(fx.sucursalA1.id, "admin2a1", rolAdminId);
    objetivoId = await crearUsuario(fx.sucursalA1.id, "objetivo", rolOperadorId);
    enA2Id = await crearUsuario(fx.sucursalA2.id, "enA2", rolOperadorId);
    const operadorId = await crearUsuario(fx.sucursalA1.id, "oper", rolOperadorId);
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxOperador = { ...ctxAdmin, usuarioId: operadorId, esAdmin: false };
  });

  describe("happy path", () => {
    it("moves a user of the session branch to another active branch: row, version +1 and ONE audit row", async () => {
      const result = await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 1,
      });

      expect(result).toEqual({
        ok: true,
        data: { usuarioId: objetivoId, version: 2, cambio: true },
      });
      expect(await estado(objetivoId)).toEqual({
        sucursalId: fx.sucursalA2.id,
        version: 2,
        activo: true,
      });
      const audit = await auditoriaUsuario(objetivoId);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        empresaId: fx.empresaA.id,
        // The audit insert runs with the SESSION branch pinned again.
        sucursalId: fx.sucursalA1.id,
        usuarioId: fx.usuarios.adminA.id,
        accion: "ACTUALIZAR",
        entidad: "Usuario",
        idEntidad: String(objetivoId),
        valorAnterior: JSON.stringify({ sucursalId: fx.sucursalA1.id }),
        valorNuevo: JSON.stringify({ sucursalId: fx.sucursalA2.id }),
      });
    });

    it("moves a user of ANOTHER branch (company-wide target read) into the session branch", async () => {
      const result = await mover(ctxAdmin, {
        usuarioId: enA2Id,
        sucursalDestinoId: fx.sucursalA1.id,
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: true, data: { version: 2, cambio: true } });
      expect((await estado(enA2Id)).sucursalId).toBe(fx.sucursalA1.id);
      expect(await auditoriaUsuario(enA2Id)).toHaveLength(1);
    });

    it("an administrator moves while the source keeps another active administrator", async () => {
      const result = await mover(ctxAdmin, {
        usuarioId: admin2A1Id,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: true, data: { cambio: true } });
      expect((await estado(admin2A1Id)).sucursalId).toBe(fx.sucursalA2.id);
    });

    it("nothing but USUARIO.sucursalId and version changes (documents keep their own branch)", async () => {
      const antes = await db().usuario.findUniqueOrThrow({ where: { id: objetivoId } });
      await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 1,
      });
      const despues = await db().usuario.findUniqueOrThrow({ where: { id: objetivoId } });
      expect({
        ...despues,
        sucursalId: antes.sucursalId,
        version: antes.version,
        updatedAt: antes.updatedAt,
      }).toEqual(antes);
    });

    it("the moved user's NEXT context reports the destination branch (S8)", async () => {
      const sub = randomUUID();
      await db().usuario.update({ where: { id: objetivoId }, data: { authUserId: sub } });
      const supabase = {
        auth: { getUser: async () => ({ data: { user: { id: sub } }, error: null }) },
      } as unknown as SupabaseClient;
      expect(await getCurrentTenantContext(supabase)).toMatchObject({
        usuarioId: objetivoId,
        sucursalId: fx.sucursalA1.id,
      });

      await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 1,
      });

      expect(await getCurrentTenantContext(supabase)).toMatchObject({
        usuarioId: objetivoId,
        empresaId: fx.empresaA.id,
        sucursalId: fx.sucursalA2.id,
      });
    });
  });

  describe("branch GUC", () => {
    it("is restored after the move: a later write in the SAME transaction is branch-pinned again", async () => {
      const resultado = await withTenantTransaction(ctxAdmin, async (tx) => {
        const movido = await moverUsuarioDeSucursal(
          tx,
          ctxAdmin,
          { usuarioId: objetivoId, sucursalDestinoId: fx.sucursalA2.id, versionEsperada: 1 },
          ROLES_GESTION_USUARIOS,
        );
        const guc = await tx.$queryRaw<{ v: string }[]>`
          SELECT current_setting('app.current_sucursal_id', true) AS v`;
        const empresaGuc = await tx.$queryRaw<{ v: string }[]>`
          SELECT current_setting('app.current_empresa_id', true) AS v`;
        // Pinned: a user of branch A2 is invisible to the write, one of A1 is not.
        const enOtraSucursal = await tx.usuario.updateMany({
          where: { id: enA2Id },
          data: { nombre: "no-debe-cambiar" },
        });
        const enSucursalPropia = await tx.usuario.updateMany({
          where: { id: admin2A1Id },
          data: { nombre: "cambia" },
        });
        return { movido, guc: guc[0].v, empresaGuc: empresaGuc[0].v, enOtraSucursal, enSucursalPropia };
      });

      expect(resultado.movido).toMatchObject({ ok: true });
      expect(resultado.guc).toBe(String(fx.sucursalA1.id));
      expect(resultado.empresaGuc).toBe(String(fx.empresaA.id));
      expect(resultado.enOtraSucursal.count).toBe(0);
      expect(resultado.enSucursalPropia.count).toBe(1);
      expect((await db().usuario.findUniqueOrThrow({ where: { id: enA2Id } })).nombre).toBe("enA2");
    });

    it("is restored after a REFUSED move too", async () => {
      const guc = await withTenantTransaction(ctxAdmin, async (tx) => {
        const r = await moverUsuarioDeSucursal(
          tx,
          ctxAdmin,
          { usuarioId: objetivoId, sucursalDestinoId: fx.sucursalA2.id, versionEsperada: 99 },
          ROLES_GESTION_USUARIOS,
        );
        expect(r).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
        const v = await tx.$queryRaw<{ v: string }[]>`
          SELECT current_setting('app.current_sucursal_id', true) AS v`;
        return v[0].v;
      });
      expect(guc).toBe(String(fx.sucursalA1.id));
    });
  });

  describe("authorization (Operador)", () => {
    it("the action gate refuses an Operador: the move is never reached", async () => {
      const antes = await estado(objetivoId);
      const result = await withTenantTransaction(ctxOperador, async (tx) => {
        const permitido = await tieneRolPermitidoEnTx(
          tx,
          ctxOperador.usuarioId,
          ctxOperador.empresaId,
          ROLES_GESTION_USUARIOS,
        );
        if (!permitido) return { ok: false as const, code: TEN_OPS_NO_AUTORIZADO };
        return moverUsuarioDeSucursal(
          tx,
          ctxOperador,
          { usuarioId: objetivoId, sucursalDestinoId: fx.sucursalA2.id, versionEsperada: 1 },
          ROLES_GESTION_USUARIOS,
        );
      });
      expect(result).toEqual({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await estado(objetivoId)).toEqual(antes);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });

    it("with the gate bypassed the use case re-proves the actor and refuses an Operador", async () => {
      const antes = await estado(objetivoId);
      const result = await mover(ctxOperador, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await estado(objetivoId)).toEqual(antes);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });

    it("the DATABASE wall: an Operador UPDATE of USUARIO.sucursalId under a blank branch GUC changes 0 rows", async () => {
      const antes = await estado(objetivoId);
      const res = await withTenantTransaction(ctxOperador, async (tx) => {
        await liberarSucursalActivaEnTx(tx);
        return tx.usuario.updateMany({
          where: { id: objetivoId, empresaId: fx.empresaA.id },
          data: { sucursalId: fx.sucursalA2.id },
        });
      });
      expect(res.count).toBe(0);
      expect(await estado(objetivoId)).toEqual(antes);
    });
  });

  describe("target and destination validation", () => {
    it("a destination of ANOTHER empresa => TEN_SUCURSAL_NO_VALIDA, nothing written", async () => {
      const antes = await estado(objetivoId);
      const result = await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalB1.id,
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_SUCURSAL_NO_VALIDA });
      expect(await estado(objetivoId)).toEqual(antes);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });

    it("an INACTIVE destination => TEN_SUCURSAL_NO_VALIDA, nothing written", async () => {
      const antes = await estado(objetivoId);
      const result = await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: sucursalA3InactivaId,
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_SUCURSAL_NO_VALIDA });
      expect(await estado(objetivoId)).toEqual(antes);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });

    it("a user of another empresa and an unknown id => TEN_USUARIO_NO_ENCONTRADO, nothing written", async () => {
      const antes = await estado(fx.usuarios.adminB.id);
      const foraneo = await mover(ctxAdmin, {
        usuarioId: fx.usuarios.adminB.id,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: antes.version,
      });
      const desconocido = await mover(ctxAdmin, {
        usuarioId: 2147483000,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 1,
      });
      expect(foraneo).toMatchObject({ ok: false, code: TEN_USUARIO_NO_ENCONTRADO });
      expect(desconocido).toMatchObject({ ok: false, code: TEN_USUARIO_NO_ENCONTRADO });
      expect(await estado(fx.usuarios.adminB.id)).toEqual(antes);
      expect(await auditoriaUsuario(fx.usuarios.adminB.id)).toHaveLength(0);
    });
  });

  describe("safeguards", () => {
    it("self-move => TEN_AUTO_PROTECCION, nothing written", async () => {
      const antes = await estado(ctxAdmin.usuarioId);
      const result = await mover(ctxAdmin, {
        usuarioId: ctxAdmin.usuarioId,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: antes.version,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_AUTO_PROTECCION });
      expect(await estado(ctxAdmin.usuarioId)).toEqual(antes);
      expect(await auditoriaUsuario(ctxAdmin.usuarioId)).toHaveLength(0);
    });

    it("the last active Administrador of the SOURCE branch (not the session one) cannot be moved", async () => {
      const soloA2 = await crearUsuario(fx.sucursalA2.id, "admin-solo-a2", rolAdminId);
      const antes = await estado(soloA2);
      const result = await mover(ctxAdmin, {
        usuarioId: soloA2,
        sucursalDestinoId: fx.sucursalA1.id,
        versionEsperada: antes.version,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_ULTIMO_ADMINISTRADOR });
      expect(await estado(soloA2)).toEqual(antes);
      expect(await auditoriaUsuario(soloA2)).toHaveLength(0);
    });

    it("an INACTIVE administrator does not count as one: the other active one cannot leave", async () => {
      const activoA2 = await crearUsuario(fx.sucursalA2.id, "admin-activo-a2", rolAdminId);
      const inactivoA2 = await crearUsuario(fx.sucursalA2.id, "admin-inactivo-a2", rolAdminId);
      await db().usuario.update({ where: { id: inactivoA2 }, data: { activo: false } });
      const result = await mover(ctxAdmin, {
        usuarioId: activoA2,
        sucursalDestinoId: fx.sucursalA1.id,
        versionEsperada: 1,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_ULTIMO_ADMINISTRADOR });
    });

    it("a stale version => TEN_CONCURRENCIA_CONFLICTO, nothing written", async () => {
      const antes = await estado(objetivoId);
      const result = await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 7,
      });
      expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
      expect(await estado(objetivoId)).toEqual(antes);
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });

    it("the same version cannot be replayed after a successful move", async () => {
      await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 1,
      });
      const replay = await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalA2.id,
        versionEsperada: 1,
      });
      expect(replay).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(1);
    });
  });

  describe("idempotency", () => {
    it("moving to the branch the user already has is a success no-op: no version bump, NO audit", async () => {
      const result = await mover(ctxAdmin, {
        usuarioId: objetivoId,
        sucursalDestinoId: fx.sucursalA1.id,
        versionEsperada: 1,
      });
      expect(result).toEqual({
        ok: true,
        data: { usuarioId: objetivoId, version: 1, cambio: false },
      });
      expect(await estado(objetivoId)).toEqual({
        sucursalId: fx.sucursalA1.id,
        version: 1,
        activo: true,
      });
      expect(await auditoriaUsuario(objetivoId)).toHaveLength(0);
    });
  });

  describe("concurrency on the last administrator of a branch", () => {
    it("two parallel moves of the two administrators of one branch: at most one succeeds, the branch keeps an active administrator", async () => {
      const a = await crearUsuario(fx.sucursalA2.id, "admin-a2-a", rolAdminId);
      const b = await crearUsuario(fx.sucursalA2.id, "admin-a2-b", rolAdminId);

      const resultados = await Promise.all([
        mover(ctxAdmin, { usuarioId: a, sucursalDestinoId: fx.sucursalA1.id, versionEsperada: 1 }),
        mover(ctxAdmin, { usuarioId: b, sucursalDestinoId: fx.sucursalA1.id, versionEsperada: 1 }),
      ]);

      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const fallo = resultados.find((r) => !r.ok);
      expect(fallo !== undefined && !fallo.ok ? fallo.code : null).toBe(TEN_ULTIMO_ADMINISTRADOR);
      const restantes = await db().usuario.count({
        where: {
          empresaId: fx.empresaA.id,
          sucursalId: fx.sucursalA2.id,
          activo: true,
          roles: { some: { rol: { nombre: "Administrador" } } },
        },
      });
      expect(restantes).toBe(1);
      const auditorias = (await auditoriaUsuario(a)).length + (await auditoriaUsuario(b)).length;
      expect(auditorias).toBe(1);
    });
  });
});
