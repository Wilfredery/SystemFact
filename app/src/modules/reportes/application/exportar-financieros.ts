/**
 * Reportes application — the financial CSV export orchestration (EXP-2, EXP-4; slice C).
 *
 * Mirrors the slice-B operational exporter exactly: every generator reuses the IDENTICAL
 * authorization + scope path as its screen (an export bypass is a defect, so the gate is shared,
 * not duplicated) and the SAME infrastructure/canonical query with pagination OMITTED, so the CSV
 * carries the FULL filtered dataset (EXP-2 "screen totals and CSV totals match to the cent";
 * "25/100 pages never truncate an export"). No new dependency; RFC 4180 output via the shared
 * `csv-writer` (EXP-1). Nothing here reaches `MovimientoAuditoria` (EXP-4 "auditoría never
 * exportable in V1").
 *
 *  - CxC — reuses {@link leerCxcAgingCompleto}, which ALREADY owns the Cobrador own-branch pin /
 *    Admin widen-or-pin and the canonical `consultarSaldoCxcEnTx` balance; the export therefore
 *    gets exactly the rows the screen aged, un-paged (a Cobrador export is pinned to their branch
 *    automatically — FIN-3 / EXP-4 "Cobrador CSV pinned to CxC + own branch").
 *  - CxP — reuses the {@link conPermisoOperativo} gate + the `cxpPendienteEnTx` aggregate un-paged
 *    with the SAME window; its footer Σ equals the screen `totalesCxPEnTx` summary.
 *  - Comparativa — reuses {@link ventanasComparativa} for the identical current/preceding windows +
 *    the SAME canonical `totalesVentasEnTx`; the summary block matches the screen totals exactly.
 */

import { REPORTE_ID, type ReporteId } from "../domain/catalogo";
import { BUCKET_AGING, ETIQUETA_BUCKET_AGING, type BucketAging } from "../domain/aging";
import { calcularVariacion } from "../domain/ventana-comparativa";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import { error, ok, type ReportResult } from "../domain/reporte-resultado";
import {
  REPORTE_NO_AUTORIZADO,
  REPORTE_VALIDACION,
  messageFor,
} from "../domain/errors";
import type { ValorCsv } from "../infrastructure/csv-writer";
import { escribirCsv } from "../infrastructure/csv-writer";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { leerCxcAgingCompleto } from "./cxc-aging";
import { conPermisoOperativo, ventanaDe } from "./operacional";
import { ventanasComparativa } from "./financiero";
import { cxpPendienteEnTx, totalesCxPEnTx } from "../infrastructure/cxp-repository";
import { totalesVentasEnTx } from "../infrastructure/dashboard-repository";
import { ventasPorPeriodoEnTx } from "../infrastructure/operacional-repository";
import type { CsvResultado } from "./exportar-operativos";

/** The financial report ids that export to CSV in slice C. */
const FINANCIEROS_EXPORTABLES: readonly ReporteId[] = [
  REPORTE_ID.CXC,
  REPORTE_ID.CXP,
  REPORTE_ID.COMPARATIVA,
];

/** Spanish display label per aging bucket — the SAME domain label the panel renders (no drift). */
function etiquetaBucket(bucket: BucketAging): string {
  return ETIQUETA_BUCKET_AGING[bucket];
}

/**
 * Generate the CSV for one slice-C financial report under the SAME gate/scope/query as its screen.
 * Any id outside the financial set is denied `REPORTE_NO_AUTORIZADO` (the dispatcher routes the
 * operational ids separately; dashboard/fiscal/rentabilidad ids never export through here).
 */
