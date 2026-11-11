/**
 * Unit — Caja UI presentation helpers (S7). Pure functions, no DOM.
 *
 * The screen never computes money with JS floats: these helpers only FORMAT the Decimal strings
 * the DTOs carry (sign, method label, method-sum via decimal.js, margin suffix) so the island has
 * one home for every displayed figure.
 */

import {
  esMontoNegativo,
  etiquetaMetodo,
  formatearMargen,
  formatearMontoConSigno,
  sumarMontos,
} from "../caja-formato";

describe("formatearMontoConSigno — Diferencia keeps its sign (S1)", () => {
  it("formats a positive Decimal string like the shared money formatter", () => {
    expect(formatearMontoConSigno("1234.50")).toBe("RD$ 1,234.50");
    expect(formatearMontoConSigno("0.00")).toBe("RD$ 0.00");
  });

  it("keeps the sign in front of the currency for a negative value", () => {
    expect(formatearMontoConSigno("-499.50")).toBe("-RD$ 499.50");
    expect(formatearMontoConSigno("-0.01")).toBe("-RD$ 0.01");
  });

  it("treats any non-negative input as positive (no stray sign)", () => {
    expect(formatearMontoConSigno("2000.00")).not.toContain("-");
  });
});

describe("esMontoNegativo — styling predicate", () => {
  it("is true only for a negative Decimal string", () => {
    expect(esMontoNegativo("-499.50")).toBe(true);
    expect(esMontoNegativo("-0.01")).toBe(true);
    expect(esMontoNegativo("0.00")).toBe(false);
    expect(esMontoNegativo("499.50")).toBe(false);
  });
});

describe("etiquetaMetodo — wireframe row label", () => {
  it("renders the frozen enum value as a Spanish label", () => {
    expect(etiquetaMetodo("EFECTIVO")).toBe("Efectivo");
  });

  it("falls back to a readable label instead of hiding an unknown method", () => {
    expect(etiquetaMetodo("TRANSFERENCIA")).toBe("Transferencia");
    expect(etiquetaMetodo("TARJETA_CREDITO")).toBe("Tarjeta credito");
  });
});

describe("sumarMontos — the Total row's Cobros cell", () => {
  it("adds Decimal strings exactly (no float drift)", () => {
    expect(sumarMontos(["0.10", "0.20"])).toBe("0.30");
    expect(sumarMontos(["1500.50"])).toBe("1500.50");
    expect(sumarMontos(["1500.50", "999.50"])).toBe("2500.00");
  });

  it("returns a two-decimal zero for an empty day", () => {
    expect(sumarMontos([])).toBe("0.00");
  });
});

describe("formatearMargen — the 06b 'Margen %' cell", () => {
  it("appends the percent sign to the DTO's 1-decimal string", () => {
    expect(formatearMargen("32.6")).toBe("32.6%");
  });

  it("renders the zero-sales day state", () => {
    expect(formatearMargen("0.0")).toBe("0.0%");
  });
});
