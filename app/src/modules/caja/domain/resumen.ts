/**
 * Caja domain — "Resumen del día — Ventas, costo y margen bruto" (06b, S2/S5).
 *
 * ADR-013: pure TypeScript. No imports from Next.js, React, Prisma or Supabase. The Ventas and
 * Costo de lo vendido inputs arrive already SQL-aggregated as `Decimal(12,2)` STRINGS (the cost
 * from `Producto.costoPromedio` at sale time, per S5/S6), and every emitted figure is a string too
 * — never a JS float (AGENTS.md "Money = Decimal").
 *
 * Formulas (S5, the 06b wireframe):
 *
 *   margenBruto      = ventas − costoVendido
 *   margenPorcentaje = margenBruto ÷ ventas × 100   (1 dp, half-up — the wireframe's "32.6%")
 *
 * Two deliberate behaviours:
 * - ventas = 0 → margen % is exactly `"0.0"`. A zero-sales day has no percentage, and dividing by
 *   zero would hand the screen a NaN/Infinity.
 * - A NEGATIVE margin is preserved. Cost above price is a real business signal (a loss), not an
 *   input error to clamp or hide.
 */

import { aDinero, aUnDecimal, MOTOR_DECIMAL } from "./decimal";

/** The four 06b KPIs — money at `Decimal(12,2)`, the percentage at 1 decimal. */
export interface ResumenDia {
  /** Ventas del día (Σ total of CONFIRMADA ventas), `Decimal(12,2)` string. */
  readonly ventas: string;
  /** Costo de lo vendido (Σ quantity × costoPromedio), `Decimal(12,2)` string. */
  readonly costoVendido: string;
  /** `ventas − costoVendido`, `Decimal(12,2)` string; negative is a loss. */
  readonly margenBruto: string;
  /** `margenBruto ÷ ventas × 100` at 1 dp; `"0.0"` when ventas = 0. */
  readonly margenPorcentaje: string;
}

/**
 * Compute the 06b KPIs from the day's aggregated sales and cost of goods sold. The percentage is
 * derived from the UNROUNDED margin so the rounding happens exactly once, at the display scale.
 */
export function calcularResumenDia(datos: {
  readonly ventasTotal: string;
  readonly costoVendido: string;
}): ResumenDia {
  const ventas = new MOTOR_DECIMAL(datos.ventasTotal);
  const costoVendido = new MOTOR_DECIMAL(datos.costoVendido);
  const margenBruto = ventas.minus(costoVendido);

  return {
    ventas: aDinero(ventas),
    costoVendido: aDinero(costoVendido),
    margenBruto: aDinero(margenBruto),
    margenPorcentaje: ventas.isZero()
      ? "0.0"
      : aUnDecimal(margenBruto.div(ventas).times(100)),
  };
}
