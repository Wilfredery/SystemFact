/**
 * Stable business-error catalog for the Proveedor module (19-directivas §9).
 * Mirrors the Categoria pattern: `const` codes + union type + message map,
 * versioned with the domain. Adapters/components must never invent codes.
 */

export const RNC_PROVEEDOR_DUPLICADO = "RNC_PROVEEDOR_DUPLICADO";
export const RNC_FORMATO_INVALIDO = "RNC_FORMATO_INVALIDO";
export const PROVEEDOR_NO_ENCONTRADO = "PROVEEDOR_NO_ENCONTRADO";
export const PROVEEDOR_YA_INACTIVO = "PROVEEDOR_YA_INACTIVO";
export const PROVEEDOR_TIENE_COMPRAS = "PROVEEDOR_TIENE_COMPRAS";
export const CONCURRENCIA_CONFLICTO = "CONCURRENCIA_CONFLICTO";
export const NO_AUTORIZADO = "NO_AUTORIZADO";
export const SESION_INVALIDA = "SESION_INVALIDA";
export const VALIDATION_ERROR = "VALIDATION_ERROR";

export type ProveedorErrorCode =
  | typeof RNC_PROVEEDOR_DUPLICADO
  | typeof RNC_FORMATO_INVALIDO
  | typeof PROVEEDOR_NO_ENCONTRADO
  | typeof PROVEEDOR_YA_INACTIVO
  | typeof PROVEEDOR_TIENE_COMPRAS
  | typeof CONCURRENCIA_CONFLICTO
  | typeof NO_AUTORIZADO
  | typeof SESION_INVALIDA
  | typeof VALIDATION_ERROR;

const MESSAGES: Record<ProveedorErrorCode, string> = {
  [RNC_PROVEEDOR_DUPLICADO]:
    "Ya existe un proveedor activo con ese RNC en la empresa",
  [RNC_FORMATO_INVALIDO]:
    "El RNC debe contener entre 9 y 11 dígitos",
  [PROVEEDOR_NO_ENCONTRADO]: "El proveedor no existe en la empresa",
  [PROVEEDOR_YA_INACTIVO]: "El proveedor ya se encuentra inactivo",
  [PROVEEDOR_TIENE_COMPRAS]:
    "El proveedor tiene compras no canceladas y no puede desactivarse",
  [CONCURRENCIA_CONFLICTO]:
    "Otro usuario modificó el proveedor; recargue y reintente",
  [NO_AUTORIZADO]: "No tiene permisos para realizar esta acción",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
};

export function messageFor(code: ProveedorErrorCode): string {
  return MESSAGES[code];
}

export class ProveedorDomainError extends Error {
  readonly code: ProveedorErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ProveedorErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.code = code;
    this.details = details;
  }
}
