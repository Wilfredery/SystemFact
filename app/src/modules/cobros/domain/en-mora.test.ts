/**
 * Unit — Santo Domingo mora rule (R-B3).
 *
 * Clock-injected `now`; no DB. SD is UTC-4 with no DST, so an instant that is
 * already the next day in UTC is STILL the previous day in SD — the whole point
 * of resolving "today" in SD. A receivable flips to mora only after ONE FULL SD
 * day has passed beyond the SD due date (inclusive due day is not mora).
 */

import { enMora, fechaVencimiento } from "./en-mora";

// Invoice emitted at SD midday so its SD calendar date is unambiguous (2026-09-10).
const FECHA_EMISION = new Date("2026-09-10T12:00:00.000Z");
// plazo 5 days → due date is the 2026-09-15 SD calendar day.
const PLAZO = 5;
const VENCIMIENTO_SD = "2026-09-15";

describe("fechaVencimiento (SD calendar date)", () => {
  it("resolves the due date to its Santo Domingo calendar day", () => {
    expect(fechaVencimiento(FECHA_EMISION, PLAZO)).toBe(VENCIMIENTO_SD);
  });

  it("rejects a non-integer/negative plazo as a config defect (fails loud)", () => {
    expect(() => fechaVencimiento(FECHA_EMISION, -1)).toThrow(
      /plazoCreditoDias inválido/,
    );
    expect(() => fechaVencimiento(FECHA_EMISION, 2.5)).toThrow(
      /plazoCreditoDias inválido/,
    );
  });
});

describe("enMora (R-B3)", () => {
  it("SD/UTC boundary day is NOT in mora: 2026-09-15T02:00Z is UTC 15th but SD 14th", () => {
    // Naive UTC comparison would wrongly see today (15) >= due (15) as past due;
    // SD resolution sees today = 2026-09-14, strictly BEFORE the due day.
    const now = new Date("2026-09-15T02:00:00.000Z"); // 2026-09-14 22:00 SD
    expect(enMora({ fechaEmision: FECHA_EMISION, plazoCreditoDias: PLAZO, now })).toBe(
      false,
    );
  });

  it("the due day itself (0 full days past) is NOT in mora", () => {
    const now = new Date("2026-09-15T12:00:00.000Z"); // 2026-09-15 SD, == due
    expect(enMora({ fechaEmision: FECHA_EMISION, plazoCreditoDias: PLAZO, now })).toBe(
      false,
    );
  });

  it("one full SD day past due (2026-09-16 SD) IS in mora", () => {
    const now = new Date("2026-09-16T12:00:00.000Z"); // 2026-09-16 SD
    expect(enMora({ fechaEmision: FECHA_EMISION, plazoCreditoDias: PLAZO, now })).toBe(
      true,
    );
  });

  it("the day-after-in-UTC-but-still-due-day-in-SD is NOT in mora", () => {
    // 2026-09-16T02:00Z == 2026-09-15 22:00 SD → still the due day in SD.
    const now = new Date("2026-09-16T02:00:00.000Z");
    expect(enMora({ fechaEmision: FECHA_EMISION, plazoCreditoDias: PLAZO, now })).toBe(
      false,
    );
  });

  it("plazo 0 is due on the emission day; the next SD day is mora", () => {
    const now = new Date("2026-09-11T12:00:00.000Z"); // SD 2026-09-11, due SD 2026-09-10
    expect(enMora({ fechaEmision: FECHA_EMISION, plazoCreditoDias: 0, now })).toBe(
      true,
    );
  });
});
