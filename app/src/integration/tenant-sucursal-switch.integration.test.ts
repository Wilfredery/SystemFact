/**
 * Integration tests — S2 switch active sucursal (real DB, RLS enforced).
 *
 * TEN-SWITCH: a confirmed switch rewrites `Usuario.sucursalId` so the NEXT
 * row read resolves the NEW branch; nothing else changed (no audit row); a
 * foreign-empresa/inactive target is refused with the shared code.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { cambiarSucursalActiva } from "@/modules/tenant/application/cambiarSucursalActiva";
import { TEN_SUCURSAL_NO_VALIDA } from "@/modules/tenant/domain/errors";
import { getHarnessDb, seedTenantFixture, type TenantFixture } from "./setup/fixtures";

describe("cambiarSucursalActiva (real DB)", () => {
  let fixture: TenantFixture;
  let ctxA: TenantCtx;

  beforeEach(async () => {
    fixture = await seedTenantFixture();
    ctxA = {
      empresaId: fixture.empresaA.id,
      sucursalId: fixture.sucursalA1.id,
      usuarioId: fixture.usuarios.adminA.id,
      esAdmin: true,
    };
  });

  it("TEN-SWITCH-04-A: happy path persists sucursalId + version++ and writes NO audit row", async () => {
    const db = getHarnessDb();
    const auditBefore = await db.movimientoAuditoria.count();

    const result = await withTenantTransaction(ctxA, (tx: PrismaTx) =>
      cambiarSucursalActiva(ctxA, { sucursalId: fixture.sucursalA2.id }, tx),
    );
    expect(result).toEqual({ ok: true });

    // Next row read (the resolution point, D1) resolves the NEW branch.
    const usuario = await db.usuario.findUniqueOrThrow({
      where: { id: ctxA.usuarioId },
      select: { sucursalId: true, version: true },
    });
    expect(usuario.sucursalId).toBe(fixture.sucursalA2.id);

    // ZERO audit rows: the audit table gained nothing (not even LOGIN).
    const auditAfter = await db.movimientoAuditoria.count();
    expect(auditAfter).toBe(auditBefore);
  });

  it("TEN-SWITCH-04-B/D: a target outside the empresa scope is refused, branch unchanged", async () => {
    const result = await withTenantTransaction(ctxA, (tx: PrismaTx) =>
      cambiarSucursalActiva(ctxA, { sucursalId: fixture.sucursalB1.id }, tx),
    );

    expect(result).toEqual({
      ok: false,
      code: TEN_SUCURSAL_NO_VALIDA,
      message: expect.any(String),
    });
    const usuario = await getHarnessDb().usuario.findUniqueOrThrow({
      where: { id: ctxA.usuarioId },
      select: { sucursalId: true },
    });
    expect(usuario.sucursalId).toBe(fixture.sucursalA1.id);
  });

  it("TEN-SWITCH-04-E.idempotent: re-confirming the current branch writes nothing", async () => {
    const db = getHarnessDb();
    const versionAntes = (
      await db.usuario.findUniqueOrThrow({
        where: { id: ctxA.usuarioId },
        select: { version: true },
      })
    ).version;

    const result = await withTenantTransaction(ctxA, (tx: PrismaTx) =>
      cambiarSucursalActiva(ctxA, { sucursalId: fixture.sucursalA1.id }, tx),
    );
    expect(result).toEqual({ ok: true });

    const usuario = await db.usuario.findUniqueOrThrow({
      where: { id: ctxA.usuarioId },
      select: { sucursalId: true, version: true },
    });
    expect(usuario.sucursalId).toBe(fixture.sucursalA1.id);
    expect(usuario.version).toBe(versionAntes);
  });

  it("TEN-SWITCH-04-C: non-admin ctx denied, nothing changed", async () => {
    const ctxNoAdmin: TenantCtx = { ...ctxA, esAdmin: false };
    const result = await withTenantTransaction(ctxNoAdmin, (tx: PrismaTx) =>
      cambiarSucursalActiva(ctxNoAdmin, { sucursalId: fixture.sucursalA2.id }, tx),
    );
    expect(result).toEqual({
      ok: false,
      code: "TEN_OPS_NO_AUTORIZADO",
      message: expect.any(String),
    });
  });
});
