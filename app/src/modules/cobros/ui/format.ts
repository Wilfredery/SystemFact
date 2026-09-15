/**
 * Cobros UI — boundary formatters (fase-6 PR-4).
 *
 * Presentation-only helpers that turn the `Decimal(12,2)` money STRINGS the
 * canonical view carries into Dominican display. They NEVER re-derive or recompute
 * a balance — the numbers arriving here are already the derived facts from
 * `consultarSaldoCxC` (ADR-017). Money is parsed through `decimal.js` (never a
 * float) and only converted to a JS number inside the `Intl` formatter, which is a
 * display boundary, not arithmetic (AGENTS.md "Money = Decimal"; "conversions via a
 * dedicated library — no manual hour arithmetic").
 *
 * The `es-DO` locale is the ratified Dominican presentation dialect (19-directivas
 * §currency/DOP·es-DO); the Santo-Domingo calendar-day discipline for dates is
 * resolved upstream in `domain/en-mora.ts`, so only the pure SD date strings reach
 * this file.
 */

import { Decimal } from "decimal.js";

const MONEDA_DO = new Intl.NumberFormat("es-DO", {
  style: "currency",
  currency: "DOP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * `Decimal(12,2)` money string → Dominican currency display (e.g. `1234.5` →
 * `$1,234.50`). An out-of-domain input is shown verbatim rather than throwing, so a
 * single malformed cell never blanks the whole board; the value is already frozen
 * server-side.
 */
export function formatearMontoDO(valor: string): string {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(valor.trim())) return valor;
  // Decimal → number is a DISPLAY conversion only; no monetary math happens here.
  return MONEDA_DO.format(new Decimal(valor).toNumber());
}

/**
 * SD calendar date (`YYYY-MM-DD`, already Santo-Domingo-resolved upstream) → the
 * same day rendered in the Dominican short form for display. The value is a date,
 * so this is presentation formatting, not a timezone conversion (R-B3 happens in
 * the domain). An empty/unparseable input falls back to `—`.
 */
export function formatearFechaDO(fechaSD: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaSD)) return "—";
  const [y, m, d] = fechaSD.split("-").map(Number);
  // Construct at UTC midnight so the formatter never shifts the calendar day:
  // the value is already a bare SD date, not an instant.
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
