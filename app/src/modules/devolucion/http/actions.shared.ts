/**
 * Devolucion Server Actions ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â thin HTTP adapters (fase-5d, task 1.4).
 *
 * Each action is the SAME three steps and NOTHING more (zero business logic):
 *   1. zod-parse the payload ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ stable `VALIDATION_ERROR` on a bad shape;
 *   2. resolve the tenant context from the Supabase session (an AUTH read, not
 *      tenant-DB access, so it precedes the wrapper ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â venta/compra convention);
 *   3. inside `withTenantTransaction`: enforce the coarse role
 *      (`Administrador` + `Operador`, mirroring ROLES_VENTA ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â returns are an
 *      operational action), then delegate to the use case and map its typed
 *      result (or `warnings`) into the action envelope.
 *
 * Every DB access here sits inside `withTenantTransaction`, satisfying the
 * project-local ESLint rule `systemfact/server-action-must-wrap-tenant`.
 *
 * The action exposes the composed error surface: the use case's frozen codes
 * (`DevolucionErrorCode` = venta catalog ÃƒÂ¢Ã‹â€ Ã‚Âª `PLAZO_DEVOLUCION_FALTANTE`) plus
 * the three transport codes ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the adapter forwards `result.message` verbatim
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

/** Returns are operational (Administrador + Operador) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â mirrors ROLES_VENTA. */
export const ROLES_DEVOLUCION = ["Administrador", "Operador"];

/** Composed action error surface: domain/catalog ÃƒÂ¢Ã‹â€ Ã‚Âª transport codes. */
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

export function ok<T>(data: T, warnings?: readonly DevolucionWarning[]): ActionResult<T> {
  return warnings && warnings.length > 0 ? { ok: true, data, warnings } : { ok: true, data };
}

export function fail(code: DevolucionAccionesErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

// The use case already resolves a stable user message for its composed code, so
// the adapter forwards `result.message` verbatim (no duplicate copy at the
// boundary ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the single source of truth stays in the domain/config catalogs).
export async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

