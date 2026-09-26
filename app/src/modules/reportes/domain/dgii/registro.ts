/**
 * Reportes domain — the DGII fixed-width RECORD assemblers for 607 (ventas), 606 (compras) and
 * 608 (anulados), plus their encabezado (FIS-3/FIS-4/FIS-5; slice E, tasks 5.1/5.3/5.4/5.5).
 *
 * ADR-013: PURE TypeScript. Every row DTO is already Decimal-STRING-typed and pre-mapped by the
 * repository/use case; this module ONLY lays the values out at fixed widths and joins them
 * space-delimited (research §2: "Texto delimitado por espacios" — no separator char, NO pipe per
 * U6). The field WIDTHS are the single centralized config seam (research §9 U2: exact byte offsets
 * are UNVERIFIED) — if the DGII pre-validation tool reports a width mismatch, editing the widths
 * here changes every record with zero touch to the mapping/assembly logic. Money via
 * {@link formatearMonto} (decimal point inside the field, zero-left-padded, negatives for B04),
 * dates via {@link fechaAAAMMDD}, alphanumeric (RNC/NCF) via {@link rellenarAlnum} (right space-
 * pad), small integer codes via {@link rellenarEnteroIzq} (zero-left-pad).
 *
 * DETERMINISTIC BYTES (EXP-1 discipline carried to TXT): given the same DTOs these functions emit
 * identical output; the encoding/line-ending (U1) is applied by the `infrastructure/` writer, so a
 * tool-verified CRLF↔LF or ASCII↔cp1252 change requires no domain edit.
 */

import {
  LARGO_IMPORTE_DEFAULT,
  LARGO_NCF,
  LARGO_REGISTROS_DEFAULT,
  LARGO_RNC,
  LARGO_TOTAL_MONTO_DEFAULT,
  SEPARADOR_LINEA,
  ensamblarLinea,
  fechaAAAMMDD,
  formatearMonto,
  rellenarAlnum,
  rellenarEnteroIzq,
  validarPeriodoAAAAMM,
} from "./formato";
import {
  REPORTE_DGII_CODIGO_INVALIDO,
  ReporteDomainError,
} from "../errors";
import type { FormasPago607 } from "./pagos-607";

/**
 * Field widths for the 607/606/608 columns. The MONEY / COUNT / TOTAL widths are imported from
 * `formato` (the SINGLE declared source — a U2 byte-offset fix edits `formato`, never a second
 * copy here); the small CODE widths are layout-only constants local to the record shape.
 */
const W_IMPORTE = LARGO_IMPORTE_DEFAULT; // N12
const W_MONTO_TOTAL = LARGO_TOTAL_MONTO_DEFAULT; // header TOTAL_MONTO_FACTURADO N16
const W_REGISTROS = LARGO_REGISTROS_DEFAULT; // header CANTIDAD_REGISTROS N12
const W_FECHA = 8; // AAAAMMDD (a natural length; padding is a no-op for a real date)
const W_ID = 1; // TipoIdentificación N1
const W_TIPO_INGRESO = 1; // 607 D5 code
const W_TIPO_BIEN = 2; // 606 D3 (01–11)
const W_TIPO_ISR = 1; // 606 D17 ISR retention type
const W_FORMA_PAGO = 1; // 606 D23 FormaPago
const W_TIPO_ANULACION = 2; // 608 D3 (1–10)

/**
 * One VIGENTE sales document's 607 DETAIL inputs (spec FIS-3, 23 columns). Every amount is a
 * `Decimal(12,2)` string, the payment split is pre-cross-footed by {@link distribuirFormasPago607}.
 * Dates are UTC instants laid out to the SD `AAAAMMDD` business date here.
 */
export interface FilaDetalle607 {
  readonly rncAdquirente: string | null; // D1 (blank for an unidentified final consumer)
  readonly tipoIdentificacion: 1 | 2 | 3; // D2
  readonly ncf: string; // D3 (11 positions, WITH the 2-char tipoNcf prefix)
  readonly ncfModificado: string | null; // D4 (blank if none)
  readonly tipoIngreso: string; // D5 (DB-resolved income code, U3)
  readonly fechaComprobante: Date; // D6
  readonly fechaRetencion: Date | null; // D7 (blank if none)
  readonly montoFacturado: string; // D8 (base, excl. ITBIS)
  readonly itbisFacturado: string; // D9
  readonly itbisRetenidoTerceros: string; // D10
  readonly itbisPercibido: string; // D11
  readonly retRentaTerceros: string; // D12
  readonly isrPercibido: string; // D13
  readonly isc: string; // D14
  readonly otrosImp: string; // D15
  readonly propinaLegal: string; // D16
  readonly formasPago: FormasPago607; // D17–D23 (cross-footed to gross total)
}

