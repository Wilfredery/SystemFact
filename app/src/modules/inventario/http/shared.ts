import { type InventarioErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: InventarioErrorCode; message: string } };

// One named group per capability (owner, 2026-11-08): actions read these groups,
// never literal role names. Operador and Despachador share the same level.
export const ROLES_VER_INVENTARIO = ["Administrador", "Operador", "Despachador"];

// Manage: adjust stock (owner: Operador and Despachador are view-only).
export const ROLES_GESTION_INVENTARIO = ["Administrador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(code: InventarioErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}
