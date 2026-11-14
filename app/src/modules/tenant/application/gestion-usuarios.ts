/**
 * Application use cases — user management writes (Step 7b, S4–S8).
 *
 * `cambiarRolesUsuario` (SET semantics) and `cambiarEstadoUsuario` (flip
 * `activo`). Both run inside the caller's `withTenantTransaction` and follow the
 * same sequence, so the invariants are decided UNDER the row locks, never
 * check-then-write outside them (S7):
 *
 *   1. lock the target + the branch's active administrators (id order) and
 *      re-prove the ACTOR is still an active Administrador -> TEN_OPS_NO_AUTORIZADO
 *   2. read the target                      -> TEN_USUARIO_NO_ENCONTRADO
 *   3. version check                        -> TEN_CONCURRENCIA_CONFLICTO
 *   4. (roles) validate the id set          -> TEN_ROL_NO_VALIDO
 *   5. count administrators, decide (pure domain)
 *        SIN_CAMBIO -> ok, cambio=false: NO write, NO version bump, NO audit
 *        RECHAZAR   -> TEN_AUTO_PROTECCION | TEN_ULTIMO_ADMINISTRADOR
 *   6. verified UPDATE (version bump) -> replace roles -> ONE audit row
 *
 * IDEMPOTENCY RULE (decided + pinned by tests): the version check (3) runs
 * BEFORE the no-op detection (5), so a stale `versionEsperada` ALWAYS conflicts,
 * even when the requested state is already in place. That is the stricter-safe
 * choice: a retry must carry the version it actually read; a screen that is
 * behind never gets a silent "success" for a state it has not seen. A retry
 * with the CURRENT version and the same target state is the idempotent no-op.
 *
 * The Administrador role group is passed in (`rolesAdministrador`): the only
 * place the role name is spelled is `ROLES_GESTION_USUARIOS` in `http/shared.ts`.
 * Authorization (who may call this) is the action's job; this layer never
 * touches Prisma directly (AGENTS.md).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_ROL_NO_VALIDO,
  TEN_USUARIO_NO_ENCONTRADO,
  messageFor,
  type TenantErrorCode,
} from "../domain/errors";
import {
  decidirCambioEstado,
  decidirCambioRoles,
  esAdministradorActivo,
  validarConjuntoRoles,
} from "../domain/usuario-gestion";
import {
  aplicarCambioUsuarioEnTx,
  bloquearUsuarioYAdministradoresEnTx,
  contarAdministradoresActivosEnTx,
  leerRolesActivosPorIdEnTx,
  leerUsuarioGestionableEnTx,
  reemplazarRolesEnTx,
  registrarAuditUsuarioEnTx,
} from "../infrastructure/usuario-gestion-repository";

export interface CambiarRolesUsuarioInput {
  readonly usuarioId: number;
  readonly rolIds: readonly number[];
  readonly versionEsperada: number;
}

export interface CambiarEstadoUsuarioInput {
  readonly usuarioId: number;
  readonly activo: boolean;
  readonly versionEsperada: number;
}

export interface CambioUsuarioData {
  readonly usuarioId: number;
  /** Version after the call (unchanged on a no-op). */
  readonly version: number;
  /** `false` = idempotent no-op (nothing written, no audit row). */
  readonly cambio: boolean;
}

export type CambioUsuarioResult =
  | { readonly ok: true; readonly data: CambioUsuarioData }
  | {
      readonly ok: false;
      readonly code: TenantErrorCode;
      readonly message: string;
    };

function rechazo(code: TenantErrorCode): CambioUsuarioResult {
  return { ok: false, code, message: messageFor(code) };
}

function nombresOrdenados(roles: readonly { nombre: string }[]): string[] {
  return roles.map((rol) => rol.nombre).sort((a, b) => a.localeCompare(b));
}

/**
 * Step 2 of the sequence: bring the rows under lock and re-prove the ACTOR.
 * The action's role guard ran BEFORE the lock, so a concurrent transaction may
 * have demoted/deactivated the actor in between; their authority is re-read
 * here, under the lock, and must still hold (TOCTOU close).
 */
async function bloquearYVerificarActor(
  tx: PrismaTx,
  ctx: TenantCtx,
  usuarioId: number,
  rolesAdministrador: readonly string[],
): Promise<boolean> {
  await bloquearUsuarioYAdministradoresEnTx(tx, ctx, usuarioId, rolesAdministrador);
  const actor = await leerUsuarioGestionableEnTx(tx, ctx.empresaId, ctx.usuarioId);
  return actor !== null && esAdministradorActivo(actor, rolesAdministrador);
}

