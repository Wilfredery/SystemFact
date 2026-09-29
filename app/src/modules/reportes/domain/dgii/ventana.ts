/**
 * Reportes domain — the two BOUNDS that keep a DGII export inside what a request may cost
 * (FIS-3/FIS-4/FIS-5).
 *
 * ADR-013: PURE TypeScript. No Next.js, React, Prisma or Supabase — both guards are arithmetic on
 * an already-normalized {@link ReporteFiltro}, so the application layer can call them and then
 * never open a transaction's worth of work for a request that cannot be served.
 *
 *   1. THE DGII EXPORT WINDOW, FOR ALL THREE FORMATS (606, 607, 608). Each of them is a MONTHLY
 *      filing: the header carries a single `PERIODO` = AAAAMM. So the window must stay inside ONE
 *      `America/Santo_Domingo` calendar month — the SD month of `desde` must equal the SD month of
 *      `hasta`. Bounding "days" is NOT the same rule: 2026-04-01 .. 2026-05-01 is 31 days, yet it
 *      spans two months, and the header takes the window END's month, so the file would be filed
 *      as May while carrying April's rows. Same-month containment subsumes the 31-day maximum
 *      (no SD month is longer) and makes that mislabeling unrepresentable. Without the bound, a user
 *      can ask for a whole quarter: the `UNION ALL` aggregate runs unbounded, the assembled text
 *      reaches hundreds of MB, and the failure arrives as an unhandled `Prisma` `P2028`
 *      (interactive-transaction timeout) — an infrastructure error for what is really a business
 *      rule. An ABSENT or one-sided window is refused for the same reason: it is unbounded, and
 *      none of the three formats is an open-ended register.
 *
 *   2. THE ASSEMBLED RESPONSE SIZE. A 65,000-row part is tens of MB of fixed-width text, so a
 *      per-part byte cap refuses a file that cannot fit the server/transport budget. The cap is
 *      measured in UTF-8 BYTES (what actually ships), never in JS characters — the detail rows
 *      carry accented names, and a char count would understate the real body.
 *
 * The window MUST be evaluated on the SD business calendar, never on the UTC instant: a window
 * arrives as UTC-bracketed SD day bounds, so 2026-04-30 ends at 2026-05-01T03:59:59.999Z — whose
 * UTC month is May while its SD month is April. A UTC-month check would reject a legal April
 * export. Every conversion goes through the shared {@link fechaEnSD} seam — no manual hour
 * arithmetic (AGENTS.md dates rule).
 */

import { REPORTE_DGII_TAMANO_EXCEDIDO, REPORTE_DGII_VENTANA_EXCEDIDA, ReporteDomainError } from "../errors";
import type { ReporteFiltro } from "../reporte-filtro";
import { fechaEnSD } from "../zona-horaria";

/** The largest assembled TXT part this exporter will ship: 50 MiB, measured in UTF-8 bytes. */
export const MAX_BYTES_EXPORTACION_DGII = 52_428_800; // 50 * 1024 * 1024

/** A calendar month on the SD business calendar — the granularity a DGII header can express. */
export interface PeriodoSd {
  readonly anio: number;
  readonly mes: number;
}

/** The SD calendar month of `instante`, read through the shared date seam. */
function mesSdDe(instante: Date): PeriodoSd {
  const [anio, mes] = fechaEnSD(instante).split("-").map(Number);
  return { anio: anio as number, mes: mes as number };
}

/**
 * The single SD month the window covers, or `null` when the window is NOT a valid single-month
 * window — either unbounded (an absent end, or no window at all) or straddling a month boundary.
 *
 * `null` covers BOTH cases on purpose, so a non-null result is a guarantee: the window is bounded
 * AND every day in it shares that one month. A caller can therefore use the result as the export's
 * `PERIODO` without re-checking anything — it is impossible to get a period for a window that
 * spans two months out of here.
 */
export function periodoSdDeVentana(filtro: ReporteFiltro): PeriodoSd | null {
  if (filtro.desde === undefined || filtro.hasta === undefined) return null;
  const desde = mesSdDe(filtro.desde);
  const hasta = mesSdDe(filtro.hasta);
  if (desde.anio !== hasta.anio || desde.mes !== hasta.mes) return null;
  return desde;
}

/** `"YYYY-MM"` — the `PERIODO` shape, used as the operator-facing month label in `details`. */
function etiquetaPeriodo(p: PeriodoSd): string {
  return `${p.anio}-${String(p.mes).padStart(2, "0")}`;
}

/**
 * The one-calendar-month rule, as a guard AND as the answer: returns the SD month the window covers
 * so the caller can file under it, or THROWS the STABLE {@link REPORTE_DGII_VENTANA_EXCEDIDA} code
 * — which the application layer maps into a typed `ReportResult`, never an infrastructure error.
 *
 * Call it BEFORE any query: the point of the cap is that an unservable request does no work at all.
 * Because this ONE function both validates and yields the period, a header can never be filed under
 * a month the guard did not approve.
 *
 * The two SD months go into `details` so a refused request says which months it straddled instead
 * of only asserting that something is wrong.
 */
export function periodoAprobadoDeVentana(filtro: ReporteFiltro): PeriodoSd {
  const periodo = periodoSdDeVentana(filtro);
  if (periodo !== null) return periodo;
  throw new ReporteDomainError(REPORTE_DGII_VENTANA_EXCEDIDA, {
    mesDesde: filtro.desde === undefined ? null : etiquetaPeriodo(mesSdDe(filtro.desde)),
    mesHasta: filtro.hasta === undefined ? null : etiquetaPeriodo(mesSdDe(filtro.hasta)),
  });
}

/** The UTF-8 size of `txt` in BYTES — the unit the transport actually bills and buffers. */
export function bytesUtf8(txt: string): number {
  return new TextEncoder().encode(txt).byteLength;
}

/**
 * Refuse an assembled TXT part larger than {@link MAX_BYTES_EXPORTACION_DGII}. Throws the STABLE
 * {@link REPORTE_DGII_TAMANO_EXCEDIDO} code; a part of EXACTLY the cap is allowed.
 *
 * `details` names the DGII format and both sizes, and the application layer FORWARDS it into the
 * typed `ReportResult` — an oversized 606 and an oversized 607 otherwise return the byte-identical
 * message with no way to tell WHICH file was too big.
 */
export function verificarTamanoExportacionDgii(codigo: string, txt: string): void {
  const bytes = bytesUtf8(txt);
  if (bytes > MAX_BYTES_EXPORTACION_DGII) {
    throw new ReporteDomainError(REPORTE_DGII_TAMANO_EXCEDIDO, {
      codigo,
      bytes,
      maxBytes: MAX_BYTES_EXPORTACION_DGII,
    });
  }
}
