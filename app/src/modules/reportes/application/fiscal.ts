/**
 * Reportes application — the fiscal (DGII) use cases: ITBIS summary, IT-1 worksheet and the
 * 606/607/608 TXT generators (FIS-1..FIS-6; slice E, tasks 5.3/5.4/5.5/5.6/5.8).
 *
 * Thin read orchestration (ADR-013), EVERY one reusing the slice-B {@link conPermisoOperativo}
 * gate + company-wide widen VERBATIM: the fiscal report ids are Administrador-only in the slice-A
 * role matrix (proposal decision 5), so a non-admin is refused `REPORTE_NO_AUTORIZADO` BEFORE any
 * aggregate (DB-2) and an Admin read runs the ratified `conSucursalAmpliadaEnTx` widen (empresa
 * pinned, branch cleared, restored in `finally`, DB-4) with any explicit `sucursalId` narrowed by
 * the SQL `WHERE`. An EXPORT can therefore never carry a looser authorization than its on-screen
 * consultation (EXP-4), and NO path here touches `MovimientoAuditoria` (EXP-4 "auditoría never
 * exportable in V1"; DB-6).
 *
 * The use case is the ONLY place the raw repository rows meet the PURE domain: it maps each row to
 * a `FilaDetalleNNN` via the domain code derivations, applies the B02 threshold predicate and the
 * payment cross-foot (607), splits at the format caps DETERMINISTICALLY, and assembles the fixed-
 * width document body with the header `CANTIDAD_REGISTROS` matching the part's detail count. The
 * BYTES (encoding/BOM) are applied by the HTTP route through the `infrastructure/dgii-writer` —
 * this layer produces the already-CRLF-joined TEXT (a transport-neutral value), keeping the U1
 * encoding seam out of the logic.
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { REPORTE_ID, type ReporteId } from "../domain/catalogo";
import { error, type ReportResult } from "../domain/reporte-resultado";
import { REPORTE_NO_AUTORIZADO, ReporteDomainError, messageFor } from "../domain/errors";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import { fechaEnSD } from "../domain/zona-horaria";
import {
  construirCasillasIT1,
  construirResumenITBIS,
  type CasillasIT1,
  type ResumenITBIS,
} from "../domain/fiscal";
import { periodoAAAAMM } from "../domain/dgii/formato";
import {
  TOPE_606_POR_DEFECTO,
  TOPE_607,
  TOPE_608,
  nombreArchivoDGII,
  trocearRegistros,
} from "../domain/dgii/topes";
import {
  ensamblarArchivo,
  ensamblarDetalle606,
  ensamblarDetalle607,
  ensamblarDetalle608,
  ensamblarEncabezado5,
  ensamblarEncabezado608,
  type Encabezado608,
  type EncabezadoDGII,
  type FilaDetalle606,
  type FilaDetalle607,
  type FilaDetalle608,
} from "../domain/dgii/registro";
import {
  debeDetallarseEn607,
  distribuirFormasPago607,
  esComprobanteDeVenta607,
  verificarCrucePagos607,
} from "../domain/dgii/pagos-607";
import { resolverTipoIngreso } from "../domain/dgii/tipo-ingreso";
import { derivarTipoIdentificacion } from "../domain/dgii/identificacion";
import { mapearTipoAnulacion } from "../domain/dgii/tipo-anulacion";
import {
  derivarFormaPago606,
  derivarItbis606,
  derivarTipoBienesServicios,
  derivarTipoRetencionISR,
} from "../domain/dgii/mapeo-606";
import {
  leerRncEmpresaEnTx,
  leerMapaTipoIngreso607EnTx,
  leerUmbralConsumo607EnTx,
} from "../infrastructure/dgii-config-repository";
import {
  filas606EnTx,
  filas607EnTx,
  filas608EnTx,
  resumenITBISenTx,
} from "../infrastructure/fiscal-repository";
import { conPermisoOperativo, ventanaDe } from "./operacional";

/** One DGII TXT part (a file within the format cap) + its register count and download name. */
export interface TxtParte {
  readonly filename: string;
  readonly txt: string; // the already-CRLF-joined document body (encoding applied at the route)
  readonly registros: number; // this part's detail count == its header CANTIDAD_REGISTROS
}

