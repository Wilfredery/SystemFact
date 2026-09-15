/**
 * Pure mora (past-due) rule (R-B3).
 *
 * No DB, no Prisma, deterministic under a clock-injected `now`. A receivable is
 * in mora only once a FULL Santo Domingo calendar day has passed beyond its due
 * date (invoice date + client `plazoCreditoDias`). The due date and "today" are
 * BOTH resolved in `America/Santo_Domingo` — never by comparing raw UTC instants.
 *
 * TIMEZONE LIBRARY (design.md names `date-fns-tz`): this project does not ship
 * `date-fns-tz`; the ratified equivalent — AGENTS.md "Conversions via a dedicated
 * library (date-fns-tz or equivalent); no manual hour arithmetic" — is the
 * standard `Intl.DateTimeFormat` API with an explicit `timeZone`, already used for
 * the structurally identical Santo Domingo calendar-day window in
 * `devolucion/domain/devolucion.ts` (`validarPlazoDevolucion`) and
 * `venta/ui/fecha.ts`. SD is UTC-4 with NO DST, so shifting by whole
 * 86_400_000 ms moves the SD calendar date by exactly that many days; no manual
 * hour arithmetic is performed. Reusing the ratified path avoids adding an unused
 * dependency while satisfying R-B3 verbatim.
 */

/** `en-CA` yields an ISO-like `YYYY-MM-DD` that compares in calendar order. */
const FORMATO_FECHA_SD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santo_Domingo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** One millisecond-day; SD has no DST, so adding it shifts the SD date exactly. */
const MILISEGUNDOS_POR_DIA = 86_400_000;

/** Freeze a UTC instant to its `America/Santo_Domingo` calendar date string. */
function fechaEnSD(valor: Date): string {
  return FORMATO_FECHA_SD.format(valor);
}

/**
 * The invoice due date (`fechaEmision + plazoCreditoDias` days) expressed as its
 * Santo Domingo calendar date. Exposed for the aging/board views that group by
 * due bucket. A non-integer or negative `plazoCreditoDias` is a CONFIG defect, not
 * a business state, and fails loud.
 */
export function fechaVencimiento(
  fechaEmision: Date,
  plazoCreditoDias: number,
): string {
  if (!Number.isInteger(plazoCreditoDias) || plazoCreditoDias < 0) {
    throw new Error(
      `fechaVencimiento: plazoCreditoDias inválido (${String(plazoCreditoDias)}); revise CLIENTE.plazoCreditoDias`,
    );
  }
  const due = new Date(fechaEmision.getTime() + plazoCreditoDias * MILISEGUNDOS_POR_DIA);
  return fechaEnSD(due);
}

/**
 * R-B3 mora gate. `true` only when `now`, resolved in Santo Domingo, is STRICTLY
 * after the SD due date — i.e. at least one full SD day past due. On the due day
 * itself, and for the SD/UTC boundary instant that is still the previous day in
 * SD, it is NOT yet in mora ("today" resolves in SD).
 */
export function enMora(params: {
  readonly fechaEmision: Date;
  readonly plazoCreditoDias: number;
  readonly now: Date;
}): boolean {
  const vencimientoSD = fechaVencimiento(params.fechaEmision, params.plazoCreditoDias);
  const hoySD = fechaEnSD(params.now);
  // `YYYY-MM-DD` (en-CA) orders lexicographically the same as chronologically.
  return hoySD > vencimientoSD;
}
