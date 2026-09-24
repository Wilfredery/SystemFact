/**
 * Cobros domain — pure payment types and the frozen-enum mirrors (fase-6, R-B*).
 *
 * ADR-013: this module imports NOTHING from Next.js, React, Prisma or Supabase.
 * Money travels as `decimal.js` values at the pure function boundary and as
 * `Decimal(12,2)`-compatible STRINGS across interfaces; floats MUST NOT appear
 * (AGENTS.md "Money = Decimal"). The Prisma `@prisma/client` Decimal type is the
 * INFRASTRUCTURE dialect of money; the pure domain mirrors it with `decimal.js`
 * exactly as `devolucion/domain/devolucion.ts` established, so the domain stays
 * generated-client-free while still honouring decimal money end-to-end.
 *
 * The derived payment state (`PENDIENTE`/`PARCIAL`/`PAGADA`) is NEVER persisted —
 * ADR-017: it is computed from the canonical aggregate by
 * {@link ./clasificar-estado-pago}. The persisted `estado` on `PAGO` is the frozen
 * lifecycle enum mirror below.
 */

import { Decimal } from "decimal.js";

// ---------------------------------------------------------------------------
// Frozen enum mirrors (match the Prisma schema literals; kept local so the
// domain does not import the generated client — same discipline as
// `TIPO_REPOSICION` in devolucion and `ESTADO_COMPRA` in compra).
// ---------------------------------------------------------------------------

/** Payment direction: a customer collection or a cash refund (schema `TipoPago`). */
export const TIPO_PAGO = {
  COBRO: "COBRO",
  REEMBOLSO: "REEMBOLSO",
} as const;
export type TipoPago = (typeof TIPO_PAGO)[keyof typeof TIPO_PAGO];

/** Persisted lifecycle of a payment (schema `EstadoPago`). */
export const ESTADO_PAGO = {
  REGISTRADO: "REGISTRADO",
  APLICADO: "APLICADO",
  REVERTIDO: "REVERTIDO",
} as const;
export type EstadoPago = (typeof ESTADO_PAGO)[keyof typeof ESTADO_PAGO];

/** Payment method actually applied; only EFECTIVO in V1 (schema `MetodoPago`). */
export const METODO_PAGO = {
  EFECTIVO: "EFECTIVO",
} as const;
export type MetodoPago = (typeof METODO_PAGO)[keyof typeof METODO_PAGO];

// ---------------------------------------------------------------------------
// Derived payment state (ADR-017) — computed, never stored.
// ---------------------------------------------------------------------------

/** The derived CxC state a receivable resolves to from its applied cobros. */
export const ESTADO_PAGO_DERIVADO = {
  PENDIENTE: "PENDIENTE",
  PARCIAL: "PARCIAL",
  PAGADA: "PAGADA",
} as const;
export type EstadoPagoDerivado =
  (typeof ESTADO_PAGO_DERIVADO)[keyof typeof ESTADO_PAGO_DERIVADO];

// ---------------------------------------------------------------------------
// Canonical aggregate row (the single SQL source, R-B1).
// ---------------------------------------------------------------------------

/**
 * One VIGENTE invoice projected by the canonical derived-balance aggregate
 * (cobros/infrastructure/saldo-cxc.repository.ts). All money fields are
 * `Decimal(12,2)` strings so the row survives the infrastructure → application →
 * domain hop without a float (AGENTS.md "Money = Decimal");
 * `cobrosAplicados`/`ajustesCredito`/`ajustesDebito` are the summed terms and
 * `saldoPendiente` is `total − applied − creditNotes + debitNotes`.
 * `fechaEmision` is the raw invoice instant the mora rule consumes (R-B3).
 */
export interface SaldoCxcFila {
  readonly facturaId: number;
  readonly clienteId: number;
  /** Frozen invoice total as a `Decimal(12,2)` string. */
  readonly total: string;
  /** Σ `PAGO.tipo=COBRO AND estado=APLICADO` as a `Decimal(12,2)` string. */
  readonly cobrosAplicados: string;
  /** Σ VIGENTE credit-note amounts as a `Decimal(12,2)` string. */
  readonly ajustesCredito: string;
  /** Σ VIGENTE debit-note amounts (empty in V1; B03 deferred) as a string. */
  readonly ajustesDebito: string;
  /** Derived pending balance as a `Decimal(12,2)` string. */
  readonly saldoPendiente: string;
  /** Invoice emission instant (UTC); SD resolution happens in en-mora. */
  readonly fechaEmision: Date;
}

/**
 * Typed use-case result: success data or a stable coded error (19-directivas §9).
 * Mirrors `VentaResult` so the payment surface speaks the same shape, but bound
 * to the cobros catalog.
 */
export type CobroResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: import("./errors").CobroErrorCode;
      readonly message: string;
    };

/** A non-negative `Decimal(12,2)` money value from a Decimal-string. */
export function aDecimalMonto(valor: string): Decimal {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(valor)) {
    throw new Error(
      `aDecimalMonto: monto fuera del dominio Decimal(12,2) (${valor})`,
    );
  }
  return new Decimal(valor);
}

/**
 * Refund bound (audit v2r-02). A refund must never exceed what the client
 * actually paid on the invoice: `cobrado = total − saldoPendiente` derived
 * from the SAME row-locked facts the canonical recompute just produced (the
 * `SaldoFacturaBloqueado` pair the locked-balance query returns). It mirrors
 * the sibling `COBRO_EXCEDE_SALDO` guard on the collection path
 * (`registrar-cobro.ts`) — but for refunds, whose balance the canonical sum
 * never sees. Pure decimal arithmetic, domain-only, no DB.
 */
export function reembolsoExcedeMontoCobrado(
  monto: Decimal,
  total: string,
  saldoPendiente: string,
): boolean {
  const cobrado = new Decimal(total).minus(new Decimal(saldoPendiente));
  return monto.greaterThan(cobrado);
}
