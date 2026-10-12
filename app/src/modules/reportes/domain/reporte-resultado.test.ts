/**
 * Unit — the ONE `pagina<T>` assembler (D3/D7, R-QC-07 "duplicated helpers = 0").
 *
 * The assembler used to be duplicated verbatim at `application/operacional.ts`
 * and `application/financiero.ts`; this module now owns it beside `Pagina<T>`.
 * The fixtures below pin the moved implementation produces the byte-equal
 * `Pagina<T>` fields BOTH former copies produced (`filas`, `total`, echoed
 * `page`/`pageSize`, `totalPages` with the shared audited semantics and the
 * `resumen` map) across pages — a pure module test, no DB (R-QC-07).
 */

import { pagina, type Pagina } from "./reporte-resultado";
import type { ReporteFiltro } from "./reporte-filtro";

function filtro(over: { page?: number; pageSize?: number }): ReporteFiltro {
  return {
    page: over.page ?? 1,
    pageSize: over.pageSize ?? 25,
  };
}

function fila(i: number): { readonly fechaSD: string; readonly neto: string } {
  return { fechaSD: `2026-09-0${(i % 9) + 1}`, neto: `${1000 + i}.00` };
}

describe("pagina<T> assembler (the single reportes copy)", () => {
  it("fixtures produce the byte-equal Pagina across pages (filas/total/page/pageSize/totalPages/resumen)", () => {
    const filas = [fila(1), fila(2), fila(3)];

    const p1: Pagina<{ fechaSD: string; neto: string }> = pagina(
      filtro({ page: 1, pageSize: 25 }),
      filas,
      70,
      { totalNeto: "103000.00", totalOperaciones: "3" },
    );

    // Field-by-field shape pin (the contract both former copies emitted).
    expect(p1.filas).toEqual(filas);
    expect(p1.total).toBe(70);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(25);
    expect(p1.totalPages).toBe(3);
    expect(p1.resumen).toEqual({ totalNeto: "103000.00", totalOperaciones: "3" });

    // A later page echoes the page it served — never a re-computed one.
    const p3 = pagina(filtro({ page: 3, pageSize: 25 }), [], 70, {});
    expect(p3.page).toBe(3);
    expect(p3.filas).toEqual([]);
    expect(p3.totalPages).toBe(3);
  });

  it("the totalPages semantics are the shared audited base: 0 for an empty total", () => {
    const empty = pagina(filtro({ page: 1 }), [], 0, {});
    expect(empty.total).toBe(0);
    expect(empty.totalPages).toBe(0);
  });
});