export async function generarCsvFinanciero(
  tx: PrismaTx,
  ctx: TenantCtx,
  reporteId: ReporteId,
  filtro: ReporteFiltro,
  input: { readonly now?: Date } = {},
): Promise<ReportResult<CsvResultado>> {
  if (!FINANCIEROS_EXPORTABLES.includes(reporteId)) {
    return error(REPORTE_NO_AUTORIZADO, messageFor(REPORTE_NO_AUTORIZADO));
  }

  if (reporteId === REPORTE_ID.CXC) {
    // The canonical gate/scope + derived balances come straight from the shared aging read.
    const resultado = await leerCxcAgingCompleto(tx, ctx, filtro, input);
    if (!resultado.ok) return resultado;
    const { filas, resumen } = resultado.data;
    const celdas: ValorCsv[][] = filas.map((f) => [
      f.facturaId,
      f.clienteId,
      f.vencimiento,
      f.diasVencido,
      etiquetaBucket(f.bucket),
      f.saldoPendiente,
    ]);
    // The footer Σ equals the screen summary (page-independent canonical reduction — EXP-2).
    celdas.push([], ["TOTAL CxC", "", "", "", "", resumen.saldoTotal]);
    for (const b of [
      BUCKET_AGING.AL_DIA,
      BUCKET_AGING.VENCIDO_1_30,
      BUCKET_AGING.VENCIDO_31_60,
      BUCKET_AGING.MAYOR_60,
    ] as const) {
      celdas.push([`  ${etiquetaBucket(b)}`, "", "", "", "", resumen.porBucket[b]]);
    }
    return ok<CsvResultado>({
      filename: "cxc-aging.csv",
      csv: escribirCsv(
        ["Factura", "Cliente", "Vencimiento (SD)", "Días vencido", "Rango", "Saldo pendiente"],
        celdas,
      ),
    });
  }

  if (reporteId === REPORTE_ID.CXP) {
    return conPermisoOperativo(tx, ctx, REPORTE_ID.CXP, async (txw) => {
      // Full dataset (no `pag`) — the SAME derived-balance query the screen runs, un-paged.
      const ventana = ventanaDe(filtro);
      const filas = await cxpPendienteEnTx(txw, ctx, ventana);
      const resumen = await totalesCxPEnTx(txw, ctx, ventana);
      const celdas: ValorCsv[][] = filas.map((f) => [
        f.compraId,
        f.proveedorNombre,
        f.sucursalNombre,
        f.fechaSD,
        f.estado,
        f.total,
        f.pagado,
        f.saldoPendiente,
      ]);
      celdas.push([], ["TOTAL CxP", "", "", "", "", "", "", resumen.saldoTotal]);
      return {
        filename: "cxp-pendiente.csv",
        csv: escribirCsv(
          [
            "Compra",
            "Proveedor",
            "Sucursal",
            "Fecha (SD)",
            "Estado",
            "Total",
            "Pagado",
            "Saldo pendiente",
          ],
          celdas,
        ),
      } satisfies CsvResultado;
    });
  }

  // REPORTE_ID.COMPARATIVA — summary block (matches the screen totals) + full day rows.
  const ventanas = ventanasComparativa(filtro);
  if (ventanas === null) {
    return error(REPORTE_VALIDACION, messageFor(REPORTE_VALIDACION));
  }
  return conPermisoOperativo(tx, ctx, REPORTE_ID.COMPARATIVA, async (txw) => {
    const [filas, actuales, anteriores] = await Promise.all([
      ventasPorPeriodoEnTx(txw, ctx, ventanas.actual), // un-paged → every SD day
      totalesVentasEnTx(txw, ctx, ventanas.actual),
      totalesVentasEnTx(txw, ctx, ventanas.anterior),
    ]);
    const variacion = calcularVariacion({
      montoActual: actuales.neto,
      montoAnterior: anteriores.neto,
    });
    const celdas: ValorCsv[][] = [
      ["Período actual", "", variacion.montoActual],
      ["Período anterior", "", variacion.montoAnterior],
      ["Variación", variacion.variacionMonto, `${variacion.variacionPorciento}%`],
      [],
      ...filas.map((f) => [f.fechaSD, f.operaciones, f.neto] as ValorCsv[]),
    ];
    return {
      filename: "comparativa.csv",
      csv: escribirCsv(
        ["Concepto / Fecha (SD)", "Operaciones / Variación", "Monto"],
        celdas,
      ),
    } satisfies CsvResultado;
  });
}
