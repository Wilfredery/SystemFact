/**
 * Stable business-error catalog for the Cliente module (19-directivas §9).
 * Mirrors the Proveedor pattern: `const` codes + a union type + a message map,
 * versioned with this domain. Adapters/components must never invent codes.
 *
 * Eleven codes (design "Error catalog"): the ten proveedor-parity codes plus a
 * distinct Consumidor-Final-protection code, so reserved-row CRUD violations
 * are separable from ordinary duplicates. Message strings are frozen Spanish
 * user copy; `messageFor` is the single source of truth.
 */

export const CLIENTE_IDENTIFICACION_DUPLICADA =
  "CLIENTE_IDENTIFICACION_DUPLICADA";
export const IDENTIFICACION_FISCAL_INVALIDA = "IDENTIFICACION_FISCAL_INVALIDA";
export const CLIENTE_NO_ENCONTRADO = "CLIENTE_NO_ENCONTRADO";
export const CLIENTE_YA_INACTIVO = "CLIENTE_YA_INACTIVO";
export const CLIENTE_TIENE_VENTAS = "CLIENTE_TIENE_VENTAS";
export const CONCURRENCIA_CONFLICTO = "CONCURRENCIA_CONFLICTO";
export const CREDITO_REQUIERE_FISCAL_IDENTIDAD =
  "CREDITO_REQUIERE_FISCAL_IDENTIDAD";
export const NO_AUTORIZADO = "NO_AUTORIZADO";
export const SESION_INVALIDA = "SESION_INVALIDA";
export const VALIDATION_ERROR = "VALIDATION_ERROR";
export const CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO =
  "CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO";

export type ClienteErrorCode =
  | typeof CLIENTE_IDENTIFICACION_DUPLICADA
  | typeof IDENTIFICACION_FISCAL_INVALIDA
  | typeof CLIENTE_NO_ENCONTRADO
  | typeof CLIENTE_YA_INACTIVO
  | typeof CLIENTE_TIENE_VENTAS
  | typeof CONCURRENCIA_CONFLICTO
  | typeof CREDITO_REQUIERE_FISCAL_IDENTIDAD
  | typeof NO_AUTORIZADO
  | typeof SESION_INVALIDA
  | typeof VALIDATION_ERROR
  | typeof CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO;

const MESSAGES: Record<ClienteErrorCode, string> = {
  [CLIENTE_IDENTIFICACION_DUPLICADA]:
    "Ya existe un cliente activo con esa identificación fiscal en la empresa",
  [IDENTIFICACION_FISCAL_INVALIDA]:
    "La identificación fiscal debe ser un RNC (9 dígitos) o una cédula (11 dígitos) válida",
  [CLIENTE_NO_ENCONTRADO]: "El cliente no existe en la empresa",
  [CLIENTE_YA_INACTIVO]: "El cliente ya se encuentra inactivo",
  [CLIENTE_TIENE_VENTAS]:
    "El cliente tiene ventas no canceladas y no puede desactivarse",
  [CONCURRENCIA_CONFLICTO]:
    "Otro usuario modificó el cliente; recargue y reintente",
  [CREDITO_REQUIERE_FISCAL_IDENTIDAD]:
    "Habilitar crédito requiere una identificación fiscal válida (RNC o cédula)",
  [NO_AUTORIZADO]: "No tiene permisos para realizar esta acción",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
  [CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO]:
    "El registro de Consumidor Final es de solo lectura y no puede modificarse ni desactivarse",
};

/**
 * Frozen Spanish user message for a stable code. Optional `details` are never
 * folded into the message (keeps copy stable); they travel alongside it for
 * minimal machine-readable context only.
 */
export function messageFor(code: ClienteErrorCode): string {
  return MESSAGES[code];
}

export class ClienteDomainError extends Error {
  readonly code: ClienteErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ClienteErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.name = "ClienteDomainError";
    this.code = code;
    this.details = details;
  }
}