/** Assemble one 607 detail line (D1–D23), fixed-width, space-delimited. */
export function ensamblarDetalle607(f: FilaDetalle607): string {
  return ensamblarLinea([
    rellenarAlnum(f.rncAdquirente ?? "", LARGO_RNC), // D1
    rellenarEnteroIzq(f.tipoIdentificacion, W_ID), // D2
    rellenarAlnum(f.ncf, LARGO_NCF), // D3
    rellenarAlnum(f.ncfModificado ?? "", LARGO_NCF), // D4
    rellenarAlnum(f.tipoIngreso, W_TIPO_INGRESO), // D5
    fechaAAAMMDD(f.fechaComprobante).padEnd(W_FECHA, " "), // D6 (blank if undated)
    fechaAAAMMDD(f.fechaRetencion).padEnd(W_FECHA, " "), // D7
    formatearMonto(f.montoFacturado, W_IMPORTE), // D8
    formatearMonto(f.itbisFacturado, W_IMPORTE), // D9
    formatearMonto(f.itbisRetenidoTerceros, W_IMPORTE), // D10
    formatearMonto(f.itbisPercibido, W_IMPORTE), // D11
    formatearMonto(f.retRentaTerceros, W_IMPORTE), // D12
    formatearMonto(f.isrPercibido, W_IMPORTE), // D13
    formatearMonto(f.isc, W_IMPORTE), // D14
    formatearMonto(f.otrosImp, W_IMPORTE), // D15
    formatearMonto(f.propinaLegal, W_IMPORTE), // D16
    formatearMonto(f.formasPago.efectivo, W_IMPORTE), // D17
    formatearMonto(f.formasPago.chequeTransferencia, W_IMPORTE), // D18
    formatearMonto(f.formasPago.tarjeta, W_IMPORTE), // D19
    formatearMonto(f.formasPago.ventaCredito, W_IMPORTE), // D20
    formatearMonto(f.formasPago.bonos, W_IMPORTE), // D21
    formatearMonto(f.formasPago.permuta, W_IMPORTE), // D22
    formatearMonto(f.formasPago.otrasFormas, W_IMPORTE), // D23
  ]);
}

/** A 606/607 header record (the shared 5-field shape — research §3/§4). */
export interface EncabezadoDGII {
  readonly codigoInformacion: "606" | "607"; // H1 — the file-type label, frozen
  readonly rnc: string; // remitter's RNC (no dashes)
  readonly periodo: string; // AAAAMM
  readonly cantidadRegistros: number; // this file's detail count (≤ cap)
  readonly totalMontoFacturado: string; // Σ base, Decimal string
}

/** Assemble a 606/607 encabezado (H1–H5). The header is NOT counted in CANTIDAD_REGISTROS.
 * The period and the file-type label are both asserted before being laid out (a free-string
 * period or a mislabelled file can never be emitted raw). */
export function ensamblarEncabezado5(h: EncabezadoDGII): string {
  validarPeriodoAAAAMM(h.periodo);
  if (h.codigoInformacion !== "606" && h.codigoInformacion !== "607") {
    // Defense-in-depth: TS already narrows the type, but transport input can bypass types.
    throw new ReporteDomainError(REPORTE_DGII_CODIGO_INVALIDO, {
      codigo: h.codigoInformacion,
    });
  }
  return ensamblarLinea([
    h.codigoInformacion, // H1 (literal "606"/"607")
    rellenarAlnum(h.rnc, LARGO_RNC), // H2
    h.periodo, // H3 (AAAAMM, already 6)
    rellenarEnteroIzq(h.cantidadRegistros, W_REGISTROS), // H4
    formatearMonto(h.totalMontoFacturado, W_MONTO_TOTAL), // H5
  ]);
}

/**
 * One purchase's 606 DETAIL inputs (spec FIS-4, current ~23-col layout). Amounts are Decimal
 * strings; `montoServicios`/`montoBienes` split the base; the ITBIS columns are derived upstream
 * (por-adelantar = facturado − al-costo), ISR retention type is a 1–8 code.
 */
export interface FilaDetalle606 {
  readonly rncProveedor: string; // D1 (never blank)
  readonly tipoIdentificacion: 1 | 2 | 3; // D2
  readonly tipoBienesServicios: number; // D3 (01–11)
  readonly ncf: string; // D4 (purchase NCF incl. prefix; B01/B11)
  readonly ncfModificado: string | null; // D5
  readonly fechaComprobante: Date; // D6
  readonly fechaPago: Date | null; // D7 (required when a retention is reported)
  readonly montoServicios: string; // D8
  readonly montoBienes: string; // D9
  readonly totalMontoFacturado: string; // D10 (auto D8+D9 — still emitted)
  readonly itbisFacturado: string; // D11
  readonly itbisRetenido: string; // D12 (B11 → 100%, servicio profesional → 30%)
  readonly itbisProporcionalidad: string; // D13 (art. 349)
  readonly itbisAlCosto: string; // D14
  readonly itbisPorAdelantar: string; // D15 (auto D11 − D14 — emitted for the file)
  readonly itbisPercibido: string; // D16
  readonly tipoRetencionIsr: number; // D17 (1–8; 0 when none)
  readonly montoRetencionRenta: string; // D18
  readonly isrPercibido: string; // D19
  readonly isc: string; // D20
  readonly otrosImp: string; // D21
  readonly propinaLegal: string; // D22
  readonly formaPago: number; // D23 (1–7)
}

