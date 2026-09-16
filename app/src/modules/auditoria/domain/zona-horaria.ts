/**
 * Santo Domingo calendar-date → UTC-instant conversion (AC-3).
 *
 * Pure TypeScript; no DB, no Prisma, no Next.js/React/Supabase. The audit consultation
 * date range is CHOSEN in `America/Santo_Domingo` (the business timezone) but the log
 * stores `fechaHora` as UTC `timestamptz`, so a filter boundary must be translated to the
 * UTC instants that bracket the requested SD calendar days.
 *
 * TIMEZONE LIBRARY (AGENTS.md "Conversions via a dedicated library (date-fns-tz or
 * equivalent); no manual hour arithmetic"): the project ships no `date-fns-tz`, so the
 * ratified equivalent is the standard `Intl.DateTimeFormat` zone API with an explicit
 * `timeZone` — already used for the structurally identical SD calendar handling in
 * `cobros/domain/en-mora.ts` and `venta/ui/fecha.ts`. Rather than assume a fixed offset,
 * the offset is DISCOVERED from the zone itself: we guess a UTC instant for the SD
 * wall-clock, ask `Intl` what SD wall-clock that instant actually is, and the difference
 * is the zone's real offset. The SD→UTC instant is then `guess − offset`. No hours are
 * hand-computed and no DST/offset is hardcoded; `Intl` resolves the zone.
 */

import { AUDITORIA_VALIDACION, AuditoriaDomainError } from "./errors";

/** SD calendar-date resolver: `en-CA` yields ISO-like numeric parts that compare in order. */
const FORMATO_ZONA_SD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santo_Domingo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  // h23 guarantees a 00–23 hour range (no 24-hour or AM/PM edge at midnight).
  hourCycle: "h23",
});

/** A bare SD calendar date: `YYYY-MM-DD` (month 1-12, day 1-31). */
const RE_DX_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The `America/Santo_Domingo` wall-clock parts (numbers) of a UTC instant. */
function partesZonaSD(instanteMs: number): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
} {
  const partes = FORMATO_ZONA_SD.formatToParts(new Date(instanteMs));
  const num = (tipo: Intl.DateTimeFormatPartTypes): number => {
    const p = partes.find((x) => x.type === tipo);
    return p ? Number(p.value) : 0;
  };
  return {
    y: num("year"),
    mo: num("month"),
    d: num("day"),
    h: num("hour"),
    mi: num("minute"),
    s: num("second"),
  };
}

/**
 * Resolve an SD wall-clock date/time to the exact UTC instant, discovering the zone offset
 * through `Intl` (never hardcoded). The offset is measured once via a round-trip, so this
 * is correct for SD's fixed UTC-4 and would equally honour any real zone DST rule.
 */
function fechaHoraSDaInstanteUTC(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): number {
  // Assume the wall-clock is already UTC, then see what SD shows for that instant.
  const supuesto = Date.UTC(y, mo - 1, d, h, mi, s);
  const zp = partesZonaSD(supuesto);
  const zpComoUTC = Date.UTC(zp.y, zp.mo - 1, zp.d, zp.h, zp.mi, zp.s);
  // zpComoUTC differs from the guess by exactly the zone offset (ms, negative for SD).
  const desfase = zpComoUTC - supuesto;
  return supuesto - desfase;
}

/**
 * Convert an `America/Santo_Domingo` calendar date (`YYYY-MM-DD`) to the UTC instant that
 * starts (`boundary = "inicio"`) or ends (`boundary = "fin"`) that SD day:
 *
 * - `inicio` → SD 00:00:00.000 of the day (inclusive lower bound).
 * - `fin`    → SD 23:59:59.999 of the day (inclusive upper bound).
 *
 * A malformed or non-existent calendar date (e.g. `2026-02-31`, `2026-13-01`) fails loud
 * as `AUDITORIA_VALIDACION`; the caller never receives a silently-wrong instant.
 */
export function fechaSDaUTC(fechaSD: string, boundary: "inicio" | "fin"): Date {
  const m = RE_DX_FECHA.exec(fechaSD);
  if (!m) {
    throw new AuditoriaDomainError(AUDITORIA_VALIDACION, { campo: boundary });
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  // Reject a rolled-over / non-existent calendar date: Date.UTC normalises past the real
  // calendar, so compare the round-tripped UTC parts (a date check, not hour arithmetic).
  const ancla = new Date(Date.UTC(y, mo - 1, d));
  if (
    ancla.getUTCFullYear() !== y ||
    ancla.getUTCMonth() + 1 !== mo ||
    ancla.getUTCDate() !== d
  ) {
    throw new AuditoriaDomainError(AUDITORIA_VALIDACION, { campo: boundary });
  }

  const ms =
    boundary === "inicio"
      ? fechaHoraSDaInstanteUTC(y, mo, d, 0, 0, 0)
      : // 23:59:59.999 SD → the 999 ms tail is millisecond precision, not an hour shift.
        fechaHoraSDaInstanteUTC(y, mo, d, 23, 59, 59) + 999;
  return new Date(ms);
}

/**
 * Map an optional SD date-range (both ends as `YYYY-MM-DD`) to UTC `Date` bounds, leaving
 * each bound `undefined` when the caller omitted it (an open-ended range). `desde` becomes
 * the SD start-of-day, `hasta` the SD end-of-day.
 */
export function rangoFechasAUTC(rango: {
  readonly desde?: string;
  readonly hasta?: string;
}): { desde?: Date; hasta?: Date } {
  const out: { desde?: Date; hasta?: Date } = {};
  if (rango.desde !== undefined && rango.desde !== null) {
    out.desde = fechaSDaUTC(rango.desde, "inicio");
  }
  if (rango.hasta !== undefined && rango.hasta !== null) {
    out.hasta = fechaSDaUTC(rango.hasta, "fin");
  }
  return out;
}
