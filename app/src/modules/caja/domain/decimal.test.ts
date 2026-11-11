/**
 * Unit — Caja domain Decimal seam (S5). No database.
 *
 * Pins the ONE money/percentage rounding policy the whole Caja module shares: half-up at the
 * declared scale, a precision high enough that a long division never rounds before the display
 * scale is applied (decimal.js defaults to 20 significant digits), and no `-0.00` ever reaching
 * the screen.
 */

import { Decimal } from "decimal.js";
import { aDinero, aUnDecimal, MOTOR_DECIMAL } from "./decimal";

describe("caja decimal — money scale (2 dp, half-up)", () => {
  it("rounds exactly .005 up (half-up, not banker's rounding)", () => {
    expect(aDinero("0.005")).toBe("0.01");
  });

  it("rounds .015 up and 2.675 up (the classic binary-float trap)", () => {
    expect(aDinero("0.015")).toBe("0.02");
    // Number(2.675) is 2.67499999999999982…; Decimal keeps the written value.
    expect(aDinero("2.675")).toBe("2.68");
  });

  it("rounds a half-down-below case down (0.0049 → 0.00)", () => {
    expect(aDinero("0.0049")).toBe("0.00");
  });

  it("always emits the fixed 2-decimal scale", () => {
    expect(aDinero("1000")).toBe("1000.00");
    expect(aDinero("0")).toBe("0.00");
    expect(aDinero("-7.5")).toBe("-7.50");
  });

  it("keeps money beyond JS number precision intact", () => {
    // 1234567890123.45 is NOT representable as a float (…3.449999…); Decimal is exact.
    expect(aDinero("1234567890123.45")).toBe("1234567890123.45");
    expect(aDinero("999999999999.99")).toBe("999999999999.99");
  });

  it("normalises negative zero so the screen never prints -0.00", () => {
    expect(aDinero("-0.001")).toBe("0.00");
    expect(aDinero("-0")).toBe("0.00");
  });
});

describe("caja decimal — percentage scale (1 dp, half-up)", () => {
  it("rounds exactly .05 up (32.65 → 32.7)", () => {
    expect(aUnDecimal("32.65")).toBe("32.7");
  });

  it("rounds 32.649 down to 32.6 and 32.55 up to 32.6", () => {
    expect(aUnDecimal("32.649")).toBe("32.6");
    expect(aUnDecimal("32.55")).toBe("32.6");
  });

  it("preserves a negative percentage (a real loss)", () => {
    expect(aUnDecimal("-50")).toBe("-50.0");
    expect(aUnDecimal("-5.44")).toBe("-5.4");
  });

  it("normalises negative zero so the screen never prints -0.0", () => {
    expect(aUnDecimal("-0.001")).toBe("0.0");
    expect(aUnDecimal("-0")).toBe("0.0");
  });

  it("pins a precision strictly wider than the library default, half-up", () => {
    // Guard the seam itself: 20 significant digits is the default that causes the gotcha
    // exercised end-to-end in resumen.test.ts (a long division rounding before the display dp).
    expect(Decimal.precision).toBe(20);
    expect(MOTOR_DECIMAL.precision).toBe(34);
    expect(MOTOR_DECIMAL.rounding).toBe(Decimal.ROUND_HALF_UP);
  });
});
