/**
 * Unit — reportes comparativa window + variation (FIN-5, slice C).
 *
 * Pure: no DB. The FIN-5 scenario fixes the preceding-window behaviour (a full SD March window
 * → a full SD February baseline) and the zero-baseline percentage rule (no division by zero).
 * Variation is checked as exact Decimal strings (never a JS float).
 */

import {
  ventanaPrecedenteMes,
  calcularVariacion,
} from "./ventana-comparativa";

describe("ventanaPrecedenteMes (FIN-5 equal-length preceding SD window)", () => {
  it("a full March window shifts to a full February baseline", () => {
    const anterior = ventanaPrecedenteMes({ desde: "2026-03-01", hasta: "2026-03-31" });
    expect(anterior).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
  });

  it("a mid-month window shifts both endpoints by exactly one month", () => {
    const anterior = ventanaPrecedenteMes({ desde: "2026-03-15", hasta: "2026-03-20" });
    expect(anterior).toEqual({ desde: "2026-02-15", hasta: "2026-02-20" });
  });

  it("January wraps to December of the previous year", () => {
    const anterior = ventanaPrecedenteMes({ desde: "2026-01-01", hasta: "2026-01-31" });
    expect(anterior).toEqual({ desde: "2025-12-01", hasta: "2025-12-31" });
  });

  it("March 31 clamps to February 29 in a leap year", () => {
    const anterior = ventanaPrecedenteMes({ desde: "2024-03-01", hasta: "2024-03-31" });
    expect(anterior).toEqual({ desde: "2024-02-01", hasta: "2024-02-29" });
  });

  it("a one-day window at month start still shifts back by exactly one month", () => {
    const anterior = ventanaPrecedenteMes({ desde: "2026-05-01", hasta: "2026-05-01" });
    expect(anterior).toEqual({ desde: "2026-04-01", hasta: "2026-04-01" });
  });
});

describe("calcularVariacion (FIN-5 Decimal-safe percentage)", () => {
  it("a positive baseline computes both monto and % variation", () => {
    const r = calcularVariacion({ montoActual: "150.00", montoAnterior: "100.00" });
    expect(r.montoActual).toBe("150.00");
    expect(r.montoAnterior).toBe("100.00");
    expect(r.variacionMonto).toBe("50.00");
    expect(r.variacionPorciento).toBe("50.00");
  });

  it("a decrease carries a negative monto and a negative percentage", () => {
    const r = calcularVariacion({ montoActual: "80.00", montoAnterior: "100.00" });
    expect(r.variacionMonto).toBe("-20.00");
    expect(r.variacionPorciento).toBe("-20.00");
  });

  it("a zero preceding baseline → percentage exactly 0.00 while the monto still reports the delta", () => {
    const r = calcularVariacion({ montoActual: "250.00", montoAnterior: "0.00" });
    expect(r.variacionMonto).toBe("250.00");
    expect(r.variacionPorciento).toBe("0.00");
  });

  it("both zeros → monto and percentage are exactly 0.00", () => {
    const r = calcularVariacion({ montoActual: "0.00", montoAnterior: "0.00" });
    expect(r.variacionMonto).toBe("0.00");
    expect(r.variacionPorciento).toBe("0.00");
  });

  it("a fractional percentage normalises to the Decimal(12,2) money scale", () => {
    const r = calcularVariacion({ montoActual: "10.00", montoAnterior: "3.00" });
    // 10/3 - 1 = 233.333…% → clamped to two decimals.
    expect(r.variacionPorciento).toBe("233.33");
    expect(r.variacionMonto).toBe("7.00");
  });
});
