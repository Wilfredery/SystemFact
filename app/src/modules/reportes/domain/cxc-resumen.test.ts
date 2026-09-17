/**
 * Unit — the CxC receivables summary (DB-1). No DB.
 *
 * Reduces the canonical per-invoice pending balances (Decimal strings) to the dashboard
 * tile: counts strictly-positive pending invoices and sums them with `decimal.js` (never
 * a float), normalised to the 2-dp money scale.
 */

import { resumirCxC } from "./cxc-resumen";

describe("resumirCxC — display aggregate over the canonical derived balances", () => {
  it("empty input yields 0 pendientes and a 0.00 saldo", () => {
    expect(resumirCxC([])).toEqual({ facturasPendientes: 0, saldoTotal: "0.00" });
  });

  it("counts only strictly-positive pending balances and sums them", () => {
    const filas = [
      { saldoPendiente: "100.50" },
      { saldoPendiente: "0.00" }, // fully paid → not pending
      { saldoPendiente: "199.50" },
      { saldoPendiente: "-5.00" }, // over-collected → not pending (defensive)
    ];
    const r = resumirCxC(filas);
    expect(r.facturasPendientes).toBe(2); // 100.50 + 199.50
    expect(r.saldoTotal).toBe("295.00"); // includes the negative in the NET total
  });

  it("sums with Decimal precision (no float drift on .1 + .2 magnitudes)", () => {
    const filas = [
      { saldoPendiente: "0.10" },
      { saldoPendiente: "0.20" },
      { saldoPendiente: "10.18" },
    ];
    expect(resumirCxC(filas).saldoTotal).toBe("10.48");
  });

  it("normalises a sub-cent aggregate to the 2-dp money scale", () => {
    expect(resumirCxC([{ saldoPendiente: "0.004" }]).saldoTotal).toBe("0.00");
  });
});
