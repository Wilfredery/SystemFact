/**
 * Unit tests — 607 payment-mode cross-foot and the B02 consumption threshold (FIS-3; task 5.1).
 *
 * PURE (no DB). Pins the two 607 fiscal invariants the exporter must never violate:
 *   - CROSS-FOOT: Σ(D17..D23) == the invoice GROSS total (incl. ITBIS) to the CENT (spec FIS-3
 *     "Payment-mode cross-foot" scenario: cash + card + credit split sums exactly);
 *   - B02 BOUNDARY: consumo invoices detail ONLY at ≥ the threshold, boundary INCLUSIVE (spec FIS-3
 *     scenario RD$250,000.00 IN vs RD$249,999.00 OUT); the threshold is a passed-in PERIOD PARAM
 *     (never hardcoded), so the test feeds it like the repository would from `ConfiguracionEmpresa`.
 */

import {
  debeDetallarseEn607,
  distribuirFormasPago607,
  esComprobanteDeVenta607,
  verificarCrucePagos607,
} from "./pagos-607";

describe("dgii/pagos-607 — cross-foot to the gross total (FIS-3)", () => {
  it("a fully-cash invoice puts the whole gross in D17 and zeros D20", () => {
    const formas = distribuirFormasPago607({ totalBruto: "1180.00", cobrosEfectivo: "1180.00" });
    expect(formas.efectivo).toBe("1180.00");
    expect(formas.ventaCredito).toBe("0.00");
    expect(() => verificarCrucePagos607(formas, "1180.00")).not.toThrow();
  });

  it("a partially-collected invoice splits cash + remaining credit and STILL cross-foots", () => {
    // 500 cash collected of a 1180 gross invoice → D17 500 + D20 680 == 1180.
    const formas = distribuirFormasPago607({ totalBruto: "1180.00", cobrosEfectivo: "500.00" });
    expect(formas.efectivo).toBe("500.00");
    expect(formas.ventaCredito).toBe("680.00");
    expect(() => verificarCrucePagos607(formas, "1180.00")).not.toThrow();
  });

  it("an entirely-credit invoice leaves D17 at zero and D20 at the full gross", () => {
    const formas = distribuirFormasPago607({ totalBruto: "3540.00", cobrosEfectivo: "0.00" });
    expect(formas.efectivo).toBe("0.00");
    expect(formas.ventaCredito).toBe("3540.00");
    expect(() => verificarCrucePagos607(formas, "3540.00")).not.toThrow();
  });

  it("the cent-level cross-foot holds for a fractional total (no rounding tail)", () => {
    const formas = distribuirFormasPago607({ totalBruto: "10.18", cobrosEfectivo: "3.33" });
    expect(formas.efectivo).toBe("3.33");
    expect(formas.ventaCredito).toBe("6.85");
    expect(() => verificarCrucePagos607(formas, "10.18")).not.toThrow();
  });

  it("a cash figure exceeding the gross is clamped to the total (credit never negative)", () => {
    const formas = distribuirFormasPago607({ totalBruto: "100.00", cobrosEfectivo: "150.00" });
    expect(formas.efectivo).toBe("100.00");
    expect(formas.ventaCredito).toBe("0.00");
    expect(() => verificarCrucePagos607(formas, "100.00")).not.toThrow();
  });

  it("the guard THROWS when a row's columns do not sum to the gross (a defect, fail-fast)", () => {
    const formas = distribuirFormasPago607({ totalBruto: "100.00", cobrosEfectivo: "40.00" });
    // Tamper one column so the Σ no longer equals the gross → verificar must throw.
    expect(() => verificarCrucePagos607({ ...formas, bonos: "1.00" }, "100.00")).toThrow(
      /cross-foot/,
    );
  });
});

describe("dgii/pagos-607 — B02 consumption threshold, boundary inclusive (FIS-3 scenario)", () => {
  const UMBRAL = "250000.00"; // the ConfiguracionEmpresa-sourced period parameter
  it("B01/B03/B04 are ALWAYS detailed regardless of amount", () => {
    expect(debeDetallarseEn607({ tipoNcf: "B01", totalBruto: "10.00", umbralB02: UMBRAL })).toBe(true);
    expect(debeDetallarseEn607({ tipoNcf: "B03", totalBruto: "0.00", umbralB02: UMBRAL })).toBe(true);
    expect(debeDetallarseEn607({ tipoNcf: "B04", totalBruto: "0.00", umbralB02: UMBRAL })).toBe(true);
  });
  it("B02 at EXACTLY the threshold is INCLUSIVE (detail row)", () => {
    expect(debeDetallarseEn607({ tipoNcf: "B02", totalBruto: "250000.00", umbralB02: UMBRAL })).toBe(true);
  });
  it("B02 one cent below the threshold is excluded", () => {
    expect(debeDetallarseEn607({ tipoNcf: "B02", totalBruto: "249999.99", umbralB02: UMBRAL })).toBe(false);
    // The spec scenario's literal figures: 250,000.00 in, 249,999.00 out.
    expect(debeDetallarseEn607({ tipoNcf: "B02", totalBruto: "249999.00", umbralB02: UMBRAL })).toBe(false);
  });
  it("a non-sales NCF (B11) is never a 607 detail row", () => {
    expect(debeDetallarseEn607({ tipoNcf: "B11", totalBruto: "999999.00", umbralB02: UMBRAL })).toBe(false);
  });
});

describe("dgii/pagos-607 — esComprobanteDeVenta607 (scope filter before the B02 predicate)", () => {
  it("accepts the four sales-document types and rejects everything else", () => {
    for (const t of ["B01", "B02", "B03", "B04"]) expect(esComprobanteDeVenta607(t)).toBe(true);
    for (const t of ["B11", "B15", "", "b01"]) expect(esComprobanteDeVenta607(t)).toBe(false);
  });
});
