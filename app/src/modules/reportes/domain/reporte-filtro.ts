/**
 * Reportes domain — the shared filter + pagination contract every report use case reuses
 * (DB-3, DB-5).
 *
 * ADR-013: this module imports NOTHING from Next.js, React, Prisma or Supabase. It owns
 * ONLY the normalisation of a raw consultation request into a DB-ready filter:
 *   - page floored to ≥ 1, page size DEFAULT 25 and HARD-CLAMPED to ≤ 100 (DB-5);
 *   - a `sucursalId` narrowed filter validated as a positive integer;
 *   - SD date range (arbitrary `desde`/`hasta`, or a full-period preset) converted to
 *     UTC `Date` bounds through the reused {@link fechaSDaUTC} / {@link rangoFechasAUTC}
 *     seam (design "Domain converts SD dates through the existing `Intl` seam");
 *   - a `desde > hasta` range REJECTED with the stable `REPORTE_VALIDACION`, never
 *     silently flipped, so no query runs on a nonsense window (DB-5).
 *
 * The clamp/preset/window math is pure and unit-tested with no database (design Testing
 * Strategy: "Pure Jest tests cover SD boundaries, invalid ranges …").
 */

import { REPORTE_VALIDACION, ReporteDomainError } from "./errors";
import { rangoFechasAUTC } from "./zona-horaria";

// --- Pagination constants (DB-5) ---

/** Default page size (AGENTS.md "lists always paginated — default 25/page"). */
export const TAMANO_PAGINA_POR_DEFECTO = 25;
/** Hard ceiling; a larger request is CLAMPED to it, never accepted (DB-5). */
export const TAMANO_PAGINA_MAXIMO = 100;

/**
 * A full-calendar-period preset (DB-5 "date filters MUST support both full calendar
 * periods (day/week/month presets) AND arbitrary SD-date ranges"). Resolved against a
 * `now` into a `[desde, hasta]` SD calendar-date pair by {@link presetARango}.
 */
export const PRESETS_PERIODICO = ["HOY", "SEMANA", "MES", "ANIO"] as const;
export type PresetPeriodico = (typeof PRESETS_PERIODICO)[number];

const PRESETS = new Set<string>(PRESETS_PERIODICO);

/** True when `valor` is one of the accepted period presets. */
export function esPresetPeriodico(valor: unknown): valor is PresetPeriodico {
  return typeof valor === "string" && PRESETS.has(valor);
}

/** A normalised, DB-ready filter. Optional facets are `undefined` when unset (ANDed by
 *  the repository — DB-5 "filters empresa + sucursal + date range MUST be combinable
 *  with AND"). `desde`/`hasta` are already UTC instants produced by the SD conversion. */
export interface ReporteFiltro {
  /** UTC instant = start of the requested Santo-Domingo day (inclusive). */
  readonly desde?: Date;
  /** UTC instant = end of the requested Santo-Domingo day (inclusive). */
  readonly hasta?: Date;
  /** Optional branch narrowing (a plain `WHERE sucursalId`), never a tenant anchor. */
  readonly sucursalId?: number;
  /** 1-based page index, always ≥ 1. */
  readonly page: number;
  /** Rows per page, always in `[1, TAMANO_PAGINA_MAXIMO]`. */
  readonly pageSize: number;
}

/** Raw, transport-shaped input (as parsed by the HTTP/Zod layer) before normalisation. */
export interface ReporteFiltroEntrada {
  readonly desde?: string | null;
  readonly hasta?: string | null;
  /** Optional calendar-period preset; resolves to desde/hasta when they are absent. */
  readonly preset?: string | null;
  readonly sucursalId?: number | null;
  readonly page?: number | null;
  readonly pageSize?: number | null;
}

/** Positive-integer locator id, or `undefined`; anything else is transport-invalid. */
function normalizarId(
  valor: number | null | undefined,
  campo: "sucursalId",
): number | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (!Number.isInteger(valor) || valor < 1) {
    throw new ReporteDomainError(REPORTE_VALIDACION, { campo });
  }
  return valor;
}

/** Clamp the requested page to an integer ≥ 1 (defaults to the first page). */
function normalizarPage(page: number | null | undefined): number {
  if (page === undefined || page === null || !Number.isFinite(page)) return 1;
  const truncada = Math.trunc(page);
  return truncada < 1 ? 1 : truncada;
}

/** Clamp the requested page size into `[1, TAMANO_PAGINA_MAXIMO]` (default 25). */
function normalizarPageSize(pageSize: number | null | undefined): number {
  if (
    pageSize === undefined ||
    pageSize === null ||
    !Number.isFinite(pageSize)
  ) {
    return TAMANO_PAGINA_POR_DEFECTO;
  }
  const truncada = Math.trunc(pageSize);
  return Math.max(1, Math.min(truncada, TAMANO_PAGINA_MAXIMO));
}

/** A bare SD calendar date `YYYY-MM-DD` (validated downstream by the seam). */
const RE_DX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Pad a month (1-12) or day (1-31) to two digits. */
function dos(v: number): string {
  return String(v).padStart(2, "0");
}

/**
 * Resolve a full-calendar-period preset to a `[desde, hasta]` SD calendar-date pair
 * (inclusive), computed on the Santo-Domingo calendar day of `now` (never raw UTC).
 * Week is Monday-anchored (ISO); month/year use the natural SD boundaries. DB-5.
 */
