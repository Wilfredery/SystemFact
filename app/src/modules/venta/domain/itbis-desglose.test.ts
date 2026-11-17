/**
 * Per-rate ITBIS breakdown for the printed invoice — pure unit tests (DGII
 * 254-06 Art. 11: "ITBIS desglosado" per rate; odd/tasks/factura-print.md S3).
 *
 * The printed bill must show ITBIS split BY RATE (18 general, 16 reduced, 0
 * exempt). The FACTURA row stores only the totals, but the frozen lines carry
 * each line's `tasaItbis` and `itbisLinea`, so the breakdown is a pure
 * aggregation of the persisted record — never recomputed from rates ("today's"
 * rate must never touch a past invoice).
 */

import { desglosarItbisPorTasa } from "./itbis-desglose";

describe("desglosarItbisPorTasa (S3: ITBIS desglosado en la factura impresa)", () => {
  it("groups the frozen line ITBIS by rate, sorted descending", () => {
    const desglose = desglosarItbisPorTasa([
      { tasaItbis: "18.00", itbisLinea: "27.00" },
      { tasaItbis: "18.00", itbisLinea: "9.00" },
      { tasaItbis: "16.00", itbisLinea: "1.60" },
      { tasaItbis: "0.00", itbisLinea: "0.00" },
    ]);
    expect(desglose).toEqual([
      { tasa: "18.00", itbis: "36.00" },
      { tasa: "16.00", itbis: "1.60" },
      { tasa: "0.00", itbis: "0.00" },
    ]);
  });

  it("is exact with Decimal arithmetic (no float drift)", () => {
    const desglose = desglosarItbisPorTasa([
      { tasaItbis: "18.00", itbisLinea: "0.10" },
      { tasaItbis: "18.00", itbisLinea: "0.20" },
    ]);
    expect(desglose).toEqual([{ tasa: "18.00", itbis: "0.30" }]);
  });

  it("returns an empty breakdown for a sale with no taxable lines", () => {
    expect(desglosarItbisPorTasa([])).toEqual([]);
  });

  it("drops nothing: every line's ITBIS lands in exactly one rate bucket", () => {
    const desglose = desglosarItbisPorTasa([
      { tasaItbis: "18.00", itbisLinea: "10.00" },
      { tasaItbis: "16.00", itbisLinea: "3.20" },
      { tasaItbis: "16.00", itbisLinea: "1.60" },
      { tasaItbis: "0.00", itbisLinea: "0.00" },
      { tasaItbis: "0.00", itbisLinea: "0.00" },
    ]);
    const totalItbis = desglose.reduce((acc, r) => acc + Number(r.itbis), 0);
    expect(totalItbis).toBeCloseTo(14.8, 5);
    expect(desglose).toHaveLength(3);
  });
});
