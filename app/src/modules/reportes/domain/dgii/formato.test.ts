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

describe("dgii/formato — rellenarAlnum strips ASCII control chars (one physical line per record)", () => {
  const SIN_CONTROL = /[\x00-\x1F\x7F]/;

  it("removes an interior CRLF from an 11-char NCF and keeps the declared width", () => {
    // "B01\r\n123456" is 11 chars, so a pad/truncate-only implementation returns it UNCHANGED
    // and the CR/LF ship into the record (fingerprint dgii-606). Stripping first yields
    // "B01123456" (9), which is then space-padded to the 11 declared columns.
    const salida = rellenarAlnum("B01\r\n123456", 11);
    expect(salida).toBe("B01123456  ");
    expect(salida).toHaveLength(11);
    expect(salida).not.toMatch(SIN_CONTROL);
  });

  it("removes a CR, LF, TAB, NUL or DEL sitting at index 2 (width still exact)", () => {
    for (const ctl of ["\r", "\n", "\t", "\u0000", "\u001F", "\u007F"]) {
      // 11 chars in, 10 after stripping, so the field is right-padded back to 11.
      const salida = rellenarAlnum(`B0${ctl}12345678`, 11);
      expect(salida).toBe("B012345678 ");
      expect(salida).toHaveLength(11);
      expect(salida).not.toMatch(SIN_CONTROL);
    }
  });

  it("pads to the full width AFTER stripping, so the field never shortens", () => {
    // "B01\r\n1" is 7 chars; stripped it is "B011" (4) and must still occupy 11 columns.
    const salida = rellenarAlnum("B01\r\n1", 11);
    expect(salida).toBe("B011       ");
    expect(salida).toHaveLength(11);
  });

  it("strips a control-only value down to a full-width blank field (never absent)", () => {
    expect(rellenarAlnum("\r\n", 11)).toBe("           ");
    expect(rellenarAlnum("\t\u0000", 4)).toBe("    ");
  });

  it("keeps the SPACE character (0x20 is padding data, not a control char)", () => {
    // Regression guard: stripping must never touch the padding character, or every
    // right-padded field (RNC, blank NCF) would collapse and the layout would desync.
    expect(rellenarAlnum("AB CD", 5)).toBe("AB CD");
    expect(rellenarAlnum("130000000", 11)).toBe("130000000  ");
    expect(rellenarAlnum("  1300", 6)).toBe("  1300");
  });

  it("leaves a control-free value byte-identical to the pure pad/truncate behaviour", () => {
    const casos: ReadonlyArray<readonly [string, number, string]> = [
      ["B0100000001", 11, "B0100000001"],
      ["ABCDEFGHIJKL", 11, "ABCDEFGHIJK"], // truncation
      ["130000000", 11, "130000000  "], // padding
      ["", 11, "           "], // blank
      ["AB", 4, "AB  "],
    ];
    for (const [valor, ancho, esperado] of casos) {
      expect(rellenarAlnum(valor, ancho)).toBe(esperado);
    }
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
