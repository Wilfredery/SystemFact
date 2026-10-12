/**
 * Cobros UI — pure board model (fase-6 PR-4, R-C7 / R-C9).
 *
 * No React, no DOM, no network: just the deterministic transformations the CxC
 * board performs over the canonical `consultarSaldoCxcPaginado` page — the
 * three-way bucket (Pendiente / Parcial / En Mora) and the composition of a
 * section's `Pagina` from the SERVER pagination metadata. Keeping them pure
 * mirrors `venta/ui/carro.ts` and lets a plain unit test pin the bucketing and
 * the composition without a DB or a browser (AGENTS.md "Domain tests run with no
 * database"; board classification is the same class of logic).
 *
 * Every input row is a DERIVED fact from the single canonical aggregate — the
 * board NEVER re-queries a balance and never recomputes money here: it only
 * partitions the already-derived `estadoPago`/`enMora` flags the use case returns
 * (ADR-017 — nothing is materialized or cached; the flags ride in from the sole
 * entry point). The page cut itself lives in SQL (R-C9) — nothing here slices a
 * full set in memory (the old in-memory `paginar` page cut is gone; the
 * pagination caps live in the shared `@/shared/domain/pagination` playbook the
 * application normalizes through).
 */

import type { SaldoCxCVista, SaldoCxCVistaPagina } from "../application/consultar-saldo-cxc";
import { ESTADO_PAGO_DERIVADO } from "../domain/pago";

/** The three outstanding-receivable buckets the board renders (spec R-C7). */
export interface TableroCxc {
  readonly pendiente: readonly SaldoCxCVista[];
  readonly parcial: readonly SaldoCxCVista[];
  readonly enMora: readonly SaldoCxCVista[];
}

/**
 * Partition the canonical rows into the board's three buckets. The buckets are
 * mutually exclusive and the settled (`PAGADA`) receivables are dropped entirely:
 * the board shows what is still collectable. Settled rows can never reach this
 * classification from the paged serving mode either — the SQL wrapper already
 * applies the classifier's threshold — so the drop is the same pure-parity
 * defense, never a second derivation.
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

/** One board section's render window, composed from the served server page. */
export interface Pagina<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
}

/**
 * Compose ONE section's `Pagina` FROM the served server page (R-C9, design D4 —
 * `paginar` is now a composition over server pages, not an in-memory slice):
 * the page cursor and page count ARE the server metadata (the cut already
 * executed in SQL; the caps ride the shared playbook upstream — R-QC-07), and
 * `items` is the page-scoped bucket slice for the section.
 *
 * `total` is therefore the PAGE-SCOPED bucket count — the accepted behavior
 * change of H1 (design risk #3): per-bucket totals across the WHOLE tenant are
 * impossible without re-encoding the derived mora/estado rules in SQL, which is
 * the forbidden second encoding (D2's pin absolves ordering, not the
 * pages-per-bucket derived state). Pure and total — a stale snapshot never
 * crashes the board (page display clamps into `[1, max(1, totalPages)]`, the
 * board's min-1 semantics composed HERE, not re-encoded from the shared base).
 */
export function paginar<T>(
  items: readonly T[],
  servida: Pick<SaldoCxCVistaPagina, "page" | "totalPages">,
): Pagina<T> {
  const totalPages = Math.max(1, servida.totalPages);
  const page = Math.min(Math.max(1, servida.page), totalPages);
  return {
    items,
    page,
    totalPages,
    total: items.length,
  };
}
