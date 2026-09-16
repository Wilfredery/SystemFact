/**
 * Unit tests — DGII record caps, deterministic split, en-cero file and filename (FIS-6; task 5.1).
 *
 * PURE (no DB). Pins: the 607 ≤ 65,000 / 608 ≤ 4,999 caps, the deterministic multi-file split whose
 * per-file counts SUM to the whole and each stay within cap (spec FIS-6 "Cap-exceeding split"), the
 * zero-activity EN-CERO file (one chunk of length 0, header CANTIDAD_REGISTROS=0), and the
 * `DGII_F_<code>_<RNC>_<AAAAMM>.TXT` filename convention with a split suffix only when needed.
 */

import {
  TOPE_606_POR_DEFECTO,
  TOPE_607,
  TOPE_608,
  dividirPorTope,
  nombreArchivoDGII,
  trocearRegistros,
} from "./topes";

describe("dgii/topes — cap constants (research §3/§5/§9)", () => {
  it("freezes the 607 at 65,000 and 608 at 4,999; the 606 default is the legacy 10,000 (U5 seam)", () => {
    expect(TOPE_607).toBe(65_000);
    expect(TOPE_608).toBe(4_999);
    expect(TOPE_606_POR_DEFECTO).toBe(10_000);
  });
});

describe("dgii/topes — dividirPorTope (deterministic split, counts sum to the whole)", () => {
  it("returns a single chunk when the register is within cap", () => {
    expect(dividirPorTope(100, TOPE_607)).toEqual([100]);
    expect(dividirPorTope(TOPE_607, TOPE_607)).toEqual([65_000]);
  });
  it("splits a register over cap into consecutive fixed-size chunks whose sum is exact", () => {
    const partes = dividirPorTope(65_001, TOPE_607);
    expect(partes).toEqual([65_000, 1]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(65_001);
    expect(partes.every((p) => p <= TOPE_607)).toBe(true);
  });
  it("splits 608 at the 4,999 boundary", () => {
    expect(dividirPorTope(4_999, TOPE_608)).toEqual([4_999]);
    expect(dividirPorTope(5_000, TOPE_608)).toEqual([4_999, 1]);
  });
  it("a zero-activity period yields ONE zero-length chunk (the en-cero file, FIS-6)", () => {
    expect(dividirPorTope(0, TOPE_607)).toEqual([0]);
  });
  it("rejects a negative count or a non-positive cap", () => {
    expect(() => dividirPorTope(-1, TOPE_607)).toThrow(RangeError);
    expect(() => dividirPorTope(10, 0)).toThrow(RangeError);
  });
});

describe("dgii/topes — trocearRegistros (array split mirrors dividirPorTope)", () => {
  it("returns one empty chunk for an empty register (en-cero)", () => {
    expect(trocearRegistros([], 5)).toEqual([[]]);
  });
  it("cuts rows in order; per-file lengths equal the counts and cover every row once", () => {
    const filas = Array.from({ length: 7 }, (_, i) => i);
    const trozos = trocearRegistros(filas, 3);
    expect(trozos.map((t) => t.length)).toEqual([3, 3, 1]);
    expect(trozos.flat()).toEqual(filas);
  });
});

describe("dgii/topes — nombreArchivoDGII (DGII_F_<code>_<RNC>_<AAAAMM>.TXT)", () => {
  it("builds the canonical single-file name with no suffix", () => {
    expect(nombreArchivoDGII("607", "130000000", 2018, 7)).toBe("DGII_F_607_130000000_201807.TXT");
  });
  it("appends a 1-based zero-padded part suffix ONLY for a multi-file split", () => {
    expect(nombreArchivoDGII("608", "130000000", 2026, 3, 2, 3)).toBe(
      "DGII_F_608_130000000_202603_002.TXT",
    );
    // A single part (total=1) never carries the suffix, even if `parte` is passed.
    expect(nombreArchivoDGII("606", "130000000", 2026, 3, 1, 1)).toBe(
      "DGII_F_606_130000000_202603.TXT",
    );
  });
});
