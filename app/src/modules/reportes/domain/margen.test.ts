/**
 * Unit tests — reportes rentabilidad domain math (REN-1; slice D).
 *
 * Pure, no database (design "Domain tests run with no database"): every assertion pins a REN-1
 * formula to the cent/unit with `decimal.js` semantics, and exercises the two zero-edge cases the
 * spec calls out (zero units sold → weighted price `0.00`; zero sales → margin % `0.00`).
 */

import { Decimal } from "decimal.js";
import {
  calcularCapital,
  calcularMargen,
  calcularMargenPorciento,
  calcularPrecioSalida,
  calcularFilaRentabilidad,
  resumirRentabilidad,
  NOTA_LIMITACION_RENTABILIDAD,
  type RentabilidadInsumo,
} from "./margen";

describe("reportes rentabilidad domain — weighted output price (REN-1)", () => {
  it("is the cantidad-weighted mean of the sold unit prices (Σ qty×price ÷ Σ qty)", () => {
    // The spec scenario: 10u @ 100 and 40u @ 90 → (1000 + 3600) / 50 = 92.
    expect(
      calcularPrecioSalida({ ventasBrutas: "4600.00", unidadesVendidas: "50.000" }),
    ).toBe("92.00");
  });

  it("weights unequal quantities correctly (3u @ 10 + 7u @ 20 → 17.00)", () => {
    // (3×10 + 7×20) / 10 = 170 / 10 = 17.
    expect(
      calcularPrecioSalida({ ventasBrutas: "170.00", unidadesVendidas: "10.000" }),
    ).toBe("17.00");
  });

  it("a zero-sold product has no realized output price → 0.00 (never ÷0)", () => {
    expect(
      calcularPrecioSalida({ ventasBrutas: "0.00", unidadesVendidas: "0.000" }),
    ).toBe("0.00");
  });

  it("keeps Decimal(12,2) precision — no float drift", () => {
    // 1u @ 10.18 → exactly 10.18 (a float sum of 0.1-style parts must never appear).
    expect(
      calcularPrecioSalida({ ventasBrutas: "10.18", unidadesVendidas: "1.000" }),
    ).toBe("10.18");
    // 33.33 + 2×100 = 233.33 over 3 units → 77.7766… → half-up to 77.78.
    expect(
      calcularPrecioSalida({ ventasBrutas: "233.33", unidadesVendidas: "3.000" }),
    ).toBe("77.78");
  });
});

describe("reportes rentabilidad domain — margin and margin % (REN-1)", () => {
  it("Ventas − (Salida × costoPromedio); the spec scenario reconciled", () => {
    // 10u @ 100 + 40u @ 90 (Ventas 4600), costo 60, Salida 50 → 4600 − 50×60 = 1600.
    // NOTE: the spec scenario's "5,000 − 50×60 = 2,000" is an arithmetic slip — with the pinned
    // weighted price 92 the sales amount is 50 × 92 = 4,600, NOT 5,000. The REN-1 formula
    // (`Ventas − Salida × costoPromedio`) governs; both agree on the weighted price 92.00.
    expect(
      calcularMargen({ ventasBrutas: "4600.00", unidadesVendidas: "50.000", costoPromedio: "60.00" }),
    ).toBe("1600.00");
  });

  it("margin % of ventas with the matching figure (1600 / 4600 × 100 = 34.78)", () => {
    expect(calcularMargenPorciento({ margen: "1600.00", ventasBrutas: "4600.00" })).toBe(
      "34.78",
    );
  });

  it("a simple all-one-price sale yields that price's margin (1000 − 10×60 = 400, 40%)", () => {
    expect(
      calcularMargen({ ventasBrutas: "1000.00", unidadesVendidas: "10.000", costoPromedio: "60.00" }),
    ).toBe("400.00");
    expect(calcularMargenPorciento({ margen: "400.00", ventasBrutas: "1000.00" })).toBe("40.00");
  });

  it("a cost above the output price yields a NEGATIVE margin (a loss), never clamped to 0", () => {
    // Ventas 100, Salida 5, costo 30 → 100 − 150 = −50; % = −50 / 100 × 100 = −50.
    expect(
      calcularMargen({ ventasBrutas: "100.00", unidadesVendidas: "5.000", costoPromedio: "30.00" }),
    ).toBe("-50.00");
    expect(calcularMargenPorciento({ margen: "-50.00", ventasBrutas: "100.00" })).toBe("-50.00");
  });

  it("zero sales → zero margin %, no division by zero", () => {
    expect(calcularMargenPorciento({ margen: "0.00", ventasBrutas: "0.00" })).toBe("0.00");
  });
});

