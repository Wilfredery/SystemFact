/**
 * Caja domain — the module's ONE Decimal seam (S5).
 *
 * AGENTS.md "Money = Decimal": every figure crossing this module is a Decimal STRING, never a
 * JS float. Two policies are pinned here so no function in the module can drift from them:
 *
 * - SCALE: money is emitted at `Decimal(12,2)` and percentages at 1 decimal (the wireframe's
 *   "32.6%"), both rounded HALF-UP — the DGII/display convention (`0.005 → 0.01`), which is
 *   also decimal.js' default but is stated explicitly rather than inherited.
 * - PRECISION: a local `Decimal` clone with 34 significant digits. decimal.js defaults to 20,
 *   and its `div`/`times` chain rounds the INTERMEDIATE result to that width — so a percentage
 *   like `32.64999999999999999950` would become `32.65` and print `32.7`, one tenth off the true
 *   answer. Cloning locally (rather than `Decimal.set`) keeps the rest of the app untouched.
 *
 * Negative zero is normalised to `"0.00"` / `"0.0"`: `-0.00` on a cash close reads like a bug.
 */

import { Decimal } from "decimal.js";

/** The module-local Decimal constructor: 34 significant digits, half-up rounding. */
export const MOTOR_DECIMAL = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
});

/** `Decimal(12,2)` money string — half-up at 2 dp, fixed scale, never `-0.00`. */
export function aDinero(valor: Decimal.Value): string {
  const d = new MOTOR_DECIMAL(valor).toDecimalPlaces(2, MOTOR_DECIMAL.ROUND_HALF_UP);
  return d.isZero() ? "0.00" : d.toFixed(2);
}

/** Percentage string at 1 dp — half-up, fixed scale, never `-0.0`. */
export function aUnDecimal(valor: Decimal.Value): string {
  const d = new MOTOR_DECIMAL(valor).toDecimalPlaces(1, MOTOR_DECIMAL.ROUND_HALF_UP);
  return d.isZero() ? "0.0" : d.toFixed(1);
}
