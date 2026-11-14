/**
 * Tenant Server Actions — the Administración user-management WRITES (Step 7b,
 * S3–S6/S10). Thin adapters only (AGENTS.md): parse the payload, resolve the
 * session context, and inside the ONE `withTenantTransaction` check the named
 * role group on the SERVER BEFORE any write (deny-by-default), then delegate to
 * the use case. Zero business logic, zero Prisma here; only stable catalog codes
 * cross the boundary (no Prisma errors, no stack traces).
 *
 * The screen re-reads the directory after a confirmed success: there is no
 * cache tag to revalidate (the read actions use none), and fiscal-style
 * operations never render an optimistic state.
 */

"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  cambiarEstadoUsuario,
  cambiarRolesUsuario,
  type CambioUsuarioData,
  type CambioUsuarioResult,
} from "../application/gestion-usuarios";
import { tieneRolPermitidoEnTx } from "../infrastructure/usuario-repository";
import { TEN_OPS_NO_AUTORIZADO, messageFor } from "../domain/errors";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zCambiarEstadoUsuarioInput,
  zCambiarRolesUsuarioInput,
} from "./validations";
import {
  ROLES_GESTION_USUARIOS,
  error,
  ok,
  resolverCtx,
  type ActionResult,
} from "./shared";

function aActionResult(result: CambioUsuarioResult): ActionResult<CambioUsuarioData> {
  return result.ok ? ok(result.data) : error(result.code, result.message);
}

/** Replace a user's roles (SET semantics, S4). Administrador only. */
export async function cambiarRolesUsuarioAction(
  input: unknown,
): Promise<ActionResult<CambioUsuarioData>> {
  const parsed = zCambiarRolesUsuarioInput.safeParse(input);
  if (!parsed.success) {
    return error(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const ctx = await resolverCtx();
  if (ctx === null) {
    return error(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_USUARIOS,
    );
    if (!permitido) {
      return error(TEN_OPS_NO_AUTORIZADO, messageFor(TEN_OPS_NO_AUTORIZADO));
    }
    return aActionResult(
      await cambiarRolesUsuario(tx, ctx, parsed.data, ROLES_GESTION_USUARIOS),
    );
  });
}

/** Activate / deactivate a user (S5, never a delete). Administrador only. */
export async function cambiarEstadoUsuarioAction(
  input: unknown,
): Promise<ActionResult<CambioUsuarioData>> {
  const parsed = zCambiarEstadoUsuarioInput.safeParse(input);
  if (!parsed.success) {
    return error(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const ctx = await resolverCtx();
  if (ctx === null) {
    return error(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_USUARIOS,
    );
    if (!permitido) {
      return error(TEN_OPS_NO_AUTORIZADO, messageFor(TEN_OPS_NO_AUTORIZADO));
    }
    return aActionResult(
      await cambiarEstadoUsuario(tx, ctx, parsed.data, ROLES_GESTION_USUARIOS),
    );
  });
}