/** A full DGII export: one or more parts (a >cap period splits; en-cero yields a single part). */
export interface TxtExportacion {
  readonly codigo: string; // "606" | "607" | "608"
  readonly cantidadArchivos: number;
  readonly partes: readonly TxtParte[];
}

/** The fiscal TXT ids the route serves (606/607/608); anything else is not a TXT export. */
export function esReporteTxtFiscal(id: ReporteId): boolean {
  return id === REPORTE_ID.DGII_606 || id === REPORTE_ID.DGII_607 || id === REPORTE_ID.DGII_608;
}

/**
 * Resolve the DGII `PERIODO` (AAAAMM + numeric year/month) for the export from the (already UTC-
 * bracketed) SD window: the SD calendar month of the window END (or start when the end is open),
 * the natural "which month am I filing" anchor. No manual hour math — the reused SD seam.
 */
function periodoDeFiltro(filtro: ReporteFiltro, now: Date): { anio: number; mes: number } {
  const ancla = filtro.hasta ?? filtro.desde ?? now;
  const sd = fechaEnSD(ancla); // "YYYY-MM-DD"
  const [anio, mes] = sd.split("-").map(Number);
  return { anio: anio as number, mes: mes as number };
}

/** Σ of the base monto across a set of 607 detail rows (the H5 total for a part's header). */
function sumarMontoFacturado(filas: readonly FilaDetalle607[]): string {
  return filas
    .reduce((acc, f) => acc.plus(new Decimal(f.montoFacturado)), new Decimal(0))
    .toDecimalPlaces(2)
    .toFixed(2);
}

/**
 * FIS-1 — the per-period ITBIS summary. Runs under the SAME Admin gate + company-wide widen as the
 * screen; reads the one signed sales-net + purchase-rollup aggregate and feeds the pure summary
 * builder (the B11 no-credit rule is already baked into `itbisComprasAdelantar` by the aggregate's
 * `tipoProveedor='FORMAL'` CASE).
 */
