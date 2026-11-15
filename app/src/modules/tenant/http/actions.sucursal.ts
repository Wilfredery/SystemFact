/**
 * Tenant Server Action — thin HTTP adapter for the admin branch switch
 * (“auth-tenant-selector”, design D4). Zero business logic (AGENTS.md):
 *   1. Zod-parse the payload → stable `VALIDATION_ERROR` on a bad SHAPE.
 *   2. Resolve the tenant context from the Supabase session (auth read, not
 *      tenant-DB access — precedes the wrapper, venta/devolucion convention).
 *   3. Inside the ONE `withTenantTransaction`: delegate to the use case and
 *      forward its typed result. The switch form triggers navigation to
 *      `/dashboard` on success (design D2).
 *
 * Only stable catalog codes cross the boundary; Prisma/DB errors never leak.
 * The branch-management writes (`crearSucursalAction`, `editarSucursalAction`,
 * odd/tasks/administracion-sucursales-crear-editar.md S3-S7) follow the sibling
 * `actions.usuarios.ts` shape: parse, session, then INSIDE the one transaction
 * the Administrador-only role gate BEFORE any use case (deny-by-default).
 *
 * Constants/types live in `./validations.ts` — a `"use server"` file may only
 * export async functions (devolucion/actions.shared.ts precedent).
 */

"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { cambiarSucursalActiva } from "../application/cambiarSucursalActiva";
import {
  crearSucursal,
  editarSucursal,
  type EditarSucursalData,
  type ResultadoSucursal,
} from "../application/gestion-sucursales";
import type { SucursalGestionable } from "../infrastructure/sucursal-gestion-repository";
import { tieneRolPermitidoEnTx } from "../infrastructure/usuario-repository";
import { TEN_OPS_NO_AUTORIZADO, messageFor } from "../domain/errors";
import {
  VALIDATION_ERROR,
  SESION_INVALIDA,
  mensajeTransporte,
  zCambiarSucursalInput,
  zCrearSucursalInput,
  zEditarSucursalInput,
} from "./validations";
import {
  ROLES_GESTION_SUCURSALES,
  error,
  ok,
  resolverCtx,
  type ActionResult,
} from "./shared";

export type CambiarSucursalActionCode =
  | import("../domain/errors").TenantErrorCode
  | typeof VALIDATION_ERROR
  | typeof SESION_INVALIDA;

export type CambiarSucursalActionResult =
  | { ok: true }
  | { ok: false; code: CambiarSucursalActionCode; message: string };

export async function cambiarSucursalActivaAction(
  input: unknown,
): Promise<CambiarSucursalActionResult> {
  const parsed = zCambiarSucursalInput.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      code: VALIDATION_ERROR,
      message: mensajeTransporte(VALIDATION_ERROR),
    };
  }

  const supabase = await createClient();
  const ctx = await getCurrentTenantContext(supabase);
  if (ctx === null) {
    return {
      ok: false,
      code: SESION_INVALIDA,
      message: mensajeTransporte(SESION_INVALIDA),
    };
  }

  return withTenantTransaction(ctx, (tx) =>
    cambiarSucursalActiva(ctx, parsed.data, tx),
  );
}

function aActionResult<T>(result: ResultadoSucursal<T>): ActionResult<T> {
  return result.ok ? ok(result.data) : error(result.code, result.message);
}

/** Create a branch (Administrador only). `empresaId` always comes from the session. */
export async function crearSucursalAction(
  input: unknown,
): Promise<ActionResult<SucursalGestionable>> {
  const parsed = zCrearSucursalInput.safeParse(input);
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
      ROLES_GESTION_SUCURSALES,
    );
    if (!permitido) {
      return error(TEN_OPS_NO_AUTORIZADO, messageFor(TEN_OPS_NO_AUTORIZADO));
    }
    return aActionResult(await crearSucursal(tx, ctx, parsed.data));
  });
}

/** Edit a branch's name, address and phone with optimistic locking (Administrador only). */
export async function editarSucursalAction(
  input: unknown,
): Promise<ActionResult<EditarSucursalData>> {
  const parsed = zEditarSucursalInput.safeParse(input);
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
      ROLES_GESTION_SUCURSALES,
    );
    if (!permitido) {
      return error(TEN_OPS_NO_AUTORIZADO, messageFor(TEN_OPS_NO_AUTORIZADO));
    }
    return aActionResult(await editarSucursal(tx, ctx, parsed.data));
  });
}