/** Assemble one 606 detail line (D1–D23), fixed-width, space-delimited. */
export function ensamblarDetalle606(f: FilaDetalle606): string {
  return ensamblarLinea([
    rellenarAlnum(f.rncProveedor, LARGO_RNC), // D1
    rellenarEnteroIzq(f.tipoIdentificacion, W_ID), // D2
    rellenarEnteroIzq(f.tipoBienesServicios, W_TIPO_BIEN), // D3
    rellenarAlnum(f.ncf, LARGO_NCF), // D4
    rellenarAlnum(f.ncfModificado ?? "", LARGO_NCF), // D5
    fechaAAAMMDD(f.fechaComprobante).padEnd(W_FECHA, " "), // D6
    fechaAAAMMDD(f.fechaPago).padEnd(W_FECHA, " "), // D7
    formatearMonto(f.montoServicios, W_IMPORTE), // D8
    formatearMonto(f.montoBienes, W_IMPORTE), // D9
    formatearMonto(f.totalMontoFacturado, W_IMPORTE), // D10
    formatearMonto(f.itbisFacturado, W_IMPORTE), // D11
    formatearMonto(f.itbisRetenido, W_IMPORTE), // D12
    formatearMonto(f.itbisProporcionalidad, W_IMPORTE), // D13
    formatearMonto(f.itbisAlCosto, W_IMPORTE), // D14
    formatearMonto(f.itbisPorAdelantar, W_IMPORTE), // D15
    formatearMonto(f.itbisPercibido, W_IMPORTE), // D16
    rellenarEnteroIzq(f.tipoRetencionIsr, W_TIPO_ISR), // D17
    formatearMonto(f.montoRetencionRenta, W_IMPORTE), // D18
    formatearMonto(f.isrPercibido, W_IMPORTE), // D19
    formatearMonto(f.isc, W_IMPORTE), // D20
    formatearMonto(f.otrosImp, W_IMPORTE), // D21
    formatearMonto(f.propinaLegal, W_IMPORTE), // D22
    rellenarEnteroIzq(f.formaPago, W_FORMA_PAGO), // D23
  ]);
}

/** One annulled document's 608 DETAIL inputs (spec FIS-5, 3 columns — NO amounts). */
export interface FilaDetalle608 {
  readonly ncf: string; // D1 (the annulled NCF, 11 positions)
  readonly fechaComprobante: Date; // D2 (original issue date, AAAAMMDD)
  readonly tipoAnulacion: number; // D3 (1–10, mapped from Anulacion.motivo)
}

/** Assemble one 608 detail line (D1–D3), fixed-width, space-delimited. */
export function ensamblarDetalle608(f: FilaDetalle608): string {
  return ensamblarLinea([
    rellenarAlnum(f.ncf, LARGO_NCF), // D1
    fechaAAAMMDD(f.fechaComprobante).padEnd(W_FECHA, " "), // D2
    rellenarEnteroIzq(f.tipoAnulacion, W_TIPO_ANULACION), // D3
  ]);
}
/** The 608 header shape — the SAME 5-field encabezado minus H5 TOTAL_MONTO (608 has no amounts). */
export interface Encabezado608 {
  readonly codigoInformacion: "608";
  readonly rnc: string;
  readonly periodo: string; // AAAAMM
  readonly cantidadRegistros: number; // ≤ 4,999
}

/**
 * Assemble the 608 encabezado: `608` + RNC(11) + periodo(6) + CANTIDAD_REGISTROS(12) — the 608
 * header carries NO total-monto field (research §5: "No amounts are reported in 608"). The period
 * is validated before being laid out, exactly like the 606/607 header.
 */
export function ensamblarEncabezado608(h: Encabezado608): string {
  validarPeriodoAAAAMM(h.periodo);
  return ensamblarLinea([
    h.codigoInformacion,
    rellenarAlnum(h.rnc, LARGO_RNC),
    h.periodo,
    rellenarEnteroIzq(h.cantidadRegistros, W_REGISTROS),
  ]);
}

/**
 * Compose the encabezado + its detail rows into ONE TXT document body (the pre-encoding, line-
 * separated text). Header and details are joined by {@link SEPARADOR_LINEA} with a trailing
 * terminator, and NO separator line sits between the header and the first detail (research §2).
 * A zero-length detail array yields a valid EN-CERO file (header only, CANTIDAD_REGISTROS=0) — the
 * header's own count is the caller's to set from the row length, so this stays consistent.
 */
export function ensamblarArchivo(
  encabezado: string,
  detalles: readonly string[],
): string {
  const lineas = [encabezado, ...detalles];
  return `${lineas.join(SEPARADOR_LINEA)}${SEPARADOR_LINEA}`;
}
