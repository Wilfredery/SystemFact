/**
 * Tenant repository — the USUARIO management WRITES (Step 7b, S4–S8).
 *
 * Everything runs INSIDE the caller's `withTenantTransaction` (the RLS GUCs are
 * already set, and the DB role-aware write policies of migration
 * `20261114120000_usuario_writes_admin_only` are the second wall). Every
 * statement ALSO pins `empresaId` (AGENTS.md defense in depth); the branch scope
 * stays owned by RLS, as in `usuario-repository.ts`, except the administrator
 * count, which is by definition "this session branch" and says so explicitly.
 *
 * Locking (S7): `bloquearUsuarioYAdministradoresEnTx` takes ONE statement
 * `... ORDER BY id FOR UPDATE` over the target row plus every ACTIVE
 * administrator row of the branch. A single ordered statement means every
 * transaction acquires the row locks in the same (id) order, so two admins
 * demoting each other serialize instead of deadlocking. The counts and reads that
 * decide the write are separate statements issued AFTER the locks are held:
 * under READ COMMITTED each statement sees what the previous lock holder
 * committed, so the decision is never made on a stale snapshot.
 *
 * Users are NEVER deleted (master entity, AGENTS.md): this file exposes no
 * `delete` of USUARIO. `USUARIO_ROL` rows are the only thing replaced.
 */

import { ACCION_AUDITORIA } from "@/modules/auditoria/domain/auditoria";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import type { RolCatalogo } from "../domain/usuario-gestion";

export interface UsuarioGestionable {
  readonly id: number;
  readonly activo: boolean;
  readonly version: number;
  readonly roles: readonly RolCatalogo[];
}

/** Lock the target user row and all active administrators of the branch, in id order. */
export async function bloquearUsuarioYAdministradoresEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  usuarioId: number,
  rolesAdministrador: readonly string[],
): Promise<void> {
  await tx.$queryRaw`
    SELECT u."id"
    FROM "USUARIO" u
    WHERE u."empresaId" = ${ctx.empresaId}
      AND (
        u."id" = ${usuarioId}
        OR (
          u."sucursalId" = ${ctx.sucursalId}
          AND u."activo" = true
          AND EXISTS (
            SELECT 1
            FROM "USUARIO_ROL" ur
            JOIN "ROL" r ON r."id" = ur."rolId"
            WHERE ur."usuarioId" = u."id"
              AND r."nombre" = ANY(${[...rolesAdministrador]}::text[])
          )
        )
      )
    ORDER BY u."id"
    FOR UPDATE OF u`;
}

/** The target as the write sees it; `null` = unknown / foreign empresa / other branch (RLS). */
export async function leerUsuarioGestionableEnTx(
  tx: PrismaTx,
  empresaId: number,
  usuarioId: number,
): Promise<UsuarioGestionable | null> {
  const fila = await tx.usuario.findFirst({
    where: { id: usuarioId, empresaId },
    select: {
      id: true,
      activo: true,
      version: true,
      roles: { select: { rol: { select: { id: true, nombre: true } } } },
    },
  });
  if (fila === null) return null;
  return {
    id: fila.id,
    activo: fila.activo,
    version: fila.version,
    roles: fila.roles.map((r) => ({ id: r.rol.id, nombre: r.rol.nombre })),
  };
}

/**
 * ACTIVE administrators of the SESSION branch. RLS only shows the branch, so
 * this can only under-count (err toward refusing the write), never over-count.
 */
export async function contarAdministradoresActivosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  rolesAdministrador: readonly string[],
): Promise<number> {
  return tx.usuario.count({
    where: {
      empresaId: ctx.empresaId,
      sucursalId: ctx.sucursalId,
      activo: true,
      roles: { some: { rol: { nombre: { in: [...rolesAdministrador] } } } },
    },
  });
}

/** The ACTIVE catalog roles among `rolIds` (unknown and inactive ids are simply absent). */
export async function leerRolesActivosPorIdEnTx(
  tx: PrismaTx,
  rolIds: readonly number[],
): Promise<RolCatalogo[]> {
  const filas = await tx.rol.findMany({
    where: { id: { in: [...rolIds] }, activo: true },
    select: { id: true, nombre: true },
  });
  return filas;
}

/**
 * Verified UPDATE: `WHERE id AND empresaId AND version = esperada`, bumping
 * `version` atomically. `aplicado=false` (0 rows) means a stale version.
 * `activo` is only written when given (roles change only bumps the version).
 */
export async function aplicarCambioUsuarioEnTx(
  tx: PrismaTx,
  empresaId: number,
  usuarioId: number,
  versionEsperada: number,
  cambio: { readonly activo?: boolean },
): Promise<{ aplicado: boolean; version: number }> {
  const resultado = await tx.usuario.updateMany({
    where: { id: usuarioId, empresaId, version: versionEsperada },
    data: {
      version: { increment: 1 },
      ...(cambio.activo === undefined ? {} : { activo: cambio.activo }),
    },
  });
  if (resultado.count === 0) return { aplicado: false, version: versionEsperada };
  return { aplicado: true, version: versionEsperada + 1 };
}

/** Replace the user's role set (set semantics, S4): deleteMany + createMany in the same tx. */
export async function reemplazarRolesEnTx(
  tx: PrismaTx,
  usuarioId: number,
  rolIds: readonly number[],
): Promise<void> {
  await tx.usuarioRol.deleteMany({ where: { usuarioId } });
  await tx.usuarioRol.createMany({
    data: rolIds.map((rolId) => ({ usuarioId, rolId })),
  });
}

/** ONE append-only audit row per successful change (S8): who = ctx.usuarioId, target = usuarioId. */
export async function registrarAuditUsuarioEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  usuarioId: number,
  antes: Record<string, unknown>,
  despues: Record<string, unknown>,
): Promise<void> {
  await registrarEventoAuditoriaEnTx(tx, ctx, {
    accion: ACCION_AUDITORIA.ACTUALIZAR,
    entidad: "Usuario",
    idEntidad: String(usuarioId),
    valorAnterior: JSON.stringify(antes),
    valorNuevo: JSON.stringify(despues),
  });
}
