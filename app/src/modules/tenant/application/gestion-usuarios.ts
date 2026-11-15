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
  TEN_SUCURSAL_NO_VALIDA,
  TEN_USUARIO_NO_ENCONTRADO,
  TEN_USUARIO_SUCURSAL_INACTIVA,
  messageFor,
  type TenantErrorCode,
} from "../domain/errors";
import {
  decidirCambioEstado,
  decidirCambioRoles,
  decidirMovimientoUsuario,
  esAdministradorActivo,
  validarConjuntoRoles,
} from "../domain/usuario-gestion";
import {
  aplicarCambioUsuarioEnTx,
  bloquearUsuarioYAdministradoresDeSucursalesEnTx,
  bloquearUsuarioYAdministradoresEnTx,
  contarAdministradoresActivosDeSucursalEnTx,
  contarAdministradoresActivosEnTx,
  leerRolesActivosPorIdEnTx,
  leerUsuarioGestionableEnTx,
  leerUsuarioParaMoverEnTx,
  moverUsuarioASucursalEnTx,
  reemplazarRolesEnTx,
  registrarAuditUsuarioEnTx,
} from "../infrastructure/usuario-gestion-repository";
import {
  activarSucursalEnTx,
  leerSucursalActivaEnTx,
  leerSucursalActivaConBloqueoEnTx,
  leerSucursalEstadoEnTx,
  liberarSucursalActivaEnTx,
} from "../infrastructure/repo-sucursal";

export interface CambiarRolesUsuarioInput {
  readonly usuarioId: number;
  readonly rolIds: readonly number[];
  readonly versionEsperada: number;
}

