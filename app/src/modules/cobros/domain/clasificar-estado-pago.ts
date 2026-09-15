/**
 * Pure payment-state classifier (R-B2, ADR-017).
 *
 * No DB, no Prisma, no I/O — `decimal.js` Decimal inputs only, so it runs in a
 * plain unit test. The derived state is a FUNCTION of the applied cobros and the
 * invoice total, never a stored column: the board, estado de cuenta and credit
 * gate all call this single classifier over the canonical aggregate row.
 */

import { Decimal } from "decimal.js";
import { ESTADO_PAGO_DERIVADO, type EstadoPagoDerivado } from "./pago";

/**
 * Map the applied APLICADO cobros against the invoice total:
 *   applied ≤ 0            → `PENDIENTE`
 *   0 < applied < total    → `PARCIAL`
 *   applied ≥ total        → `PAGADA`
 *
 * `aplicado ≥ total` (not `equals`) is deliberate: a balance can only be driven
 * to or past the total by legitimate over-application guards already enforced in
 * the use case, so the classifier must never report `PARCIAL` for a settled
 * invoice. A zero/negative applied total is `PENDIENTE`.
 */
export function clasificarEstadoPago(
  aplicado: Decimal,
  total: Decimal,
): EstadoPagoDerivado {
  if (aplicado.lessThanOrEqualTo(0)) {
    return ESTADO_PAGO_DERIVADO.PENDIENTE;
  }
  if (aplicado.greaterThanOrEqualTo(total)) {
    return ESTADO_PAGO_DERIVADO.PAGADA;
  }
  return ESTADO_PAGO_DERIVADO.PARCIAL;
}
