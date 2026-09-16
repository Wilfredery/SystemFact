/**
 * Auditoria UI — presentation formatters (Slice D, task 4.2).
 *
 * Boundary-only helpers turning the DTO the read use case returns into the strings
 * the table renders. They compute NOTHING: `fechaHora` is already the authoritative
 * UTC instant persisted on the append-only log, and `accion` is already the frozen
 * domain enum. Formatting is pure display.
 *
 * Dates (AGENTS.md "Dates & time"): storage is UTC `timestamptz`; `America/Santo_Domingo`
 * is a PRESENTATION concern. The conversion runs through the standard `Intl` zone API
 * with an explicit `timeZone` (the ratified equivalent of `date-fns-tz` in this repo,
 * same approach as `domain/zona-horaria.ts`) — never manual hour arithmetic. So a row
 * timestamped `2026-09-15T04:00:00Z` renders as `15/09/2026 00:00:00` in SD (UTC-4).
 */

import type { AccionAuditoria } from "../domain/auditoria";

/** SD wall-clock display for a UTC instant (`es-DO`, 24-hour, no manual offset math). */
const FORMATO_FECHA_HORA_SD = new Intl.DateTimeFormat("es-DO", {
  timeZone: "America/Santo_Domingo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** A persisted UTC `Date` → its Santo-Domingo calendar rendering for the table. */
export function formatearFechaHoraSD(fecha: Date): string {
  return FORMATO_FECHA_HORA_SD.format(fecha);
}

/** Spanish end-user label for each audit action (matches the cobros UI language). */
export const ETIQUETA_ACCION: Record<AccionAuditoria, string> = {
  CREAR: "Crear",
  ACTUALIZAR: "Actualizar",
  CANCELAR: "Cancelar",
  ANULAR: "Anular",
  PAGAR: "Pagar",
  AJUSTAR: "Ajustar",
  LOGIN: "Iniciar sesión",
  LOGOUT: "Cerrar sesión",
  LEER: "Leer",
};

/** A short badge tone per action, purely for legibility (never a business rule). */
export function tonoAccion(accion: AccionAuditoria): string {
  switch (accion) {
    case "CANCELAR":
    case "ANULAR":
      return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
    case "CREAR":
    case "PAGAR":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
    case "ACTUALIZAR":
    case "AJUSTAR":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

/**
 * The truncated "detalle" cell: `entidad #idEntidad` plus the reason when present.
 * The full text is exposed via the `title` attribute; the visible string is clamped
 * by CSS in the table (`truncate`). NEVER the JSON payloads (`valorAnterior`/
 * `valorNuevo`) — those are out of the read contract's free-text scope (AC-3) and
 * deliberately not surfaced in the summary column either.
 */
export function detalleFila(fila: {
  readonly entidad: string;
  readonly idEntidad: string;
  readonly motivo: string | null;
}): string {
  const base = `${fila.entidad} #${fila.idEntidad}`;
  return fila.motivo !== null && fila.motivo !== "" ? `${base} — ${fila.motivo}` : base;
}
