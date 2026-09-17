/**
 * Unit — the pure stock-state classifier (OP-3 flag). No DB.
 *
 * The same semantics the dashboard rollup uses, expressed once: agotado at/below zero,
 * bajo strictly positive but at/below `stockMinimo`, otherwise normal. Compared with
 * `decimal.js` so a `0.000` and a `0.001` never collapse (no float).
 */

import { clasificarStock } from "./operacional";

describe("reportes/domain/operacional — clasificarStock (OP-3)", () => {
  it("is AGOTADO at or below zero", () => {
    expect(clasificarStock("0.000", 5)).toBe("AGOTADO");
    expect(clasificarStock("-1.000", 5)).toBe("AGOTADO");
  });

  it("is BAJO when 0 < cantidad <= stockMinimo", () => {
    expect(clasificarStock("5.000", 5)).toBe("BAJO");
    expect(clasificarStock("2.000", 5)).toBe("BAJO");
  });

  it("is NORMAL above stockMinimo", () => {
    expect(clasificarStock("5.001", 5)).toBe("NORMAL");
    expect(clasificarStock("100.000", 5)).toBe("NORMAL");
  });

  it("treats a stockMinimo of 0 as never BAJO while positive", () => {
    // 0 < 0.001 <= 0 is false → NORMAL; only <= 0 is AGOTADO.
    expect(clasificarStock("0.001", 0)).toBe("NORMAL");
  });
});
