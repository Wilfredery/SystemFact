/**
 * Venta error catalog — stable codes versioned with the domain (19-directivas §9).
 *
 * Adapters and components must never invent codes; every business failure is
 * expressed as one of these constants plus a Spanish user message. `messageFor`
 * is the single source of truth for default copy. `STOCK_INSUFICIENTE` is NOT an
 * error code here — it is a draft-save WARNING (see {@link StockWarning}), never
 * a blocking failure (spec R-V9).
 *
 * Scope note (R-V13): the enumeration below mirrors the exhaustive code list in
 * the venta spec. Phase 5b pinned 14 codes (12 venta-owned + 2 re-emitted
 * `CLIENTE_*`). Phase 5c confirm (R-V15) adds five more — three NCF-consume codes
 * mapped from the ncf-engine port, one emission-gate code and one hard-stock
 * block — for a frozen catalog of **19**. `STOCK_INSUFICIENTE` and
 * `NCF_UMBRAL_90` stay WARNING channels, never catalog error codes.
 */

// --- Stable code catalog (R-V13) ---
export const VENTA_NO_ENCONTRADO = "VENTA_NO_ENCONTRADO";
export const VENTA_INMUTABLE = "VENTA_INMUTABLE";
export const CONCURRENCIA_CONFLICTO = "CONCURRENCIA_CONFLICTO";
export const LINEAS_VACIAS = "LINEAS_VACIAS";
export const LINEA_INVALIDA = "LINEA_INVALIDA";
export const PRODUCTO_NO_ENCONTRADO = "PRODUCTO_NO_ENCONTRADO";
export const PRODUCTO_INACTIVO = "PRODUCTO_INACTIVO";
export const TASA_ITBIS_VIGENCIA_FALTA = "TASA_ITBIS_VIGENCIA_FALTA";
export const DESCUENTO_EXCEDE_MAXIMO = "DESCUENTO_EXCEDE_MAXIMO";
export const DESCUENTO_EXCEDE_BASE = "DESCUENTO_EXCEDE_BASE";
export const DESCUENTO_INVALIDO = "DESCUENTO_INVALIDO";
export const DESCUENTO_NO_AUTORIZADO = "DESCUENTO_NO_AUTORIZADO";
// Re-emitted resolver codes (R-V10): the cliente module owns these; venta
// re-exports them so the sale HTTP contract speaks a single versioned catalog.
export const CLIENTE_NO_ENCONTRADO = "CLIENTE_NO_ENCONTRADO";
export const CLIENTE_INACTIVO = "CLIENTE_INACTIVO";
// Phase 5c confirm codes (R-V15 / R-F1). The three `NCF_*` codes mirror the
// ncf-engine consume port's `NcfConsumoErrorCode` so `confirmarVenta` can surface
// a pre-consume failure in the SAME versioned catalog the sale speaks (the ncf
// module owns the throw; venta owns the user-facing code).
export const NCF_AGOTADA = "NCF_AGOTADA";
export const NCF_VENCIDA = "NCF_VENCIDA";
export const NCF_SEC_INEXISTENTE = "NCF_SEC_INEXISTENTE";
// Emission gate: `Empresa.facturaAutomatica=false` blocks confirm before any NCF
// is burned (R-F1, D1b — no deferred-emission path).
export const FACTURA_AUTOMATICA_FALTA = "FACTURA_AUTOMATICA_FALTA";
// Hard stock block at confirm (distinct from the draft-save `STOCK_INSUFICIENTE`
// WARNING). The authoritative debit lands in 5c Phase 3 (`registrarSalidasVenta`);
// the early HARD preview in confirm rejects with this same code before any burn.
export const STOCK_INSUFICIENTE_BLOQUEO = "STOCK_INSUFICIENTE_BLOQUEO";

