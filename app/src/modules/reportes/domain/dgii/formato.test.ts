/**
 * Unit tests — DGII fixed-width formatting primitives (FIS-3/FIS-6; slice E, task 5.1).
 *
 * PURE (no DB). These pin the FORMATTING RULES (padding direction, truncation, the decimal-point-
 * inside-width convention, negative handling, the SD date→AAAAMMDD conversion, deterministic
 * concatenation) against the CHOSEN widths — NOT against a DGII-tool-verified byte offset
 * (research §9 U2: offsets are UNVERIFIED; the unit proves the rules, the pre-validation loop proves
 * the bytes). Money always flows as `Decimal`/Decimal-string (never a JS float).
 */

import { Decimal } from "decimal.js";
import {
  LARGO_IMPORTE_DEFAULT,
  fechaAAAMMDD,
  periodoAAAAMM,
  ensamblarLinea,
  formatearMonto,
  rellenarAlnum,
  rellenarEnteroIzq,
} from "./formato";

describe("dgii/formato — rellenarAlnum (right space-pad, truncate)", () => {
  it("pads an alphanumeric field to the right with spaces to the exact width", () => {
    expect(rellenarAlnum("130000000", 11)).toBe("130000000  ");
  });
  it("truncates an over-long value instead of widening the line (fixed-width invariant)", () => {
    expect(rellenarAlnum("ABCDEFGHIJKL", 11)).toBe("ABCDEFGHIJK");
    expect(rellenarAlnum("ABCDEFGHIJKL", 11)).toHaveLength(11);
  });
  it("renders a blank field (never absent) for null/undefined/empty", () => {
    expect(rellenarAlnum(null, 11)).toBe("           ");
    expect(rellenarAlnum(undefined, 11)).toBe("           ");
    expect(rellenarAlnum("", 11)).toBe("           ");
  });
});

describe("dgii/formato — rellenarEnteroIzq (zero left-pad)", () => {
  it("zero-left-pads a count to the declared width", () => {
    expect(rellenarEnteroIzq(7, 12)).toBe("000000000007");
  });
  it("leaves a value already at/over the width un-truncated (a count is never clipped)", () => {
    expect(rellenarEnteroIzq(65000, 12)).toBe("000000065000");
    expect(rellenarEnteroIzq(1234567890123, 4)).toBe("1234567890123");
  });
  it("rejects a negative or non-integer count", () => {
    expect(() => rellenarEnteroIzq(-1, 12)).toThrow(RangeError);
    expect(() => rellenarEnteroIzq(1.5, 12)).toThrow(RangeError);
  });
});

describe("dgii/formato — formatearMonto (decimal point inside width, zero left-pad)", () => {
  it("emits a whole amount at 2dp zero-left-padded to width, point counted in the length", () => {
    // 4000.00 at width 13 == the research §2 illustrative `0000004000.00`.
    expect(formatearMonto("4000", 13)).toBe("0000004000.00");
    expect(formatearMonto("4000", 13)).toHaveLength(13);
  });
  it("preserves centavos exactly and never rounds a float (10.18 stays 10.18)", () => {
    expect(formatearMonto("10.18", LARGO_IMPORTE_DEFAULT)).toBe("000000010.18");
  });
  it("accepts a Decimal instance and serialises it at full 2dp precision", () => {
    expect(formatearMonto(new Decimal("1250000.00"), 16)).toBe("0000001250000.00");
  });
  it("keeps a negative amount signed and right-justified (B04 nota crédito reduces the register)", () => {
    const neg = formatearMonto("-118.00", LARGO_IMPORTE_DEFAULT);
    expect(neg).toBe("-00000118.00");
    expect(neg).toHaveLength(LARGO_IMPORTE_DEFAULT);
    expect(neg.startsWith("-")).toBe(true);
  });
  it("never truncates an amount that exceeds the width (would corrupt the cross-foot)", () => {
    // A figure too large for the field is emitted in FULL, not silently clipped.
    expect(formatearMonto("999999999999.99", 8)).toBe("999999999999.99");
  });
});

describe("dgii/formato — SD date → AAAAMMDD and period → AAAAMM", () => {
  it("renders a UTC instant at its Santo-Domingo calendar date (no manual offset)", () => {
    // 2026-07-15T23:00:00Z is 19:00 SD the SAME day (UTC-4) → 20260715.
    expect(fechaAAAMMDD(new Date("2026-07-15T23:00:00.000Z"))).toBe("20260715");
  });
  it("crosses the SD day at the boundary (03:00Z is 23:00 SD the PREVIOUS day)", () => {
    expect(fechaAAAMMDD(new Date("2026-07-16T03:00:00.000Z"))).toBe("20260715");
  });
  it("renders a blank field for an undated row", () => {
    expect(fechaAAAMMDD(null)).toBe("");
  });
  it("formats the AAAAMM header period with a zero-padded month", () => {
    expect(periodoAAAAMM(2018, 7)).toBe("201807");
    expect(periodoAAAAMM(2026, 12)).toBe("202612");
  });
});

describe("dgii/formato — ensamblarLinea (fixed-width concatenation, no separator, deterministic)", () => {
  it("joins pre-padded fields with NO delimiter (a pipe/comma delimiter is REJECTED — U6)", () => {
    const linea = ensamblarLinea(["607", rellenarAlnum("130000000", 11)]);
    expect(linea).toBe("607130000000  ");
    expect(linea).not.toContain("|");
    expect(linea).not.toContain(",");
  });
  it("is byte-deterministic for identical inputs", () => {
    const campos = ["AA", "BB", "CC"];
    expect(ensamblarLinea(campos)).toBe(ensamblarLinea(campos));
  });
});
