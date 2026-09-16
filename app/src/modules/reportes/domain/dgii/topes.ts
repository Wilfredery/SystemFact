/**
 * Reportes domain — DGII record caps, deterministic multi-file split, en-cero file and the
 * file-naming convention (FIS-6; slice E, task 5.1).
 *
 * ADR-013: PURE TypeScript, Decimal-free (these are counts and strings). The DGII "Formatos de
 * Envío" cap each TXT at a fixed number of DETAIL records; a period with more registers MUST be
 * split into several files, each within cap, whose counts sum to the whole (research §2/§9 U5;
 * spec FIS-6 "Cap-exceeding split" + "Zero-activity period"). 607 ≤ 65,000 (S4), 608 ≤ 4,999
 * (S6); the 606 CURRENT cap is UNVERIFIED (only the legacy 10,000 is sourced — U5), so it is a
 * DEFAULT a tool-verified fix flips in ONE place here, never hardcoded across the exporter.
 *
 * The split is DETERMINISTIC: it takes the input in the caller's (already-canonical, ordered)
 * row order and cuts it into consecutive fixed-size chunks, so re-running an export for the same
 * period yields byte-identical files (research §8 "idempotency: re-running an export must not
 * double-count; produce deterministic bytes").
 */

import { periodoAAAAMM } from "./formato";

/** The 607 detail-record cap per file (research §3/§9, S4: ≤ 65,000). */
export const TOPE_607 = 65_000;
/** The 608 detail-record cap per file (research §5/§9, S6: ≤ 4,999). */
export const TOPE_608 = 4_999;
/**
 * The 606 detail-record cap per file. UNVERIFIED (U5) — only the legacy 10,000 is sourced
 * (research §9). This is the SINGLE seam to change once the pre-validation tool confirms the
 * current cap; the exporter reads it from here, so no split logic changes.
 */
export const TOPE_606_POR_DEFECTO = 10_000;

/** The numeric DGII format codes for the three TXT registers. */
export const CODIGO_FORMATO = {
  606: "606",
  607: "607",
  608: "608",
} as const;
export type CodigoFormato606_608 = (typeof CODIGO_FORMATO)[keyof typeof CODIGO_FORMATO];

/**
 * The DGII TXT filename convention (research §2/§8, S4): `DGII_F_<code>_<RNC>_<AAAAMM>.TXT`. The
 * RNC is the remitter's fiscal id (dashes already stripped by the caller); the period is the 6-
 * digit `AAAAMM` the header carries. A split file appends `_NNN` (1-based, zero-padded) before the
 * extension so every part stays within the 8.3-unfriendly but DGII-accepted long name WITHOUT
 * colliding — deterministic and tool-inspectable.
 */
export function nombreArchivoDGII(
  codigo: CodigoFormato606_608,
  rnc: string,
  anio: number,
  mes: number,
  parte = 1,
  totalPartes = 1,
): string {
  const periodo = periodoAAAAMM(anio, mes);
  const sufijo = totalPartes > 1 ? `_${String(parte).padStart(3, "0")}` : "";
  return `DGII_F_${codigo}_${rnc}_${periodo}${sufijo}.TXT`;
}

/**
 * Cut `total` records into consecutive fixed-size chunks within `tope` — the DETERMINISTIC split.
 * Returns the list of per-file row-count slices (each ≤ `tope`) summing to `total`. A zero-
 * activity period yields a SINGLE chunk of length 0 (the en-cero file — spec FIS-6), so the writer
 * always emits at least one valid header file even with no detail rows.
 */
export function dividirPorTope(total: number, tope: number): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError(`dividirPorTope: total debe ser un entero no negativo, recibido ${String(total)}`);
  }
  if (!Number.isInteger(tope) || tope < 1) {
    throw new RangeError(`dividirPorTope: tope debe ser un entero >= 1, recibido ${String(tope)}`);
  }
  if (total === 0) return [0]; // the en-cero file
  const partes: number[] = [];
  let restante = total;
  while (restante > 0) {
    const size = Math.min(tope, restante);
    partes.push(size);
    restante -= size;
  }
  return partes;
}

/**
 * Slice the ordered rows into per-file chunks matching {@link dividirPorTope}. Splitting the
 * ARRAY (not just the counts) keeps the split and the writer in lockstep so each file's header
 * `CANTIDAD_REGISTROS` equals its own detail length and the per-file counts sum to the whole.
 */
export function trocearRegistros<T>(filas: readonly T[], tope: number): T[][] {
  const trozos: T[][] = [];
  if (filas.length === 0) return [[]]; // en-cero: one empty chunk
  for (let i = 0; i < filas.length; i += tope) {
    trozos.push(filas.slice(i, i + tope));
  }
  return trozos;
}
