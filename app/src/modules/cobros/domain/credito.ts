/**
 * Cobros domain — pure credit-gate rules (fase-6 PR-3, R-K2).
 *
 * ADR-013: imports NOTHING from Next.js, React, Prisma or Supabase. The credit
 * decision is a pure function of facts the caller gathers from the canonical
 * derived-CxC aggregate (never a second balance source): whether the client is
 * credit-enabled, its frozen limit, its current aggregate pending, the new
 * sale's total and its worst SD-days-overdue receivable. Money crosses the
 * boundary as `Decimal(12,2)` strings; the rule compares with `decimal.js` so
 * the inclusive at-limit boundary is exact (AGENTS.md "Money = Decimal").
 *
 * The gate is invoked ONLY for a credit sale — venta/contado sales never reach
 * it (the port returns `CONTADO` and skips this rule). The rejection order is
 * fixed by spec R-K2: habilitation → limit → mora.
 */

import { Decimal } from "decimal.js";
import {
  CLIENTE_EN_MORA,
  CREDITO_NO_HABILITADO,
  LIMITE_CREDITO_EXCEDIDO,
  messageFor,
} from "./errors";

/** The three stable codes a credit evaluation can reject with (a subset of the cobros catalog). */
export const CREDITO_RECHAZO_CODES = [
  CREDITO_NO_HABILITADO,
  LIMITE_CREDITO_EXCEDIDO,
  CLIENTE_EN_MORA,
] as const;
export type CreditoRechazo = (typeof CREDITO_RECHAZO_CODES)[number];

/** A rejected credit evaluation: a stable code plus its catalog message. */
export interface CreditoRechazado {
  readonly permitido: false;
  readonly code: CreditoRechazo;
  readonly message: string;
}

/** The outcome of the pure credit rules for a credit sale. */
export type ReglaCreditoResultado =
  | { readonly permitido: true }
  | CreditoRechazado;

/** Santo Domingo full days past the credit-mora threshold that block a new credit sale. */
export const DIAS_MORA_BLOQUEO_CREDITO = 30;

/**
 * The R-K2 credit gate. `true` when the sale may extend credit; otherwise the
 * first stable rejection by the spec-fixed order:
 *   1. `creditoHabilitado=false` → `CREDITO_NO_HABILITADO`;
 *   2. pending + totalVenta STRICTLY exceeding the limit → `LIMITE_CREDITO_EXCEDIDO`
 *      (the limit is INCLUSIVE: `pending + total == limite` passes);
 *   3. any receivable strictly more than {@link DIAS_MORA_BLOQUEO_CREDITO} days
 *      overdue (SD) → `CLIENTE_EN_MORA`.
 *
 * `pendienteTotal` is the client's SUM of the canonical aggregate's per-invoice
 * `saldoPendiente` (already excluding REVERTIDO cobros — the filter is the
 * aggregate's, never a second source here). `diasEnMoraMaximo` is the worst
 * full-SD-days-overdue among the client's unpaid VIGENTE receivables (0 when
 * none are overdue). Degenerate Decimal strings fail loud at the domain edge.
 */
export function evaluarReglaCredito(params: {
  readonly creditoHabilitado: boolean;
  /** Σ canonical pending as a `Decimal(12,2)` string. */
  readonly pendienteTotal: string;
  readonly limiteCredito: string;
  /** New sale total as a `Decimal(12,2)` string. */
  readonly totalVenta: string;
  readonly diasEnMoraMaximo: number;
}): ReglaCreditoResultado {
  if (!params.creditoHabilitado) {
    return rechazo(CREDITO_NO_HABILITADO);
  }

  const proyectado = new Decimal(params.pendienteTotal).plus(params.totalVenta);
  const limite = new Decimal(params.limiteCredito);
  // Inclusive boundary: reject only when the projection STRICTLY exceeds the limit.
  if (proyectado.greaterThan(limite)) {
    return rechazo(LIMITE_CREDITO_EXCEDIDO);
  }

  // Strictly more than 30 full SD days overdue (30 is not yet blocking; 31 is).
  if (params.diasEnMoraMaximo > DIAS_MORA_BLOQUEO_CREDITO) {
    return rechazo(CLIENTE_EN_MORA);
  }

  return { permitido: true };
}

function rechazo(code: CreditoRechazo): CreditoRechazado {
  return { permitido: false, code, message: messageFor(code) };
}
