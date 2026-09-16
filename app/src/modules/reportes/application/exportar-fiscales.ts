/**
 * Reportes application — the ITBIS / IT-1 CSV summaries (FIS-1/FIS-2, EXP-1..EXP-4; slice E).
 *
 * MIRRORS the slice-B/C/D CSV exporters exactly: it reuses {@link consultarResumenITBIS} /
 * {@link consultarCasillasIT1}, which run the SAME `conPermisoOperativo` gate + company-wide widen
 * and the SAME aggregate as the on-screen figures (EXP-4 authorization parity, EXP-2 totals parity),
 * so the exported worksheet can never disagree with the panel and can never be reached by a role the
 * screen refuses. The dependency-free RFC 4180 CSV writer produces deterministic, no-BOM bytes (EXP-1).
 *
 * CRITICAL (FIS-2): IT-1 is a DATA SUMMARY, never a DGII TXT — so it exports to CSV only, and this
 * module (and the fiscal panel) carry the SAME frozen note. No IT-1 "TXT" is ever claimed here.
 * Nothing reaches `MovimientoAuditoria` (EXP-4). Fiscal is Administrador-only, so any other role is
 * refused `REPORTE_NO_AUTORIZADO` before a single aggregate runs.
 */

import { REPORTE_ID, type ReporteId } from "../domain/catalogo";
import { error, type ReportResult } from "../domain/reporte-resultado";
import { REPORTE_NO_AUTORIZADO, messageFor } from "../domain/errors";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import {
  NOTA_B11_SIN_CREDITO_FISCAL,
  NOTA_VENCIMIENTO_IT1,
} from "../domain/fiscal";
import { escribirCsv } from "../infrastructure/csv-writer";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { consultarCasillasIT1, consultarResumenITBIS } from "./fiscal";
import type { CsvResultado } from "./exportar-operativos";

/**
 * Generate the ITBIS-summary CSV (FIS-1) or the IT-1 casilla worksheet CSV (FIS-2), each under the
 * SAME gate + aggregate as its screen. An id outside {itbis, it1} is denied (the DGII TXT formats are
 * served by the fiscal TXT route, not this CSV seam).
 */
export async function generarCsvFiscal(
  tx: PrismaTx,
  ctx: TenantCtx,
  reporteId: ReporteId,
  filtro: ReporteFiltro,
): Promise<ReportResult<CsvResultado>> {
  if (reporteId === REPORTE_ID.ITBIS) {
    const r = await consultarResumenITBIS(tx, ctx, filtro);
    if (!r.ok) return error(r.code, r.message); // forward the real code (deny-by-default already applied in the gate)
    const d = r.data;
    return {
      ok: true,
      data: {
        filename: "resumen-itbis.csv",
        csv: escribirCsv(
          ["Concepto", "Monto (RD$)"],
          [
            ["Débito fiscal (Σ ITBIS ventas, neto NC/ND)", d.debitoFiscal],
            ["Crédito fiscal / ITBIS por adelantar (Σ606)", d.creditoFiscal],
            ["ITBIS retenido (Σ606)", d.itbisRetenido],
            ["ISR retenido (Σ606)", d.isrRetenido],
            [],
            [NOTA_B11_SIN_CREDITO_FISCAL],
          ],
        ),
      },
    };
  }

  if (reporteId === REPORTE_ID.IT1) {
    const r = await consultarCasillasIT1(tx, ctx, filtro);
    if (!r.ok) return error(r.code, r.message); // forward the real code (deny-by-default already applied in the gate)
    const w = r.data;
    return {
      ok: true,
      data: {
        filename: "it1-casillas.csv",
        csv: escribirCsv(
          ["Casilla IT-1", "Monto (RD$)"],
          [
            ["Débito fiscal", w.debitoFiscal],
            ["Crédito / adelantos", w.creditoAdelantos],
            ["ITBIS retenido (casilla 60 = Σ606)", w.itbisRetenido],
            ["ISR retenido", w.isrRetenido],
            ["Neto a pagar (débito − crédito)", w.netoAPagar],
            [],
            w.avisoValidacion === null ? [] : [`AVISO: ${w.avisoValidacion}`],
            [NOTA_VENCIMIENTO_IT1],
            [NOTA_B11_SIN_CREDITO_FISCAL],
            [],
            ["Nota: IT-1 se declara en la Oficina Virtual (formulario interactivo); DGII no acepta un archivo TXT del IT-1."],
          ],
        ),
      },
    };
  }

  return error(REPORTE_NO_AUTORIZADO, messageFor(REPORTE_NO_AUTORIZADO));
}
