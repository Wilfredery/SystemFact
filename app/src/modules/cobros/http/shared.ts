/**
 * Cobros shared helpers — types, role gates and adapter plumbing for the cobros
 * server actions (fase-6, R-C6, R-B1). The helpers live here; the actions
 * themselves live in `actions.escritura.ts` (writes) and `actions.lectura.ts`
 * (reads) and are re-exported through the `actions.ts` barrel.
 *
 * Each action is the SAME three steps and NOTHING more (zero business logic):
 *   1. zod-parse the payload → stable `VALIDATION_ERROR` on a bad shape (the
 *      refund key is MANDATORY here);
 *   2. resolve the tenant context from the Supabase session (an AUTH read, not
 *      tenant-DB access, so it precedes the wrapper — venta/devolucion convention);
 *   3. inside `withTenantTransaction`: enforce the server-side role gate
 *      (R-C6 — a Despachador is denied all of Cobros; a refund additionally needs
 *      an authorizing role), then delegate to the use case and forward its typed
 *      result. An unauthorized actor is refused BEFORE the use case runs, i.e.
 *      before any write and before any receipt number is burned.
 *
 * Hiding UI controls is NOT the control: the role check queries the user's actual
 * DB roles via `tieneRolPermitidoEnTx` (reused from `venta` like `devolucion`),
 * and every read/write is tenant-scoped under the RLS GUCs. The authorization
 * refusal is the cobros catalog's `PAGO_NO_AUTORIZADO`, so the whole error surface
 * stays inside the single versioned catalog (R-C5). No `withTenantTransaction`
 * call sits outside these wrappers (satisfies the project-local ESLint rule).
 */

import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { type CobroErrorCode } from "../domain/errors";
import { SESION_INVALIDA, VALIDATION_ERROR } from "./validations";

/** Cobros collections + reads are operational (Admin + Operador); Despachador denied. */
export const ROLES_COBROS = ["Administrador", "Operador"];
/** Refunds require an authorizing role (Administrador only, §10 / R-C6). */
export const ROLES_REEMBOLSO = ["Administrador"];

/** Composed action error surface: cobros catalog ∪ transport codes. */
export type CobrosAccionesErrorCode =
  | CobroErrorCode
  | typeof VALIDATION_ERROR
  | typeof SESION_INVALIDA;

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: CobrosAccionesErrorCode;
        readonly message: string;
      };
    };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(code: CobrosAccionesErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** The tenant context comes from the Supabase session (auth read), not the DB. */
export async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}
