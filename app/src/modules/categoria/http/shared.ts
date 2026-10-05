import { type CategoriaErrorCode } from "../domain/errors";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CategoriaErrorCode; message: string } };

export const ROLES_GESTION_CATEGORIAS = ["Administrador", "Operador"];
export const ROLES_ADMIN_ONLY = ["Administrador"];

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(
  code: CategoriaErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}
