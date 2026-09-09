/**
 * Compra error catalog — stable codes versioned with the domain (19-directivas §9).
 *
 * Adapters and components must never invent codes; every business failure is
 * expressed as one of these constants plus a user message. `messageFor` is the
 * single source of truth for default copy. A `CompraDomainError` lets the
 * infrastructure layer signal a known violation (e.g. the NCF unique
 * constraint) that the application layer converts back into a typed result.
 */

// --- Stable code catalog (R: all error scenarios) ---
export const VALIDATION_ERROR = "VALIDATION_ERROR";
export const COMPRA_NO_ENCONTRADA = "COMPRA_NO_ENCONTRADA";
export const PROVEEDOR_NO_ENCONTRADO = "PROVEEDOR_NO_ENCONTRADO";
export const PRODUCTO_NO_ENCONTRADO = "PRODUCTO_NO_ENCONTRADO";
export const PROVEEDOR_INACTIVO = "PROVEEDOR_INACTIVO";
export const LINEA_INVALIDA = "LINEA_INVALIDA";
export const COMPRA_INMUTABLE = "COMPRA_INMUTABLE";
export const TRANSICION_INVALIDA = "TRANSICION_INVALIDA";
export const CONFIG_RETENCION_FALTANTE = "CONFIG_RETENCION_FALTANTE";
export const CORRELATIVO_CONFLICTO = "CORRELATIVO_CONFLICTO";
export const CONCURRENCIA_CONFLICTO = "CONCURRENCIA_CONFLICTO";
export const NFC_DUPLICADO = "NFC_DUPLICADO";
export const NO_AUTORIZADO = "NO_AUTORIZADO";
export const SESION_INVALIDA = "SESION_INVALIDA";
// fase-3-4b receipt wiring: branch scoping for `recibirCompra` and the stable
// bridge code that maps any inventario entry failure into compra's catalog so
// inventario's internal codes never leak to the HTTP contract.
export const COMPRA_SUCURSAL_INVALIDA = "COMPRA_SUCURSAL_INVALIDA";
export const INVENTARIO_ENTRADA_RECHAZADA = "INVENTARIO_ENTRADA_RECHAZADA";

export type CompraErrorCode =
  | typeof VALIDATION_ERROR
  | typeof COMPRA_NO_ENCONTRADA
  | typeof PROVEEDOR_NO_ENCONTRADO
  | typeof PRODUCTO_NO_ENCONTRADO
  | typeof PROVEEDOR_INACTIVO
  | typeof LINEA_INVALIDA
  | typeof COMPRA_INMUTABLE
  | typeof TRANSICION_INVALIDA
  | typeof CONFIG_RETENCION_FALTANTE
  | typeof CORRELATIVO_CONFLICTO
  | typeof CONCURRENCIA_CONFLICTO
  | typeof NFC_DUPLICADO
  | typeof NO_AUTORIZADO
  | typeof SESION_INVALIDA
  | typeof COMPRA_SUCURSAL_INVALIDA
  | typeof INVENTARIO_ENTRADA_RECHAZADA;

const MESSAGES: Record<CompraErrorCode, string> = {
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
  [COMPRA_NO_ENCONTRADA]: "La compra no existe en la empresa",
  [PROVEEDOR_NO_ENCONTRADO]: "El proveedor no existe en la empresa",
  [PRODUCTO_NO_ENCONTRADO]: "El producto no existe en la empresa",
  [PROVEEDOR_INACTIVO]: "El proveedor está inactivo",
  [LINEA_INVALIDA]: "La línea de compra es inválida",
  [COMPRA_INMUTABLE]: "La compra ya confirmada no puede editarse",
  [TRANSICION_INVALIDA]: "La transición de estado no es permitida",
  [CONFIG_RETENCION_FALTANTE]:
    "Falta la configuración de retención requerida; no se puede confirmar",
  [CORRELATIVO_CONFLICTO]:
    "No se pudo asignar un correlativo interno único; reintente",
  [CONCURRENCIA_CONFLICTO]:
    "Otro usuario modificó la compra; recargue y reintente",
  [NFC_DUPLICADO]: "Ya existe una compra con ese NCF en la empresa",
  [NO_AUTORIZADO]: "No tiene permisos para realizar esta acción",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
  [COMPRA_SUCURSAL_INVALIDA]:
    "La compra pertenece a otra sucursal; solo puede recibirse en su propia sucursal",
  [INVENTARIO_ENTRADA_RECHAZADA]:
    "No se pudo registrar la entrada de inventario; la recepción fue cancelada",
};

export function messageFor(code: CompraErrorCode): string {
  return MESSAGES[code];
}

/**
 * Known domain violation raised by the infrastructure layer (e.g. the partial
 * unique on `(empresaId, ncf)` mapping Prisma `P2002`, or a missing required
 * retention key). The application layer catches it and returns a typed result;
 * anything that is NOT a `CompraDomainError` is a defect and propagates.
 */
export class CompraDomainError extends Error {
  readonly code: CompraErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CompraErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.name = "CompraDomainError";
    this.code = code;
    this.details = details;
  }
}
