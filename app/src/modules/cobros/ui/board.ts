/**
 * Cobros UI — pure board model (fase-6 PR-4, R-C7).
 *
 * No React, no DOM, no network: just the deterministic transformations the CxC
 * board performs over the canonical `consultarSaldoCxC` rows — the three-way
 * bucket (Pendiente / Parcial / En Mora) and the 25-per-page window. Keeping them
 * pure mirrors `venta/ui/carro.ts` and lets a plain unit test pin the bucketing
 * and paging without a DB or a browser (AGENTS.md "Domain tests run with no
 * database"; board classification is the same class of logic).
 *
 * Every input row is a DERIVED fact from the single canonical aggregate — the
 * board NEVER re-queries a balance and never recomputes money here: it only
 * partitions the already-derived `estadoPago`/`enMora` flags the use case returns
 * (ADR-017 — nothing is materialized or cached; the flags ride in from the sole
 * entry point).
 */

import type { SaldoCxCVista } from "../application/consultar-saldo-cxc";
import { ESTADO_PAGO_DERIVADO } from "../domain/pago";
import {
  TAMANO_PAGINA_POR_DEFECTO,
  calcularOffset,
  calcularTotalPages,
  normalizarPagina,
  normalizarTamanoPagina,
} from "@/shared/domain/pagination";

/**
 * Default page size (AGENTS.md "Lists ALWAYS paginated — default 25/page"):
 * the module-facing name that composes the shared pagination contract —
 * board copies of the caps used to duplicate the 25/100 literals (R-QC-07).
 */
export const TAMANO_PAGINA_CXC = TAMANO_PAGINA_POR_DEFECTO;

/** The three outstanding-receivable buckets the board renders (spec R-C7). */
export interface TableroCxc {
  readonly pendiente: readonly SaldoCxCVista[];
  readonly parcial: readonly SaldoCxCVista[];
  readonly enMora: readonly SaldoCxCVista[];
}

/**
 * Partition the canonical rows into the board's three buckets. The buckets are
 * mutually exclusive and the settled (`PAGADA`) receivables are dropped entirely:
 * the board shows what is still collectable.
 *   • En Mora     — overdue AND not yet settled (an unpaid balance past its due
 *                   date, resolved in `America/Santo_Domingo` upstream in R-B3);
 *   • Pendiente   — not in mora, zero applied cobros;
 *   • Parcial     — not in mora, some but not all cobros applied.
 * Mora takes precedence over the PENDIENTE/PARCIAL split because a past-due
 * partial is a collection-urgency signal the board must surface once, not twice.
 */
export function clasificarTableroCxc(
  filas: readonly SaldoCxCVista[],
): TableroCxc {
  const pendiente: SaldoCxCVista[] = [];
  const parcial: SaldoCxCVista[] = [];
  const enMora: SaldoCxCVista[] = [];

  for (const fila of filas) {
    const pagada = fila.estadoPago === ESTADO_PAGO_DERIVADO.PAGADA;
    if (pagada) continue;
    if (fila.enMora) {
      enMora.push(fila);
    } else if (fila.estadoPago === ESTADO_PAGO_DERIVADO.PARCIAL) {
      parcial.push(fila);
    } else {
      pendiente.push(fila);
    }
  }
  return { pendiente, parcial, enMora };
}

/** One paginated window over a list, computed at the UI boundary. */
export interface Pagina<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
}

/**
 * Slice `[items]` into `pageSize`-sized pages composed FROM the shared
 * pagination contract (R-QC-07 — the board keeps its own min-1 `totalPages`
 * and stale-deep-link page-fallback UI semantics per design D3; the shared
 * module supplies the caps, offset and the audited 0-for-empty base).
 * Pure and total — no throw for out-of-range pages, so a stale deep link never
 * crashes the board.
 */
export function paginar<T>(
  items: readonly T[],
  page: number,
  pageSize: number = TAMANO_PAGINA_CXC,
): Pagina<T> {
  const limit = normalizarTamanoPagina(pageSize);
  const total = items.length;
  // Board shape: an empty list still yields ONE stable empty page (min-1),
  // where the shared audited base returns 0 — composed here, not re-encoded.
  const totalPages = Math.max(1, calcularTotalPages(total, limit));
  const safePage = Math.min(normalizarPagina(page), totalPages);
  const inicio = calcularOffset(safePage, limit);
  return {
    items: items.slice(inicio, inicio + limit),
    page: safePage,
    totalPages,
    total,
  };
}
