/**
 * Reportes domain — the analytical comparativa window + variation math (FIN-5, slice C).
 *
 * ADR-013: pure TypeScript, no DB. Two responsibilities, both Decimal-safe and clock-free:
 *
 *   1. {@link ventanaPrecedenteMes} derives the **immediately-preceding equal-length SD window**
 *      for a `[desde, hasta]` Santo-Domingo calendar range by shifting BOTH endpoints back by
 *      exactly one calendar month, clamping the day to the shorter month's length. The binding
 *      FIN-5 example fixes the behaviour: `2026-03-01 .. 2026-03-31` → `2026-02-01 .. 2026-02-28`
 *      (a one-month offset, not a fixed day count — this is the month-over-month comparativa
 *      the wireframe 2.5.1 intends). All arithmetic is whole-calendar-day on the UTC `Date`
 *      calendar of the SD Y/M/D parts (SD has no DST), never a manual hour offset.
 *
 *   2. {@link calcularVariacion} contrasts the current-window total against the preceding one:
 *      the absolute `variacionMonto = actual − anterior` and the percentage
 *      `variacionPorciento = (actual − anterior) / anterior × 100`, both `decimal.js`. When the
 *      previous total is zero the percentage MUST be `0` (no division by zero, FIN-5) while the
 *      monto variation still reports the absolute delta.
 *
 * Money crosses in as `Decimal(12,2)` strings (the canonical confirmed-sales totals already
 * produce them); nothing here re-derives a balance — the totals come from the reused
 * `totalesVentasEnTx` aggregate applied to each window.
 */

import { Decimal } from "decimal.js";

/** An inclusive SD calendar-date range (`YYYY-MM-DD` at each end). */
export interface RangoSD {
  readonly desde: string;
  readonly hasta: string;
}

/** Pad a month (1-12) or day (1-31) to two digits. */
function dos(v: number): string {
  return String(v).padStart(2, "0");
}

/** Last day of a calendar month (natural lengths; leap years fall out of the Date calendar). */
function ultimoDiaDelMes(y: number, m: number): number {
  // Day 0 of the NEXT month is the last day of this one — whole-calendar day math only.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Shift an SD `YYYY-MM-DD` date back by exactly one calendar month, preserving the day-of-month
 * but clamping it to the shorter target month (e.g. `03-31` → `02-28`, `03-31` in a leap year →
 * `02-29`, `01-15` → previous-year `12-15`). Whole-calendar arithmetic on the UTC day index —
 * no fixed 30/31 assumption, no hour math.
 */
function unMesAntes(fechaSD: string): string {
  const [y, m, d] = fechaSD.split("-").map(Number);
  const anio = y as number;
  const mes = m as number;
  const dia = d as number;
  // Subtract one month from (mes): month 1 wraps to December of the previous year.
  const mesPrev = mes - 1 === 0 ? 12 : mes - 1;
  const anioPrev = mes - 1 === 0 ? anio - 1 : anio;
  const diaClampado = Math.min(dia, ultimoDiaDelMes(anioPrev, mesPrev));
  return `${anioPrev}-${dos(mesPrev)}-${dos(diaClampado)}`;
}

/**
 * The immediately-preceding equal-length SD window for a `[desde, hasta]` range: both ends moved
 * back one calendar month. The FIN-5 scenario pins `2026-03-01 .. 2026-03-31` → `2026-02-01 ..
 * 2026-02-28`; a mid-month window shifts the same way (`2026-03-15 .. 2026-03-20` →
 * `2026-02-15 .. 2026-02-20`).
 */
export function ventanaPrecedenteMes(actual: RangoSD): RangoSD {
  return { desde: unMesAntes(actual.desde), hasta: unMesAntes(actual.hasta) };
}

/** The current-vs-preceding figures plus their absolute and percentage variation. */
export interface VariacionComparativa {
  /** Σ confirmed-sales neto of the current window, `Decimal(12,2)` string. */
  readonly montoActual: string;
  /** Σ confirmed-sales neto of the preceding window, `Decimal(12,2)` string. */
  readonly montoAnterior: string;
  /** `montoActual − montoAnterior`, `Decimal(12,2)` string (may be negative). */
  readonly variacionMonto: string;
  /** `variacionMonto / montoAnterior × 100`, 2 dp string; exactly `0.00` when `montoAnterior` is 0. */
  readonly variacionPorciento: string;
}

/**
 * Contrast the two window totals with `decimal.js`. A zero preceding baseline yields `0.00` for
 * the percentage (FIN-5 "no division by zero") while the monto variation still carries the
 * absolute current-vs-zero delta. Both outputs are normalised to the `Decimal(12,2)` money scale.
 */
export function calcularVariacion(params: {
  readonly montoActual: string;
  readonly montoAnterior: string;
}): VariacionComparativa {
  const actual = new Decimal(params.montoActual);
  const anterior = new Decimal(params.montoAnterior);
  const delta = actual.minus(anterior);
  const porcentaje = anterior.isZero()
    ? new Decimal(0)
    : delta.div(anterior).times(100);
  return {
    montoActual: actual.toDecimalPlaces(2).toFixed(2),
    montoAnterior: anterior.toDecimalPlaces(2).toFixed(2),
    variacionMonto: delta.toDecimalPlaces(2).toFixed(2),
    variacionPorciento: porcentaje.toDecimalPlaces(2).toFixed(2),
  };
}
