/**
 * Devolucion Server Actions — thin HTTP adapters (fase-5d, task 1.4).
 *
 * Each action is the SAME three steps and NOTHING more (zero business logic):
 *   1. zod-parse the payload → stable `VALIDATION_ERROR` on a bad shape;
 *   2. resolve the tenant context from the Supabase session (an AUTH read, not
 *      tenant-DB access, so it precedes the wrapper — venta/compra convention);
 *   3. inside `withTenantTransaction`: enforce the coarse role
 *      (`Administrador` + `Operador`, mirroring ROLES_VENTA — returns are an
 *      operational action), then delegate to the use case and map its typed
 *      result (or `warnings`) into the action envelope.
 *
 * Every DB access here sits inside `withTenantTransaction`, satisfying the
 * project-local ESLint rule `systemfact/server-action-must-wrap-tenant`.
 *
 * The action exposes the composed error surface: the use case's frozen codes
 * (`DevolucionErrorCode` = venta catalog ∪ `PLAZO_DEVOLUCION_FALTANTE`) plus
 * the three transport codes — the adapter forwards `result.message` verbatim
 * (the single source of truth stays in the domain/config catalogs).
 */

"use server";

import { createClient } from "@/lib/supabase/client";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { tieneRolPermitidoEnTx } from "../../venta/infrastructure/venta-repository";
import {
  crearDevolucion,
  type DevolucionErrorCode,
  type DevolucionOutput,
  type DevolucionWarning,
} from "../application/crear-devolucion";
import {
  NO_AUTORIZADO,
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zDevolverVentaInput,
} from "./validations";

/** Returns are operational (Administrador + Operador) — mirrors ROLES_VENTA. */
const ROLES_DEVOLUCION = ["Administrador", "Operador"];

/** Composed action error surface: domain/catalog ∪ transport codes. */
export type DevolucionAccionesErrorCode =
  | DevolucionErrorCode
  | typeof NO_AUTORIZADO
  | typeof SESION_INVALIDA
  | typeof VALIDATION_ERROR;

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T; readonly warnings?: readonly DevolucionWarning[] }
  | {
      readonly ok: false;
      readonly error: { readonly code: DevolucionAccionesErrorCode; readonly message: string };
    };

function ok<T>(data: T, warnings?: readonly DevolucionWarning[]): ActionResult<T> {
  return warnings && warnings.length > 0 ? { ok: true, data, warnings } : { ok: true, data };
}

function fail(code: DevolucionAccionesErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

// The use case already resolves a stable user message for its composed code, so
// the adapter forwards `result.message` verbatim (no duplicate copy at the
// boundary — the single source of truth stays in the domain/config catalogs).
async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

export async function devolverVentaAction(
  input: unknown,
): Promise<ActionResult<DevolucionOutput>> {
  const parsed = zDevolverVentaInput.safeParse(input);
  if (!parsed.success) return fail(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));

  const ctx = await resolverCtx();
  if (ctx === null) return fail(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_DEVOLUCION);
    if (!permitido) {
      return fail(NO_AUTORIZADO, mensajeTransporte(NO_AUTORIZADO));
    }
    const result = await crearDevolucion(tx, ctx, parsed.data);
    if (!result.ok) return fail(result.code, result.message);
    return ok(result.data, result.warnings);
  });
}