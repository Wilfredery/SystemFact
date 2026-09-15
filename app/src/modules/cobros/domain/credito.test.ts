/**
 * Unit — pure credit rules (R-K2, fase-6 PR-3, no DB).
 *
 * The heart of the credit gate is the INCLUSIVE limit boundary and the >30-day
 * SD mora threshold, both pure Decimal/date functions. These run with no
 * database (the domain is pure) and pin the exact edges the integration
 * scenarios can only approximate.
 */

import {
  evaluarReglaCredito,
  DIAS_MORA_BLOQUEO_CREDITO,
} from "./credito";
import { diasVencidoEnSD } from "./en-mora";
import {
  CLIENTE_EN_MORA,
  CREDITO_NO_HABILITADO,
  LIMITE_CREDITO_EXCEDIDO,
} from "./errors";

const base = {
  creditoHabilitado: true,
  pendienteTotal: "0.00",
  limiteCredito: "20000.00",
  totalVenta: "0.00",
  diasEnMoraMaximo: 0,
};

describe("evaluarReglaCredito (R-K2)", () => {
  it("rejects when the client is not credit-enabled, even under the limit", () => {
    const r = evaluarReglaCredito({ ...base, creditoHabilitado: false, totalVenta: "100.00" });
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.code).toBe(CREDITO_NO_HABILITADO);
  });

  it("INCLUSIVE boundary: pending + sale EXACTLY equals the limit → allowed (R-K2)", () => {
    const r = evaluarReglaCredito({
      ...base,
      pendienteTotal: "15000.00",
      totalVenta: "5000.00",
    }); // 15,000 + 5,000 == 20,000 == limit
    expect(r.permitido).toBe(true);
  });

  it("rejects when pending + sale exceeds the limit by the smallest amount", () => {
    const r = evaluarReglaCredito({
      ...base,
      pendienteTotal: "18000.00",
      totalVenta: "5000.00",
    }); // 23,000 > 20,000 → spec over-limit scenario
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.code).toBe(LIMITE_CREDITO_EXCEDIDO);
  });

  it("uses exact Decimal compare: 0.01 over the limit is a rejection", () => {
    const r = evaluarReglaCredito({
      ...base,
      pendienteTotal: "19999.99",
      totalVenta: "0.02",
    }); // 20,000.01 > 20,000
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.code).toBe(LIMITE_CREDITO_EXCEDIDO);
  });

  it("mora at exactly the threshold is NOT blocking (30 days passes)", () => {
    expect(DIAS_MORA_BLOQUEO_CREDITO).toBe(30);
    const r = evaluarReglaCredito({ ...base, diasEnMoraMaximo: 30 });
    expect(r.permitido).toBe(true);
  });

  it("mora strictly beyond the threshold rejects with CLIENTE_EN_MORA", () => {
    const r = evaluarReglaCredito({ ...base, diasEnMoraMaximo: 31 });
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.code).toBe(CLIENTE_EN_MORA);
  });

  it("fixed rejection order: habilitation is checked before limit and mora", () => {
    const r = evaluarReglaCredito({
      ...base,
      creditoHabilitado: false,
      pendienteTotal: "50000.00",
      totalVenta: "50000.00",
      diasEnMoraMaximo: 90,
    });
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(r.code).toBe(CREDITO_NO_HABILITADO);
  });

  it("every rejection carries the catalog message (never empty)", () => {
    const r = evaluarReglaCredito({ ...base, diasEnMoraMaximo: 45 });
    expect(r.permitido).toBe(false);
    if (!r.permitido) expect(typeof r.message).toBe("string");
    if (!r.permitido) expect(r.message.length).toBeGreaterThan(0);
  });
});

describe("diasVencidoEnSD (R-K2 mora window, SD calendar)", () => {
  it("is 0 on and before the SD due date, 1 on the day after", () => {
    // Invoice 2026-01-01, plazo 30 → due 2026-01-31 (SD).
    const emision = new Date("2026-01-01T12:00:00.000Z");
    expect(
      diasVencidoEnSD({ fechaEmision: emision, plazoCreditoDias: 30, now: new Date("2026-01-31T12:00:00.000Z") }),
    ).toBe(0);
    expect(
      diasVencidoEnSD({ fechaEmision: emision, plazoCreditoDias: 30, now: new Date("2026-02-01T12:00:00.000Z") }),
    ).toBe(1);
  });

  it("reaches exactly 31 days overdue past the due+30 boundary", () => {
    const emision = new Date("2026-01-01T12:00:00.000Z");
    // due 2026-01-31; 31 days overdue → now 2026-03-03.
    expect(
      diasVencidoEnSD({ fechaEmision: emision, plazoCreditoDias: 30, now: new Date("2026-03-03T12:00:00.000Z") }),
    ).toBe(31);
  });
});
