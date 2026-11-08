import { type ProductoErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ProductoErrorCode; message: string } };

// One named group per capability (owner, 2026-11-08): screens and actions read
// these groups, never literal role names, so a future change of who may do what
// is a one-line edit here. Operador and Despachador share the same level.
//
// View: list products (also feeds the sales product search).
export const ROLES_VER_PRODUCTOS = ["Administrador", "Operador", "Despachador"];

// Manage: create and edit products (owner: Operador and Despachador are view-only).
export const ROLES_GESTION_PRODUCTOS = ["Administrador"];

// Deactivation is a lifecycle decision with fiscal history consequences;
// REQ-PROD-013 reserves it for Admin only.
export const ROLES_ADMIN_ONLY = ["Administrador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(code: ProductoErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}
