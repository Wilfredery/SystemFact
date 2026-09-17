/**
 * Reportes application — the rentabilidad CSV export (EXP-1..EXP-4 + REN-3; slice D).
 *
 * Mirrors the slice-B/C exporters exactly, so the export shares the screen's authorization and
 * canonical query rather than duplicating them (EXP-4 "an export bypass is a defect"; EXP-2 "exports
 * reuse the screen's canonical query"): it reuses {@link leerRentabilidadCompleta}, which runs the
 * SAME `conPermisoOperativo` gate + company-wide widen and the SAME one aggregated per-product read,
 * UN-PAGED → the CSV carries the FULL filtered dataset and its footer Σ equals the screen summary.
 * Output is the dependency-free RFC 4180 writer (EXP-1). Nothing here reaches `MovimientoAuditoria`
 * (EXP-4 "auditoría never exportable in V1"); rentabilidad is Administrador-only, so any other role
 * is refused `REPORTE_NO_AUTORIZADO` before a single row is read.
 *
 * REN-3 — the cost-basis limitation TRAVELS WITH THE FILE: the disclaimer
 * ({@link NOTA_LIMITACION_RENTABILIDAD}, the SAME frozen string the on-screen panel shows) is written
 * as a trailing footer note on every rentabilidad CSV, so no consumer mistakes the current-cost
 * figures for frozen historical margins.
 */

import { REPORTE_ID, type ReporteId } from "../domain/catalogo";
import { NOTA_LIMITACION_RENTABILIDAD } from "../domain/margen";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import { type ReportResult } from "../domain/reporte-resultado";
import { error } from "../domain/reporte-resultado";
import { REPORTE_NO_AUTORIZADO, messageFor } from "../domain/errors";
import { escribirCsv } from "../infrastructure/csv-writer";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { leerRentabilidadCompleta } from "./rentabilidad";
import type { CsvResultado } from "./exportar-operativos";

/**
 * Generate the rentabilidad CSV under the SAME gate/widen/query as its screen. Only the
 * `RENTABILIDAD` id exports through here (the dispatcher routes the other families separately);
 * anything else is denied `REPORTE_NO_AUTORIZADO` before any read.
 */
export async function generarCsvRentabilidad(
  tx: PrismaTx,
  ctx: TenantCtx,
  reporteId: ReporteId,
  filtro: ReporteFiltro,
): Promise<ReportResult<CsvResultado>> {
  if (reporteId !== REPORTE_ID.RENTABILIDAD) {
    return error(REPORTE_NO_AUTORIZADO, messageFor(REPORTE_NO_AUTORIZADO));
  }

  const resultado = await leerRentabilidadCompleta(tx, ctx, filtro);
  if (!resultado.ok) return resultado;

  const { filas, resumen } = resultado.data;
  const cabecera = [
    "Producto",
    "Precio costo",
    "Precio salida",
    "Unidades vendidas",
    "Unidades compradas",
    "Inversión",
    "Ventas",
    "Capital",
    "Margen",
    "Margen %",
  ];

  const celdas: (string | number)[][] = filas.map((f) => [
    f.nombre,
    f.precioCosto,
    f.precioSalida,
    f.unidadesVendidas,
    f.unidadesCompradas,
    f.inversion,
    f.ventas,
    f.capital,
    f.margen,
    f.margenPorciento,
  ]);

  // The footer TOTAL row equals the screen's page-independent Decimal summary (EXP-2 parity).
  celdas.push([], [
    "TOTAL",
    "",
    "",
    resumen.unidadesVendidas,
    resumen.unidadesCompradas,
    resumen.inversion,
    resumen.ventas,
    resumen.capital,
    resumen.margen,
    `${resumen.margenPorciento}%`,
  ]);

  // REN-3 — the cost-basis limitation note travels with every exported rentabilidad file.
  celdas.push([], [NOTA_LIMITACION_RENTABILIDAD]);

  return {
    ok: true,
    data: {
      filename: "rentabilidad-por-producto.csv",
      csv: escribirCsv(cabecera, celdas),
    },
  };
}
