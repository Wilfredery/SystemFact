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

/** Default page size (AGENTS.md "Lists ALWAYS paginated — default 25/page"). */
export const TAMANO_PAGINA_CXC = 25;

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
 * Slice `[items]` into `pageSize`-sized pages (default 25, capped at 100 per the
 * repo pagination rule) and clamp `page` to `[1, totalPages]`. An empty list
 * yields a single empty page (`totalPages: 1`) so the view keeps a stable shape.
 * Pure and total — no throw for out-of-range pages, so a stale deep link never
 * crashes the board.
 */
export function paginar<T>(
  items: readonly T[],
  page: number,
  pageSize: number = TAMANO_PAGINA_CXC,
): Pagina<T> {
  const limit = Math.max(1, Math.min(pageSize, 100));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  const inicio = (safePage - 1) * limit;
  return {
    items: items.slice(inicio, inicio + limit),
    page: safePage,
    totalPages,
    total,
  };
}
