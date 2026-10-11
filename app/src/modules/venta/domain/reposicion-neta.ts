/**
 * Pure net-reposition calculator for the CONFIRMED-sale cancellation (R-V16).
 *
 * Audit run-3 finding `venta:cancelar-venta-confirmada:reposicion-ignora-devoluciones-vigentes`
 * (probe `app/scripts/stock-shape.probe.ts`: a sale of 10 with a prior return of 4
 * re-credited the FULL +10 on cancel — VENDIBLE stock ended 4 units over the seed
 * (phantom credit), and a DANADO (merma-disposed) return came back as sellable
 * stock it no longer exists). Product decision (2026-10): "solo reposición neta" —
 * the cancel-time stock restore credits ONLY the units not already returned:
 *
 *   net = persisted DETALLE_VENTA.cantidad − Σ cantidad of every line of every
 *         VIGENTE NOTA_CREDITO against the same facturaOriginalId/productoId,
 *         regardless of TipoReposicion: a VENDIBLE return physically restocked the
 *         unit (re-crediting it under an ANULADA invoice would double-count it),
 *         and a DANADO return disposed the unit as merma (physically lost, so it
 *         must never come back either).
 *
 * A line whose net is ≤ 0 is dropped: the stock ledger never receives a negative
 * "reposition" (and there is no inventory to take back). Zero devoluciones leaves
 * every line unchanged (net = cantidad), so the helper is a no-op on the plain
 * cancel path. This is PURE arithmetic — the aggregation query itself lives in
 * the devolucion infrastructure (`leerPriorNCsPorFacturaEnTx`), called INSIDE the
 * cancel transaction; the FACTURA row lock the cancel already holds serializes it
 * against a concurrent return.
 */

import { Decimal } from "decimal.js";

/** One sale line entering the calculator (persisted `Decimal(12,3)` quantity). */
export interface LineaReposicion {
  readonly productoId: number;
  readonly cantidad: string;
}

/** Returned quantity per product (Decimal(12,3) semantics); absent product = 0. */
export type DevueltoPorProducto = ReadonlyMap<number, Decimal>;

/**
 * Net the sale lines against the credit-note returns: per distinct product,
 * `cantidad − devuelto` (absent → 0), keeping only strictly-positive nets.
 * Order of the input sale lines is preserved.
 */
export function calcularReposicionNeta(
  lineasVenta: readonly LineaReposicion[],
  devueltoPorProducto: DevueltoPorProducto,
): LineaReposicion[] {
  const netas: LineaReposicion[] = [];
  for (const linea of lineasVenta) {
    const devuelto = devueltoPorProducto.get(linea.productoId) ?? new Decimal(0);
    const neto = new Decimal(linea.cantidad).minus(devuelto);
    if (neto.greaterThan(0)) {
      netas.push({ productoId: linea.productoId, cantidad: neto.toFixed(3) });
    }
  }
  return netas;
}
