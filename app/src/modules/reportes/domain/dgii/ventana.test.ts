/**
 * Unit — the DGII TXT export WINDOW rule + the assembled-RESPONSE-SIZE cap. No DB.
 *
 * Two bounds guard a DGII export, and both are PURE decisions so they are provable without a
 * database:
 *   - the export WINDOW. Every DGII TXT format (606, 607, 608) is a MONTHLY filing: its header
 *     carries a single `PERIODO` = AAAAMM. The window must therefore stay inside ONE
 *     `America/Santo_Domingo` calendar month. Bounding "days" is NOT the same rule — 2026-04-01
 *     .. 2026-05-01 is 31 days, yet it spans two months, and the header takes the window END's
 *     month, so the file would be filed as May while carrying April's rows. Same-month
 *     containment subsumes the 31-day maximum (no SD month is longer) and makes that
 *     mislabeling unrepresentable. An ABSENT or one-sided window is refused as unbounded: none of
 *     the three formats is an open-ended register.
 *   - the assembled RESPONSE SIZE. A 65,000-row part is tens of MB of fixed-width text, so a
 *     per-part byte cap refuses a file that cannot fit the server/transport budget.
 *
 * The window MUST be evaluated on the SD business calendar, never on the UTC instant: a window is
 * stored as UTC-bracketed SD day bounds, so 2026-04-30 ends at 2026-05-01T03:59:59.999Z — its UTC
 * month is May while its SD month is April. A UTC-month check would reject a perfectly legal April
 * export. Both conversions go through the shared `fechaEnSD` seam — no manual hour arithmetic
 * (AGENTS.md dates rule).
 */

import {
  REPORTE_DGII_TAMANO_EXCEDIDO,
  REPORTE_DGII_VENTANA_EXCEDIDA,
  ReporteDomainError,
} from "../errors";
import { normalizarFiltro, type ReporteFiltro } from "../reporte-filtro";
import {
  MAX_BYTES_EXPORTACION_DGII,
  bytesUtf8,
  periodoSdDeVentana,
  periodoAprobadoDeVentana,
  verificarTamanoExportacionDgii,
} from "./ventana";

/** The stable code a guard threw, or `null` when it accepted the input. */
function codigoDe(lanzar: () => void): string | null {
  try {
    lanzar();
    return null;
  } catch (e) {
    return e instanceof ReporteDomainError ? e.code : `no-dominio:${String(e)}`;
  }
}

function ventana(desde: string, hasta: string): ReporteFiltro {
  return normalizarFiltro({ desde, hasta });
}

