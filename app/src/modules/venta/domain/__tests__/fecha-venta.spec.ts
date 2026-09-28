/**
 * Unit — sale-date band gate (F5 remediation of audit v2r-11). Pure, no DB.
 *
 * `fecha-venta.ts` is the rule that closes the `backdated-fecha-devolucion-window`
 * finding: the wire `fecha` must land inside `hoy_SD − horizonteDias … hoy_SD`,
 * both bounds inclusive, compared in `America/Santo_Domingo` calendar days
 * against an injected SERVER instant.
 *
 * The SD-timezone cases are the ones that matter for correctness: SD is UTC-4,
 * so a UTC instant late in the UTC day is still "yesterday" in SD, and one early
 * in the UTC day is already "today" in SD. Comparing raw UTC instants would
 * accept a future SD date (or reject a legal one) at the day boundary — these
 * tests pin the SD semantics deliberately.
 */

import {
  FECHA_VENTA_FUTURA,
  FECHA_VENTA_RETROACTIVA_EXCEDIDA,
  VentaDomainError,
} from "../errors";
import { validarFechaVenta } from "../fecha-venta";

/**
 * A fixed server instant. 2026-09-28T14:30:00Z is 2026-09-28 10:30 in SD
 * (UTC-4, no DST) — comfortably mid-day, so the SD/UTC boundary cases below are
 * not aliased to the same calendar day.
 */
const AHORA = new Date("2026-09-28T14:30:00.000Z");
const UN_DIA_MS = 86_400_000;

describe("validarFechaVenta — the retroactive bound", () => {
  it("accepts today's SD date (the whole day is legal, not just the elapsed part)", () => {
    // 2026-09-28T02:00:00Z is 2026-09-27 22:00 in SD — still YESTERDAY there.
    expect(() => validarFechaVenta(new Date("2026-09-28T02:00:00.000Z"), 7, AHORA)).not.toThrow();
    // 2026-09-28T20:00:00Z is 2026-09-28 16:00 in SD — TODAY there.
    expect(() => validarFechaVenta(new Date("2026-09-28T20:00:00.000Z"), 7, AHORA)).not.toThrow();
  });

  it("accepts a backdate of exactly `horizonteDias` (the lower bound is inclusive)", () => {
    expect(() =>
      validarFechaVenta(new Date(AHORA.getTime() - 7 * UN_DIA_MS), 7, AHORA),
    ).not.toThrow();
    expect(() =>
      validarFechaVenta(new Date(AHORA.getTime() - 30 * UN_DIA_MS), 30, AHORA),
    ).not.toThrow();
  });

  it("rejects a backdate of `horizonteDias + 1` with FECHA_VENTA_RETROACTIVA_EXCEDIDA", () => {
    expect.assertions(3);
    try {
      validarFechaVenta(new Date(AHORA.getTime() - 8 * UN_DIA_MS), 7, AHORA);
    } catch (err) {
      expect(err).toBeInstanceOf(VentaDomainError);
      const e = err as VentaDomainError;
      expect(e.code).toBe(FECHA_VENTA_RETROACTIVA_EXCEDIDA);
      expect(e.details).toMatchObject({ horizonteDias: 7, ahora: AHORA.toISOString() });
    }
  });

  it("horizonteDias = 0 admits ONLY today in SD and rejects yesterday", () => {
    expect(() => validarFechaVenta(new Date("2026-09-28T20:00:00.000Z"), 0, AHORA)).not.toThrow();
    expect(() => validarFechaVenta(new Date("2026-09-27T20:00:00.000Z"), 0, AHORA)).toThrow(
      VentaDomainError,
    );
  });
});

describe("validarFechaVenta — the future bound", () => {
  it("rejects any SD date after today with FECHA_VENTA_FUTURA", () => {
    expect.assertions(2);
    try {
      validarFechaVenta(new Date(AHORA.getTime() + UN_DIA_MS), 7, AHORA);
    } catch (err) {
      expect(err).toBeInstanceOf(VentaDomainError);
      expect((err as VentaDomainError).code).toBe(FECHA_VENTA_FUTURA);
    }
  });

  it("rejects a forward date that a WIDE horizon would otherwise swallow", () => {
    // The horizon is the retroactive side ONLY; no configuration can legalize a
    // future SD date. This is the arm of the original exploit.
    expect(() => validarFechaVenta(new Date(AHORA.getTime() + UN_DIA_MS), 999, AHORA)).toThrow(
      VentaDomainError,
    );
  });

  it("accepts the exact `now` instant (SD equality is not 'future')", () => {
    expect(() => validarFechaVenta(new Date(AHORA.getTime()), 7, AHORA)).not.toThrow();
  });
});

describe("validarFechaVenta — SD calendar-day semantics", () => {
  it("a UTC instant whose UTC date is today but whose SD date is YESTERDAY is NOT future", () => {
    // 2026-09-29T02:00Z → UTC date 2026-09-29, but SD 2026-09-28 22:00 → today in
    // SD. A naive UTC comparison would have rejected it as a future date.
    const instante = new Date("2026-09-29T02:00:00.000Z");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-09-29");
    expect(() => validarFechaVenta(instante, 7, AHORA)).not.toThrow();
  });

  it("a UTC instant whose UTC date is today but whose SD date is TOMORROW IS future", () => {
    // 2026-09-29T20:00Z → UTC date 2026-09-29 (same as "today" in a naive UTC
    // view), but SD 2026-09-29 16:00 → TOMORROW in SD, so it must be rejected.
    const instante = new Date("2026-09-29T20:00:00.000Z");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-09-29");
    expect(() => validarFechaVenta(instante, 7, AHORA)).toThrow(VentaDomainError);
  });

  it("the retroactive bound is measured in SD days, so the exact edge holds across the offset", () => {
    // Limite = AHORA − 7d = 2026-09-21T14:30Z = 2026-09-21 10:30 in SD.
    // 2026-09-21T04:30Z is 2026-09-21 00:30 in SD → same SD day → ACCEPTED.
    expect(() =>
      validarFechaVenta(new Date("2026-09-21T04:30:00.000Z"), 7, AHORA),
    ).not.toThrow();
    // One second earlier in SD terms (2026-09-20 23:59:59.999) → REJECTED.
    expect(() =>
      validarFechaVenta(new Date("2026-09-21T03:59:59.999Z"), 7, AHORA),
    ).toThrow(VentaDomainError);
  });
});

describe("validarFechaVenta — horizonteDias is a CONFIG value, not a business state", () => {
  it("fails loud on a negative horizon instead of returning a catalog code", () => {
    expect(() => validarFechaVenta(AHORA, -1, AHORA)).toThrow(Error);
    expect(() => validarFechaVenta(AHORA, -1, AHORA)).not.toThrow(VentaDomainError);
  });

  it("fails loud on a non-integer (float / NaN / Infinity) horizon", () => {
    expect(() => validarFechaVenta(AHORA, 7.5, AHORA)).toThrow(Error);
    expect(() => validarFechaVenta(AHORA, Number.NaN, AHORA)).toThrow(Error);
    expect(() => validarFechaVenta(AHORA, Number.POSITIVE_INFINITY, AHORA)).toThrow(Error);
  });

  it("names the offending key so a misconfigured tenant is diagnosable", () => {
    expect(() => validarFechaVenta(AHORA, -3, AHORA)).toThrow(/RETROACTIVO_FECHA_VENTA_DIAS/);
  });
});
