import { type ProductoErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ProductoErrorCode; message: string } };

// Same role domain for listing: reads are operational actions too. REQ-PROD-007
// establishes the verify-role + verify-company + verify-assigned-branch chain,
// and the listing path must not be a downgraded read-only bypass of it.
export const ROLES_GESTION_PRODUCTOS = ["Administrador", "Operador"];

// Deactivation is a lifecycle decision with fiscal history consequences;
// REQ-PROD-013 reserves it for Admin only.
export const ROLES_ADMIN_ONLY = ["Administrador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(code: ProductoErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}
