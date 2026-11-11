/**
 * The daily-close PDF builder (S4) — a PURE projection of the close DTO.
 *
 * It computes no figure: the use case owns every number and the /caja screen's own helpers
 * (`caja-formato`, `shared/ui/format`) own every label and every format, so the exported document
 * can never print a different value or a different wording than the screen for the same payload.
 *
 * Deliberate constraints (S4):
 *  - pdfkit is created per call through an injectable factory ({@link CreadorDocPdf}) — the route
 *    passes the standard one, tests can pass their own;
 *  - ONLY the built-in standard fonts (Helvetica) are used: no font file is read from disk, no
 *    external network, so the handler stays safe in a serverless runtime;
 *  - `compress: false` keeps the content stream readable (the bytes are the contract S9 asserts).
 */

import PDFDocument from "pdfkit";
import type { CierreDiarioDto } from "@/modules/caja/http/shared";
import {
  FORMULA_CORTE,
  TEXTO_NOTA_CIERRE,
  etiquetaMetodo,
  formatearMontoConSigno,
} from "@/modules/caja/ui/caja-formato";
import { formatearFechaSD, formatearMonto } from "@/shared/ui/format";

/** What the PDF needs that the close DTO does not carry: the resolved read-only scope label. */
export interface EntradaCierrePdf {
  readonly cierre: CierreDiarioDto;
  /** Already resolved by the route (session branch, or company-wide for an Administrador). */
  readonly alcanceNombre: string;
}

/** How a document is created — the seam that keeps this builder testable. */
export type CreadorDocPdf = () => PDFKit.PDFDocument;

/** The production factory: A4, standard fonts, uncompressed content stream. */
export function crearDocCierrePdf(): PDFKit.PDFDocument {
  return new PDFDocument({ size: "A4", margin: MARGEN, compress: false });
}

const MARGEN = 54;
const ANCHO_UTIL = 595.28 - MARGEN * 2;
const DERECHA = MARGEN + ANCHO_UTIL;
const TINTA = "#18181b";
const TENUE = "#52525b";
const BORDE = "#d4d4d8";

/** Where each table column starts (the Método column is the only left-aligned one). */
const COL = {
  metodo: { x: MARGEN + 6, width: 140 },
  ventas: { x: 200, width: 108 },
  cobros: { x: 312, width: 108 },
  total: { x: 424, width: 111 },
} as const;

const ALTO_FILA = 18;
const LIMITE_PAGINA = 720;

/**
 * Make a wireframe string printable with the built-in standard fonts. WinAnsi has no U+2212
 * (mathematical minus), so the formula's minus is folded to the ASCII hyphen — the ONE glyph the
 * PDF cannot carry, and the only difference from the screen's wording.
 */
function textoSeguro(texto: string): string {
  return texto.replace(/−/g, "-");
}

/** A filled light panel (used for the KPI cards and the corte block). */
function panel(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number): void {
  doc.save().rect(x, y, w, h).fillColor("#f4f4f5").fill().restore();
}

/** One KPI card: label above, figure below. */
function kpi(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  etiqueta: string,
  valor: string,
): void {
  panel(doc, x, y, w, 52);
  doc
    .fillColor(TENUE)
    .font("Helvetica")
    .fontSize(9)
    .text(etiqueta, x + 10, y + 9, { width: w - 20 });
  doc
    .fillColor(TINTA)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(valor, x + 10, y + 26, { width: w - 20 });
}

/** One right-aligned money cell of the método table. */
function celdaNumero(
  doc: PDFKit.PDFDocument,
  columna: { readonly x: number; readonly width: number },
  y: number,
  valor: string,
): void {
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(TINTA)
    .text(valor, columna.x, y, { width: columna.width, align: "right" });
}

/** One label/value term of the corte panel. */
function termino(
  doc: PDFKit.PDFDocument,
  y: number,
  etiqueta: string,
  valor: string,
): void {
  doc.fillColor(TENUE).font("Helvetica").fontSize(10).text(etiqueta, MARGEN + 10, y, { width: 200 });
  doc
    .fillColor(TINTA)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(valor, DERECHA - 200, y, { width: 190, align: "right" });
}

/**
 * Render the close to a PDF buffer. Every figure is the DTO's already-computed value; a zero day
 * simply prints zeros.
 */
