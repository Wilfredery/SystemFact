import { type InventarioErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: InventarioErrorCode; message: string } };

export const ROLES_GESTION_INVENTARIO = ["Administrador", "Operador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(code: InventarioErrorCode, message: string): ActionResult<never> {
  return { ok: false, error: { code, message } };
}
