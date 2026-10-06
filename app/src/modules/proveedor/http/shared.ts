import { type ProveedorErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ProveedorErrorCode; message: string } };

// CRUD and listing are operational management actions: Admin + Operador.
export const ROLES_GESTION_PROVEEDORES = ["Administrador", "Operador"];

// Deactivation is a lifecycle decision with downstream purchase effects
// (fase 4 CxP); the role matrix reserves it for Administrador.
export const ROLES_ADMIN_ONLY = ["Administrador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(
  code: ProveedorErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}