export async function consultarResumenITBIS(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<ResumenITBIS>> {
  return conPermisoOperativo(tx, ctx, REPORTE_ID.ITBIS, async (txw) => {
    const leido = await resumenITBISenTx(txw, ctx, ventanaDe(filtro));
    return construirResumenITBIS(leido);
  });
}

/**
 * FIS-2 — the IT-1 casilla worksheet (débito/crédito/retenido/neto + the Σ606 self-check). It is
 * a SUMMARY, never a TXT (DGII accepts no IT-1 file). `casilla60Manual` lets the worksheet flag a
 * mismatch against Σ606 retenido without ever trusting the manual figure.
 */
export async function consultarCasillasIT1(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
  casilla60Manual?: string | null,
): Promise<ReportResult<CasillasIT1>> {
  const resumen = await consultarResumenITBIS(tx, ctx, filtro);
  if (!resumen.ok) return resumen;
  return { ok: true, data: construirCasillasIT1(resumen.data, casilla60Manual) };
}

/**
 * FIS-3 — the 607 (ventas) TXT export. Reads the VIGENTE sales documents, keeps only a 607 detail
 * row when the domain scope predicate allows it (B01/B03/B04 always; B02 only at ≥ the DB threshold,
 * inclusive), maps each to a fixed-width detail row (DB-resolved Tipo-Ingreso, derived D2, the
 * cross-footed payment split verified to the cent), then splits at the 65,000 cap into deterministic
 * files whose header `CANTIDAD_REGISTROS`/`TOTAL_MONTO` match the part's own rows. A zero-activity
 * period still emits one valid en-cero file.
 */
export async function generarTxt607(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
  now: Date = new Date(),
): Promise<ReportResult<TxtExportacion>> {
  return conPermisoFiscalTxt(tx, ctx, REPORTE_ID.DGII_607, async (txw) => {
    const [rnc, umbral, mapaTipo] = await Promise.all([
      leerRncEmpresaEnTx(txw, ctx.empresaId),
      leerUmbralConsumo607EnTx(txw, ctx.empresaId, now),
      leerMapaTipoIngreso607EnTx(txw, ctx.empresaId, now),
    ]);
    requireRnc(rnc);

    const leidas = await filas607EnTx(txw, ctx, ventanaDe(filtro));
    const periodo = periodoDeFiltro(filtro, now);
    const filas: FilaDetalle607[] = [];
    for (const r of leidas) {
      if (!esComprobanteDeVenta607(r.tipoNcf)) continue;
      if (!debeDetallarseEn607({ tipoNcf: r.tipoNcf, totalBruto: r.totalBruto, umbralB02: umbral })) continue;
      const id = derivarTipoIdentificacion(r.identificacionFiscal, r.esConsumidorFinal);
      const formas = distribuirFormasPago607({ totalBruto: r.totalBruto, cobrosEfectivo: r.cobrosEfectivo });
      verificarCrucePagos607(formas, r.totalBruto); // fail-fast: a broken row can never ship
      const cero = "0.00";
      filas.push({
        rncAdquirente: id.identificacion,
        tipoIdentificacion: id.tipo,
        ncf: r.ncf,
        ncfModificado: r.ncfModificado,
        tipoIngreso: resolverTipoIngreso(r.tipoNcf, mapaTipo),
        fechaComprobante: r.fechaComprobante,
        fechaRetencion: null,
        montoFacturado: r.montoFacturado,
        itbisFacturado: r.itbis,
        itbisRetenidoTerceros: cero,
        itbisPercibido: cero,
        retRentaTerceros: cero,
        isrPercibido: cero,
        isc: cero,
        otrosImp: cero,
        propinaLegal: cero,
        formasPago: formas,
      });
    }
    return armarExportacion("607", rnc, periodo, filas, TOPE_607, (parte) => {
      const header: EncabezadoDGII = {
        codigoInformacion: "607",
        rnc,
        periodo: periodoAAAAMM(periodo.anio, periodo.mes),
        cantidadRegistros: parte.length,
        totalMontoFacturado: sumarMontoFacturado(parte),
      };
      return ensamblarArchivo(ensamblarEncabezado5(header), parte.map(ensamblarDetalle607));
    });
  });
}

/**
 * FIS-4 — the 606 (compras) TXT export. Reads only RECIBIDA/PAGADA purchases, derives the D3 goods/
 * services category, the B11-vs-formal ITBIS al-costo/por-adelantar split (FIS-1 no-credit rule),
 * the D17 ISR retention type (DB-overridable) and the D23 form-of-payment from the applied supplier
 * payments, then splits at the (legacy-defaulted, U5) cap.
 */
export async function generarTxt606(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
  now: Date = new Date(),
): Promise<ReportResult<TxtExportacion>> {
  return conPermisoFiscalTxt(tx, ctx, REPORTE_ID.DGII_606, async (txw) => {
    const rnc = await leerRncEmpresaEnTx(txw, ctx.empresaId);
    requireRnc(rnc);

    const leidas = await filas606EnTx(txw, ctx, ventanaDe(filtro));
    const periodo = periodoDeFiltro(filtro, now);
    const filas: FilaDetalle606[] = leidas.map((r) => {
      const informal = r.tipoProveedor === "INFORMAL";
      // The supplier's OWN fiscal id drives D1/D2, via the same pure derivation as 607: a valid
      // 9-digit RNC → type 1, an 11-digit Cédula → type 2, a blank/unvalid (e.g. an informal with no
      // id on file) → type 3 with a blank D1. We NEVER substitute the remitter's company RNC (that
      // would report the company as its own supplier) — a blank/odd id is the tenant's data concern,
      // surfaced to the pre-validation tool, not fabricated here.
      const id = derivarTipoIdentificacion(r.rncProveedor, false);
      const split = derivarItbis606({ itbisFacturado: r.itbis, proveedorInformal: informal });
      // V1 splits the base into goods OR services by tipoCompra (all-in-one column).
      const esBienes = r.tipoCompra === "MERCANCIA";
      const base = new Decimal(r.subtotalGravado).plus(r.subtotalExento).toDecimalPlaces(2);
      const cero = "0.00";
      return {
        rncProveedor: id.identificacion, // the supplier's own id, blank if none (never the company RNC)
        tipoIdentificacion: id.tipo, // 1 RNC | 2 Cédula | 3 sin identificación (research §4 D2)
        tipoBienesServicios: derivarTipoBienesServicios(r.tipoCompra),
        ncf: r.ncf ?? "",
        ncfModificado: null, // V1 stores no modified-purchase NCF reference (column present, blank)
        fechaComprobante: r.fechaComprobante,
        fechaPago: r.fechaPago,
        montoServicios: esBienes ? cero : base.toFixed(2),
        montoBienes: esBienes ? base.toFixed(2) : cero,
        totalMontoFacturado: base.toFixed(2),
        itbisFacturado: r.itbis,
        itbisRetenido: r.retencionItbis,
        itbisProporcionalidad: split.itbisProporcionalidad,
        itbisAlCosto: split.itbisAlCosto,
        itbisPorAdelantar: split.itbisPorAdelantar,
        itbisPercibido: cero,
        tipoRetencionIsr: derivarTipoRetencionISR({ tipoCompra: r.tipoCompra, montoRetencionIsr: r.retencionIsr }),
        montoRetencionRenta: r.retencionIsr,
        isrPercibido: cero,
        isc: cero,
        otrosImp: cero,
        propinaLegal: cero,
        formaPago: derivarFormaPago606({ estado: r.estado, pagado: r.pagado }),
      } satisfies FilaDetalle606;
    });
    return armarExportacion("606", rnc, periodo, filas, TOPE_606_POR_DEFECTO, (parte) => {
      const header: EncabezadoDGII = {
        codigoInformacion: "606",
        rnc,
        periodo: periodoAAAAMM(periodo.anio, periodo.mes),
        cantidadRegistros: parte.length,
        totalMontoFacturado: parte
          .reduce((acc, f) => acc.plus(new Decimal(f.totalMontoFacturado)), new Decimal(0))
          .toDecimalPlaces(2)
          .toFixed(2),
      };
      return ensamblarArchivo(ensamblarEncabezado5(header), parte.map(ensamblarDetalle606));
    });
  });
}

/**
 * FIS-5 — the 608 (anulados) TXT export. Reads ONLY `FACTURA.estado='ANULADA'` (a `CANCELADA`
 * document never appears here NOR in 607 — the binding scope decision), maps each `Anulacion.motivo`
 * to the DGII 1–10 reason code conservatively, and splits at the 4,999 cap. 608 has NO amounts.
 */
export async function generarTxt608(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
  now: Date = new Date(),
): Promise<ReportResult<TxtExportacion>> {
  return conPermisoFiscalTxt(tx, ctx, REPORTE_ID.DGII_608, async (txw) => {
    const rnc = await leerRncEmpresaEnTx(txw, ctx.empresaId);
    requireRnc(rnc);

    const leidas = await filas608EnTx(txw, ctx, ventanaDe(filtro));
    const periodo = periodoDeFiltro(filtro, now);
    const filas: FilaDetalle608[] = leidas.map((r) => ({
      ncf: r.ncf,
      fechaComprobante: r.fechaComprobante,
      tipoAnulacion: mapearTipoAnulacion(r.motivo),
    }));
    const trozos = trocearRegistros(filas, TOPE_608);
    const partes: TxtParte[] = trozos.map((parte, i) => {
      const header: Encabezado608 = {
        codigoInformacion: "608",
        rnc,
        periodo: periodoAAAAMM(periodo.anio, periodo.mes),
        cantidadRegistros: parte.length,
      };
      return {
        filename: nombreArchivoDGII("608", rnc, periodo.anio, periodo.mes, i + 1, trozos.length),
        txt: ensamblarArchivo(ensamblarEncabezado608(header), parte.map(ensamblarDetalle608)),
        registros: parte.length,
      };
    });
    return { codigo: "608", cantidadArchivos: partes.length, partes };
  });
}

/**
 * A guard THROWING the stable `REPORTE_NO_AUTORIZADO` code when the tenant has no usable RNC: a
 * DGII file with a blank `RNC_CEDULA` is rejected by the tool (research §2), so the export is
 * refused rather than emitting a malformed header. {@link conPermisoFiscalTxt} maps this throw back
 * into a typed result, so it never leaks as an unhandled error across the boundary.
 */
function requireRnc(rnc: string): void {
  if (rnc.trim() === "") {
    throw new ReporteDomainError(REPORTE_NO_AUTORIZADO, { motivo: "rnc_ausente" });
  }
}

/**
 * The fiscal TXT gate wrapper: it delegates to the SHARED {@link conPermisoOperativo} gate + widen
 * (so authorization is byte-identical to the on-screen consultation, EXP-4) and maps a thrown
 * {@link ReporteDomainError} (the blank-RNC refusal) back into a typed `ReportResult`. Anything not
 * a known domain error PROPAGATES (never swallowed — AGENTS.md "no try/catch that swallows errors").
 */
async function conPermisoFiscalTxt(
  tx: PrismaTx,
  ctx: TenantCtx,
  reporteId: ReporteId,
  lectura: (tx: PrismaTx) => Promise<TxtExportacion>,
): Promise<ReportResult<TxtExportacion>> {
  try {
    return await conPermisoOperativo(tx, ctx, reporteId, lectura);
  } catch (e) {
    if (e instanceof ReporteDomainError) {
      return error(e.code, messageFor(e.code));
    }
    throw e;
  }
}

/**
 * Build a {@link TxtExportacion} (the raw payload the gate wraps in `ok`): split the ordered rows at
 * `tope`, then per part compose the fixed-width document body + its DGII filename. Deterministic:
 * identical rows yield identical parts. A zero-row register yields one en-cero part.
 */
function armarExportacion<T>(
  codigo: "606" | "607",
  rnc: string,
  periodo: { anio: number; mes: number },
  filas: readonly T[],
  tope: number,
  ensamblar: (parte: readonly T[]) => string,
): TxtExportacion {
  const trozos = trocearRegistros(filas, tope);
  const partes: TxtParte[] = trozos.map((parte, i) => ({
    filename: nombreArchivoDGII(codigo, rnc, periodo.anio, periodo.mes, i + 1, trozos.length),
    txt: ensamblar(parte),
    registros: parte.length,
  }));
  return { codigo, cantidadArchivos: partes.length, partes };
}

/** The fiscal report ids exportable through the CSV seam (ITBIS + IT-1 summaries — never a TXT). */
export const REPORTES_FISCALES_CSV = [REPORTE_ID.ITBIS, REPORTE_ID.IT1] as const;

/**
 * The SINGLE fiscal TXT dispatcher the DGII export route calls (mirrors {@link generarCsvReporte}):
 * it routes a DGII id to its exporter and re-runs that exporter's OWN gate + widen + aggregate, so
 * an export can never carry a looser authorization or a different predicate than its on-screen
 * consultation (EXP-4) or reach `MovimientoAuditoria` (EXP-4). An id that is not a DGII TXT format
 * (a summary, the dashboard, or an unknown) is denied `REPORTE_NO_AUTORIZADO` before any read.
 */
export async function generarTxtReporte(
  tx: PrismaTx,
  ctx: TenantCtx,
  reporteId: ReporteId,
  filtro: ReporteFiltro,
  now: Date = new Date(),
): Promise<ReportResult<TxtExportacion>> {
  if (reporteId === REPORTE_ID.DGII_607) return generarTxt607(tx, ctx, filtro, now);
  if (reporteId === REPORTE_ID.DGII_606) return generarTxt606(tx, ctx, filtro, now);
  if (reporteId === REPORTE_ID.DGII_608) return generarTxt608(tx, ctx, filtro, now);
  return error(REPORTE_NO_AUTORIZADO, messageFor(REPORTE_NO_AUTORIZADO));
}