export async function cambiarRolesUsuario(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CambiarRolesUsuarioInput,
  rolesAdministrador: readonly string[],
): Promise<CambioUsuarioResult> {
  if (!(await bloquearYVerificarActor(tx, ctx, input.usuarioId, rolesAdministrador))) {
    return rechazo(TEN_OPS_NO_AUTORIZADO);
  }

  const objetivo = await leerUsuarioGestionableEnTx(
    tx,
    ctx.empresaId,
    input.usuarioId,
  );
  if (objetivo === null) return rechazo(TEN_USUARIO_NO_ENCONTRADO);
  if (objetivo.version !== input.versionEsperada) {
    return rechazo(TEN_CONCURRENCIA_CONFLICTO);
  }

  const catalogo = await leerRolesActivosPorIdEnTx(tx, input.rolIds);
  if (!validarConjuntoRoles(input.rolIds, catalogo)) {
    return rechazo(TEN_ROL_NO_VALIDO);
  }

  const administradoresActivos = await contarAdministradoresActivosEnTx(
    tx,
    ctx,
    rolesAdministrador,
  );
  const decision = decidirCambioRoles({
    actorId: ctx.usuarioId,
    objetivoId: objetivo.id,
    objetivoActivo: objetivo.activo,
    rolesActuales: objetivo.roles,
    rolesNuevos: catalogo,
    rolesAdministrador,
    administradoresActivos,
  });
  if (decision.tipo === "RECHAZAR") return rechazo(decision.code);
  if (decision.tipo === "SIN_CAMBIO") {
    return {
      ok: true,
      data: { usuarioId: objetivo.id, version: objetivo.version, cambio: false },
    };
  }

  // Version bump FIRST: a lost race (0 rows) must not have touched the roles.
  const aplicado = await aplicarCambioUsuarioEnTx(
    tx,
    ctx.empresaId,
    objetivo.id,
    input.versionEsperada,
    {},
  );
  if (!aplicado.aplicado) return rechazo(TEN_CONCURRENCIA_CONFLICTO);

  await reemplazarRolesEnTx(
    tx,
    objetivo.id,
    catalogo.map((rol) => rol.id),
  );
  await registrarAuditUsuarioEnTx(
    tx,
    ctx,
    objetivo.id,
    { roles: nombresOrdenados(objetivo.roles) },
    { roles: nombresOrdenados(catalogo) },
  );
  return {
    ok: true,
    data: { usuarioId: objetivo.id, version: aplicado.version, cambio: true },
  };
}

export async function cambiarEstadoUsuario(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CambiarEstadoUsuarioInput,
  rolesAdministrador: readonly string[],
): Promise<CambioUsuarioResult> {
  if (!(await bloquearYVerificarActor(tx, ctx, input.usuarioId, rolesAdministrador))) {
    return rechazo(TEN_OPS_NO_AUTORIZADO);
  }

  const objetivo = await leerUsuarioGestionableEnTx(
    tx,
    ctx.empresaId,
    input.usuarioId,
  );
  if (objetivo === null) return rechazo(TEN_USUARIO_NO_ENCONTRADO);
  if (objetivo.version !== input.versionEsperada) {
    return rechazo(TEN_CONCURRENCIA_CONFLICTO);
  }

  const administradoresActivos = await contarAdministradoresActivosEnTx(
    tx,
    ctx,
    rolesAdministrador,
  );
  const decision = decidirCambioEstado({
    actorId: ctx.usuarioId,
    objetivoId: objetivo.id,
    objetivoActivo: objetivo.activo,
    activoNuevo: input.activo,
    objetivoEsAdministrador: objetivo.roles.some((rol) =>
      rolesAdministrador.includes(rol.nombre),
    ),
    administradoresActivos,
  });
  if (decision.tipo === "RECHAZAR") return rechazo(decision.code);
  if (decision.tipo === "SIN_CAMBIO") {
    return {
      ok: true,
      data: { usuarioId: objetivo.id, version: objetivo.version, cambio: false },
    };
  }

  const aplicado = await aplicarCambioUsuarioEnTx(
    tx,
    ctx.empresaId,
    objetivo.id,
    input.versionEsperada,
    { activo: input.activo },
  );
  if (!aplicado.aplicado) return rechazo(TEN_CONCURRENCIA_CONFLICTO);

  await registrarAuditUsuarioEnTx(
    tx,
    ctx,
    objetivo.id,
    { activo: objetivo.activo },
    { activo: input.activo },
  );
  return {
    ok: true,
    data: { usuarioId: objetivo.id, version: aplicado.version, cambio: true },
  };
}