export type VentaErrorCode =
  | typeof VENTA_NO_ENCONTRADO
  | typeof VENTA_INMUTABLE
  | typeof CONCURRENCIA_CONFLICTO
  | typeof LINEAS_VACIAS
  | typeof LINEA_INVALIDA
  | typeof PRODUCTO_NO_ENCONTRADO
  | typeof PRODUCTO_INACTIVO
  | typeof TASA_ITBIS_VIGENCIA_FALTA
  | typeof DESCUENTO_EXCEDE_MAXIMO
  | typeof DESCUENTO_EXCEDE_BASE
  | typeof DESCUENTO_INVALIDO
  | typeof DESCUENTO_NO_AUTORIZADO
  | typeof CLIENTE_NO_ENCONTRADO
  | typeof CLIENTE_INACTIVO
  | typeof NCF_AGOTADA
  | typeof NCF_VENCIDA
  | typeof NCF_SEC_INEXISTENTE
  | typeof FACTURA_AUTOMATICA_FALTA
  | typeof STOCK_INSUFICIENTE_BLOQUEO;

const MESSAGES: Record<VentaErrorCode, string> = {
  [VENTA_NO_ENCONTRADO]: "La venta no existe en la empresa",
  [VENTA_INMUTABLE]: "La venta no puede editarse en su estado actual",
  [CONCURRENCIA_CONFLICTO]:
    "Otro usuario modificó la venta; recargue y reintente",
  [LINEAS_VACIAS]: "La venta debe contener al menos una línea",
  [LINEA_INVALIDA]: "La línea de venta es inválida",
  [PRODUCTO_NO_ENCONTRADO]: "El producto no existe en la empresa",
  [PRODUCTO_INACTIVO]: "El producto está inactivo",
  [TASA_ITBIS_VIGENCIA_FALTA]:
    "No hay una tasa de ITBIS vigente para el producto en la fecha de la venta",
  [DESCUENTO_EXCEDE_MAXIMO]:
    "El descuento supera el máximo permitido por la configuración",
  [DESCUENTO_EXCEDE_BASE]: "El descuento supera la base aplicable",
  [DESCUENTO_INVALIDO]: "El descuento es inválido",
  [DESCUENTO_NO_AUTORIZADO]:
    "Solo un administrador puede aplicar un descuento",
  [CLIENTE_NO_ENCONTRADO]: "El cliente no existe en la empresa",
  [CLIENTE_INACTIVO]: "El cliente está inactivo",
  [NCF_AGOTADA]: "El rango de secuencias NCF está agotado; no se puede confirmar la venta",
  [NCF_VENCIDA]: "El rango de secuencias NCF está vencido; no se puede confirmar la venta",
  [NCF_SEC_INEXISTENTE]:
    "No hay una secuencia NCF activa configurada para esta empresa y tipo",
  [FACTURA_AUTOMATICA_FALTA]:
    "La empresa no tiene facturación automática; active el parámetro para confirmar la venta",
  [STOCK_INSUFICIENTE_BLOQUEO]:
    "No hay suficiente existencias en la sucursal para confirmar la venta",
};

export function messageFor(code: VentaErrorCode): string {
  return MESSAGES[code];
}

/**
 * Typed use-case result: success data or a stable coded error (19-directivas §9).
 * Mirrors `CompraResult` so both sale and purchase surfaces share a shape.
 */
export type VentaResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: VentaErrorCode;
      readonly message: string;
    };

/**
 * A draft-save warning. `STOCK_INSUFICIENTE` is a WARNING, never an error: the
 * draft still saves while availability is short at the branch (spec R-V9). The
 * authoritative block happens at 5c confirm inside the transaction.
 */
export interface StockWarning {
  readonly code: "STOCK_INSUFICIENTE";
  readonly productoId: number;
  /** Branch availability as a `Decimal(12,3)` string. */
  readonly available: string;
  /** Requested quantity as a `Decimal(12,3)` string. */
  readonly requested: string;
}

/**
 * A save result: a {@link VentaResult} plus any non-blocking stock warnings.
 * The optional `warnings` never flips `ok` to `false`.
 */
export type VentaSaveResult<T> = VentaResult<T> & {
  readonly warnings?: readonly StockWarning[];
};

/**
 * Known domain violation raised by the infrastructure layer (e.g. the guarded
 * `updateMany` losing a race, or a state read after commit). The application
 * layer catches it and returns a typed result; anything that is NOT a
 * `VentaDomainError` is a defect and propagates.
 */
export class VentaDomainError extends Error {
  readonly code: VentaErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: VentaErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.name = "VentaDomainError";
    this.code = code;
    this.details = details;
  }
}
