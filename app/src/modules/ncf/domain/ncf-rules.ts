/**
 * NCF domain — pure rules (Phase 1 / pr5c1).
 *
 * Owns the frozen DGII sequence rules that are testable with no database and
 * no Prisma (ADR-013): composition, the 90% warning threshold, Santo Domingo
 * calendar-day expiry, and the D7 "last used → next" transition helpers the
 * consume port reuses. B01/B02 ELIGIBILITY SELECTION lives in the factura /
 * venta layer (see task 2.2); this module only owns the pure result TYPE per
 * design (D2), never the client-shape decision logic.
 *
 * Dates: expiry is compared on the `America/Santo_Domingo` CALENDAR DAY via the
 * standard `Intl.DateTimeFormat` API with an explicit `timeZone` — the ratified
 * project equivalent of a dedicated tz library (see `venta/ui/fecha.ts`),
 * satisfying AGENTS.md "no manual hour arithmetic" and R-N5 "never raw UTC
 * compare". No third-party dependency is introduced.
 */

/** Non-blocking warning emitted when a range crosses the 90% usage threshold. */
export const NCF_UMBRAL_90 = "NCF_UMBRAL_90" as const;
export type NcfWarning = typeof NCF_UMBRAL_90;

/**
 * NCF sequence kinds backed by an `NCF_SECUENCIA` row (`TipoNcfSecuencia` enum).
 * Frozen value set mirrors the Prisma enum; kept as a plain union so the domain
 * stays free of generated-client imports.
 */
export type TipoNcf = "B01" | "B02" | "B03" | "B04" | "B11";

/**
 * D2 — pure eligibility RESULT types. `seleccionarTipoNcf` (venta/factura,
 * Phase 2) is the ONLY producer; this module just names the shape so later
 * fases share it. B01 = taxpayer, B02 = consumidor final / invalid RNC
 * (fail-closed on degenerate data).
 */
export type TipoNcfEmitido = Extract<TipoNcf, "B01" | "B02">;
export interface ElegibilidadNcf {
  readonly tipo: TipoNcfEmitido;
  readonly motivo: "CONTRIBUYENTE" | "CONSUMIDOR_FINAL" | "DATOS_DEGENERADOS";
}

const PREFIJO = "B";
const DIGITOS_TIPO = 2; // "B02" -> "02"
const LONGITUD_CONSECUTIVO = 8; // %08d
const MAX_CONSECUTIVO = 99_999_999; // largest value that stays within %08d
const LARGO_NCF = 1 + DIGITOS_TIPO + LONGITUD_CONSECUTIVO; // 11

const ZONA_SD = "America/Santo_Domingo";
// `en-CA` yields an ISO-like `YYYY-MM-DD`, which compares lexicographically in
// calendar order. Explicit timeZone ⇒ SD calendar day, never the UTC instant.
const FORMATO_FECHA_SD = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_SD,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Freeze a UTC instant to its `America/Santo_Domingo` calendar date string
 * (`YYYY-MM-DD`). Exported for tests; used internally by {@link esRangoVencidoSD}.
 */
export function fechaEnSD(valor: Date): string {
  return FORMATO_FECHA_SD.format(valor);
}

/**
 * R-N2 — frozen composition: `B` + 2-digit tipo + 8-digit zero-padded
 * consecutive, exactly 11 characters, no embedded RNC. Guards the 11-char
 * invariant: a consecutive that does not fit `%08d` (or a non-integer) fails
 * loud rather than silently producing an out-of-spec NCF.
 */
export function componerNcf(tipo: TipoNcf, secuencial: number): string {
  if (!Number.isInteger(secuencial) || secuencial < 0) {
    throw new RangeError(
      `componerNcf: secuencial must be a non-negative integer, got ${String(secuencial)}`,
    );
  }
  if (secuencial > MAX_CONSECUTIVO) {
    throw new RangeError(
      `componerNcf: secuencial ${String(secuencial)} exceeds the ${String(LONGITUD_CONSECUTIVO)}-digit DGII consecutive (max ${String(MAX_CONSECUTIVO)})`,
    );
  }
  const digitosTipo = tipo.slice(PREFIJO.length);
  const consecutivo = String(secuencial).padStart(LONGITUD_CONSECUTIVO, "0");
  const ncf = `${PREFIJO}${digitosTipo}${consecutivo}`;
  // Defensive: the two guards above already guarantee this; keep the invariant
  // explicit so any future edit to the constants trips immediately.
  if (ncf.length !== LARGO_NCF) {
    throw new Error(`componerNcf: produced a non-conforming NCF "${ncf}" (expected ${String(LARGO_NCF)} chars)`);
  }
  return ncf;
}

/**
 * R-N3 — 90% usage threshold. `secuenciaActual` is the just-consumed (last used)
 * value (D7). Returns `NCF_UMBRAL_90` when the consumed position reaches ≥ 90%
 * of the range, otherwise `null`. NEVER throws and NEVER fails the operation:
 * degenerate ranges simply yield no warning.
 *
 * Uses exact integer cross-multiplication (10·used ≥ 9·total) instead of float
 * division, so the inclusive boundary is not subject to rounding error.
 */
export function calcularUmbral90(input: {
  readonly rangoInicio: number;
  readonly rangoFin: number;
  readonly secuenciaActual: number;
}): NcfWarning | null {
  const { rangoInicio, rangoFin, secuenciaActual } = input;
  const total = rangoFin - rangoInicio + 1;
  if (total <= 0) return null; // empty/inverted range: nothing to warn about
  if (secuenciaActual > rangoFin) return null; // past exhaustion = error, not a warning
  const used = secuenciaActual - rangoInicio + 1;
  return 10 * used >= 9 * total ? NCF_UMBRAL_90 : null;
}

/**
 * D7 transition helpers — the pure math the consume port and its tests share.
 * `secuenciaActual` is the LAST used value; the next number to hand out is one
 * past it, and the range is exhausted once that next would pass `rangoFin`.
 */
export function siguienteSecuencia(secuenciaActual: number): number {
  return secuenciaActual + 1;
}

export function esRangoAgotado(input: {
  readonly rangoFin: number;
  readonly secuenciaActual: number;
}): boolean {
  return siguienteSecuencia(input.secuenciaActual) > input.rangoFin;
}

/**
 * R-N5 — SD calendar-day expiry. A range is expired when today's Santo Domingo
 * date is strictly after the `vigenciaFin` Santo Domingo date. The boundary day
 * (equal SD dates) is still valid. Compares calendar-date strings, never the
 * raw UTC instants.
 */
export function esRangoVencidoSD(input: {
  readonly now: Date;
  readonly vigenciaFin: Date;
}): boolean {
  return fechaEnSD(input.now) > fechaEnSD(input.vigenciaFin);
}
