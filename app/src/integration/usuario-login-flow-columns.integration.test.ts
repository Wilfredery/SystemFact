/**
 * Integration — column guard on USUARIO under the login flow (real DB, app role).
 *
 * Migration `20261114130000_usuario_login_flow_column_guard` (odd/tasks/
 * administracion-writes.md T1b): RLS cannot restrict columns, so a BEFORE UPDATE
 * trigger makes `authUserId` (plus the Prisma `updatedAt` bookkeeping) the ONLY
 * thing a login-flow UPDATE may change. Admin and bootstrap writes are unaffected.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { setLoginFlow } from "@/modules/tenant/infrastructure/login-flow";
import { enlazarAuthSub } from "@/modules/auth/infrastructure/auth-identity";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { Prisma } from "@/generated/prisma/client";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const GUARD_REFUSAL = /login flow|login-flow/i;

// Every column of "USUARIO". A new column must be added here AND to the
// trigger function (usuario_login_flow_column_guard); the drift test enforces it.
const GUARDED_COLUMNS = [
  "id",
  "empresaId",
  "sucursalId",
  "nombre",
  "nombreUsuario",
  "passwordHash",
  "email",
  "activo",
  "version",
  "createdAt",
] as const;
const ALLOWED_TO_CHANGE = ["authUserId", "updatedAt"] as const;

describe("USUARIO login-flow column guard (real DB)", () => {
  let fx: TenantFixture;
  let usuarioId: number;
  let ctxAdmin: TenantCtx;

  beforeEach(async () => {
    fx = await seedTenantFixture();
    const db = getHarnessDb();
    let rolOperador = await db.rol.findFirst({ where: { nombre: "Operador" } });
    if (rolOperador === null) {
      rolOperador = await db.rol.create({
        data: { nombre: "Operador", descripcion: "Integration harness operador role" },
      });
    }
    const u = await db.usuario.create({
      data: {
        empresaId: fx.empresaA.id,
        sucursalId: fx.sucursalA1.id,
        nombre: "objetivo",
        nombreUsuario: `objetivo-${randomUUID()}`,
        passwordHash: "test-hash",
        email: "obj@example.test",
        roles: { create: { rolId: rolOperador.id } },
      },
    });
    usuarioId = u.id;
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  const loginFlowUpdate = (data: Prisma.UsuarioUncheckedUpdateManyInput) =>
    prisma.$transaction(async (tx) => {
      await setLoginFlow(tx);
      await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${String(fx.empresaA.id)}, true)`;
      return tx.usuario.updateMany({ where: { id: usuarioId, authUserId: null }, data });
    });

  it("(1) the real enlazarAuthSub bind still works", async () => {
    const sub = randomUUID();
    expect(await enlazarAuthSub({ authSub: sub, usuarioId, empresaId: fx.empresaA.id })).toEqual({ ok: true });
    const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    expect(stored.authUserId).toBe(sub);
  });

  describe("(2) a login-flow UPDATE that binds AND changes another column is refused", () => {
    it.each([
      ["passwordHash", { passwordHash: "evil" }],
      ["activo", { activo: false }],
      ["sucursalId", () => ({ sucursalId: fx.sucursalA2.id })],
      ["nombre", { nombre: "otro" }],
      ["nombreUsuario", { nombreUsuario: "otro-usuario" }],
      ["email", { email: "evil@example.test" }],
    ] as const)("%s", async (_col, patch) => {
      const extra = typeof patch === "function" ? patch() : patch;
      const before = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      await expect(
        loginFlowUpdate({ authUserId: randomUUID(), ...extra } as Prisma.UsuarioUncheckedUpdateManyInput),
      ).rejects.toThrow(GUARD_REFUSAL);
      const after = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: usuarioId } });
      expect(after).toEqual(before);
      expect(after.authUserId).toBeNull();
    });
  });

  it("(3) Administrador (esAdmin, not login flow) can still change those columns", async () => {
    const res = await withTenantTransaction(ctxAdmin, (tx) =>
      tx.usuario.updateMany({
        where: { id: usuarioId, empresaId: fx.empresaA.id },
        data: {
          passwordHash: "new-hash",
          activo: false,
          nombre: "nuevo",
          nombreUsuario: `nuevo-${randomUUID()}`,
          email: "nuevo@example.test",
        },
      }),
    );
    expect(res.count).toBe(1);
    const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    expect(stored.activo).toBe(false);
    expect(stored.passwordHash).toBe("new-hash");
    expect(stored.nombre).toBe("nuevo");
  });

  it("(4) bootstrap is unaffected, even when login flow is also set", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
      await tx.$executeRaw`SELECT set_config('app.is_login_flow', 'true', true)`;
      const r = await tx.usuario.updateMany({
        where: { id: usuarioId },
        data: { passwordHash: "boot-hash", activo: false, authUserId: randomUUID() },
      });
      expect(r.count).toBe(1);
    });
    const stored = await getHarnessDb().usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    expect(stored.passwordHash).toBe("boot-hash");
    expect(stored.activo).toBe(false);
  });

  it("(5) drift guard: the function knows every column of USUARIO", async () => {
    const db = getHarnessDb();
    const cols = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'USUARIO'`;
    const actual = cols.map((c) => c.column_name).sort();
    const known = [...GUARDED_COLUMNS, ...ALLOWED_TO_CHANGE].sort();
    expect(actual).toEqual(known);

    const def = await db.$queryRaw<{ src: string }[]>`
      SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p
      WHERE p.proname = 'usuario_login_flow_column_guard'`;
    expect(def).toHaveLength(1);
    for (const c of GUARDED_COLUMNS) expect(def[0].src).toContain(`"${c}"`);
  });
});
