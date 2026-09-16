/**
 * Reportes domain — the product-sales RANKING rule (OP-2).
 *
 * ADR-013: pure TypeScript, no DB. "Productos más/menos vendidos" ranks by UNITS SOLD as
 * the primary key and total MONTO as the secondary tie-breaker — never monto-first (that is
 * the dashboard top-sellers tile's concern, a different affordance). Both figures arrive as
 * `Decimal` STRINGS (units `Decimal(12,3)`, money `Decimal(12,2)`) across the infrastructure
 * boundary (AGENTS.md "Money = Decimal"); the comparison parses them through `decimal.js` so
 * a `100.000` vs `90.000` unit tie and an `RD$500.00` vs `RD$4500.00` monto tie are resolved
 * exactly, never via float subtraction.
 *
 * {@link compararPorUnidades} is the single ordering SPEC: the infrastructure `GROUP BY ...
 * ORDER BY SUM(cantidad) DESC, SUM(subtotalLinea) DESC` mirrors it 1:1 so the SQL pushdown
 * (OP-5) and the pure rule (OP-2 unit test) can never drift. `ordenarMasVendidos` sorts the
 * most-sold-first (the report's default); `ordenarMenosVendidos` is the exact inverse (the
 * same rows, opposite direction) so the two rankings are two views of ONE dataset.
 */

import { Decimal } from "decimal.js";

/** The minimal per-product shape the ranking needs (both figures as Decimal strings). */
export interface FilaProductoRankeable {
  /** Σ units sold in the window, `Decimal(12,3)` string. */
  readonly unidades: string;
  /** Σ line subtotal (monto) in the window, `Decimal(12,2)` string. */
  readonly monto: string;
}

/**
 * Compare two products by units-first, then monto, DESCENDING on both (most sold first).
 * Returns a NEGATIVE number when `a` ranks ABOVE `b`, POSITIVE when below, `0` on a full
 * tie. A units difference always decides the order (OP-2 "units decide"); monto breaks a
 * units tie (higher monto first); a further tie is left to the caller's stable sort.
 */
export function compararPorUnidades<T extends FilaProductoRankeable>(
  a: T,
  b: T,
): number {
  const ua = new Decimal(a.unidades);
  const ub = new Decimal(b.unidades);
  if (!ua.eq(ub)) return ub.cmp(ua); // units descending
  const ma = new Decimal(a.monto);
  const mb = new Decimal(b.monto);
  return mb.cmp(ma); // monto descending — the tie-breaker
}

/**
 * The products ordered MOST sold first (units desc, monto desc on tie). Does not mutate the
 * input — returns a new sorted array. A stable engine sort keeps any secondary caller order
 * for fully-equal rows.
 */
export function ordenarMasVendidos<T extends FilaProductoRankeable>(
  filas: readonly T[],
): T[] {
  return [...filas].sort((a, b) => compararPorUnidades(a, b));
}

/** The products ordered LEAST sold first — the exact inverse of {@link ordenarMasVendidos}. */
export function ordenarMenosVendidos<T extends FilaProductoRankeable>(
  filas: readonly T[],
): T[] {
  return [...filas].sort((a, b) => -compararPorUnidades(a, b));
}
