/**
 * Reportes domain — the CxC receivables summary derived from the CANONICAL query rows
 * (DB-1 "pending fiscal invoices count + total, total CxC balance").
 *
 * ADR-013: pure TypeScript, no DB. It receives the per-invoice rows the canonical
 * `consultarSaldoCxcEnTx` aggregate already produces (each with its `saldoPendiente` as a
 * `Decimal(12,2)` STRING — the pending balance is already SQL-aggregated there: total −
 * Σcobros − Σnotas), and reduces them to the dashboard summary. This is a DISPLAY
 * aggregate of already-derived facts computed with `decimal.js` — never a fetch-then-sum
 * over raw documents and never a JS float (AGENTS.md "Money = Decimal"; the exact pattern
 * `cobros/ui/EstadoDeCuentaScreen` already uses). It NEVER re-implements the balance
 * derivation (that stays the single canonical query, ADR-017).
 */

import { Decimal } from "decimal.js";

/** The minimal per-invoice shape the summary needs (a subset of `SaldoCxcFila`). */
export interface FilaSaldoCxc {
  readonly saldoPendiente: string;
}

/** The dashboard CxC-family summary, Decimal-string money, count of pending invoices. */
export interface ResumenCxC {
  /** VIGENTE invoices whose derived pending balance is strictly positive. */
  readonly facturasPendientes: number;
  /** Σ pending balances over those invoices, as a `Decimal(12,2)` string. */
  readonly saldoTotal: string;
}

/**
 * Sum the derived per-invoice pending balances and count the invoices still outstanding.
 * An empty input yields `{ facturasPendientes: 0, saldoTotal: "0.00" }`. The reduction uses
 * `Decimal` end-to-end; the result is normalised to 2 dp (`toDecimalPlaces(2)`) to match
 * the canonical `numeric(12,2)` money scale.
 */
export function resumirCxC(filas: readonly FilaSaldoCxc[]): ResumenCxC {
  let saldo = new Decimal(0);
  let pendientes = 0;
  for (const fila of filas) {
    const pendiente = new Decimal(fila.saldoPendiente);
    if (pendiente.gt(0)) pendientes += 1;
    saldo = saldo.plus(pendiente);
  }
  return {
    facturasPendientes: pendientes,
    saldoTotal: saldo.toDecimalPlaces(2).toFixed(2),
  };
}
