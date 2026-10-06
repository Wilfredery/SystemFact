import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { CreditoRechazo } from "@/modules/cobros/application/credit-port";
import type { StockWarning, VentaErrorCode } from "../domain/errors";
import type { VentaGuardadoErrorCode } from "../application/venta-guardado";
import { NO_AUTORIZADO, SESION_INVALIDA, VALIDATION_ERROR } from "./validations";

/** Sale CRUD is operational (Admin + Operador); the discount gate is per-payload. */
export const ROLES_VENTA = ["Administrador", "Operador"];

/** Composed action error surface: domain ∪ config ∪ transport ∪ credit codes. */
export type VentaAccionesErrorCode =
  | VentaErrorCode
  | CreditoRechazo
  | Extract<VentaGuardadoErrorCode, "DESC_MAX_FALTANTE">
  | typeof NO_AUTORIZADO
  | typeof SESION_INVALIDA
  | typeof VALIDATION_ERROR;

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T; readonly warnings?: readonly StockWarning[] }
  | {
      readonly ok: false;
      readonly error: { readonly code: VentaAccionesErrorCode; readonly message: string };
    };

export function ok<T>(data: T, warnings?: readonly StockWarning[]): ActionResult<T> {
  return warnings && warnings.length > 0 ? { ok: true, data, warnings } : { ok: true, data };
}

export function fail(code: VentaAccionesErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

// The use case already resolves a stable user message for its composed code, so
// the adapter forwards `result.message` verbatim (no duplicate copy at the
// boundary — the single source of truth stays in the domain/config catalogs).
export async function resolverCtx() {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}
