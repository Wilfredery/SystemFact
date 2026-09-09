/**
 * DB-free unit tests for the company-wide weighted-average cost on receipt
 * (fase-3-4b task 1.1). The domain is pure: quantities/money cross as
 * `Decimal`-compatible strings and `decimal.js` keeps arithmetic exact.
 *
 * NOTE ON THE SPEC EXAMPLE (tasks 1.1 / inventario spec "Denominator spans
 * branches"): the spec text prints `⇒ 86.67` for the inputs
 * (company pre-receipt stock 50, CP 80.00, receive 50 @ 100.00). Those inputs
 * fed through the spec's OWN normative formula
 *   (stockTotalEmpresa × CP + cantRecibida × costoUnitarioSinITBIS)
 *     / (stockTotalEmpresa + cantRecibida)
 * give 90.00, not 86.67. 86.67 is only reachable with a different quantity
 * (e.g. receive 25 @ 100 → (50×80+25×100)/(50+25) = 86.6667). The formula is the
 * contract; the printed `86.67` is an arithmetic slip in the example. The tests
 * below assert the FORMULA result and, separately, that the all-branch
 * denominator is used (a branch-only denominator is the defect the scenario
 * calls out — see the 96.67 contrast). Flagged in the apply-progress notes for
 * spec reconciliation.
 */

import { Decimal } from "decimal.js";
import { calcularNuevoCostoPromedio } from "./costo-promedio";

describe("calcularNuevoCostoPromedio", () => {
  it("R2: uses the ALL-BRANCH denominator (company stock 50, not branch A's 10)", () => {
    // stock 10 @ branch A + 40 @ branch B => company-wide 50, CP 80.00,
    // receive 50 @ 100.00 (ITBIS-exclusive).
    // (50*80 + 50*100) / (50+50) = 9000/100 = 90.00
    const nuevo = calcularNuevoCostoPromedio({
      stockTotalEmpresa: "50.000",
      costoPromedio: "80.00",
      cantidadRecibida: "50.000",
      costoUnitarioSinItbis: "100.00",
    });
    expect(nuevo).toBe("90.00");
  });

  it("R2 contrast: a single-branch denominator is a defect (must NOT be produced)", () => {
    // Using only branch A's 10 would give (10*80 + 50*100)/(10+50)=96.6667→96.67.
    // The all-branch result must differ from that defect value.
    const defectoUnaSucursal = "96.67";
    const nuevo = calcularNuevoCostoPromedio({
      stockTotalEmpresa: "50.000", // all branches, not 10.000
      costoPromedio: "80.00",
      cantidadRecibida: "50.000",
      costoUnitarioSinItbis: "100.00",
    });
    expect(nuevo).not.toBe(defectoUnaSucursal);
    expect(nuevo).toBe("90.00");
  });

  it("R1: consumes ITBIS-EXCLUSIVE costs for mixed 18/16/0 lines (no gross-up)", () => {
    // Three receipts of the SAME product at net (ITBIS-exclusive) unit costs
    // of 100.00 (18%), 50.00 (16%) and 200.00 (0%). Applied sequentially over a
    // zero-cost, zero-stock product. A gross-up bug would multiply by 1.18 etc.
    // Sequential: CP0=0; after 10@100 => 100; after 10@50 => (10*100+10*50)/20=75;
    // after 10@200 => (20*75+10*200)/30 = 3500/30 = 116.6667 => 116.67.
    let cp = "0.00";
    let stock = "0.000";
    for (const [cant, unit] of [
      ["10.000", "100.00"],
      ["10.000", "50.00"],
      ["10.000", "200.00"],
    ] as const) {
      cp = calcularNuevoCostoPromedio({
        stockTotalEmpresa: stock,
        costoPromedio: cp,
        cantidadRecibida: cant,
        costoUnitarioSinItbis: unit,
      });
      stock = calcularSuma(stock, cant);
    }
    expect(cp).toBe("116.67");
  });

  it("rounds half-up to 2 dp on a .005 boundary", () => {
    // (1*0.00 + 1*0.01) / (1+1) = 0.005 -> half-up -> 0.01
    const nuevo = calcularNuevoCostoPromedio({
      stockTotalEmpresa: "1.000",
      costoPromedio: "0.00",
      cantidadRecibida: "1.000",
      costoUnitarioSinItbis: "0.01",
    });
    expect(nuevo).toBe("0.01");
  });

  it("keeps the current cost when nothing changes the denominator (guard)", () => {
    // Zero company stock and zero received quantity: no basis to reweight; the
    // current CP is returned normalized to 2 dp.
    const nuevo = calcularNuevoCostoPromedio({
      stockTotalEmpresa: "0.000",
      costoPromedio: "42.50",
      cantidadRecibida: "0.000",
      costoUnitarioSinItbis: "99.00",
    });
    expect(nuevo).toBe("42.50");
  });

  it("first receipt on an unseen product sets cost to the received net unit cost", () => {
    // (0*0 + 5*84.75) / (0+5) = 84.75
    const nuevo = calcularNuevoCostoPromedio({
      stockTotalEmpresa: "0.000",
      costoPromedio: "0.00",
      cantidadRecibida: "5.000",
      costoUnitarioSinItbis: "84.75",
    });
    expect(nuevo).toBe("84.75");
  });

  it("is exact on decimal strings (no float drift)", () => {
    // 0.1 + 0.2 style drift must not appear. Use thirds.
    // (1*0 + 2*100)/3 = 66.6667 -> 66.67
    const nuevo = calcularNuevoCostoPromedio({
      stockTotalEmpresa: "1.000",
      costoPromedio: "0.00",
      cantidadRecibida: "2.000",
      costoUnitarioSinItbis: "100.00",
    });
    expect(nuevo).toBe("66.67");
  });
});

// Small test-local helper to accumulate stock across the R1 sequential loop.
// Kept out of the domain (the repository owns stock aggregation); the test only
// needs to thread the running denominator forward.
function calcularSuma(a: string, b: string): string {
  return new Decimal(a).plus(new Decimal(b)).toFixed(3);
}
