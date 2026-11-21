/**
 * Integration — create and edit a branch against real Postgres
 * (odd/tasks/administracion-sucursales-crear-editar.md, T2, S3-S8/S10).
 *
 * Runs the use cases through `withTenantTransaction` as the least-privilege
 * `systemfact_app` role (FORCE RLS), the way the Server Actions do. The harness
 * superuser client only seeds and reads back, so every "refused" assertion also
 * proves that stored rows, versions and audit are unchanged.
 */

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { tieneRolPermitidoEnTx } from "@/modules/tenant/infrastructure/usuario-repository";
import {
  crearSucursal,
  editarSucursal,
  type CrearSucursalInput,
  type EditarSucursalInput,
} from "@/modules/tenant/application/gestion-sucursales";
import { listarSucursalesDeEmpresa } from "@/modules/tenant/application/listarSucursalesDeEmpresa";
import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_SUCURSAL_NOMBRE_DUPLICADO,
} from "@/modules/tenant/domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { ROLES_GESTION_SUCURSALES } from "@/modules/tenant/http/shared";
import { getHarnessDb, nombreUsuarioConCodigo, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("crearSucursal / editarSucursal (real DB)", () => {
  let fx: TenantFixture;
  let ctxAdmin: TenantCtx;
  let ctxOperador: TenantCtx;
  let sucursalInactivaId: number;

  const db = () => getHarnessDb();

  const datos = (nombre: string): CrearSucursalInput => ({
    nombre,
    direccion: "Calle 1",
    telefono: "8095550000",
  });

  const crear = (ctx: TenantCtx, input: CrearSucursalInput) =>
    withTenantTransaction(ctx, (tx) => crearSucursal(tx, ctx, input));
  const editar = (ctx: TenantCtx, input: EditarSucursalInput) =>
    withTenantTransaction(ctx, (tx) => editarSucursal(tx, ctx, input));

  async function estado(id: number) {
    return db().sucursal.findUniqueOrThrow({ where: { id } });
  }
  async function auditoriaSucursal(id: number) {
    return db().movimientoAuditoria.findMany({
      where: { entidad: "Sucursal", idEntidad: String(id) },
      orderBy: { id: "asc" },
    });
  }
  async function auditoriaSucursalTotal() {
    return db().movimientoAuditoria.count({ where: { entidad: "Sucursal" } });
  }
  async function contarSucursales(empresaId: number) {
    return db().sucursal.count({ where: { empresaId } });
  }

  beforeEach(async () => {
    fx = await seedTenantFixture();
    sucursalInactivaId = (
      await db().sucursal.create({
        data: {
          empresaId: fx.empresaA.id,
          nombre: "Cerrada",
          direccion: "x",
          telefono: "0",
          activa: false,
        },
      })
    ).id;
    const rolOperador =
      (await db().rol.findFirst({ where: { nombre: "Operador", activo: true } })) ??
      (await db().rol.create({ data: { nombre: "Operador", descripcion: "Integration Operador" } }));
    const operador = await db().usuario.create({
      data: {
        empresaId: fx.empresaA.id,
        sucursalId: fx.sucursalA1.id,
        nombre: "oper",
        nombreUsuario: nombreUsuarioConCodigo(fx.empresaA.codigo, "oper"),
        passwordHash: "test-hash",
        roles: { create: { rolId: rolOperador.id } },
      },
    });
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxOperador = { ...ctxAdmin, usuarioId: operador.id, esAdmin: false };
  });

  describe("crearSucursal", () => {
    it("creates an active branch of the SESSION empresa, version 1, trimmed, with ONE CREAR audit row", async () => {
      const result = await crear(ctxAdmin, {
        nombre: "  Sucursal Nueva ",
        direccion: " Av. Principal 5 ",
        telefono: " 8095551234 ",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toMatchObject({
        nombre: "Sucursal Nueva",
        direccion: "Av. Principal 5",
        telefono: "8095551234",
        activa: true,
        version: 1,
      });
      const stored = await estado(result.data.id);
      expect(stored).toMatchObject({
        empresaId: fx.empresaA.id,
        nombre: "Sucursal Nueva",
        activa: true,
        version: 1,
      });
      const audit = await auditoriaSucursal(result.data.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        empresaId: fx.empresaA.id,
        sucursalId: null,
        usuarioId: fx.usuarios.adminA.id,
        accion: "CREAR",
        entidad: "Sucursal",
        idEntidad: String(result.data.id),
        valorAnterior: null,
      });
      expect(JSON.parse(audit[0]?.valorNuevo ?? "{}")).toEqual({
        nombre: "Sucursal Nueva",
        direccion: "Av. Principal 5",
        telefono: "8095551234",
      });
    });

    it.each([
      ["the exact same name", "A2"],
      ["a case variant", "a2"],
      ["a space + case variant", "  A2  "],
      ["an INACTIVE branch's name", "Cerrada"],
      ["an INACTIVE branch's name, case variant", "  cERRADA "],
    ])("refuses a duplicate: %s => TEN_SUCURSAL_NOMBRE_DUPLICADO, nothing stored, no audit", async (_caso, nombre) => {
      const antes = await contarSucursales(fx.empresaA.id);

      const result = await crear(ctxAdmin, datos(nombre));

      expect(result).toEqual({
        ok: false,
        code: TEN_SUCURSAL_NOMBRE_DUPLICADO,
        message: expect.stringMatching(/inactiv/i),
      });
      expect(await contarSucursales(fx.empresaA.id)).toBe(antes);
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it("the same name in ANOTHER empresa is not a duplicate", async () => {
      const result = await crear(ctxAdmin, datos("B1"));
      expect(result.ok).toBe(true);
    });

    it("a parallel double create of the same name: exactly one succeeds, the other is a typed duplicate, one audit row", async () => {
      const [a, b] = await Promise.all([
        crear(ctxAdmin, datos("Carrera")),
        crear(ctxAdmin, datos("  carrera ")),
      ]);

      const resultados = [a, b];
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const perdedor = resultados.find((r) => !r.ok);
      expect(perdedor).toMatchObject({ ok: false, code: TEN_SUCURSAL_NOMBRE_DUPLICADO });
      expect(
        await db().sucursal.count({
          where: { empresaId: fx.empresaA.id, nombre: { in: ["Carrera", "carrera"] } },
        }),
      ).toBe(1);
      expect(await auditoriaSucursalTotal()).toBe(1);
    });

    it("the action gate refuses an Operador: the use case is never reached", async () => {
      const antes = await contarSucursales(fx.empresaA.id);
      const result = await withTenantTransaction(ctxOperador, async (tx) => {
        const permitido = await tieneRolPermitidoEnTx(
          tx,
          ctxOperador.usuarioId,
          ctxOperador.empresaId,
          ROLES_GESTION_SUCURSALES,
        );
        if (!permitido) return { ok: false as const, code: TEN_OPS_NO_AUTORIZADO };
        return crearSucursal(tx, ctxOperador, datos("Intrusa"));
      });
      expect(result).toEqual({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await contarSucursales(fx.empresaA.id)).toBe(antes);
    });

    it("with the gate bypassed, RLS still refuses an Operador: typed TEN_OPS_NO_AUTORIZADO, nothing stored, no audit", async () => {
      const antes = await contarSucursales(fx.empresaA.id);

      const result = await crear(ctxOperador, datos("Intrusa"));

      expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await contarSucursales(fx.empresaA.id)).toBe(antes);
      expect(await auditoriaSucursalTotal()).toBe(0);
    });
  });

  describe("editarSucursal", () => {
    const base = (sucursalId: number, version: number) => ({
      sucursalId,
      nombre: "A2",
      direccion: "x",
      telefono: "0",
      versionEsperada: version,
    });

    it("edits the changed fields: version 2 and ONE ACTUALIZAR audit with before/after of the changed fields", async () => {
      const antes = await estado(fx.sucursalA2.id);

      const result = await editar(ctxAdmin, {
        ...base(fx.sucursalA2.id, antes.version),
        nombre: "  Renombrada ",
        telefono: "8295559999",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toMatchObject({
        id: fx.sucursalA2.id,
        nombre: "Renombrada",
        telefono: "8295559999",
        direccion: antes.direccion,
        version: antes.version + 1,
        cambio: true,
      });
      expect(await estado(fx.sucursalA2.id)).toMatchObject({
        nombre: "Renombrada",
        telefono: "8295559999",
        direccion: antes.direccion,
        version: antes.version + 1,
        activa: true,
        empresaId: fx.empresaA.id,
      });
      const audit = await auditoriaSucursal(fx.sucursalA2.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        empresaId: fx.empresaA.id,
        sucursalId: null,
        usuarioId: fx.usuarios.adminA.id,
        accion: "ACTUALIZAR",
        entidad: "Sucursal",
        idEntidad: String(fx.sucursalA2.id),
        valorAnterior: JSON.stringify({ nombre: antes.nombre, telefono: antes.telefono }),
        valorNuevo: JSON.stringify({ nombre: "Renombrada", telefono: "8295559999" }),
      });
    });

    it("identical values (after trim) = success no-op: no version bump, no write, NO audit", async () => {
      const antes = await estado(fx.sucursalA2.id);

      const result = await editar(ctxAdmin, {
        ...base(fx.sucursalA2.id, antes.version),
        nombre: "  A2 ",
      });

      expect(result).toMatchObject({ ok: true, data: { cambio: false, version: antes.version } });
      const despues = await estado(fx.sucursalA2.id);
      expect(despues.version).toBe(antes.version);
      expect(despues.updatedAt.getTime()).toBe(antes.updatedAt.getTime());
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it("a stale version is refused with TEN_CONCURRENCIA_CONFLICTO and nothing changes", async () => {
      const antes = await estado(fx.sucursalA2.id);
      await editar(ctxAdmin, { ...base(fx.sucursalA2.id, antes.version), telefono: "111" });
      const intermedio = await estado(fx.sucursalA2.id);

      const result = await editar(ctxAdmin, {
        ...base(fx.sucursalA2.id, antes.version),
        telefono: "222",
      });

      expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
      expect(await estado(fx.sucursalA2.id)).toMatchObject({
        telefono: "111",
        version: intermedio.version,
      });
      expect(await auditoriaSucursal(fx.sucursalA2.id)).toHaveLength(1);
    });

    it("a stale version conflicts even when the values already match (no silent success)", async () => {
      const antes = await estado(fx.sucursalA2.id);
      await editar(ctxAdmin, { ...base(fx.sucursalA2.id, antes.version), telefono: "111" });

      const result = await editar(ctxAdmin, {
        ...base(fx.sucursalA2.id, antes.version),
        telefono: "111",
      });

      expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
    });

    it("a foreign-empresa branch and an unknown id get the SAME TEN_SUCURSAL_NO_VALIDA answer; nothing changes", async () => {
      const ajena = await estado(fx.sucursalB1.id);

      const foranea = await editar(ctxAdmin, {
        ...base(fx.sucursalB1.id, ajena.version),
        nombre: "Secuestrada",
      });
      const inexistente = await editar(ctxAdmin, {
        ...base(2_000_000_000, 1),
        nombre: "Fantasma",
      });

      expect(foranea).toMatchObject({ ok: false, code: TEN_SUCURSAL_NO_VALIDA });
      expect(inexistente).toEqual(foranea);
      expect(await estado(fx.sucursalB1.id)).toMatchObject({
        nombre: ajena.nombre,
        version: ajena.version,
      });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it.each([
      ["another active branch's name", "A1"],
      ["a case/space variant of another branch's name", "  a1 "],
      ["an INACTIVE branch's name", "Cerrada"],
    ])("renaming to %s is refused: TEN_SUCURSAL_NOMBRE_DUPLICADO, nothing changes", async (_caso, nombre) => {
      const antes = await estado(fx.sucursalA2.id);

      const result = await editar(ctxAdmin, {
        ...base(fx.sucursalA2.id, antes.version),
        nombre,
      });

      expect(result).toMatchObject({ ok: false, code: TEN_SUCURSAL_NOMBRE_DUPLICADO });
      expect(await estado(fx.sucursalA2.id)).toMatchObject({
        nombre: antes.nombre,
        version: antes.version,
      });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });

    it("renaming a branch to its own name with a different case is allowed", async () => {
      const antes = await estado(fx.sucursalA2.id);

      const result = await editar(ctxAdmin, {
        ...base(fx.sucursalA2.id, antes.version),
        nombre: "a2",
      });

      expect(result).toMatchObject({ ok: true, data: { nombre: "a2", cambio: true } });
      expect((await estado(fx.sucursalA2.id)).nombre).toBe("a2");
      expect(await auditoriaSucursal(fx.sucursalA2.id)).toHaveLength(1);
    });

    it("two parallel renames to the same free name: exactly one wins, the loser is a typed error, never a Prisma error", async () => {
      const a1 = await estado(fx.sucursalA1.id);
      const a2 = await estado(fx.sucursalA2.id);

      const [x, y] = await Promise.all([
        editar(ctxAdmin, { ...base(fx.sucursalA1.id, a1.version), nombre: "Destino" }),
        editar(ctxAdmin, { ...base(fx.sucursalA2.id, a2.version), nombre: "destino" }),
      ]);

      expect([x, y].filter((r) => r.ok)).toHaveLength(1);
      expect([x, y].find((r) => !r.ok)).toMatchObject({
        ok: false,
        code: TEN_SUCURSAL_NOMBRE_DUPLICADO,
      });
      expect(await auditoriaSucursalTotal()).toBe(1);
    });

    it("the action gate refuses an Operador: the edit is never reached", async () => {
      const antes = await estado(fx.sucursalA2.id);
      const result = await withTenantTransaction(ctxOperador, async (tx) => {
        const permitido = await tieneRolPermitidoEnTx(
          tx,
          ctxOperador.usuarioId,
          ctxOperador.empresaId,
          ROLES_GESTION_SUCURSALES,
        );
        if (!permitido) return { ok: false as const, code: TEN_OPS_NO_AUTORIZADO };
        return editarSucursal(tx, ctxOperador, {
          ...base(fx.sucursalA2.id, antes.version),
          nombre: "Hackeada",
        });
      });
      expect(result).toEqual({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await estado(fx.sucursalA2.id)).toMatchObject({ nombre: antes.nombre, version: antes.version });
    });

    it("with the gate bypassed, RLS still refuses an Operador's edit: typed TEN_OPS_NO_AUTORIZADO, nothing changes, no audit", async () => {
      const antes = await estado(fx.sucursalA2.id);

      const result = await editar(ctxOperador, {
        ...base(fx.sucursalA2.id, antes.version),
        nombre: "Hackeada",
      });

      expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
      expect(await estado(fx.sucursalA2.id)).toMatchObject({ nombre: antes.nombre, version: antes.version });
      expect(await auditoriaSucursalTotal()).toBe(0);
    });
  });

  describe("listarSucursalesDeEmpresa (S8)", () => {
    it("returns direccion, telefono and version of the ACTIVE branches, and a created branch shows up", async () => {
      const creada = await crear(ctxAdmin, {
        nombre: "Zeta",
        direccion: "Calle Z",
        telefono: "8095550099",
      });
      expect(creada.ok).toBe(true);

      const result = await withTenantTransaction(ctxAdmin, (tx) =>
        listarSucursalesDeEmpresa(ctxAdmin, tx),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.sucursales.map((s) => s.nombre)).toEqual(["A1", "A2", "Zeta"]);
      expect(result.sucursales.find((s) => s.nombre === "Zeta")).toEqual({
        id: creada.ok ? creada.data.id : -1,
        nombre: "Zeta",
        direccion: "Calle Z",
        telefono: "8095550099",
        version: 1,
      });
      expect(result.sucursales.map((s) => s.id)).not.toContain(sucursalInactivaId);
    });
  });
});