describe("reportes rentabilidad domain — capital (REN-1)", () => {
  it("current stock × current costoPromedio", () => {
    expect(calcularCapital({ stockActual: "10.000", costoPromedio: "2.50" })).toBe("25.00");
  });

  it("zero stock → zero capital even with a positive cost", () => {
    expect(calcularCapital({ stockActual: "0.000", costoPromedio: "99.99" })).toBe("0.00");
  });
});

describe("reportes rentabilidad domain — full row composition (REN-1)", () => {
  const baseInsumo: RentabilidadInsumo = {
    productoId: 7,
    nombre: "Arroz",
    costoPromedio: "60.00",
    unidadesVendidas: "50.000",
    ventasBrutas: "4600.00",
    unidadesCompradas: "80.000",
    inversion: "4800.00",
    stockActual: "30.000",
  };

  it("derives every pinned figure from the raw aggregated inputs", () => {
    const fila = calcularFilaRentabilidad(baseInsumo);
    expect(fila.precioCosto).toBe("60.00");
    expect(fila.precioSalida).toBe("92.00"); // weighted (1000+3600)/50
    expect(fila.unidadesVendidas).toBe("50.000"); // Salida
    expect(fila.unidadesCompradas).toBe("80.000"); // Entrada
    expect(fila.ventas).toBe("4600.00");
    expect(fila.inversion).toBe("4800.00");
    expect(fila.capital).toBe("1800.00"); // 30 × 60
    expect(fila.margen).toBe("1600.00"); // 4600 − 50×60
    expect(fila.margenPorciento).toBe("34.78");
  });

  it("a purchase-only product (no sales): salida 0, margin 0, % 0, capital still reported", () => {
    const fila = calcularFilaRentabilidad({
      ...baseInsumo,
      unidadesVendidas: "0.000",
      ventasBrutas: "0.00",
    });
    expect(fila.precioSalida).toBe("0.00");
    expect(fila.margen).toBe("0.00");
    expect(fila.margenPorciento).toBe("0.00");
    expect(fila.ventas).toBe("0.00");
    expect(fila.capital).toBe("1800.00");
  });
});

describe("reportes rentabilidad domain — report summary (EXP-2 page-independence)", () => {
  it("Σ across rows with an aggregate margin % and product count", () => {
    const filas = [
      calcularFilaRentabilidad({
        productoId: 1,
        nombre: "A",
        costoPromedio: "60.00",
        unidadesVendidas: "50.000",
        ventasBrutas: "4600.00",
        unidadesCompradas: "80.000",
        inversion: "4800.00",
        stockActual: "30.000",
      }),
      calcularFilaRentabilidad({
        productoId: 2,
        nombre: "B",
        costoPromedio: "10.00",
        unidadesVendidas: "10.000",
        ventasBrutas: "1000.00",
        unidadesCompradas: "10.000",
        inversion: "100.00",
        stockActual: "0.000",
      }),
    ];
    const r = resumirRentabilidad(filas);
    expect(r.unidadesVendidas).toBe("60.000");
    expect(r.unidadesCompradas).toBe("90.000");
    expect(r.ventas).toBe("5600.00");
    expect(r.inversion).toBe("4900.00");
    expect(r.capital).toBe("1800.00"); // A 1800 + B 0
    expect(r.margen).toBe("2500.00"); // A 1600 + B (1000 − 10×10 = 900)
    expect(r.margenPorciento).toBe("44.64"); // 2500 / 5600 × 100
    expect(r.productos).toBe("2");
    // The summary money is Decimal-string at the 2-dp scale (never a JS float artefact).
    expect(new Decimal(r.ventas).equals("5600")).toBe(true);
  });

  it("an empty row set sums to zero and never divides (margen % = 0.00)", () => {
    const r = resumirRentabilidad([]);
    expect(r.ventas).toBe("0.00");
    expect(r.margen).toBe("0.00");
    expect(r.margenPorciento).toBe("0.00");
    expect(r.productos).toBe("0");
  });
});

describe("reportes rentabilidad domain — cost-basis limitation (REN-3)", () => {
  it("exposes a single frozen disclaimer mentioning the current cost and non-historical caveat", () => {
    expect(NOTA_LIMITACION_RENTABILIDAD).toContain("costo promedio");
    expect(NOTA_LIMITACION_RENTABILIDAD).toContain("no son históricas");
    expect(NOTA_LIMITACION_RENTABILIDAD).toContain("DetalleVenta");
  });
});
