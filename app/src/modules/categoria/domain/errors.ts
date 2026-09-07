export const NOMBRE_CATEGORIA_DUPLICADO = "NOMBRE_CATEGORIA_DUPLICADO";
export const CATEGORIA_NO_ENCONTRADA = "CATEGORIA_NO_ENCONTRADA";
export const CATEGORIA_YA_INACTIVA = "CATEGORIA_YA_INACTIVA";
export const CATEGORIA_TIENE_PRODUCTOS = "CATEGORIA_TIENE_PRODUCTOS";
export const CONCURRENCIA_CONFLICTO = "CONCURRENCIA_CONFLICTO";
export const NO_AUTORIZADO = "NO_AUTORIZADO";
export const SESION_INVALIDA = "SESION_INVALIDA";
export const VALIDATION_ERROR = "VALIDATION_ERROR";

export type CategoriaErrorCode =
  | typeof NOMBRE_CATEGORIA_DUPLICADO
  | typeof CATEGORIA_NO_ENCONTRADA
  | typeof CATEGORIA_YA_INACTIVA
  | typeof CATEGORIA_TIENE_PRODUCTOS
  | typeof CONCURRENCIA_CONFLICTO
  | typeof NO_AUTORIZADO
  | typeof SESION_INVALIDA
  | typeof VALIDATION_ERROR;

const MESSAGES: Record<CategoriaErrorCode, string> = {
  [NOMBRE_CATEGORIA_DUPLICADO]: "Ya existe una categoría activa con ese nombre en la empresa",
  [CATEGORIA_NO_ENCONTRADA]: "La categoría no existe en la empresa",
  [CATEGORIA_YA_INACTIVA]: "La categoría ya se encuentra inactiva",
  [CATEGORIA_TIENE_PRODUCTOS]: "La categoría tiene productos activos y no puede desactivarse",
  [CONCURRENCIA_CONFLICTO]: "Otro usuario modificó la categoría; recargue y reintente",
  [NO_AUTORIZADO]: "No tiene permisos para realizar esta acción",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
};

export function messageFor(code: CategoriaErrorCode): string {
  return MESSAGES[code];
}

export class CategoriaDomainError extends Error {
  readonly code: CategoriaErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CategoriaErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.code = code;
    this.details = details;
  }
}