describe("dgii/ventana — a DGII export must stay inside ONE SD calendar month", () => {
  it("resolves the SD period of a bounded window", () => {
    expect(periodoSdDeVentana(ventana("2026-04-01", "2026-04-30"))).toEqual({ anio: 2026, mes: 4 });
    expect(periodoSdDeVentana(ventana("2026-12-01", "2026-12-31"))).toEqual({ anio: 2026, mes: 12 });
  });

  it("admits a window fully inside ONE month, including a whole 31-day month", () => {
    for (const [desde, hasta] of [
      ["2026-04-01", "2026-04-01"], // a single day
      ["2026-04-01", "2026-04-30"],
      ["2026-04-15", "2026-04-15"], // mid-month on both ends
      ["2026-02-01", "2026-02-28"], // February: the shortest month
      ["2026-01-01", "2026-01-31"], // the LONGEST SD month: 31 inclusive days
    ] as const) {
      expect(codigoDe(() => periodoAprobadoDeVentana(ventana(desde, hasta)))).toBeNull();
    }
  });

  it("resolves the period on the SD calendar, NOT on the UTC instant", () => {
    // The stored end bound of 2026-04-30 is 2026-05-01T03:59:59.999Z: its UTC month is MAY while
    // its SD month is April. A UTC-month check would reject this legal April export.
    const abril = ventana("2026-04-01", "2026-04-30");
    expect(abril.hasta?.toISOString()).toBe("2026-05-01T03:59:59.999Z");
    expect(periodoSdDeVentana(abril)?.mes).toBe(4);
    expect(codigoDe(() => periodoAprobadoDeVentana(abril))).toBeNull();
  });

  it("rejects a window that CROSSES a month boundary, however few days it spans", () => {
    for (const [desde, hasta] of [
      ["2026-04-01", "2026-05-01"], // 31 days but two months — the exact mislabeling case
      ["2026-04-30", "2026-05-01"], // two days
      ["2026-04-15", "2026-05-15"], // a month apart, mid-month ends
      ["2026-12-31", "2027-01-01"], // across the YEAR boundary
    ] as const) {
      expect(codigoDe(() => periodoAprobadoDeVentana(ventana(desde, hasta)))).toBe(
        REPORTE_DGII_VENTANA_EXCEDIDA,
      );
    }
  });

  it("rejects an ABSENT or one-sided window — an unbounded export is never exportable", () => {
    // A one-sided request: `normalizarFiltro` only fills a preset when BOTH ends are absent, so
    // this is exactly what a `{ desde }`-only URL produces.
    const soloDesde = normalizarFiltro({ desde: "2026-04-01" });
    const soloHasta = normalizarFiltro({ hasta: "2026-04-30" });
    expect(periodoSdDeVentana(soloDesde)).toBeNull();
    expect(periodoSdDeVentana(soloHasta)).toBeNull();
    expect(codigoDe(() => periodoAprobadoDeVentana(soloDesde))).toBe(REPORTE_DGII_VENTANA_EXCEDIDA);
    expect(codigoDe(() => periodoAprobadoDeVentana(soloHasta))).toBe(REPORTE_DGII_VENTANA_EXCEDIDA);

    // A fully open window (no preset resolution reached it).
    const abierto: ReporteFiltro = { page: 1, pageSize: 25 };
    expect(periodoSdDeVentana(abierto)).toBeNull();
    expect(codigoDe(() => periodoAprobadoDeVentana(abierto))).toBe(REPORTE_DGII_VENTANA_EXCEDIDA);
  });

  it("YIELDS THE APPROVED PERIOD, so the header and the guard can never disagree", () => {
    expect(periodoAprobadoDeVentana(ventana("2026-04-01", "2026-04-30"))).toEqual({ anio: 2026, mes: 4 });
    expect(codigoDe(() => periodoAprobadoDeVentana(ventana("2026-04-01", "2026-05-01")))).toBe(
      REPORTE_DGII_VENTANA_EXCEDIDA,
    );
  });

  it("a NON-NULL period is only ever returned for a genuine single-month window", () => {
    // The safety property the application layer depends on: it takes this period straight into the
    // `PERIODO` header, so `null` must cover BOTH "unbounded" and "straddles a month". A resolver
    // that returned April for an April..May window would hand the caller exactly the mislabeling
    // this module exists to prevent, and it would do so with a confident non-null value.
    expect(periodoSdDeVentana(ventana("2026-04-01", "2026-05-01"))).toBeNull();
    expect(periodoSdDeVentana(ventana("2026-12-31", "2027-01-01"))).toBeNull();
    expect(periodoSdDeVentana(normalizarFiltro({ desde: "2026-04-01" }))).toBeNull();
    expect(periodoSdDeVentana(ventana("2026-04-01", "2026-04-30"))).toEqual({ anio: 2026, mes: 4 });
  });

  it("carries the two SD months in `details` so the operator sees WHY it was refused", () => {    try {
      periodoAprobadoDeVentana(ventana("2026-04-01", "2026-05-01"));
      throw new Error("debía rechazar la ventana");
    } catch (e) {
      expect(e).toBeInstanceOf(ReporteDomainError);
      if (!(e instanceof ReporteDomainError)) throw e;
      expect(e.details).toEqual({ mesDesde: "2026-04", mesHasta: "2026-05" });
    }
  });
});

describe("dgii/ventana — the assembled response is capped at 50 MiB", () => {
  it("accepts an ordinary part", () => {
    expect(codigoDe(() => verificarTamanoExportacionDgii("607", "60700000000123\n"))).toBeNull();
  });

  it("accepts a part of EXACTLY the cap and refuses one byte over it", () => {
    expect(MAX_BYTES_EXPORTACION_DGII).toBe(52_428_800); // 50 MiB
    expect(codigoDe(() => verificarTamanoExportacionDgii("607", "x".repeat(MAX_BYTES_EXPORTACION_DGII)))).toBeNull();
    expect(codigoDe(() => verificarTamanoExportacionDgii("607", "x".repeat(MAX_BYTES_EXPORTACION_DGII + 1)))).toBe(
      REPORTE_DGII_TAMANO_EXCEDIDO,
    );
  });

  it("names the format and the sizes in `details` (the operator must learn WHICH file was too big)", () => {
    try {
      verificarTamanoExportacionDgii("606", "x".repeat(MAX_BYTES_EXPORTACION_DGII + 1));
      throw new Error("debía rechazar la parte");
    } catch (e) {
      expect(e).toBeInstanceOf(ReporteDomainError);
      if (!(e instanceof ReporteDomainError)) throw e;
      expect(e.details).toEqual({
        codigo: "606",
        bytes: MAX_BYTES_EXPORTACION_DGII + 1,
        maxBytes: MAX_BYTES_EXPORTACION_DGII,
      });
    }
  });

  it("measures UTF-8 BYTES, not JS chars (a multi-byte name counts for its real size)", () => {
    expect(bytesUtf8("abc")).toBe(3);
    expect(bytesUtf8("ñ")).toBe(2);
    expect(bytesUtf8("")).toBe(0);
    // A part of 1 char over the cap whose UTF-8 size is 2 bytes is still over.
    expect(codigoDe(() => verificarTamanoExportacionDgii("608", "x".repeat(MAX_BYTES_EXPORTACION_DGII - 1) + "ñ"))).toBe(
      REPORTE_DGII_TAMANO_EXCEDIDO,
    );
  });
});