export function presetARango(
  preset: PresetPeriodico,
  now: Date,
): { desde: string; hasta: string } {
  // SD wall-clock parts of the injected instant, via the reused conversion path by
  // asking the Intl seam for the SD calendar date, then reading Y/M/D numerically.
  const sd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const parte = (t: Intl.DateTimeFormatPartTypes): number => {
    const p = sd.find((x) => x.type === t);
    return p ? Number(p.value) : 0;
  };
  const y = parte("year");
  const m = parte("month");
  const d = parte("day");
  const iso = (yy: number, mm: number, dd: number): string =>
    `${yy}-${dos(mm)}-${dos(dd)}`;

  switch (preset) {
    case "HOY":
      return { desde: iso(y, m, d), hasta: iso(y, m, d) };
    case "MES":
      return { desde: iso(y, m, 1), hasta: iso(y, m, diasDelMes(y, m)) };
    case "ANIO":
      return { desde: iso(y, 1, 1), hasta: iso(y, 12, 31) };
    case "SEMANA": {
      // ISO weekday (Mon=1..Sun=7) derived from a UTC calendar of the SD Y/M/D (date
      // math on whole days, no hour arithmetic): getUTCDay Sun=0..Sat=6.
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const offsetLunes = (dow + 6) % 7; // days since Monday
      const lunes = new Date(Date.UTC(y, m - 1, d - offsetLunes));
      const domingo = new Date(Date.UTC(y, m - 1, d - offsetLunes + 6));
      return {
        desde: iso(lunes.getUTCFullYear(), lunes.getUTCMonth() + 1, lunes.getUTCDate()),
        hasta: iso(
          domingo.getUTCFullYear(),
          domingo.getUTCMonth() + 1,
          domingo.getUTCDate(),
        ),
      };
    }
  }
}

/** Days in an SD month (natural month lengths; leap years via the Date calendar). */
function diasDelMes(y: number, m: number): number {
  // Day 0 of the next month = last day of this month. Whole-calendar day arithmetic.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Normalise a raw consultation request into a DB-ready {@link ReporteFiltro}: page ≥ 1,
 * pageSize clamped to `[1,100]` (500 → 100, DB-5), `sucursalId` validated, the SD date
 * window resolved (explicit `desde`/`hasta`, or a preset when both are absent), and a
 * `desde > hasta` range rejected. Throws {@link ReporteDomainError}`(REPORTE_VALIDACION)`
 * on any transport violation so the use case can fail BEFORE running a query.
 */
export function normalizarFiltro(
  entrada: ReporteFiltroEntrada,
  now: Date = new Date(),
): ReporteFiltro {
  const filtro: {
    desde?: Date;
    hasta?: Date;
    sucursalId?: number;
    page: number;
    pageSize: number;
  } = {
    page: normalizarPage(entrada.page),
    pageSize: normalizarPageSize(entrada.pageSize),
  };

  const sucursalId = normalizarId(entrada.sucursalId, "sucursalId");
  if (sucursalId !== undefined) filtro.sucursalId = sucursalId;

  // Resolve the SD calendar-date strings from either explicit ends or a preset. A blank
  // value is "not provided", NOT an invalid one; only a non-empty malformed date (or a
  // `desde > hasta` inversion) fails as REPORTE_VALIDACION.
  let desde =
    typeof entrada.desde === "string" && entrada.desde.trim() !== ""
      ? entrada.desde.trim()
      : undefined;
  let hasta =
    typeof entrada.hasta === "string" && entrada.hasta.trim() !== ""
      ? entrada.hasta.trim()
      : undefined;

  const preset =
    typeof entrada.preset === "string" && entrada.preset.trim() !== ""
      ? entrada.preset.trim().toUpperCase()
      : undefined;

  if (desde === undefined && hasta === undefined && preset !== undefined) {
    if (!esPresetPeriodico(preset)) {
      throw new ReporteDomainError(REPORTE_VALIDACION, { campo: "preset" });
    }
    const r = presetARango(preset, now);
    desde = r.desde;
    hasta = r.hasta;
  } else if (preset !== undefined && !esPresetPeriodico(preset)) {
    throw new ReporteDomainError(REPORTE_VALIDACION, { campo: "preset" });
  }

  // Reject a shape-violating non-empty date BEFORE conversion (the seam validates a
  // real calendar day; here we guard the `YYYY-MM-DD` wire shape + inversion).
  if (desde !== undefined && !RE_DX_FECHA.test(desde)) {
    throw new ReporteDomainError(REPORTE_VALIDACION, { campo: "desde" });
  }
  if (hasta !== undefined && !RE_DX_FECHA.test(hasta)) {
    throw new ReporteDomainError(REPORTE_VALIDACION, { campo: "hasta" });
  }
  // A bare-lexicographic `desde > hasta` comparison is calendar-correct for `YYYY-MM-DD`
  // (ISO-like ordering), so a nonsense window is refused without a DB (DB-5).
  if (desde !== undefined && hasta !== undefined && desde > hasta) {
    throw new ReporteDomainError(REPORTE_VALIDACION, { campo: "rango" });
  }

  const rango = rangoFechasAUTC({ desde, hasta });
  if (rango.desde !== undefined) filtro.desde = rango.desde;
  if (rango.hasta !== undefined) filtro.hasta = rango.hasta;

  return filtro;
}

/** Zero-based row offset for the ordered aggregate query. */
export function calcularOffset(
  filtro: Pick<ReporteFiltro, "page" | "pageSize">,
): number {
  return (filtro.page - 1) * filtro.pageSize;
}

/** Page count for `total` at `pageSize` (0 when there are no rows). */
export function calcularTotalPages(total: number, pageSize: number): number {
  if (total <= 0) return 0;
  return Math.ceil(total / Math.max(1, pageSize));
}
