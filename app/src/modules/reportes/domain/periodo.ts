/**
 * Reportes domain — Santo-Domingo calendar-period boundaries (DB-1).
 *
 * ADR-013: pure TypeScript, no DB. The dashboard shows "ventas del día" and "ventas del
 * mes" whose boundaries are the **Santo-Domingo calendar day/month**, never the raw UTC
 * date (DB-1 scenario: a sale at 21:00 UTC is 17:00 SD the SAME day and must bucket in
 * that SD day, while one at 03:00 UTC is 23:00 SD the PREVIOUS day). We reuse the ratified
 * SD↔UTC seam ({@link fechaEnSD} for the SD calendar date, {@link fechaSDaUTC} for the
 * bracketing UTC instants) so there is a single timezone implementation and no hardcoded
 * UTC-4.
 */

import { fechaSDaUTC, fechaEnSD } from "./zona-horaria";

/** An inclusive `[desde, hasta]` UTC window bracketing a Santo-Domingo calendar period. */
export interface VentanaSD {
  /** UTC instant = SD start-of-period (inclusive lower bound). */
  readonly desde: Date;
  /** UTC instant = SD end-of-period (inclusive upper bound). */
  readonly hasta: Date;
  /** SD calendar date (`YYYY-MM-DD`) of the period start, for display. */
  readonly desdeSD: string;
  /** SD calendar date (`YYYY-MM-DD`) of the period end, for display. */
  readonly hastaSD: string;
}

/** The SD `YYYY`, `MM` (1-12) and `DD` (1-31) parts of an instant, via the Intl seam. */
function partesSD(now: Date): { y: number; m: number; d: number } {
  const sd = fechaEnSD(now); // "YYYY-MM-DD"
  const [y, m, d] = sd.split("-").map(Number);
  return { y: y as number, m: m as number, d: d as number };
}

function dos(v: number): string {
  return String(v).padStart(2, "0");
}

/** Last day of an SD month (natural lengths; leap years via the UTC day calendar). */
function ultimoDiaDelMes(y: number, m: number): number {
  // Day 0 of the NEXT month is the last day of this one — whole-calendar day math only.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The SD calendar-day window for `now` (start-of-day to end-of-day, both in SD). The
 * returned `desde`/`hasta` are the UTC instants that bracket the SD day, so a query
 * `WHERE fecha >= desde AND fecha <= hasta` counts by SD calendar day, never UTC date.
 */
export function ventanaDiaSD(now: Date): VentanaSD {
  const { y, m, d } = partesSD(now);
  const iso = `${y}-${dos(m)}-${dos(d)}`;
  return {
    desde: fechaSDaUTC(iso, "inicio"),
    hasta: fechaSDaUTC(iso, "fin"),
    desdeSD: iso,
    hastaSD: iso,
  };
}

/**
 * The SD calendar-MONTH window containing `now` (first-day-start to last-day-end, SD).
 * The end bound is derived as one instant before the next month's SD start, so the
 * 28/29/30/31-day length and any leap year fall out of the calendar (no hand-counted
 * last day).
 */
export function ventanaMesSD(now: Date): VentanaSD {
  const { y, m } = partesSD(now);
  const primerDia = `${y}-${dos(m)}-01`;
  const ultimo = ultimoDiaDelMes(y, m);
  const ultimoDia = `${y}-${dos(m)}-${dos(ultimo)}`;
  return {
    desde: fechaSDaUTC(primerDia, "inicio"),
    hasta: fechaSDaUTC(ultimoDia, "fin"),
    desdeSD: primerDia,
    hastaSD: ultimoDia,
  };
}
