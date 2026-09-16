/**
 * Reportes application — operational CSV export orchestration (EXP-1..EXP-4, slice B live).
 *
 * Export orchestration is application-level (design: "Export orchestration is application-level
 * (`generarCsv`…), with dependency-free string writers in infrastructure"). Each generator:
 *   - runs the SAME `conPermisoOperativo` gate + widen as its on-screen report (EXP-4 — an
 *     export bypass would be a defect, so it literally shares the authorization code path);
 *   - calls the SAME `infrastructure/operacional-repository.ts` aggregate with the `pag`
 *     argument OMITTED → the full filtered dataset, byte-identical WHERE clause to the screen
 *     query, just un-paged (EXP-2 "the CSV contains the full filtered dataset, independent of
 *     screen pagination"; the totals therefore match to the cent by construction);
 *   - hands the rows to the dependency-free `csv-writer` (RFC 4180, CRLF, no BOM, Decimal-as-
 *     text) which is byte-deterministic for identical inputs (EXP-1).
 *
 * No new npm dependency, no DB write, no audit row (the whole reportes surface is read-only,
 * DB-6), and NO export path ever reaches `MovimientoAuditoria` (EXP-4 "auditoría never
 * exportable in V1").
 */

import { REPORTE_ID, type ReporteId } from "../domain/catalogo";
import { clasificarStock } from "../domain/operacional";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import type { ReportResult } from "../domain/reporte-resultado";
import { error } from "../domain/reporte-resultado";
import { REPORTE_NO_AUTORIZADO, messageFor } from "../domain/errors";
import type { ValorCsv } from "../infrastructure/csv-writer";
import { escribirCsv } from "../infrastructure/csv-writer";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  estadoFacturasGridEnTx,
  inventarioValorizadoEnTx,
  productosVendidosEnTx,
  ventasPorPeriodoEnTx,
} from "../infrastructure/operacional-repository";
import { estadoInventarioEnTx } from "../infrastructure/dashboard-repository";
import { conPermisoOperativo, ventanaDe } from "./operacional";

/** A server-generated CSV document plus the suggested download filename. */
export interface CsvResultado {
  readonly filename: string;
  readonly csv: string;
}

/** The operational report ids that currently export to CSV (slice B). */
const OPERATIVOS_EXPORTABLES: readonly ReporteId[] = [
  REPORTE_ID.VENTAS,
  REPORTE_ID.PRODUCTOS,
  REPORTE_ID.INVENTARIO,
  REPORTE_ID.FACTURAS,
];

/**
 * Generate the CSV for one operational report under the SAME gate/widen/predicate as its
 * screen. An id outside the operational set is denied `REPORTE_NO_AUTORIZADO` (the fiscal
 * TXT exporters land in slice E; nothing here reaches audit models). The invalid-range case
 * is impossible: the caller passes an ALREADY-normalised {@link ReporteFiltro}.
 */
export async function generarCsvOperativo(
  tx: PrismaTx,
  ctx: TenantCtx,
  reporteId: ReporteId,
  filtro: ReporteFiltro,
): Promise<ReportResult<CsvResultado>> {
  if (!OPERATIVOS_EXPORTABLES.includes(reporteId)) {
    return error(REPORTE_NO_AUTORIZADO, messageFor(REPORTE_NO_AUTORIZADO));
  }

  if (reporteId === REPORTE_ID.VENTAS) {
    return conPermisoOperativo(tx, ctx, REPORTE_ID.VENTAS, async (txw) => {
      // Full dataset (no `pag`) — the SAME query the screen runs, un-paged.
      const filas = await ventasPorPeriodoEnTx(txw, ctx, ventanaDe(filtro));
      return {
        filename: "ventas-por-periodo.csv",
        csv: escribirCsv(
          ["Fecha (Santo Domingo)", "Ventas confirmadas", "Monto"],
          filas.map((f) => [f.fechaSD, f.operaciones, f.neto]),
        ),
      } satisfies CsvResultado;
    });
  }

  if (reporteId === REPORTE_ID.PRODUCTOS) {
    return conPermisoOperativo(tx, ctx, REPORTE_ID.PRODUCTOS, async (txw) => {
      const filas = await productosVendidosEnTx(txw, ctx, ventanaDe(filtro));
      return {
        filename: "productos-vendidos.csv",
        csv: escribirCsv(
          ["Producto", "Unidades vendidas", "Monto"],
          filas.map((f) => [f.nombre, f.unidades, f.monto]),
        ),
      } satisfies CsvResultado;
    });
  }

  if (reporteId === REPORTE_ID.INVENTARIO) {
    return conPermisoOperativo(tx, ctx, REPORTE_ID.INVENTARIO, async (txw) => {
      const sucursal = { sucursalId: filtro.sucursalId };
      const filas = await inventarioValorizadoEnTx(txw, ctx, sucursal);
      const resumen = await estadoInventarioEnTx(txw, ctx, sucursal);
      const celdas: ValorCsv[][] = filas.map((f) => [
        f.sucursalNombre,
        f.productoNombre,
        f.cantidad,
        f.costoPromedio,
        f.valor,
        clasificarStock(f.cantidad, f.stockMinimo),
      ]);
      // The valuation footer equals the screen's canonical summary (same rollup aggregate).
      celdas.push([], ["TOTAL VALOR", "", "", "", resumen.valor, ""]);
      return {
        filename: "inventario-valorizado.csv",
        csv: escribirCsv(
          ["Sucursal", "Producto", "Cantidad", "Costo promedio", "Valor", "Estado"],
          celdas,
        ),
      } satisfies CsvResultado;
    });
  }

  // REPORTE_ID.FACTURAS — estado × tipoNcf grid with the derived payment state (OP-4).
  return conPermisoOperativo(tx, ctx, REPORTE_ID.FACTURAS, async (txw) => {
    const celdas = await estadoFacturasGridEnTx(txw, ctx, ventanaDe(filtro));
    return {
      filename: "estado-de-facturas.csv",
      csv: escribirCsv(
        [
          "Estado",
          "Tipo NCF",
          "Facturas",
          "Monto",
          "Pendientes",
          "Parciales",
          "Pagadas",
        ],
        celdas.map((c) => [
          c.estado,
          c.tipoNcf,
          c.facturas,
          c.monto,
          c.pendientes,
          c.parciales,
          c.pagadas,
        ]),
      ),
    } satisfies CsvResultado;
  });
}
