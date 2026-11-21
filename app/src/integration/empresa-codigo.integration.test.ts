/**
 * Integration — company code `EMPRESA.codigo` + `<CODIGO>-<usuario>` names (real DB).
 *
 * odd/tasks/multi-company-codigo.md T1 (S4, S5; contract C1, C2, C3), migration
 * `20261122100000_empresa_codigo`:
 *   - EMPRESA.codigo: NOT NULL, UNIQUE, CHECK ^[A-Z0-9]{3,6}$, immutable by trigger
 *     `empresa_codigo_immutable` (no bootstrap bypass);
 *   - USUARIO: trigger `usuario_nombre_prefijo_guard` (BEFORE INSERT OR UPDATE OF
 *     "nombreUsuario", "empresaId") forces `<CODIGO>-<resto>` and fails closed.
 *
 * The harness superuser client seeds, probes constraints and reads stored data back
 * (triggers and CHECKs also bind a superuser); tenant-session assertions run through
 * `@/lib/prisma` (least-privilege `systemfact_app`, FORCE RLS). Every "refused"
 * assertion also proves the stored data is unchanged.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { enlazarAuthSub } from "@/modules/auth/infrastructure/auth-identity";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  codigoEmpresaUnico,
  getHarnessDb,
  nombreUsuarioConCodigo,
  seedTenantFixture,
  type TenantFixture,
} from "./setup/fixtures";

const FORMATO_REFUSADO = /EMPRESA_codigo_formato_check|check constraint|too long|length/i;
const INMUTABLE = /EMPRESA\.codigo is immutable/;
const PREFIJO_AUSENTE = /must start with the empresa code and a hyphen/;
const RESTO_INVALIDO = /invalid part after the empresa code/;
const EMPRESA_ILEGIBLE = /USUARIO\.nombreUsuario must be <CODIGO>-<usuario>: empresa code not readable/;

function datosEmpresa(codigo: string) {
  const sufijo = randomUUID();
  return {
    nombreComercial: `Cod-${sufijo}`,
    rnc: `RNC-COD-${sufijo}`,
    codigo,
    razonSocial: `Cod-${sufijo}`,
    direccionFiscal: "x",
    telefono: "0",
    correo: "cod@integration.test",
    logo: "",
    regimenFiscal: "NORMAL",
  };
}

describe("EMPRESA.codigo constraints (real DB)", () => {
  const contarEmpresas = () => getHarnessDb().empresa.count();

  it.each([
    ["too short (2 chars)", "AB"],
    ["too long (7 chars)", "ABCDEFG"],
    ["lower-case", "abc"],
    ["mixed case", "AbC"],
    ["symbol (hyphen)", "AB-C"],
    ["symbol (underscore)", "AB_C"],
    ["whitespace", "AB C"],
    ["empty", ""],
  ])("rejects a code that is %s and stores nothing", async (_caso, codigo) => {
    const before = await contarEmpresas();
    await expect(getHarnessDb().empresa.create({ data: datosEmpresa(codigo) })).rejects.toThrow(
      FORMATO_REFUSADO,
    );
    expect(await contarEmpresas()).toBe(before);
  });

  it.each([["3 chars", "A1B"], ["6 chars", "ABCDEF"], ["digits only", "123"]])(
    "accepts a valid code (%s)",
    async (_caso, codigo) => {
      const e = await getHarnessDb().empresa.create({ data: datosEmpresa(codigo) });
      expect(e.codigo).toBe(codigo);
    },
  );

  it("rejects a duplicate code (UNIQUE) and stores nothing", async () => {
    const codigo = codigoEmpresaUnico();
    await getHarnessDb().empresa.create({ data: datosEmpresa(codigo) });
    const before = await contarEmpresas();

    await expect(getHarnessDb().empresa.create({ data: datosEmpresa(codigo) })).rejects.toThrow(
      /unique|duplicate/i,
    );
    expect(await contarEmpresas()).toBe(before);
  });

  it("rejects an INSERT without a code (NOT NULL) and stores nothing", async () => {
    const before = await contarEmpresas();
    const d = datosEmpresa("X");
    await expect(
      getHarnessDb().$executeRaw`
        INSERT INTO "EMPRESA" ("nombreComercial", "rnc", "razonSocial", "direccionFiscal",
                               "telefono", "correo", "logo", "regimenFiscal", "updatedAt")
        VALUES (${d.nombreComercial}, ${d.rnc}, ${d.razonSocial}, ${d.direccionFiscal},
                ${d.telefono}, ${d.correo}, ${d.logo}, ${d.regimenFiscal}, now())`,
    ).rejects.toThrow(/null/i);
    expect(await contarEmpresas()).toBe(before);
  });

  it("rejects clearing the code (NOT NULL) on an existing row", async () => {
    const fx = await seedTenantFixture();
    await expect(
      getHarnessDb().$executeRaw`UPDATE "EMPRESA" SET "codigo" = NULL WHERE id = ${fx.empresaA.id}`,
    ).rejects.toThrow(/null|immutable/i);
    const stored = await getHarnessDb().empresa.findUniqueOrThrow({ where: { id: fx.empresaA.id } });
    expect(stored.codigo).toBe(fx.empresaA.codigo);
  });
});

describe("EMPRESA.codigo immutability (real DB)", () => {
  let fx: TenantFixture;
  let ctxAdmin: TenantCtx;

  const leerCodigo = async (empresaId: number) =>
    (await getHarnessDb().empresa.findUniqueOrThrow({ where: { id: empresaId } })).codigo;

  beforeEach(async () => {
    fx = await seedTenantFixture();
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  it("a plain session cannot change the code (even a still-valid one)", async () => {
    await expect(
      getHarnessDb().empresa.update({ where: { id: fx.empresaA.id }, data: { codigo: "NUEVO" } }),
    ).rejects.toThrow(INMUTABLE);
    expect(await leerCodigo(fx.empresaA.id)).toBe(fx.empresaA.codigo);
  });

  it("bootstrap mode has NO bypass: the code is still immutable", async () => {
    await expect(
      getHarnessDb().$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
        await tx.empresa.update({ where: { id: fx.empresaA.id }, data: { codigo: "BOOT01" } });
      }),
    ).rejects.toThrow(INMUTABLE);
    expect(await leerCodigo(fx.empresaA.id)).toBe(fx.empresaA.codigo);
  });

  it("an Administrador tenant session cannot change the code, and the row is unchanged", async () => {
    const before = await getHarnessDb().empresa.findUniqueOrThrow({ where: { id: fx.empresaA.id } });
    await expect(
      withTenantTransaction(ctxAdmin, (tx) =>
        tx.empresa.updateMany({ where: { id: fx.empresaA.id }, data: { codigo: "ADM001" } }),
      ),
    ).rejects.toThrow(INMUTABLE);
    expect(await getHarnessDb().empresa.findUniqueOrThrow({ where: { id: fx.empresaA.id } })).toEqual(before);
  });

  it("a non-admin tenant session cannot change the code either", async () => {
    await expect(
      withTenantTransaction({ ...ctxAdmin, esAdmin: false }, (tx) =>
        tx.empresa.updateMany({ where: { id: fx.empresaA.id }, data: { codigo: "OPE001" } }),
      ),
    ).rejects.toThrow(INMUTABLE);
    expect(await leerCodigo(fx.empresaA.id)).toBe(fx.empresaA.codigo);
  });

  it("other columns stay updatable, and rewriting the same code is allowed", async () => {
    const res = await withTenantTransaction(ctxAdmin, (tx) =>
      tx.empresa.updateMany({
        where: { id: fx.empresaA.id },
        data: { nombreComercial: "Con codigo SA", codigo: fx.empresaA.codigo },
      }),
    );
    expect(res.count).toBe(1);
    const stored = await getHarnessDb().empresa.findUniqueOrThrow({ where: { id: fx.empresaA.id } });
    expect(stored.nombreComercial).toBe("Con codigo SA");
    expect(stored.codigo).toBe(fx.empresaA.codigo);
  });

  it("a deactivated empresa keeps its code, and the code cannot be given to another company", async () => {
    await getHarnessDb().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
      await tx.empresa.update({ where: { id: fx.empresaA.id }, data: { activa: false } });
    });
    expect(await leerCodigo(fx.empresaA.id)).toBe(fx.empresaA.codigo);

    await expect(
      getHarnessDb().empresa.create({ data: datosEmpresa(fx.empresaA.codigo) }),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("USUARIO.nombreUsuario prefix guard (real DB)", () => {
  let fx: TenantFixture;
  let ctxAdmin: TenantCtx;

  const datosUsuario = (nombreUsuario: string, empresa: "A" | "B" = "A") => ({
    empresaId: empresa === "A" ? fx.empresaA.id : fx.empresaB.id,
    sucursalId: empresa === "A" ? fx.sucursalA1.id : fx.sucursalB1.id,
    nombre: "Prefijo",
    nombreUsuario,
    passwordHash: "test-hash",
  });
  const contarUsuarios = () => getHarnessDb().usuario.count();
  const resto = (n: number) => "a".repeat(n);

  beforeEach(async () => {
    fx = await seedTenantFixture();
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  describe("INSERT", () => {
    it("accepts <CODIGO>-<resto> and the boundary of 64 chars", async () => {
      const normal = await getHarnessDb().usuario.create({
        data: datosUsuario(`${fx.empresaA.codigo}-jperez`),
      });
      expect(normal.nombreUsuario).toBe(`${fx.empresaA.codigo}-jperez`);

      const limite = `${fx.empresaA.codigo}-${resto(57)}`;
      expect(limite).toHaveLength(64);
      const largo = await getHarnessDb().usuario.create({ data: datosUsuario(limite) });
      expect(largo.nombreUsuario).toBe(limite);

      // The part after the first hyphen may itself contain hyphens, dots and underscores.
      const mixto = await getHarnessDb().usuario.create({
        data: datosUsuario(`${fx.empresaA.codigo}-a.b_c-d`),
      });
      expect(mixto.nombreUsuario).toBe(`${fx.empresaA.codigo}-a.b_c-d`);
    });

    it.each([
      ["no prefix at all", (): string => "jperez", PREFIJO_AUSENTE],
      ["a prefix of ANOTHER empresa", (): string => `${fx.empresaB.codigo}-jperez`, PREFIJO_AUSENTE],
      ["the prefix in lower-case", (): string => `${fx.empresaA.codigo.toLowerCase()}-jperez`, PREFIJO_AUSENTE],
      ["the prefix without hyphen", (): string => `${fx.empresaA.codigo}jperez`, PREFIJO_AUSENTE],
      ["a truncated prefix", (): string => `${fx.empresaA.codigo.slice(0, 3)}-jperez`, PREFIJO_AUSENTE],
      ["an empty part after the code", (): string => `${fx.empresaA.codigo}-`, RESTO_INVALIDO],
      ["an upper-case part after the code", (): string => `${fx.empresaA.codigo}-JPerez`, RESTO_INVALIDO],
      ["a part starting with a symbol", (): string => `${fx.empresaA.codigo}-.jperez`, RESTO_INVALIDO],
      ["a space in the part", (): string => `${fx.empresaA.codigo}-j perez`, RESTO_INVALIDO],
      ["a symbol in the part", (): string => `${fx.empresaA.codigo}-j@perez`, RESTO_INVALIDO],
      ["a newline in the part", (): string => `${fx.empresaA.codigo}-jperez\n`, RESTO_INVALIDO],
      ["65 chars in total", (): string => `${fx.empresaA.codigo}-${resto(58)}`, RESTO_INVALIDO],
    ] as const)("rejects %s and stores nothing", async (_caso, nombre, mensaje) => {
      const before = await contarUsuarios();
      await expect(getHarnessDb().usuario.create({ data: datosUsuario(nombre()) })).rejects.toThrow(mensaje);
      expect(await contarUsuarios()).toBe(before);
    });

    it("rejects an INSERT for an empresa row that does not exist (fail closed)", async () => {
      const before = await contarUsuarios();
      await expect(
        getHarnessDb().usuario.create({
          data: { ...datosUsuario(`${fx.empresaA.codigo}-fantasma`), empresaId: 2_000_000_000 },
        }),
      ).rejects.toThrow(EMPRESA_ILEGIBLE);
      expect(await contarUsuarios()).toBe(before);
    });

    it("an Administrador tenant session can create a correctly prefixed user in its own empresa", async () => {
      const u = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuario.create({ data: datosUsuario(nombreUsuarioConCodigo(fx.empresaA.codigo, "nuevo")) }),
      );
      expect(u.nombreUsuario.startsWith(`${fx.empresaA.codigo}-`)).toBe(true);
    });

    it("an Administrador tenant session cannot create a user with a wrong prefix", async () => {
      const before = await contarUsuarios();
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.usuario.create({ data: datosUsuario(`${fx.empresaB.codigo}-intruso`) }),
        ),
      ).rejects.toThrow(PREFIJO_AUSENTE);
      expect(await contarUsuarios()).toBe(before);
    });

    it("a tenant session of A cannot create a user of empresa B, even with B's own prefix (fail closed)", async () => {
      const before = await contarUsuarios();
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.usuario.create({ data: datosUsuario(`${fx.empresaB.codigo}-cross`, "B") }),
        ),
      ).rejects.toThrow(/row-level security|violates|policy|USUARIO\.nombreUsuario/i);
      expect(await contarUsuarios()).toBe(before);
    });

    it("bootstrap mode does not bypass the prefix rule", async () => {
      const before = await contarUsuarios();
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
          await tx.usuario.create({ data: datosUsuario("sin-prefijo", "B") });
        }),
      ).rejects.toThrow(PREFIJO_AUSENTE);
      expect(await contarUsuarios()).toBe(before);
    });
  });

  describe("UPDATE", () => {
    it("rejects renaming to a mismatching name and leaves the row unchanged", async () => {
      const id = fx.usuarios.adminA.id;
      const before = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } });

      for (const [nombre, mensaje] of [
        ["sin-prefijo", PREFIJO_AUSENTE],
        [`${fx.empresaB.codigo}-otro`, PREFIJO_AUSENTE],
        [`${fx.empresaA.codigo.toLowerCase()}-otro`, PREFIJO_AUSENTE],
        [`${fx.empresaA.codigo}-Otro`, RESTO_INVALIDO],
        [`${fx.empresaA.codigo}-${resto(58)}`, RESTO_INVALIDO],
      ] as const) {
        await expect(
          getHarnessDb().usuario.update({ where: { id }, data: { nombreUsuario: nombre } }),
        ).rejects.toThrow(mensaje);
      }
      expect(await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } })).toEqual(before);
    });

    it("accepts a rename that keeps the code and a valid part", async () => {
      const id = fx.usuarios.adminA.id;
      const nuevo = `${fx.empresaA.codigo}-renombrado`;
      await getHarnessDb().usuario.update({ where: { id }, data: { nombreUsuario: nuevo } });
      expect((await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } })).nombreUsuario).toBe(nuevo);
    });

    it("rejects moving the user to another empresa while the name keeps the old code", async () => {
      const id = fx.usuarios.adminA.id;
      const before = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } });
      await expect(
        getHarnessDb().usuario.update({
          where: { id },
          data: { empresaId: fx.empresaB.id, sucursalId: fx.sucursalB1.id },
        }),
      ).rejects.toThrow(PREFIJO_AUSENTE);
      expect(await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } })).toEqual(before);
    });

    it("an Administrador tenant session cannot rename a user of its empresa to a wrong prefix", async () => {
      const id = fx.usuarios.adminA.id;
      const before = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } });
      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.usuario.updateMany({ where: { id, empresaId: fx.empresaA.id }, data: { nombreUsuario: "sin-prefijo" } }),
        ),
      ).rejects.toThrow(PREFIJO_AUSENTE);
      expect(await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } })).toEqual(before);
    });

    it("an UPDATE that does not name nombreUsuario/empresaId never fires the guard", async () => {
      const id = fx.usuarios.adminA.id;
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.usuario.updateMany({ where: { id, empresaId: fx.empresaA.id }, data: { nombre: "Otro nombre", activo: false } }),
      );
      expect(res.count).toBe(1);
    });
  });

  describe("legacy-shaped rows (name without the prefix)", () => {
    /**
     * A legacy row cannot be inserted while the guard is on, so the harness superuser
     * disables the trigger INSIDE a transaction that re-enables it before commit
     * (ALTER TABLE is transactional: an error rolls both back).
     */
    const crearUsuarioLegacy = async (nombreUsuario: string): Promise<number> =>
      getHarnessDb().$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`ALTER TABLE "USUARIO" DISABLE TRIGGER usuario_nombre_prefijo_guard`);
        const u = await tx.usuario.create({ data: datosUsuario(nombreUsuario) });
        await tx.$executeRawUnsafe(`ALTER TABLE "USUARIO" ENABLE TRIGGER usuario_nombre_prefijo_guard`);
        return u.id;
      });

    it("the guard is enabled again after the setup (a new bad INSERT is still refused)", async () => {
      await crearUsuarioLegacy(`legacy-${randomUUID()}`);
      const rows = await getHarnessDb().$queryRaw<{ tgenabled: string }[]>`
        SELECT tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname = 'usuario_nombre_prefijo_guard'`;
      expect(rows).toEqual([{ tgenabled: "O" }]);
      await expect(
        getHarnessDb().usuario.create({ data: datosUsuario(`legacy-${randomUUID()}`) }),
      ).rejects.toThrow(PREFIJO_AUSENTE);
    });

    it("other columns can still be UPDATEd: bind authUserId (superuser), flip activo, change nombre", async () => {
      const id = await crearUsuarioLegacy(`legacy-${randomUUID()}`);
      const sub = randomUUID();

      await getHarnessDb().usuario.update({ where: { id }, data: { authUserId: sub } });
      await getHarnessDb().usuario.update({ where: { id }, data: { activo: false, nombre: "Legacy" } });

      const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } });
      expect(stored.authUserId).toBe(sub);
      expect(stored.activo).toBe(false);
      expect(stored.nombre).toBe("Legacy");
      expect(stored.nombreUsuario.startsWith("legacy-")).toBe(true);
    });

    it("the real login bind (enlazarAuthSub, login flow, app role) still works on a legacy row", async () => {
      const id = await crearUsuarioLegacy(`legacy-${randomUUID()}`);
      const sub = randomUUID();

      expect(await enlazarAuthSub({ authSub: sub, usuarioId: id, empresaId: fx.empresaA.id })).toEqual({ ok: true });

      const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } });
      expect(stored.authUserId).toBe(sub);
    });

    it("a legacy name is NOT silently accepted on rename: it must become <CODIGO>-<resto>", async () => {
      const id = await crearUsuarioLegacy(`legacy-${randomUUID()}`);
      const before = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } });

      await expect(
        getHarnessDb().usuario.update({ where: { id }, data: { nombreUsuario: "otro-legacy" } }),
      ).rejects.toThrow(PREFIJO_AUSENTE);
      expect(await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } })).toEqual(before);

      const nuevo = `${fx.empresaA.codigo}-migrado`;
      await getHarnessDb().usuario.update({ where: { id }, data: { nombreUsuario: nuevo } });
      expect((await getHarnessDb().usuario.findUniqueOrThrow({ where: { id } })).nombreUsuario).toBe(nuevo);
    });
  });
});
