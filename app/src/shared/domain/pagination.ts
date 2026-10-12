/**
 * Shared pagination contract — the ONE pure helper set every module served by
 * the optimizacion-baseline change paginates through (R-QC-07).
 *
 * Pure TypeScript: no imports of Next.js, React, Prisma, or Supabase. The list
 * rule is AGENTS.md §7 "Lists ALWAYS paginated": default 25 rows/page with a
 * hard clamp at 100 — the caps live here and are re-encoded NOWHERE else.
 *
 * Signatures are plain `(page, pageSize)` numbers (design D3): call sites pass
 * `filtro.page`/`filtro.pageSize` themselves; there are NO delegating object
 * wrappers, because delegated shims are how stray duplicate copies re-appear.
 * Callsites that compose a UI shape (e.g. the cobros board's min-1 `totalPages`
 * or a `Paginacion {offset, limit}` bind bundle) compose HERE-SHIPPED values at
 * their own layer — the shared module exports no types (D3/D7).
 */

/** Default page size (AGENTS.md "lists always paginated — default 25/page"). */
export const TAMANO_PAGINA_POR_DEFECTO = 25;
/** Hard ceiling; a larger request is CLAMPED to it, never accepted (R-QC-07). */
export const TAMANO_PAGINA_MAXIMO = 100;

/**
 * Clamp a raw transport page size to `[1, TAMANO_PAGINA_MAXIMO]`, defaulting
 * to {@link TAMANO_PAGINA_POR_DEFECTO} when absent, non-finite, or non-positive
 * (R-QC-07 clamp matrix: 0 → 25, 25 → 25, 250 → 100).
 */
export function normalizarTamanoPagina(pageSize?: number | null): number {
  if (
    pageSize === undefined ||
    pageSize === null ||
    !Number.isFinite(pageSize)
  ) {
    return TAMANO_PAGINA_POR_DEFECTO;
  }
  const truncada = Math.trunc(pageSize);
  if (truncada <= 0) return TAMANO_PAGINA_POR_DEFECTO;
  return Math.min(truncada, TAMANO_PAGINA_MAXIMO);
}

/**
 * Floor a raw transport page to ≥ 1, defaulting to the first page when absent
 * or non-finite (matrix: 0 → 1, −1 → 1, 2.7 → 2).
 */
export function normalizarPagina(page?: number | null): number {
  if (page === undefined || page === null || !Number.isFinite(page)) return 1;
  const truncada = Math.trunc(page);
  return truncada < 1 ? 1 : truncada;
}

/** Zero-based row offset for the indexed query: 0 for the first page. */
export function calcularOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/**
 * Pages a `total` needs at `pageSize`; 0 when there are no rows (the audited
 * `calcularTotalPages` semantics — NOT the cobros board's min-1 variant, which
 * composes this value at its own UI layer).
 */
export function calcularTotalPages(total: number, pageSize: number): number {
  if (total <= 0) return 0;
  return Math.ceil(total / Math.max(1, pageSize));
}
