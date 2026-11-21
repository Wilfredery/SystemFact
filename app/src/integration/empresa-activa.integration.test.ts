/**
 * Integration — tenant kill switch `EMPRESA.activa` (real DB, app role).
 *
 * odd/tasks/empresa-activa-enforcement.md (S1-S4c). Two walls:
 *   1. app level: `buscarUsuarioPorAuthSub` (every per-request path) and
 *      `empresaEstaActiva` (the login path) fail closed for an inactive empresa;
 *   2. database level: migration `20261121200000_empresa_activa_guard` makes
 *      "EMPRESA"."activa" changeable ONLY with `app.is_bootstrap = 'true'`, while
 *      other columns stay updatable by the existing `empresa_modify` policy.
 *
 * The code under test runs through `@/lib/prisma` (least-privilege `systemfact_app`,
 * FORCE RLS). The harness superuser client only seeds and reads stored data back, so
 * every "refused" assertion also proves the stored row is unchanged.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  buscarUsuarioPorAuthSub,
  empresaEstaActiva,
} from "@/modules/auth/infrastructure/auth-identity";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

const GUARD_REFUSAL = /EMPRESA\.activa may only be changed in bootstrap mode/;

describe("EMPRESA.activa kill switch (real DB)", () => {
  let fx: TenantFixture;
  let ctxAdmin: TenantCtx;
  let ctxOperador: TenantCtx;
  let authSub: string;

  /** Seed-side change of "activa": the harness superuser still hits the trigger, so it declares bootstrap. */
  const setActivaComoBootstrap = (empresaId: number, activa: boolean) =>
    getHarnessDb().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
      await tx.empresa.update({ where: { id: empresaId }, data: { activa } });
    });

  const leerEmpresa = (empresaId: number) =>
    getHarnessDb().empresa.findUniqueOrThrow({ where: { id: empresaId } });

  beforeEach(async () => {
    fx = await seedTenantFixture();
    ctxAdmin = {
      empresaId: fx.empresaA.id,
      sucursalId: fx.sucursalA1.id,
      usuarioId: fx.usuarios.adminA.id,
      esAdmin: true,
    };
    ctxOperador = { ...ctxAdmin, esAdmin: false };
    authSub = randomUUID();
    await getHarnessDb().usuario.update({
      where: { id: fx.usuarios.adminA.id },
      data: { authUserId: authSub },
    });
  });

  describe("application level (S1, S2)", () => {
    it("active empresa: buscarUsuarioPorAuthSub resolves the user and empresaEstaActiva is true", async () => {
      const usuario = await buscarUsuarioPorAuthSub(authSub, { id: true, empresaId: true });
      expect(usuario).toEqual({ id: fx.usuarios.adminA.id, empresaId: fx.empresaA.id });
      await expect(empresaEstaActiva(fx.empresaA.id)).resolves.toBe(true);
    });

    it("inactive empresa: buscarUsuarioPorAuthSub returns null and the login check is false", async () => {
      await setActivaComoBootstrap(fx.empresaA.id, false);

      await expect(buscarUsuarioPorAuthSub(authSub, { id: true })).resolves.toBeNull();
      await expect(empresaEstaActiva(fx.empresaA.id)).resolves.toBe(false);
    });

    it("an inactive empresa does not affect another empresa's check", async () => {
      await setActivaComoBootstrap(fx.empresaA.id, false);

      await expect(empresaEstaActiva(fx.empresaB.id)).resolves.toBe(true);
    });

    it("an empresa that does not exist reads as not active (fail closed)", async () => {
      await expect(empresaEstaActiva(2_000_000_000)).resolves.toBe(false);
    });

    it("re-activating the empresa restores the session lookup", async () => {
      await setActivaComoBootstrap(fx.empresaA.id, false);
      await setActivaComoBootstrap(fx.empresaA.id, true);

      const usuario = await buscarUsuarioPorAuthSub(authSub, { id: true });
      expect(usuario).toEqual({ id: fx.usuarios.adminA.id });
    });
  });

  describe("database trigger (S3)", () => {
    it("a session that never set app.is_bootstrap cannot change activa (fail closed)", async () => {
      await expect(
        getHarnessDb().$executeRaw`UPDATE "EMPRESA" SET "activa" = false WHERE id = ${fx.empresaA.id}`,
      ).rejects.toThrow(GUARD_REFUSAL);
      expect((await leerEmpresa(fx.empresaA.id)).activa).toBe(true);
    });

    it.each([
      ["Administrador", () => ctxAdmin],
      ["non-admin", () => ctxOperador],
    ] as const)("a %s tenant session cannot change activa, and the row is unchanged", async (_rol, ctx) => {
      const before = await leerEmpresa(fx.empresaA.id);

      await expect(
        withTenantTransaction(ctx(), (tx) =>
          tx.empresa.updateMany({
            where: { id: fx.empresaA.id },
            data: { activa: false },
          }),
        ),
      ).rejects.toThrow(GUARD_REFUSAL);

      expect(await leerEmpresa(fx.empresaA.id)).toEqual(before);
      expect((await leerEmpresa(fx.empresaA.id)).activa).toBe(true);
    });

    it("a tenant session cannot re-activate an inactive empresa either", async () => {
      await setActivaComoBootstrap(fx.empresaA.id, false);
      const before = await leerEmpresa(fx.empresaA.id);

      await expect(
        withTenantTransaction(ctxAdmin, (tx) =>
          tx.empresa.updateMany({
            where: { id: fx.empresaA.id },
            data: { activa: true },
          }),
        ),
      ).rejects.toThrow(GUARD_REFUSAL);

      expect(await leerEmpresa(fx.empresaA.id)).toEqual(before);
    });

    it("a bootstrap session may change activa", async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_bootstrap', 'true', true)`;
        const r = await tx.empresa.updateMany({
          where: { id: fx.empresaA.id },
          data: { activa: false },
        });
        expect(r.count).toBe(1);
      });

      expect((await leerEmpresa(fx.empresaA.id)).activa).toBe(false);
    });

    it("a tenant session can still update other columns (nombreComercial)", async () => {
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.empresa.updateMany({
          where: { id: fx.empresaA.id },
          data: { nombreComercial: "Nombre nuevo SA" },
        }),
      );

      expect(res.count).toBe(1);
      const stored = await leerEmpresa(fx.empresaA.id);
      expect(stored.nombreComercial).toBe("Nombre nuevo SA");
      expect(stored.activa).toBe(true);
    });

    it("a tenant UPDATE that rewrites activa to its current value is allowed", async () => {
      const res = await withTenantTransaction(ctxAdmin, (tx) =>
        tx.empresa.updateMany({
          where: { id: fx.empresaA.id },
          data: { activa: true, nombreComercial: "Mismo valor SA" },
        }),
      );

      expect(res.count).toBe(1);
      expect((await leerEmpresa(fx.empresaA.id)).activa).toBe(true);
    });
  });
});
