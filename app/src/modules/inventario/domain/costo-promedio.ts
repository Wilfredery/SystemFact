/**
 * Inventario domain — company-wide weighted-average cost on purchase receipt.
 *
 * ADR-013: pure TypeScript; imports nothing from Next.js, React, Prisma or
 * Supabase. Quantities/money cross the boundary as `Decimal`-compatible strings
 * (the DB columns are `Decimal(12,3)` for quantities and `Decimal(12,2)` for the
 * cost) and `decimal.js` keeps arithmetic exact, matching the producto/compra
 * domains.
 *
 * The formula is frozen by the fase-3-4b inventario spec ("Company-wide
 * weighted-average cost on receipt"):
 *
 *   nuevoCP = (stockTotalEmpresa × CP + cantRecibida × costoUnitarioSinITBIS)
 *             / (stockTotalEmpresa + cantRecibida)
 *
 * Two properties the spec calls out and these tests lock:
 *   1. The denominator `stockTotalEmpresa` is the pre-receipt stock summed
 *      across ALL branches of the company (PRODUCTO.costoPromedio is a single
 *      company-wide column, not per branch). A branch-only denominator is a
 *      defect.
 *   2. `costoUnitarioSinITBIS` is the ITBIS-EXCLUSIVE net unit cost. The
 *      function does no fiscal gross-up; the caller passes the net basis, so a
 *      18/16/0 mixed receipt simply feeds net costs in.
 *
 * Rounding: money is `Decimal(12,2)`; the result is rounded half-up to 2 dp
 * (`toDecimalPlaces(2)` uses ROUND_HALF_UP by default), consistent with the
 * compra calculators.
 */

import { Decimal } from "decimal.js";

export interface CostoPromedioInput {
  /** Pre-receipt stock summed across ALL branches of the company (12,3). */
  readonly stockTotalEmpresa: string;
  /** Current company-wide average cost (12,2). */
  readonly costoPromedio: string;
  /** Received quantity on this entry (12,3), strictly positive at the caller. */
  readonly cantidadRecibida: string;
  /** Received unit cost EXCLUDING ITBIS (12,2). */
  readonly costoUnitarioSinItbis: string;
}

/**
 * Compute the new company-wide weighted-average cost after a purchase receipt,
 * given a single ITBIS-exclusive unit cost (the frozen spec formula).
 *
 * When the resulting denominator is zero (no company stock and nothing
 * received) there is nothing to reweight, so the current cost is returned
 * normalized to 2 dp rather than dividing by zero.
 *
 * @returns the new `costoPromedio` as a `Decimal(12,2)` half-up string.
 */
export function calcularNuevoCostoPromedio(input: CostoPromedioInput): string {
  // The received VALUE is `cantidadRecibida × costoUnitarioSinItbis`, computed
  // in exact Decimal arithmetic, then handed to the value-based form so the
  // single-line and aggregate (duplicate-product) paths share one rounding.
  const valorRecibido = new Decimal(input.cantidadRecibida).times(
    new Decimal(input.costoUnitarioSinItbis),
  );
  return calcularNuevoCostoPromedioPorValor({
    stockTotalEmpresa: input.stockTotalEmpresa,
    costoPromedio: input.costoPromedio,
    cantidadRecibida: input.cantidadRecibida,
    valorRecibidoSinItbis: valorRecibido.toString(),
  });
}

/** Input for the value-based (aggregate-capable) weighted-average cost. */
export interface CostoPromedioPorValorInput {
  /** Pre-receipt stock summed across ALL branches of the company (12,3). */
  readonly stockTotalEmpresa: string;
  /** Current company-wide average cost (12,2). */
  readonly costoPromedio: string;
  /** Total received quantity for this product (12,3); may aggregate lines. */
  readonly cantidadRecibida: string;
  /** Total received value EXCLUDING ITBIS (12,2-ish); may aggregate lines. */
  readonly valorRecibidoSinItbis: string;
}

/**
 * Value-based form of the weighted-average cost:
 *
 *   nuevoCP = (stockTotalEmpresa × CP + valorRecibidoSinITBIS)
 *             / (stockTotalEmpresa + cantRecibida)
 *
 * Feeding the received VALUE (not a pre-rounded unit cost) lets the caller
 * aggregate duplicate product lines into a single cost update without any
 * intermediate rounding drift — exactly the "one cost update, one movement per
 * line" requirement. The unit-based {@link calcularNuevoCostoPromedio} simply
 * derives `valorRecibido = cant × unit` in exact Decimal and delegates here, so
 * both paths perform a single half-up round at the very end.
 */
export function calcularNuevoCostoPromedioPorValor(
  input: CostoPromedioPorValorInput,
): string {
  const stock = new Decimal(input.stockTotalEmpresa);
  const cp = new Decimal(input.costoPromedio);
  const recibida = new Decimal(input.cantidadRecibida);
  const valor = new Decimal(input.valorRecibidoSinItbis);

  const denominador = stock.plus(recibida);
  if (denominador.isZero()) {
    return cp.toDecimalPlaces(2).toFixed(2);
  }

  const numerador = stock.times(cp).plus(valor);
  return numerador.dividedBy(denominador).toDecimalPlaces(2).toFixed(2);
}