export async function construirCierrePdf(
  entrada: EntradaCierrePdf,
  crearDoc: CreadorDocPdf = crearDocCierrePdf,
): Promise<Buffer> {
  const { cierre, alcanceNombre } = entrada;
  const doc = crearDoc();
  const trozos: Buffer[] = [];

  const fin = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (trozo: Buffer) => trozos.push(trozo));
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);
  });

  // Header: title, SD date, tenant scope (mirrors the screen's read-only header).
  doc.fillColor(TINTA).font("Helvetica-Bold").fontSize(18).text("Cierre diario de caja", MARGEN, MARGEN);
  doc
    .fillColor(TENUE)
    .font("Helvetica")
    .fontSize(10)
    .text(`${formatearFechaSD(cierre.fechaSD)} (America/Santo_Domingo)`, MARGEN, MARGEN + 26);
  doc.text(alcanceNombre, MARGEN, MARGEN + 40);
  doc
    .moveTo(MARGEN, MARGEN + 58)
    .lineTo(DERECHA, MARGEN + 58)
    .strokeColor(BORDE)
    .lineWidth(1)
    .stroke();

  // The four 06a KPIs (2 x 2), the Diferencia carrying its sign like the screen.
  const yKpi = MARGEN + 72;
  const anchoKpi = (ANCHO_UTIL - 12) / 2;
  kpi(doc, MARGEN, yKpi, anchoKpi, "Total facturado", formatearMonto(cierre.totalFacturado));
  kpi(
    doc,
    MARGEN,
    yKpi + 60,
    anchoKpi,
    "Total cobrado",
    formatearMonto(cierre.totalCobrado),
  );
  kpi(
    doc,
    MARGEN + anchoKpi + 12,
    yKpi,
    anchoKpi,
    "Efectivo esperado",
    formatearMontoConSigno(cierre.efectivoEsperado),
  );
  kpi(
    doc,
    MARGEN + anchoKpi + 12,
    yKpi + 60,
    anchoKpi,
    "Diferencia",
    formatearMontoConSigno(cierre.diferencia),
  );

  // The método table: Método | Ventas | Cobros | Total. No per-method sales source exists in the
  // schema (S6 defines ONE day-level sale total), so the per-method Ventas cell stays an honest "—".
  let y = yKpi + 132;
  doc.fillColor(TENUE).font("Helvetica").fontSize(10).text("Método", COL.metodo.x, y);
  celdaNumero(doc, COL.ventas, y, "Ventas");
  celdaNumero(doc, COL.cobros, y, "Cobros");
  celdaNumero(doc, COL.total, y, "Total");
  y += ALTO_FILA;
  doc.moveTo(MARGEN, y - 4).lineTo(DERECHA, y - 4).strokeColor(BORDE).stroke();

  for (const fila of cierre.metodos) {
    if (y > LIMITE_PAGINA) {
      doc.addPage();
      y = MARGEN;
    }
    doc
      .fillColor(TINTA)
      .font("Helvetica")
      .fontSize(10)
      .text(etiquetaMetodo(fila.metodo), COL.metodo.x, y, { width: COL.metodo.width });
    celdaNumero(doc, COL.ventas, y, "—");
    celdaNumero(doc, COL.cobros, y, formatearMonto(fila.cobros));
    celdaNumero(doc, COL.total, y, formatearMonto(fila.cobros));
    y += ALTO_FILA;
  }

  // Total row — the SAME composition the screen uses: the money COUNTED this day (the use case's
  // `totalCobrado`) fills both the Cobros and the Total cell; Ventas stays the day-level context.
  const cobrosTotal = formatearMonto(cierre.totalCobrado);
  doc.moveTo(MARGEN, y - 4).lineTo(DERECHA, y - 4).strokeColor(BORDE).stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(TINTA)
    .text("Total", COL.metodo.x, y, { width: COL.metodo.width });
  celdaNumero(doc, COL.ventas, y, formatearMonto(cierre.totalFacturado));
  celdaNumero(doc, COL.cobros, y, cobrosTotal);
  celdaNumero(doc, COL.total, y, cobrosTotal);
  y += ALTO_FILA + 18;

  // Corte de caja panel: the formula then its two terms and the result.
  if (y > LIMITE_PAGINA) {
    doc.addPage();
    y = MARGEN;
  }
  panel(doc, MARGEN, y, ANCHO_UTIL, 104);
  doc
    .fillColor(TINTA)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text("Corte de caja", MARGEN + 10, y + 10, { width: ANCHO_UTIL - 20 });
  doc
    .fillColor(TENUE)
    .font("Helvetica")
    .fontSize(8)
    .text(textoSeguro(FORMULA_CORTE), MARGEN + 10, y + 26, { width: ANCHO_UTIL - 20 });
  termino(doc, y + 44, "Cobros", formatearMonto(cierre.corte.cobros));
  termino(doc, y + 62, "Devoluciones", formatearMonto(cierre.corte.devoluciones));
  termino(doc, y + 80, "Esperado", formatearMontoConSigno(cierre.efectivoEsperado));
  y += 104 + 18;

  // Diferencia, spelled out with its formula so the sign is never read as a corte deviation.
  doc
    .fillColor(TENUE)
    .font("Helvetica")
    .fontSize(9)
    .text(textoSeguro("Diferencia = Total cobrado − Total facturado"), MARGEN, y, {
      width: ANCHO_UTIL,
    });
  doc
    .fillColor(TINTA)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(formatearMontoConSigno(cierre.diferencia), MARGEN, y + 14, { width: ANCHO_UTIL });
  y += 42;

  // The wireframe's informational note (verbatim, single-sourced with the screen).
  doc.fillColor(TENUE).font("Helvetica").fontSize(8).text(TEXTO_NOTA_CIERRE, MARGEN, y, {
    width: ANCHO_UTIL,
  });

  doc.end();
  return fin;
}
