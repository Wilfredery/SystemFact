/**
 * Reportes application — the CxP and comparativa use cases (FIN-3..FIN-5; slice C).
 *
 * Both are Administrador-only financial reports, so they reuse the slice-B
 * {@link conPermisoOperativo} gate + company-wide widen VERBATIM: the role matrix already denies
 * a Cobrador `REPORTE_NO_AUTORIZADO` BEFORE any aggregate (FIN-3), and an Admin read runs the
 * ratified `conSucursalAmpliadaEnTx` (empresa pinned, branch cleared, restored in `finally`, DB-4)
 * with any explicit `sucursalId` narrowed by a plain SQL `WHERE`. Neither re-implements a balance:
 *
 *   - CxP (FIN-4): the outstanding payable is DERIVED at query time in
 *     `infrastructure/cxp-repository.ts` (`Compra.total − ΣPagoProveedor APLICADO`, estado
 *     PENDIENTE/RECIBIDA; a PAGADA nets 0, ADR-017/never-materialized). The screen pages it; the
 *     CSV calls the SAME repository un-paged (EXP-2 parity).
 *   - Comparativa (FIN-5): the current window and its immediately-preceding equal-length SD month
 *     are both measured with the SAME canonical confirmed-sales totals aggregate the dashboard and
 *     operational reports already reuse (`totalesVentasEnTx`), and the pure
 *     {@link calcularVariacion} derives the Decimal monto + percentage (zero baseline → 0). A
 *     missing window is refused with `REPORTE_VALIDACION` BEFORE any query (FIN-5); an inverted
 *     one was already rejected pre-transaction by `normalizarFiltro`. The Total row is the CURRENT
 *     period only.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { REPORTE_ID } from "../domain/catalogo";
import { REPORTE_VALIDACION, messageFor } from "../domain/errors";
import { type Pagina, type ReportResult } from "../domain/reporte-resultado";
import { calcularOffset, calcularTotalPages, type ReporteFiltro } from "../domain/reporte-filtro";
import type { CxpFila, ComparativaFila } from "../domain/financiero";
import type { VentasPeriodoFila } from "../domain/operacional";
import { fechaEnSD, fechaSDaUTC } from "../domain/zona-horaria";
import {
  calcularVariacion,
  ventanaPrecedenteMes,
} from "../domain/ventana-comparativa";
import { conPermisoOperativo, ventanaDe } from "./operacional";
import { type Paginacion } from "../infrastructure/operacional-repository";
import {
  contarCxPEnTx,
  cxpPendienteEnTx,
  totalesCxPEnTx,
} from "../infrastructure/cxp-repository";
import { totalesVentasEnTx } from "../infrastructure/dashboard-repository";
import {
  contarDiasVentasEnTx,
  ventasPorPeriodoEnTx,
} from "../infrastructure/operacional-repository";

/** The `[offset, pageSize)` page window for the aggregate reads. */
function paginacionDe(filtro: ReporteFiltro): Paginacion {
  return { offset: calcularOffset(filtro), limit: filtro.pageSize };
}

/** Both comparison windows as DB-ready `VentanaFiltro`s (the current + equal-length preceding). */
export interface VentanasComparativa {
  readonly actual: ReturnType<typeof ventanaDe>;
  readonly anterior: ReturnType<typeof ventanaDe>;
}

/**
 * Derive the current and immediately-preceding equal-length SD windows from a normalised filter
 * as UTC-bracketed {@link VentanaFiltro}s. Returns `null` when the current window is not fully
 * bounded (an open-ended range cannot define an equal-length baseline). The SD↔UTC conversion and
 * the month-shift both reuse the ratified seams (no duplicated math). Exported so the CSV export
 * path derives the IDENTICAL windows as the screen (EXP-2 parity by construction).
 */
export function ventanasComparativa(filtro: ReporteFiltro): VentanasComparativa | null {
  if (filtro.desde === undefined || filtro.hasta === undefined) return null;
  const desdeSD = fechaEnSD(filtro.desde);
  const hastaSD = fechaEnSD(filtro.hasta);
  const anteriorSD = ventanaPrecedenteMes({ desde: desdeSD, hasta: hastaSD });
  return {
    actual: ventanaDe(filtro),
    anterior: {
      desde: fechaSDaUTC(anteriorSD.desde, "inicio"),
      hasta: fechaSDaUTC(anteriorSD.hasta, "fin"),
      sucursalId: filtro.sucursalId,
    },
  };
}

/** FIN-4 — the accounts-payable report: derived unpaid balances over open purchases. */
export async function consultarCxP(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<Pagina<CxpFila>>> {
  return conPermisoOperativo(tx, ctx, REPORTE_ID.CXP, async (txw) => {
    const ventana = ventanaDe(filtro);
    const [filas, total, resumen] = await Promise.all([
      cxpPendienteEnTx(txw, ctx, ventana, paginacionDe(filtro)),
      contarCxPEnTx(txw, ctx, ventana),
      totalesCxPEnTx(txw, ctx, ventana),
    ]);
    return pagina<CxpFila>(filtro, filas, total, {
      saldoTotal: resumen.saldoTotal,
      comprasAbiertas: String(total),
    });
  });
}

/** FIN-5 — current vs immediately-preceding equal-length SD window, with Decimal variation. */
export async function consultarComparativa(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<Pagina<ComparativaFila>>> {
  // A comparison needs a DEFINED current window on both ends; refuse before opening any query
  // (FIN-5 "invalid ranges … without executing a query"; an inverted range was rejected earlier
  // by normalizarFiltro). An open-ended window cannot bound the equal-length baseline.
  const ventanas = ventanasComparativa(filtro);
  if (ventanas === null) {
    return { ok: false, code: REPORTE_VALIDACION, message: messageFor(REPORTE_VALIDACION) };
  }

  return conPermisoOperativo(tx, ctx, REPORTE_ID.COMPARATIVA, async (txw) => {
    const [filas, total, actuales, anteriores] = await Promise.all([
      ventasPorPeriodoEnTx(txw, ctx, ventanas.actual, paginacionDe(filtro)),
      contarDiasVentasEnTx(txw, ctx, ventanas.actual),
      // REUSE the canonical confirmed-sales totals for BOTH windows — one definition, no drift.
      totalesVentasEnTx(txw, ctx, ventanas.actual),
      totalesVentasEnTx(txw, ctx, ventanas.anterior),
    ]);
    const variacion = calcularVariacion({
      montoActual: actuales.neto,
      montoAnterior: anteriores.neto,
    });
    const comparativaFilas: ComparativaFila[] = filas.map((f: VentasPeriodoFila) => ({
      fechaSD: f.fechaSD,
      monto: f.neto,
    }));
    return pagina<ComparativaFila>(filtro, comparativaFilas, total, {
      // The Total row carries the CURRENT period only (wireframe 2.5.1); the baseline + the
      // variation are shown separately so a mixed-period total is never implied.
      montoActual: variacion.montoActual,
      montoAnterior: variacion.montoAnterior,
      variacionMonto: variacion.variacionMonto,
      variacionPorciento: variacion.variacionPorciento,
    });
  });
}

/** Assemble a {@link Pagina} from a page of rows, the filtered total and a Decimal summary. */
function pagina<T>(
  filtro: ReporteFiltro,
  filas: readonly T[],
  total: number,
  resumen: Readonly<Record<string, string>>,
): Pagina<T> {
  return {
    filas,
    total,
    page: filtro.page,
    pageSize: filtro.pageSize,
    totalPages: calcularTotalPages(total, filtro.pageSize),
    resumen,
  };
}
