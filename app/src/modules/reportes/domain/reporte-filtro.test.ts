/**
 * Unit — shared reportes filter contract (DB-3, DB-5). No DB.
 *
 * Pins the transport normalisation the whole reportes surface inherits: pageSize default
 * 25 / hard clamp 100, page ≥ 1, a `desde > hasta` window rejected with the stable
 * `REPORTE_VALIDACION` before any query, presets resolving to the natural SD period, and
 * the SD→UTC window built on the reused Intl seam.
 */

import { REPORTE_VALIDACION, ReporteDomainError } from "./errors";
import {
  TAMANO_PAGINA_MAXIMO,
  TAMANO_PAGINA_POR_DEFECTO,
  calcularOffset,
  calcularTotalPages,
  normalizarFiltro,
  presetARango,
} from "./reporte-filtro";

describe("normalizarFiltro — pagination clamp (DB-5)", () => {
  it("defaults page to 1 and pageSize to 25", () => {
    const f = normalizarFiltro({});
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(TAMANO_PAGINA_POR_DEFECTO);
  });

  it("clamps an oversized pageSize to 100 (never accepted)", () => {
    const f = normalizarFiltro({ pageSize: 500 });
    expect(f.pageSize).toBe(TAMANO_PAGINA_MAXIMO);
    expect(f.pageSize).toBe(100);
  });

  it("floors a page below 1 to the first page and truncates a fractional page", () => {
    expect(normalizarFiltro({ page: 0 }).page).toBe(1);
    expect(normalizarFiltro({ page: -5 }).page).toBe(1);
    expect(normalizarFiltro({ page: 2.9 }).page).toBe(2);
  });

  it("clamps a zero/negative pageSize into [1, 100]", () => {
    expect(normalizarFiltro({ pageSize: 0 }).pageSize).toBe(1);
    expect(normalizarFiltro({ pageSize: 37 }).pageSize).toBe(37);
  });

  it("rejects a non-positive or non-integer sucursalId as REPORTE_VALIDACION", () => {
    expect(() => normalizarFiltro({ sucursalId: 0 })).toThrow(ReporteDomainError);
    expect(() => normalizarFiltro({ sucursalId: 1.5 })).toThrow(ReporteDomainError);
    try {
      normalizarFiltro({ sucursalId: -3 });
    } catch (e) {
      expect((e as ReporteDomainError).code).toBe(REPORTE_VALIDACION);
    }
  });
});

describe("normalizarFiltro — SD date window (DB-5, reused Intl seam)", () => {
  it("converts a full SD range into inclusive UTC bounds (SD day = UTC 04:00 boundary)", () => {
    const f = normalizarFiltro({ desde: "2026-01-15", hasta: "2026-01-16" });
    expect(f.desde?.toISOString()).toBe("2026-01-15T04:00:00.000Z");
    expect(f.hasta?.toISOString()).toBe("2026-01-17T03:59:59.999Z");
  });

  it("rejects desde > hasta with REPORTE_VALIDACION (never silently flipped)", () => {
    expect.assertions(2);
    try {
      normalizarFiltro({ desde: "2026-01-16", hasta: "2026-01-15" });
    } catch (e) {
      expect(e).toBeInstanceOf(ReporteDomainError);
      expect((e as ReporteDomainError).code).toBe(REPORTE_VALIDACION);
    }
  });

  it("rejects a malformed (non YYYY-MM-DD) date as REPORTE_VALIDACION", () => {
    expect(() => normalizarFiltro({ desde: "2026-1-5" })).toThrow(ReporteDomainError);
    expect(() => normalizarFiltro({ hasta: "15/01/2026" })).toThrow(ReporteDomainError);
  });

  it("treats a blank/whitespace date as 'not provided' (open window), not invalid", () => {
    const f = normalizarFiltro({ desde: "   ", hasta: "" });
    expect(f.desde).toBeUndefined();
    expect(f.hasta).toBeUndefined();
  });
});

describe("presetARango + preset resolution (DB-5 period presets)", () => {
  // 2026-03-15 is a Sunday in SD calendar time.
  const ancla = new Date("2026-03-15T18:00:00.000Z"); // 14:00 SD Sun 2026-03-15

  it("HOY spans exactly the single SD day", () => {
    const r = presetARango("HOY", ancla);
    expect(r).toEqual({ desde: "2026-03-15", hasta: "2026-03-15" });
  });

  it("MES spans the natural month (01..31 for March)", () => {
    const r = presetARango("MES", ancla);
    expect(r).toEqual({ desde: "2026-03-01", hasta: "2026-03-31" });
  });

  it("ANIO spans Jan 1 .. Dec 31 of the SD year", () => {
    const r = presetARango("ANIO", ancla);
    expect(r).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
  });

  it("SEMANA is Monday-anchored and fully contains the SD day", () => {
    const r = presetARango("SEMANA", ancla);
    // Sunday 2026-03-15 → ISO week Mon 2026-03-09 .. Sun 2026-03-15.
    expect(r).toEqual({ desde: "2026-03-09", hasta: "2026-03-15" });
  });

  it("normalizarFiltro resolves a preset when no explicit range is given", () => {
    const f = normalizarFiltro({ preset: "mes" }, ancla);
    expect(f.desde?.toISOString()).toBe("2026-03-01T04:00:00.000Z");
    expect(f.hasta?.toISOString()).toBe("2026-04-01T03:59:59.999Z");
  });

  it("an unknown preset fails as REPORTE_VALIDACION", () => {
    expect(() => normalizarFiltro({ preset: "SIGLO" }, ancla)).toThrow(ReporteDomainError);
  });
});

describe("pagination helpers", () => {
  it("offset = (page-1)*pageSize", () => {
    expect(calcularOffset({ page: 3, pageSize: 25 })).toBe(50);
    expect(calcularOffset({ page: 1, pageSize: 100 })).toBe(0);
  });

  it("totalPages is 0 for an empty set and ceil otherwise", () => {
    expect(calcularTotalPages(0, 25)).toBe(0);
    expect(calcularTotalPages(250, 100)).toBe(3);
    expect(calcularTotalPages(50, 25)).toBe(2);
  });
});
