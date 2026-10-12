/**
 * Unit — shared pagination contract (R-QC-07, design D3). No DB, no framework
 * imports: pins the full normalize/clamp matrix every consuming module
 * inherits, plus the offset/totalPages semantics the audited variants used.
 */

import {
  TAMANO_PAGINA_MAXIMO,
  TAMANO_PAGINA_POR_DEFECTO,
  calcularOffset,
  calcularTotalPages,
  normalizarPagina,
  normalizarTamanoPagina,
} from "./pagination";

describe("normalizarTamanoPagina (R-QC-07 clamp matrix)", () => {
  it("yields the default constants", () => {
    expect(TAMANO_PAGINA_POR_DEFECTO).toBe(25);
    expect(TAMANO_PAGINA_MAXIMO).toBe(100);
  });

  it("paths a size of 0 to the default 25 (spec scenario)", () => {
    expect(normalizarTamanoPagina(0)).toBe(25);
  });

  it("keeps 25 at 25", () => {
    expect(normalizarTamanoPagina(25)).toBe(25);
  });

  it("clamps 250 to the 100 maximum", () => {
    expect(normalizarTamanoPagina(250)).toBe(100);
  });

  it("defaults absent/null/non-finite to 25 and floors to ≥1", () => {
    expect(normalizarTamanoPagina(undefined)).toBe(25);
    expect(normalizarTamanoPagina(null)).toBe(25);
    expect(normalizarTamanoPagina(Number.NaN)).toBe(25);
    expect(normalizarTamanoPagina(-50)).toBe(25);
    expect(normalizarTamanoPagina(1)).toBe(1);
    expect(normalizarTamanoPagina(37.9)).toBe(37);
  });
});

describe("normalizarPagina (floor matrix)", () => {
  it("paths 0, −1 and non-finite to page 1", () => {
    expect(normalizarPagina(0)).toBe(1);
    expect(normalizarPagina(-1)).toBe(1);
    expect(normalizarPagina(undefined)).toBe(1);
    expect(normalizarPagina(null)).toBe(1);
    expect(normalizarPagina(Number.NaN)).toBe(1);
  });

  it("truncates a fractional page", () => {
    expect(normalizarPagina(2.7)).toBe(2);
  });

  it("keeps a valid page as-is", () => {
    expect(normalizarPagina(3)).toBe(3);
  });
});

describe("calcularOffset", () => {
  it("is zero-based: (page-1)*pageSize", () => {
    expect(calcularOffset(1, 25)).toBe(0);
    expect(calcularOffset(3, 25)).toBe(50);
    expect(calcularOffset(2, 100)).toBe(100);
  });
});

describe("calcularTotalPages (audited semantics: 0 for an empty set)", () => {
  it("returns 0 when there are no rows — not a min-1 page", () => {
    expect(calcularTotalPages(0, 25)).toBe(0);
  });

  it("ceils a ≥1 total", () => {
    expect(calcularTotalPages(70, 25)).toBe(3);
    expect(calcularTotalPages(250, 100)).toBe(3);
    expect(calcularTotalPages(50, 25)).toBe(2);
    expect(calcularTotalPages(25, 25)).toBe(1);
  });

  it("is guarded against a non-positive pageSize", () => {
    expect(calcularTotalPages(10, 0)).toBe(10);
  });
});
