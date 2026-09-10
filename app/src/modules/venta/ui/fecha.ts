/**
 * Presentation-layer date formatting for the POS screen.
 *
 * All timestamps are stored and transported as UTC (`timestamptz` / ISO). The
 * Dominican business timezone (`America/Santo_Domingo`) is applied ONLY here,
 * at render time, via the standard `Intl.DateTimeFormat` API with an explicit
 * `timeZone` — the equivalent of a dedicated tz library. No manual hour
 * arithmetic anywhere (AGENTS.md "Dates & time").
 */

const FORMATO_SD = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Santo_Domingo",
  dateStyle: "medium",
  timeStyle: "short",
});

/** ISO/UTC instant → Santo Domingo wall-clock string for display only. */
export function formatearFechaSD(valor: string | Date): string {
  const fecha = typeof valor === "string" ? new Date(valor) : valor;
  return FORMATO_SD.format(fecha);
}
