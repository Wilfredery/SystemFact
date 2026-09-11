/**
 * Unit — pure NCF rules (Phase 1 / pr5c1).
 *
 * Covers R-N2 (frozen 11-char composition), R-N3 (90% threshold warning,
 * never fails) and R-N5 (Santo Domingo calendar-day expiry via the injected
 * clock, NEVER a raw UTC-instant compare). No database, no Prisma: the domain
 * is pure (ADR-013).
 *
 * Composition note: the change docs literally print `B02000000522` (12 chars)
 * while ALSO asserting "exactly 11 characters" and the `B + 2-digit tipo +
 * %08d` formula. The formula and the 11-char rule are unambiguous and agree on
 * `B0200000522`; the literal has a spurious extra zero. These tests lock the
 * authoritative rule (11 chars). The deviation is reported for the docs.
 */

import {
  componerNcf,
  calcularUmbral90,
  esRangoVencidoSD,
  fechaEnSD,
  NCF_UMBRAL_90,
} from "../ncf-rules";

describe("ncf-rules — componerNcf (R-N2, frozen 11-char composition)", () => {
  it("composes B02 / 522 as exactly 'B0200000522' (11 chars, no RNC)", () => {
    const ncf = componerNcf("B02", 522);
    // Authoritative rule: B + 2-digit tipo + %08d => 1 + 2 + 8 = 11 chars.
    expect(ncf).toBe("B0200000522");
    expect(ncf).toHaveLength(11);
  });

  it("prefix always matches the requested tipo (two tipo digits)", () => {
    expect(componerNcf("B01", 7)).toBe("B0100000007");
    expect(componerNcf("B03", 0)).toBe("B0300000000");
    expect(componerNcf("B04", 12345678)).toBe("B0412345678");
    expect(componerNcf("B11", 1)).toBe("B1100000001");
  });

  it("rejects a secuencial that would break the 11-char invariant", () => {
    // 99_999_999 is the largest 8-digit consecutivo (=> 11 chars total).
    expect(componerNcf("B02", 99_999_999)).toHaveLength(11);
    // 100_000_000 is 9 digits: it can never be a valid %08d consecutive.
    expect(() => componerNcf("B02", 100_000_000)).toThrow(RangeError);
  });

  it("rejects a negative or non-integer secuencial", () => {
    expect(() => componerNcf("B02", -1)).toThrow(RangeError);
    expect(() => componerNcf("B02", 5.5)).toThrow(RangeError);
  });
});

describe("ncf-rules — calcularUmbral90 (R-N3, threshold warning, never fails)", () => {
  it("emits NCF_UMBRAL_90 when used reaches exactly 90% (inclusive)", () => {
    // rangoInicio=1, rangoFin=10 → total=10; consumido=9 → used=9 → 90%.
    expect(
      calcularUmbral90({ rangoInicio: 1, rangoFin: 10, secuenciaActual: 9 }),
    ).toBe(NCF_UMBRAL_90);
  });

  it("emits NCF_UMBRAL_90 on the spec 500–1000 range once it crosses 90%", () => {
    // total=501 → 90% boundary is used=450.9, i.e. secuenciaActual=950.
    expect(
      calcularUmbral90({ rangoInicio: 500, rangoFin: 1000, secuenciaActual: 949 }),
    ).toBeNull();
    expect(
      calcularUmbral90({ rangoInicio: 500, rangoFin: 1000, secuenciaActual: 950 }),
    ).toBe(NCF_UMBRAL_90);
  });

  it("emits nothing below the 90% threshold", () => {
    expect(
      calcularUmbral90({ rangoInicio: 500, rangoFin: 1000, secuenciaActual: 522 }),
    ).toBeNull();
  });

  it("never throws on degenerate ranges — it only reports a warning", () => {
    // Empty / inverted range: cannot evaluate a fraction, must not fail.
    expect(
      calcularUmbral90({ rangoInicio: 1000, rangoFin: 500, secuenciaActual: 700 }),
    ).toBeNull();
    expect(
      calcularUmbral90({ rangoInicio: 5, rangoFin: 5, secuenciaActual: 5 }),
    ).toBe(NCF_UMBRAL_90); // 1/1 = 100% >= 90%
  });
});

describe("ncf-rules — esRangoVencidoSD (R-N5, SD calendar-day expiry)", () => {
  it("boundary day is still valid even though a raw UTC compare would expire it", () => {
    // vigenciaFin early-morning UTC whose SD date is 2026-01-14.
    const vigenciaFin = new Date("2026-01-15T03:30:00.000Z"); // SD 2026-01-14 23:30
    const now = new Date("2026-01-15T03:45:00.000Z"); // SD 2026-01-14 23:45 (end of day SD)
    // Sanity: a naive instant compare (now > vigenciaFin) would wrongly expire.
    expect(now.getTime() > vigenciaFin.getTime()).toBe(true);
    expect(fechaEnSD(vigenciaFin)).toBe("2026-01-14");
    expect(fechaEnSD(now)).toBe("2026-01-14");
    // Correct SD behaviour: same SD calendar day ⇒ NOT expired.
    expect(esRangoVencidoSD({ now, vigenciaFin })).toBe(false);
  });

  it("the day AFTER the SD expiry date blocks", () => {
    const vigenciaFin = new Date("2026-01-15T03:30:00.000Z"); // SD date 2026-01-14
    const now = new Date("2026-01-16T10:00:00.000Z"); // SD date 2026-01-16
    expect(fechaEnSD(now)).toBe("2026-01-16");
    expect(esRangoVencidoSD({ now, vigenciaFin })).toBe(true);
  });

  it("uses the SD calendar day, not the UTC day (injected clock)", () => {
    // 2026-01-14T01:00Z is still 2026-01-13 in Santo Domingo (UTC-4).
    expect(fechaEnSD(new Date("2026-01-14T01:00:00.000Z"))).toBe("2026-01-13");
    // Equal SD days ⇒ not expired even though the instants differ.
    expect(
      esRangoVencidoSD({
        now: new Date("2026-01-14T01:00:00.000Z"), // SD 01-13
        vigenciaFin: new Date("2026-01-13T20:00:00.000Z"), // SD 01-13
      }),
    ).toBe(false);
  });
});
