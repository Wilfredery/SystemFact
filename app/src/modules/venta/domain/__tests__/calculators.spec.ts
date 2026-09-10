/**
 * Domain unit tests — venta calculators (spec R-V5, R-V6, R-V8 pure part).
 * Fixtures F1–F4 are the canonical numbers from the venta spec; the property
 * matrix checks the mixed 18/16/0 DGII identities hold with decimal strings only
 * (no floats). Pure, no DB (ADR-013).
 */

import {
  calcularLineaVenta,
  calcularTotalesVenta,
  calcularVenta,
  validarLineaVenta,
} from "../calculators";
import {
  DESCUENTO_CERO,
  DESCUENTO_TIPO,
  type Descuento,
  type VentaLineaInput,
} from "../venta";

const LINEA_RE = /^-?\d{1,9}\.\d{2}$/;

function inp(
  productoId: number,
  cantidad: string,
  precioUnitario: string,
  descuento: Descuento = DESCUENTO_CERO,
): VentaLineaInput {
  return { productoId, cantidad, precioUnitario, descuento };
}

// ---------------------------------------------------------------------------
// Fixture F2 — mixed rates with line discounts, NO header discount (R-V5).
// ---------------------------------------------------------------------------
describe("Fixture F2 — per-line ITBIS + line discounts (R-V5)", () => {
  const l1 = calcularLineaVenta(
    inp(1, "7", "3.33", { descuentoTipo: DESCUENTO_TIPO.MONTO, descuentoValor: "5.00" }),
    "18",
  );
  const l2 = calcularLineaVenta(
    inp(2, "5", "4.15", { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "3" }),
    "16",
  );
  const l3 = calcularLineaVenta(inp(3, "2", "12.90"), "0");

  it("resolves gross bases and line-discount money exactly", () => {
    expect(l1.subtotalBruto).toBe("23.31");
    expect(l1.descuentoLinea).toBe("5.00");
    expect(l1.baseLinea).toBe("18.31");
    expect(l2.subtotalBruto).toBe("20.75");
    expect(l2.descuentoLinea).toBe("0.62"); // round2(20.75 × 3%) = round2(0.6225)
    expect(l2.baseLinea).toBe("20.13");
    expect(l3.baseLinea).toBe("25.80");
  });

  it("computes per-line ITBIS on the net base (3.30 / 3.22 / 0.00)", () => {
    expect(l1.itbisLinea).toBe("3.30");
    expect(l2.itbisLinea).toBe("3.22");
    expect(l3.itbisLinea).toBe("0.00");
  });

  it("stores subtotal 69.86, descuento 5.62, itbis 6.52, total 70.76", () => {
    const { totales } = calcularTotalesVenta([l1, l2, l3], DESCUENTO_CERO);
    expect(totales.subtotal).toBe("69.86");
    expect(totales.descuento).toBe("5.62");
    expect(totales.itbis).toBe("6.52");
    expect(totales.total).toBe("70.76"); // = Σ bases 64.24 + Σ ITBIS 6.52
    // Identity holds exactly.
    expect(totales.total).toBe(
      "70.76" /* 69.86 - 5.62 + 6.52 */,
    );
  });
});

// ---------------------------------------------------------------------------
// Fixture F1 — clean proration gravado + exento (R-V6).
// ---------------------------------------------------------------------------
describe("Fixture F1 — clean header proration (R-V6)", () => {
  it("shares 3.00/4.00 → bases 27.00/36.00, ITBIS 4.86/0.00, total 67.86", () => {
    const lines = [
      calcularLineaVenta(inp(1, "3", "10.00"), "18"),
      calcularLineaVenta(inp(2, "2", "20.00"), "0"),
    ];
    const { lineas, totales } = calcularTotalesVenta(lines, {
      descuentoTipo: DESCUENTO_TIPO.PORCENTAJE,
      descuentoValor: "10",
    });
    expect(lineas[0].descuentoCabeceraLinea).toBe("3.00");
    expect(lineas[1].descuentoCabeceraLinea).toBe("4.00");
    expect(lineas[0].baseFinal).toBe("27.00");
    expect(lineas[1].baseFinal).toBe("36.00");
    expect(lineas[0].itbisLinea).toBe("4.86");
    expect(lineas[1].itbisLinea).toBe("0.00");
    expect(totales.subtotalGravado).toBe("27.00");
    expect(totales.subtotalExento).toBe("36.00");
    expect(totales.total).toBe("67.86");
  });
});

// ---------------------------------------------------------------------------
// Fixture F3 — rounding remainder to the largest base, ties earliest (R-V6).
// ---------------------------------------------------------------------------
describe("Fixture F3 — remainder −0.01 to largest base (ties earliest)", () => {
  it("shares 2.62/1.75/2.63, ITBIS 7.85, total 80.85, identity exact", () => {
    const lines = [
      calcularLineaVenta(inp(1, "1", "30.00"), "18"),
      calcularLineaVenta(inp(2, "1", "20.00"), "16"),
      calcularLineaVenta(inp(3, "1", "30.00"), "0"),
    ];
    const { lineas, totales } = calcularTotalesVenta(lines, {
      descuentoTipo: DESCUENTO_TIPO.MONTO,
      descuentoValor: "7.00",
    });
    // Half-up raw shares 2.63/1.75/2.63 (Σ 7.01); −0.01 → earliest largest (line 0).
    expect(lineas.map((l) => l.descuentoCabeceraLinea)).toEqual([
      "2.62",
      "1.75",
      "2.63",
    ]);
    expect(lineas.map((l) => l.baseFinal)).toEqual(["27.38", "18.25", "27.37"]);
    expect(lineas.map((l) => l.itbisLinea)).toEqual(["4.93", "2.92", "0.00"]);
    expect(totales.subtotalGravado).toBe("45.63");
    expect(totales.subtotalExento).toBe("27.37");
    expect(totales.itbis).toBe("7.85");
    expect(totales.total).toBe("80.85"); // 80.00 - 7.00 + 7.85
    expect(totales.total).toBe("80.85");
    // Σ shares == D exactly (7.00), so the discount never drifts.
    const sumShares = lineas.reduce(
      (acc, l) => acc + Number(l.descuentoCabeceraLinea),
      0,
    );
    expect(sumShares.toFixed(2)).toBe("7.00");
  });
});

