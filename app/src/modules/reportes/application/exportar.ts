/**
 * Reportes application — the SINGLE CSV dispatcher (EXP-2, EXP-4).
 *
 * The `/reportes/exportar` route (and the shell's export control) call this ONE entry so every
 * report family shares the SAME authorization seam and the SAME full-dataset rule. It routes by
 * report id: operational ids → the slice-B exporter, slice-C financial ids → the financial
 * exporter, anything else (dashboard, fiscal, rentabilidad) → `REPORTE_NO_AUTORIZADO` (no export
 * path exists yet, and no path ever reaches `MovimientoAuditoria` — EXP-4). The two exporters each
 * re-run their OWN gate + canonical query, so an export can never carry a looser authorization or
 * a different predicate than its on-screen consultation (EXP-4 "authorization identical to
 * consultation", EXP-2 "exports reuse the screen's canonical query").
 */

import { REPORTE_ID, type ReporteId } from "../domain/catalogo";
import { error, type ReportResult } from "../domain/reporte-resultado";
import { REPORTE_NO_AUTORIZADO, messageFor } from "../domain/errors";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { generarCsvOperativo, type CsvResultado } from "./exportar-operativos";
import { generarCsvFinanciero } from "./exportar-financieros";
import { generarCsvRentabilidad } from "./exportar-rentabilidad";

/** The report ids exportable through the shared CSV seam (slice B operational + C financial + D rentabilidad). */
const REPORTES_EXPORTABLES: readonly ReporteId[] = [
  REPORTE_ID.VENTAS,
  REPORTE_ID.PRODUCTOS,
  REPORTE_ID.INVENTARIO,
  REPORTE_ID.FACTURAS,
  REPORTE_ID.CXC,
  REPORTE_ID.CXP,
  REPORTE_ID.COMPARATIVA,
  REPORTE_ID.RENTABILIDAD,
];

const OPERATIVOS = new Set<string>([
  REPORTE_ID.VENTAS,
  REPORTE_ID.PRODUCTOS,
  REPORTE_ID.INVENTARIO,
  REPORTE_ID.FACTURAS,
]);

/**
 * Produce the CSV for any currently-exportable report, delegating to the matching family exporter.
 * An id with no exporter (dashboard / fiscal / an unknown) is denied `REPORTE_NO_AUTORIZADO` before
 * any read — the whole surface is deny-by-default (EXP-4).
 */
export async function generarCsvReporte(
  tx: PrismaTx,
  ctx: TenantCtx,
  reporteId: ReporteId,
  filtro: ReporteFiltro,
): Promise<ReportResult<CsvResultado>> {
  if (!REPORTES_EXPORTABLES.includes(reporteId)) {
    return error(REPORTE_NO_AUTORIZADO, messageFor(REPORTE_NO_AUTORIZADO));
  }
  if (OPERATIVOS.has(reporteId)) {
    return generarCsvOperativo(tx, ctx, reporteId, filtro);
  }
  if (reporteId === REPORTE_ID.RENTABILIDAD) {
    return generarCsvRentabilidad(tx, ctx, reporteId, filtro);
  }
  return generarCsvFinanciero(tx, ctx, reporteId, filtro);
}
