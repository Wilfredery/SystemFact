/**
 * Cobros error catalog — stable codes versioned with the domain (19-directivas §9).
 *
 * Pure TypeScript. No imports from Next.js, React, Prisma, or Supabase. This is
 * the SINGLE source of truth for payment/collection error codes; the HTTP
 * adapters and use cases never inline a code (AGENTS.md "Errors").
 *
 * The catalog follows the `inventario` / `producto` pattern exactly: exported
 * string constants, a discriminated `CobroErrorCode` union derived from them, a
 * `messageFor` lookup returning the Spanish user-facing copy, and a
 * `CobroDomainError` carrying the stable code for the infrastructure layer to
 * signal a known violation that the application layer converts back to a typed
 * result.
 *
 * 600-SERIES NUMBERING (R-C5): the venta catalog absorbed the phase-5d
 * devolucion codes as a documented numeric sub-range — 601–604 for the B04
 * lifecycle and 605 for the R-D5 idempotency gate (see
 * `venta/domain/errors.ts`). The cobros module owns its OWN catalog, so this
 * module continues that numbering at **606–613** with the eight codes listed in
 * the cobros spec. The numeric suffix in each trailing comment is documentation
 * of the shared 600-series sequence only; the wire value is the stable string.
 *
 * The `details` map on each failure carries only minimal, locatable context
 * (an invoice id, a client id) — never a stack trace or a raw Prisma error
 * (AGENTS.md "Never expose stack traces or internal Prisma errors").
 */

// --- Stable code catalog (R-C5) ---
export const PAGO_IDEMPOTENCIA_CONFLICTO = "PAGO_IDEMPOTENCIA_CONFLICTO"; // 606
export const COBRO_EXCEDE_SALDO = "COBRO_EXCEDE_SALDO"; // 607
export const CLIENTE_EN_MORA = "CLIENTE_EN_MORA"; // 608
export const LIMITE_CREDITO_EXCEDIDO = "LIMITE_CREDITO_EXCEDIDO"; // 609
export const CREDITO_NO_HABILITADO = "CREDITO_NO_HABILITADO"; // 610
export const FACTURA_COBRO_NO_VIGENTE = "FACTURA_COBRO_NO_VIGENTE"; // 611
export const PAGO_NO_AUTORIZADO = "PAGO_NO_AUTORIZADO"; // 612
export const PAGO_NO_ENCONTRADO = "PAGO_NO_ENCONTRADO"; // 613

export type CobroErrorCode =
  | typeof PAGO_IDEMPOTENCIA_CONFLICTO
  | typeof COBRO_EXCEDE_SALDO
  | typeof CLIENTE_EN_MORA
  | typeof LIMITE_CREDITO_EXCEDIDO
  | typeof CREDITO_NO_HABILITADO
  | typeof FACTURA_COBRO_NO_VIGENTE
  | typeof PAGO_NO_AUTORIZADO
  | typeof PAGO_NO_ENCONTRADO;

/** Ordered catalog — tests assert every code yields a stable message. */
export const COBRO_ERROR_CODES: readonly CobroErrorCode[] = [
  PAGO_IDEMPOTENCIA_CONFLICTO,
  COBRO_EXCEDE_SALDO,
  CLIENTE_EN_MORA,
  LIMITE_CREDITO_EXCEDIDO,
  CREDITO_NO_HABILITADO,
  FACTURA_COBRO_NO_VIGENTE,
  PAGO_NO_AUTORIZADO,
  PAGO_NO_ENCONTRADO,
];

const MESSAGES: Readonly<Record<CobroErrorCode, string>> = {
  [PAGO_IDEMPOTENCIA_CONFLICTO]:
    "Ya existe un pago con esa clave de idempotencia; no se registró un duplicado",
  [COBRO_EXCEDE_SALDO]:
    "El cobro supera el saldo pendiente de la factura; ajuste el monto",
  [CLIENTE_EN_MORA]:
    "El cliente tiene facturas vencidas fuera del plazo; no se puede otorgar crédito",
  [LIMITE_CREDITO_EXCEDIDO]:
    "La venta excede el límite de crédito autorizado para el cliente",
  [CREDITO_NO_HABILITADO]:
    "El cliente no tiene crédito habilitado; no se puede vender a crédito",
  [FACTURA_COBRO_NO_VIGENTE]:
    "La factura no está vigente; no se puede registrar un cobro",
  [PAGO_NO_AUTORIZADO]:
    "No tiene permisos para registrar o autorizar este pago",
  [PAGO_NO_ENCONTRADO]: "El pago no existe en la empresa",
};

export function messageFor(code: CobroErrorCode): string {
  return MESSAGES[code];
}

/**
 * Known domain violation raised by the infrastructure/application layer (e.g. the
 * refund replay hitting the `(empresaId, idempotencyKey)` unique constraint, a
 * collection exceeding the recomputed balance, or an unauthorized refund). The
 * boundary adapter catches it and returns a typed result; anything that is NOT a
 * `CobroDomainError` is a defect and propagates so the transaction rolls back.
 */
export class CobroDomainError extends Error {
  readonly code: CobroErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CobroErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.name = "CobroDomainError";
    this.code = code;
    this.details = details;
  }
}
