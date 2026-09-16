/**
 * Reportes application — canonical CxC rows → dashboard summary.
 *
 * Bridges the single canonical per-invoice aggregate ({@link SaldoCxcFila} from `cobros`)
 * to the dashboard tile via the pure {@link resumirCxC} Decimal reduction. Its own tiny
 * module so both the ADMIN and COBRADOR branches of `consultarDashboard` reuse the SAME
 * summary path (no drift between the company-wide and own-branch figures).
 */

import { resumirCxC } from "../domain/cxc-resumen";
import type { CxCResumenKpi } from "../domain/dashboard";

/** Minimal structural shape of a canonical CxC row this mapping needs. */
export interface FilaSaldo {
  readonly saldoPendiente: string;
}

/** Reduce the canonical per-invoice rows to the dashboard CxC summary. */
export function resumenFromFilas(
  filas: readonly FilaSaldo[],
): CxCResumenKpi {
  const r = resumirCxC(filas);
  return { facturasPendientes: r.facturasPendientes, saldoTotal: r.saldoTotal };
}