// ---------------------------------------------------------------------------
// Fixture F4 — DGII 4% boundary, pure math part (R-V8).
// ---------------------------------------------------------------------------
describe("Fixture F4 — 100.00 @18% with header 4% (R-V8 boundary)", () => {
  it("base 96.00, ITBIS 17.28, total 113.28", () => {
    const { totales } = calcularVenta(
      [{ linea: inp(1, "1", "100.00"), tasaItbis: "18" }],
      { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "4.00" },
    );
    expect(totales.descuentoCabecera).toBe("4.00");
    expect(totales.subtotalGravado).toBe("96.00");
    expect(totales.itbis).toBe("17.28");
    expect(totales.total).toBe("113.28");
  });
});

// ---------------------------------------------------------------------------
// Property-style matrix — 18/16/0 mix, decimal strings only, identities hold.
// ---------------------------------------------------------------------------
describe("Property-style matrix (R-V5 / R-V6 identities)", () => {
  const mix: {
    name: string;
    rates: string[];
    inputs: VentaLineaInput[];
    header: Descuento;
  }[] = [
    {
      name: "all gravado, no discount",
      rates: ["18", "16"],
      inputs: [inp(1, "1.500", "99.99"), inp(2, "2.250", "10.01")],
      header: DESCUENTO_CERO,
    },
    {
      name: "mixed gravado/exento with header %, line %, line monto",
      rates: ["18", "16", "0"],
      inputs: [
        inp(1, "3", "7.77", { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "5" }),
        inp(2, "4", "12.34", { descuentoTipo: DESCUENTO_TIPO.MONTO, descuentoValor: "1.11" }),
        inp(3, "5", "3.33"),
      ],
      header: { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "2.5" },
    },
    {
      name: "single exento with header monto",
      rates: ["0"],
      inputs: [inp(1, "7", "4.00")],
      header: { descuentoTipo: DESCUENTO_TIPO.MONTO, descuentoValor: "3.33" },
    },
  ];

  it.each(mix)("$name", ({ rates, inputs, header }) => {
    const lines = inputs.map((i, idx) => calcularLineaVenta(i, rates[idx]));
    const { lineas, totales } = calcularTotalesVenta(lines, header);

    // All money outputs are 2dp decimal strings — no floats leak through.
    for (const v of [
      totales.subtotal,
      totales.descuento,
      totales.itbis,
      totales.total,
      totales.subtotalGravado,
      totales.subtotalExento,
    ]) {
      expect(v).toMatch(LINEA_RE);
    }
    for (const l of lineas) {
      expect(l.baseFinal).toMatch(LINEA_RE);
      expect(l.itbisLinea).toMatch(LINEA_RE);
    }

    // Identity: total = subtotal − descuento + itbis (exact).
    const derived =
      Number(totales.subtotal) -
      Number(totales.descuento) +
      Number(totales.itbis);
    expect(totales.total).toBe(derived.toFixed(2));

    // gravado + exento == Σ final bases.
    const sumBases = lineas.reduce((a, l) => a + Number(l.baseFinal), 0);
    expect((Number(totales.subtotalGravado) + Number(totales.subtotalExento)).toFixed(2)).toBe(
      sumBases.toFixed(2),
    );

    // Σ shares == header money exactly (proration never drifts the discount).
    const sumShares = lineas.reduce(
      (a, l) => a + Number(l.descuentoCabeceraLinea),
      0,
    );
    expect(sumShares.toFixed(2)).toBe(totales.descuentoCabecera);

    // itbis == Σ per-line itbis.
    const sumItbis = lineas.reduce((a, l) => a + Number(l.itbisLinea), 0);
    expect(totales.itbis).toBe(sumItbis.toFixed(2));
  });

  it("returns the header discount resolved to money, never the raw percent", () => {
    const { totales } = calcularVenta(
      [{ linea: inp(1, "1", "100.00"), tasaItbis: "18" }],
      { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "12.5" },
    );
    expect(totales.descuentoCabecera).toBe("12.50");
    expect(totales.descuento).toBe("12.50");
  });
});

// ---------------------------------------------------------------------------
// Line validator — invalid shapes map to LINEA_INVALIDA.
// ---------------------------------------------------------------------------
describe("validarLineaVenta (R-V1 line shapes)", () => {
  it("accepts a well-formed line", () => {
    expect(validarLineaVenta(inp(1, "2.000", "100.00"), "18")).toBeNull();
  });
  it("rejects quantity ≤ 0", () => {
    expect(validarLineaVenta(inp(1, "0", "100.00"), "18")).toBe("LINEA_INVALIDA");
    expect(validarLineaVenta(inp(1, "-1", "100.00"), "18")).toBe("LINEA_INVALIDA");
  });
  it("rejects negative price", () => {
    expect(validarLineaVenta(inp(1, "1", "-0.01"), "18")).toBe("LINEA_INVALIDA");
  });
  it("rejects an ITBIS rate outside 18 / 16 / 0", () => {
    expect(validarLineaVenta(inp(1, "1", "10.00"), "12")).toBe("LINEA_INVALIDA");
  });
});
