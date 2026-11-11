/**
 * Unit — Caja domain daily summary (06b, S2/S5). No database.
 *
 * Pins the Ventas / Costo de lo vendido / Margen bruto / Margen % figures the Resumen del día
 * board shows. Margen bruto = Ventas − Costo; Margen % = Margen ÷ Ventas × 100 at 1 decimal
 * half-up (the wireframe's "32.6%"), zero sales guarded to "0.0", and a negative margen kept
 * because cost above price is a real business signal, not an error to hide.
 */

import { calcularResumenDia } from "./resumen";

describe("calcularResumenDia — 06b Ventas, costo y margen bruto", () => {
  it("reproduces the wireframe example (128450.00 / 86540.00 → 41910.00 / 32.6%)", () => {
    expect(calcularResumenDia({ ventasTotal: "128450.00", costoVendido: "86540.00" })).toEqual({
      ventas: "128450.00",
      costoVendido: "86540.00",
      margenBruto: "41910.00",
      margenPorcentaje: "32.6",
    });
  });

  it("a zero day is all zeros (2 dp money, 1 dp percent)", () => {
    expect(calcularResumenDia({ ventasTotal: "0.00", costoVendido: "0.00" })).toEqual({
      ventas: "0.00",
      costoVendido: "0.00",
      margenBruto: "0.00",
      margenPorcentaje: "0.0",
    });
  });

  it("zero sales with a cost never divides by zero (margen % is 0.0 by contract)", () => {
    expect(calcularResumenDia({ ventasTotal: "0.00", costoVendido: "100.00" })).toEqual({
      ventas: "0.00",
      costoVendido: "100.00",
      margenBruto: "-100.00",
      margenPorcentaje: "0.0",
    });
  });

  it("preserves a NEGATIVE margen when cost exceeds sales (never clamped)", () => {
    expect(calcularResumenDia({ ventasTotal: "100.00", costoVendido: "150.00" })).toEqual({
      ventas: "100.00",
      costoVendido: "150.00",
      margenBruto: "-50.00",
      margenPorcentaje: "-50.0",
    });
  });

  it("a fully-costless day is a 100.0% margen", () => {
    expect(calcularResumenDia({ ventasTotal: "1000.00", costoVendido: "0.00" })).toEqual({
      ventas: "1000.00",
      costoVendido: "0.00",
      margenBruto: "1000.00",
      margenPorcentaje: "100.0",
    });
  });

  it("rounds the margin percentage half-up at 1 decimal", () => {
    // 326.50 / 1000 = 32.65% → 32.7 (half-up, not 32.6).
    expect(
      calcularResumenDia({ ventasTotal: "1000.00", costoVendido: "673.50" }).margenPorcentaje,
    ).toBe("32.7");
    // 325.50 / 1000 = 32.55% → 32.6.
    expect(
      calcularResumenDia({ ventasTotal: "1000.00", costoVendido: "674.50" }).margenPorcentaje,
    ).toBe("32.6");
    // 326.25 / 1000 = 32.625% → 32.6.
    expect(
      calcularResumenDia({ ventasTotal: "1000.00", costoVendido: "673.75" }).margenPorcentaje,
    ).toBe("32.6");
  });

  it("rounds the money figures half-up at 2 decimals", () => {
    expect(calcularResumenDia({ ventasTotal: "10.005", costoVendido: "0.00" })).toEqual({
      ventas: "10.01",
      costoVendido: "0.00",
      margenBruto: "10.01",
      margenPorcentaje: "100.0",
    });
  });

  it("keeps big money exact beyond JS number precision", () => {
    expect(
      calcularResumenDia({ ventasTotal: "1234567890123.45", costoVendido: "1234567890000.00" }),
    ).toEqual({
      ventas: "1234567890123.45",
      costoVendido: "1234567890000.00",
      margenBruto: "123.45",
      margenPorcentaje: "0.0",
    });
  });

  it("keeps the percentage below a half boundary at very large scale (precision pinned)", () => {
    // margen/ventas × 100 = 32.64999999999999999950… — 21 significant digits. decimal.js' default
    // precision of 20 would round it to 32.65 and print 32.7; the true 1-dp answer is 32.6.
    expect(
      calcularResumenDia({
        ventasTotal: "100000000000000000000.00",
        costoVendido: "67350000000000000000.50",
      }).margenPorcentaje,
    ).toBe("32.6");
  });

  it("normalises the emitted scales (money 2 dp, percent 1 dp)", () => {
    expect(calcularResumenDia({ ventasTotal: "1000", costoVendido: "500" })).toEqual({
      ventas: "1000.00",
      costoVendido: "500.00",
      margenBruto: "500.00",
      margenPorcentaje: "50.0",
    });
  });

  it("never prints -0.00 for a rounded-to-zero margen", () => {
    expect(
      calcularResumenDia({ ventasTotal: "1000.00", costoVendido: "1000.001" }).margenBruto,
    ).toBe("0.00");
  });
});