export interface MoverUsuarioDeSucursalInput {
  readonly usuarioId: number;
  readonly sucursalDestinoId: number;
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

/** What the activation holds about the target's branch once the user rows are locked. */
type SucursalDeActivacion =
  | { readonly tipo: "NO_APLICA" }
  | { readonly tipo: "BLOQUEADA"; readonly sucursalId: number }
  | { readonly tipo: "NO_BLOQUEADA"; readonly sucursalId: number };

/**
 * L8, step 0 of an ACTIVATION (activo false -> true): share-lock the target
 * user's OWN branch row BEFORE any user row is locked. Lock order, global:
 * SUCURSAL first, then USUARIO rows. That is the order of `moverUsuarioDeSucursal`
 * (destination branch FOR SHARE, then users) and of `cambiarEstadoSucursal`
 * (branch FOR UPDATE, then plain count reads that take no row locks), so no
 * pair of these paths can wait on each other in a cycle. Effect against a
 * concurrent deactivation of that branch: whoever takes the branch row first
 * wins; the deactivation after our commit counts the now-active user and
 * refuses, and our read after its commit finds the branch inactive.
 *
 * The user's branch is only known from the row: a plain probe finds it, and the
 * caller re-reads it after the user locks and refuses if it moved. The probe is
 * skipped for a deactivation and for a user that already is active (the no-op
 * reads no branch). An empty locked read is NOT decided here (it also happens
 * to a non-admin, whose refusal belongs to the actor check that follows).
 */
async function bloquearSucursalDeActivacion(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CambiarEstadoUsuarioInput,
): Promise<SucursalDeActivacion> {
  if (!input.activo) return { tipo: "NO_APLICA" };
  const previo = await leerUsuarioParaMoverEnTx(tx, ctx.empresaId, input.usuarioId);
  if (previo === null || previo.activo) return { tipo: "NO_APLICA" };
  const bloqueada = await leerSucursalActivaConBloqueoEnTx(
    tx,
    ctx.empresaId,
    previo.sucursalId,
  );
  return {
    tipo: bloqueada === null ? "NO_BLOQUEADA" : "BLOQUEADA",
    sucursalId: previo.sucursalId,
  };
}

/**
 * Decides, under the locks, whether the branch of the user being activated is
 * usable: `true` = active and share-locked; otherwise the refusal code.
 */
async function sucursalDeActivacionUsable(
  tx: PrismaTx,
  ctx: TenantCtx,
  usuarioId: number,
  sucursal: SucursalDeActivacion,
): Promise<true | TenantErrorCode> {
  if (sucursal.tipo === "NO_APLICA") return true;
  const actual = await leerUsuarioParaMoverEnTx(tx, ctx.empresaId, usuarioId);
  if (actual === null || actual.sucursalId !== sucursal.sucursalId) {
    return TEN_CONCURRENCIA_CONFLICTO;
  }
  if (sucursal.tipo === "BLOQUEADA") return true;
  const visible = await leerSucursalEstadoEnTx(tx, ctx.empresaId, sucursal.sucursalId);
  if (visible === null) return TEN_SUCURSAL_NO_VALIDA;
  // Visible and active without the lock held: it was reactivated in between; the
  // lock is what makes the decision safe, so ask for an explicit retry.
  return visible.activa ? TEN_CONCURRENCIA_CONFLICTO : TEN_USUARIO_SUCURSAL_INACTIVA;
}

export async function cambiarEstadoUsuario(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CambiarEstadoUsuarioInput,
  rolesAdministrador: readonly string[],
): Promise<CambioUsuarioResult> {
  const sucursalDeActivacion = await bloquearSucursalDeActivacion(tx, ctx, input);
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

  // Only a real activation consults the branch (a deactivation or a no-op never
  // refuses because of it).
  const sucursalUsable =
    !objetivo.activo && input.activo
      ? await sucursalDeActivacionUsable(tx, ctx, objetivo.id, sucursalDeActivacion)
      : true;
  if (sucursalUsable !== true && sucursalUsable !== TEN_USUARIO_SUCURSAL_INACTIVA) {
    return rechazo(sucursalUsable);
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
    sucursalObjetivoActiva: sucursalUsable === true,
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

type ResultadoMovimiento =
  | {
      readonly tipo: "MOVIDO";
      readonly version: number;
      readonly sucursalOrigenId: number;
    }
  | { readonly tipo: "SIN_CAMBIO"; readonly version: number }
  | { readonly tipo: "RECHAZADO"; readonly code: TenantErrorCode };

/**
 * Everything of the move that needs the company-wide view: lock, re-prove the
 * actor, read the target, version check, source-branch admin count, decision
 * and the version-checked UPDATE. The branch GUC is blank ONLY inside this
 * function (restored in `finally`, the empresa GUC is never touched), so the
 * audit insert and everything after run pinned to the session branch again.
 */
async function moverBajoSucursalAmpliada(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: MoverUsuarioDeSucursalInput,
  rolesAdministrador: readonly string[],
): Promise<ResultadoMovimiento> {
  await liberarSucursalActivaEnTx(tx);
  try {
    // The source branch is only known from the row itself: probe it, lock with
    // it, then re-read under the lock and refuse if it moved in between.
    const previo = await leerUsuarioParaMoverEnTx(tx, ctx.empresaId, input.usuarioId);
    if (previo === null) {
      return { tipo: "RECHAZADO", code: TEN_USUARIO_NO_ENCONTRADO };
    }
    await bloquearUsuarioYAdministradoresDeSucursalesEnTx(
      tx,
      ctx.empresaId,
      input.usuarioId,
      [previo.sucursalId, input.sucursalDestinoId],
      rolesAdministrador,
    );

    const actor = await leerUsuarioGestionableEnTx(tx, ctx.empresaId, ctx.usuarioId);
    if (actor === null || !esAdministradorActivo(actor, rolesAdministrador)) {
      return { tipo: "RECHAZADO", code: TEN_OPS_NO_AUTORIZADO };
    }

    const objetivo = await leerUsuarioParaMoverEnTx(tx, ctx.empresaId, input.usuarioId);
    if (objetivo === null) {
      return { tipo: "RECHAZADO", code: TEN_USUARIO_NO_ENCONTRADO };
    }
    if (
      objetivo.version !== input.versionEsperada ||
      objetivo.sucursalId !== previo.sucursalId
    ) {
      return { tipo: "RECHAZADO", code: TEN_CONCURRENCIA_CONFLICTO };
    }

    const decision = decidirMovimientoUsuario({
      actorId: ctx.usuarioId,
      objetivoId: objetivo.id,
      sucursalOrigenId: objetivo.sucursalId,
      sucursalDestinoId: input.sucursalDestinoId,
      objetivoEsAdministradorActivo: esAdministradorActivo(objetivo, rolesAdministrador),
      administradoresActivosOrigen: await contarAdministradoresActivosDeSucursalEnTx(
        tx,
        ctx.empresaId,
        objetivo.sucursalId,
        rolesAdministrador,
      ),
    });
    if (decision.tipo === "RECHAZAR") {
      return { tipo: "RECHAZADO", code: decision.code };
    }
    if (decision.tipo === "SIN_CAMBIO") {
      return { tipo: "SIN_CAMBIO", version: objetivo.version };
    }

    const aplicado = await moverUsuarioASucursalEnTx(
      tx,
      ctx.empresaId,
      objetivo.id,
      input.versionEsperada,
      input.sucursalDestinoId,
    );
    if (!aplicado.aplicado) {
      return { tipo: "RECHAZADO", code: TEN_CONCURRENCIA_CONFLICTO };
    }
    return {
      tipo: "MOVIDO",
      version: aplicado.version,
      sucursalOrigenId: objetivo.sucursalId,
    };
  } finally {
    await activarSucursalEnTx(tx, ctx.sucursalId);
  }
}

/**
 * Move a user to another ACTIVE branch of the same empresa (Administrador only,
 * gated by the action). The destination must be an active branch of the
 * session empresa (one code for foreign/inactive/unknown), read FOR SHARE: the
 * lock lasts until commit, so a deactivation of that branch waits for this move
 * (and then refuses: it counts the moved user) or commits first (and this read
 * comes back empty). Same-branch = idempotent no-op: no write, no version bump,
 * no audit.
 */
export async function moverUsuarioDeSucursal(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: MoverUsuarioDeSucursalInput,
  rolesAdministrador: readonly string[],
): Promise<CambioUsuarioResult> {
  const destino = await leerSucursalActivaConBloqueoEnTx(
    tx,
    ctx.empresaId,
    input.sucursalDestinoId,
  );
  if (destino === null) {
    // The locked read is also empty for a non-admin (RLS grants the row lock only
    // to who may UPDATE the branch): a plain read tells "not allowed" from "not
    // available". A deactivation that commits between the two reads reads as
    // not available, which is right.
    const visible = await leerSucursalActivaEnTx(tx, ctx.empresaId, input.sucursalDestinoId);
    return rechazo(visible === null ? TEN_SUCURSAL_NO_VALIDA : TEN_OPS_NO_AUTORIZADO);
  }

  const resultado = await moverBajoSucursalAmpliada(
    tx,
    ctx,
    input,
    rolesAdministrador,
  );
  if (resultado.tipo === "RECHAZADO") return rechazo(resultado.code);
  if (resultado.tipo === "SIN_CAMBIO") {
    return {
      ok: true,
      data: { usuarioId: input.usuarioId, version: resultado.version, cambio: false },
    };
  }

  await registrarAuditUsuarioEnTx(
    tx,
    ctx,
    input.usuarioId,
    { sucursalId: resultado.sucursalOrigenId },
    { sucursalId: input.sucursalDestinoId },
  );
  return {
    ok: true,
    data: { usuarioId: input.usuarioId, version: resultado.version, cambio: true },
  };
}
