/**
 * Unit — auditoria pure domain: action enum, filter normalisation, pagination math and
 * the page-DTO mapping (AC-2, AC-3). Jest, no database (the domain is pure).
 * Mirrors the `cobros` domain test style.
 */

import {
  ACCION_AUDITORIA,
  CAMPOS_TEXTO_LIBRE,
  TAMANO_PAGINA_MAXIMO,
  TAMANO_PAGINA_POR_DEFECTO,
  accionAuditoriaDesdeDb,
  calcularOffset,
  calcularTotalPages,
  esAccionAuditoria,
  mapearAPagina,
  normalizarFiltro,
  AccionAuditoriaNoRepresentableError,
  type AuditoriaRegistro,
} from "./auditoria";
import { AUDITORIA_VALIDACION, AuditoriaDomainError } from "./errors";

describe("AccionAuditoria domain enum (mirrors the persisted Prisma enum)", () => {
  it("covers the nine persisted action values, including incidental LEER", () => {
    expect(Object.keys(ACCION_AUDITORIA).sort()).toEqual(
      [
        "CREAR",
        "ACTUALIZAR",
        "CANCELAR",
        "ANULAR",
        "PAGAR",
        "AJUSTAR",
        "LOGIN",
        "LOGOUT",
        "LEER",
      ].sort(),
    );
  });

  it("recognises known values and rejects unknown ones", () => {
    expect(esAccionAuditoria("PAGAR")).toBe(true);
    expect(esAccionAuditoria("BORRAR")).toBe(false);
    expect(esAccionAuditoria(123)).toBe(false);
  });

  it("accionAuditoriaDesdeDb maps known values and fails loud on the unknown", () => {
    expect(accionAuditoriaDesdeDb("LOGIN")).toBe("LOGIN");
    expect(() => accionAuditoriaDesdeDb("ELIMINAR")).toThrow(
      AccionAuditoriaNoRepresentableError,
    );
  });
});

describe("free-text target fields (AC-3)", () => {
  it("searches ONLY entidad/idEntidad/motivo and never the JSON payload columns", () => {
    expect([...CAMPOS_TEXTO_LIBRE].sort()).toEqual(
      ["entidad", "idEntidad", "motivo"].sort(),
    );
    expect(CAMPOS_TEXTO_LIBRE).not.toContain("valorAnterior");
    expect(CAMPOS_TEXTO_LIBRE).not.toContain("valorNuevo");
  });
});

describe("normalizarFiltro (AC-2 / AC-3)", () => {
  it("defaults page and page size on an empty filter", () => {
    const f = normalizarFiltro({});
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(TAMANO_PAGINA_POR_DEFECTO);
    expect(f.accion).toBeUndefined();
    expect(f.texto).toBeUndefined();
    expect(f.desde).toBeUndefined();
  });

  it("clamps an over-large page size to 100 (never accepted)", () => {
    expect(normalizarFiltro({ pageSize: 500 }).pageSize).toBe(TAMANO_PAGINA_MAXIMO);
  });

  it("keeps a valid page size untouched and flooors page below 1 to 1", () => {
    expect(normalizarFiltro({ pageSize: 50 }).pageSize).toBe(50);
    expect(normalizarFiltro({ page: 0 }).page).toBe(1);
    expect(normalizarFiltro({ page: -8 }).page).toBe(1);
    expect(normalizarFiltro({ page: 3 }).page).toBe(3);
  });

  it("floors a fractional page to its integer part", () => {
    expect(normalizarFiltro({ page: 2.9 }).page).toBe(2);
  });

  it("clamps a zero/negative page size up to 1", () => {
    expect(normalizarFiltro({ pageSize: 0 }).pageSize).toBe(1);
    expect(normalizarFiltro({ pageSize: -5 }).pageSize).toBe(1);
  });

  it("trims free text and drops a blank term", () => {
    expect(normalizarFiltro({ texto: "  001  " }).texto).toBe("001");
    expect(normalizarFiltro({ texto: "   " }).texto).toBeUndefined();
  });

  it("accepts a valid action and treats a blank one as no-filter", () => {
    expect(normalizarFiltro({ accion: "CREAR" }).accion).toBe("CREAR");
    expect(normalizarFiltro({ accion: "  " }).accion).toBeUndefined();
  });

  it("rejects an unknown non-empty action with AUDITORIA_VALIDACION", () => {
    expect.assertions(1);
    try {
      normalizarFiltro({ accion: "ELIMINAR" });
    } catch (e) {
      expect((e as AuditoriaDomainError).code).toBe(AUDITORIA_VALIDACION);
    }
  });

  it("keeps positive-integer locator ids and rejects non-positive/non-integer ones", () => {
    expect(normalizarFiltro({ usuarioId: 7 }).usuarioId).toBe(7);
    expect(normalizarFiltro({ usuarioId: null }).usuarioId).toBeUndefined();
    expect(() => normalizarFiltro({ usuarioId: 0 })).toThrow(AuditoriaDomainError);
    expect(() => normalizarFiltro({ sucursalId: 2.5 })).toThrow(AuditoriaDomainError);
  });

  it("converts the SD date range to UTC bounds on the normalised filter", () => {
    const f = normalizarFiltro({ desde: "2026-01-15", hasta: "2026-01-15" });
    expect(f.desde?.toISOString()).toBe("2026-01-15T04:00:00.000Z");
    expect(f.hasta?.toISOString()).toBe("2026-01-16T03:59:59.999Z");
  });
});

describe("pagination math (AC-2)", () => {
  it("computes the zero-based offset from page and size", () => {
    expect(calcularOffset({ page: 1, pageSize: 25 })).toBe(0);
    expect(calcularOffset({ page: 2, pageSize: 25 })).toBe(25);
    expect(calcularOffset({ page: 5, pageSize: 100 })).toBe(400);
  });

  it("derives total pages, and zero for an empty result set", () => {
    expect(calcularTotalPages(250, 25)).toBe(10);
    expect(calcularTotalPages(251, 25)).toBe(11);
    expect(calcularTotalPages(0, 25)).toBe(0);
  });
});

describe("mapearAPagina (AC-2)", () => {
  const fila = (id: number): AuditoriaRegistro => ({
    id,
    empresaId: 1,
    sucursalId: null,
    usuarioId: 9,
    fechaHora: new Date("2026-01-15T05:00:00.000Z"),
    accion: "CREAR",
    entidad: "Factura",
    idEntidad: `NCF-${id}`,
    valorAnterior: null,
    valorNuevo: null,
    motivo: null,
  });

  it("echoes the page and size and computes total pages", () => {
    const p = mapearAPagina({ filas: [fila(1), fila(2)], total: 250, filtro: { page: 2, pageSize: 25 } });
    expect(p.page).toBe(2);
    expect(p.pageSize).toBe(25);
    expect(p.total).toBe(250);
    expect(p.totalPages).toBe(10);
    expect(p.filas).toHaveLength(2);
  });

  it("returns an empty page — not an error — when the requested page is past the end", () => {
    const p = mapearAPagina({ filas: [], total: 250, filtro: { page: 99, pageSize: 25 } });
    expect(p.filas).toEqual([]);
    expect(p.page).toBe(99);
    expect(p.totalPages).toBe(10);
    expect(p.total).toBe(250);
  });

  it("reports total 0 with no pages for an empty result set", () => {
    const p = mapearAPagina({ filas: [], total: 0, filtro: { page: 1, pageSize: 25 } });
    expect(p.totalPages).toBe(0);
    expect(p.filas).toEqual([]);
  });
});
