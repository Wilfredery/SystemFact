/**
 * Inventario domain — stable error codes and user-facing messages.
 *
 * Pure TypeScript. No imports from Next.js, React, Prisma, or Supabase.
 * This is the single source of truth for inventory error codes
 * (19-directivas §9); the HTTP adapters and use cases never inline a code.
 *
 * The catalog follows the `producto` pattern exactly: exported string
 * constants, a discriminated `InventarioErrorCode` union derived from them, a
 * `messageFor` lookup, and an `InventarioDomainError` carrying the stable code.
 *
 * `SESION_INVALIDA` and `VALIDATION_ERROR` are part of the catalog in addition
 * to the seven inventory-specific codes because the thin HTTP adapter needs a
 * stable code for a missing session and for a zod-rejected DTO — mirroring the
 * producto/categoria adapters. They are documented in the apply notes.
 */

export const CANTIDAD_INVALIDA = "CANTIDAD_INVALIDA";
export const MOTIVO_VACIO = "MOTIVO_VACIO";
export const STOCK_INSUFICIENTE = "STOCK_INSUFICIENTE";
export const INVENTARIO_NO_ENCONTRADO = "INVENTARIO_NO_ENCONTRADO";
export const NO_AUTORIZADO = "NO_AUTORIZADO";
export const LIMITE_PAGINACION_INVALIDO = "LIMITE_PAGINACION_INVALIDO";
export const PAGINA_INVALIDA = "PAGINA_INVALIDA";
export const SESION_INVALIDA = "SESION_INVALIDA";
export const VALIDATION_ERROR = "VALIDATION_ERROR";

export type InventarioErrorCode =
  | typeof CANTIDAD_INVALIDA
  | typeof MOTIVO_VACIO
  | typeof STOCK_INSUFICIENTE
  | typeof INVENTARIO_NO_ENCONTRADO
  | typeof NO_AUTORIZADO
  | typeof LIMITE_PAGINACION_INVALIDO
  | typeof PAGINA_INVALIDA
  | typeof SESION_INVALIDA
  | typeof VALIDATION_ERROR;

/** Ordered catalog — tests assert every code yields a stable message. */
export const INVENTARIO_ERROR_CODES: readonly InventarioErrorCode[] = [
  CANTIDAD_INVALIDA,
  MOTIVO_VACIO,
  STOCK_INSUFICIENTE,
  INVENTARIO_NO_ENCONTRADO,
  NO_AUTORIZADO,
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
  SESION_INVALIDA,
  VALIDATION_ERROR,
];

const MESSAGES: Readonly<Record<InventarioErrorCode, string>> = {
  [CANTIDAD_INVALIDA]:
    "La cantidad debe ser un número con hasta 3 decimales y no puede ser negativa.",
  [MOTIVO_VACIO]: "El motivo del ajuste es obligatorio.",
  [STOCK_INSUFICIENTE]:
    "El ajuste dejaría el stock en negativo; la cantidad disponible es insuficiente.",
  [INVENTARIO_NO_ENCONTRADO]: "El inventario no existe en la empresa o sucursal.",
  [NO_AUTORIZADO]: "No tiene permisos para realizar esta acción.",
  [LIMITE_PAGINACION_INVALIDO]: "El límite de paginación debe estar entre 1 y 100.",
  [PAGINA_INVALIDA]: "La página debe ser mayor o igual a 1.",
  [SESION_INVALIDA]: "Sesión no válida o expirada.",
  [VALIDATION_ERROR]: "Datos de entrada inválidos.",
};

export function messageFor(code: InventarioErrorCode): string {
  return MESSAGES[code];
}

export class InventarioDomainError extends Error {
  readonly code: InventarioErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: InventarioErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.name = "InventarioDomainError";
    this.code = code;
    this.details = details;
  }
}
