/**
 * Shared display date formatter (F0.3) — the ONE `formatearFechaSD`.
 *
 * Two input kinds, each with an explicit contract (format spec):
 *  - Full ISO instant or `Date` (UTC-stored `timestamptz`) → resolved to the
 *    `America/Santo_Domingo` calendar day via `formatInTimeZone` — zero manual
 *    hour arithmetic (AGENTS.md "Dates & time").
 *  - Bare `YYYY-MM-DD` string (regex-gated) → already an SD calendar date;
 *    it is rendered at UTC so no timezone can shift the day either way.
 *
 * Empty/unparseable input renders `—` so a malformed cell never blanks a row.
 */

import { formatInTimeZone } from "date-fns-tz";

const ZONA_SD = "America/Santo_Domingo";
const FORMATO_DIA = "dd/MM/yyyy";

/** ISO instant / Date → SD calendar day (`dd/MM/yyyy`), with `—" fallback. */
export function formatearFechaSD(valor: string | Date): string {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return "—";
    return formatInTimeZone(valor, ZONA_SD, FORMATO_DIA);
  }
  const s = valor;
  if (s === "") return "—";
  // Bare SD calendar date (`YYYY-MM-DD`): format AT UTC midday so both the
  // compose and the render agree on the same wall date — no shift, ever.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, d] = s.split("-").map(Number);
    return formatInTimeZone(
      new Date(Date.UTC(y, mo - 1, d, 12)),
      "UTC",
      FORMATO_DIA,
    );
  }
  // Anything else: attempt an ISO instant; an unparseable string falls to `—`.
  const fecha = new Date(s);
  if (Number.isNaN(fecha.getTime())) return "—";
  return formatInTimeZone(fecha, ZONA_SD, FORMATO_DIA);
}
