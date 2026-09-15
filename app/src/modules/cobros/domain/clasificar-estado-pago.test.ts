/**
 * Unit — pure payment-state classifier (R-B2).
 *
 * `decimal.js` inputs only; no DB. Covers the spec's PARCIAL example
 * (5,000.00 applied on 15,000.00) plus the PENDIENTE/PAGADA boundaries and the
 * over-application edge that must still read as PAGADA.
 */

import { Decimal } from "decimal.js";
import { clasificarEstadoPago } from "./clasificar-estado-pago";
import { ESTADO_PAGO_DERIVADO } from "./pago";

const d = (s: string): Decimal => new Decimal(s);

describe("clasificarEstadoPago (R-B2)", () => {
  it("PENDIENTE when nothing is applied", () => {
    expect(clasificarEstadoPago(d("0.00"), d("15000.00"))).toBe(
      ESTADO_PAGO_DERIVADO.PENDIENTE,
    );
  });

  it("PARCIAL at 5,000.00 applied on a 15,000.00 invoice (spec scenario)", () => {
    expect(clasificarEstadoPago(d("5000.00"), d("15000.00"))).toBe(
      ESTADO_PAGO_DERIVADO.PARCIAL,
    );
  });

  it("PAGADA when applied exactly equals the total", () => {
    expect(clasificarEstadoPago(d("15000.00"), d("15000.00"))).toBe(
      ESTADO_PAGO_DERIVADO.PAGADA,
    );
  });

  it("PAGADA when applied exceeds the total (guards never let PARCIAL leak)", () => {
    expect(clasificarEstadoPago(d("15000.01"), d("15000.00"))).toBe(
      ESTADO_PAGO_DERIVADO.PAGADA,
    );
  });

  it("PENDIENTE for a zero/negative applied total", () => {
    expect(clasificarEstadoPago(d("-1.00"), d("100.00"))).toBe(
      ESTADO_PAGO_DERIVADO.PENDIENTE,
    );
  });
});
