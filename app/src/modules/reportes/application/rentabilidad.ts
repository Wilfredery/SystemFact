/**
 * Reportes application — the product-profitability (rentabilidad) use case (REN-1, REN-2; slice D).
 *
 * A thin read orchestration (ADR-013): `(tx, ctx, filtro)` where `filtro` is ALREADY the normalised,
 * DB-ready {@link ReporteFiltro} (the HTTP adapter ran `normalizarFiltro`, rejecting an invalid range
 * with `REPORTE_VALIDACION` BEFORE any query — OP-6). It reuses the slice-B {@link conPermisoOperativo}
 * gate + company-wide widen VERBATIM: the role matrix already makes rentabilidad Administrador-only
 * (proposal decision 5), so a Cobrador/Despachador/Operador is refused `REPORTE_NO_AUTORIZADO` before
 * any aggregate (DB-2), and an Admin read runs the ratified `conSucursalAmpliadaEnTx` widen (empresa
 * pinned, branch cleared, restored in `finally`, DB-4) with any explicit `sucursalId` narrowed by the
 * SQL `WHERE` (REN-2).
 *
 * The metric math is PURE (`domain/margen.ts`), fed by ONE aggregated per-product read
 * (`infrastructure/rentabilidad-repository.ts`). Because that read returns the FULL grouped dataset
 * un-paged, {@link leerRentabilidadCompleto} — and therefore BOTH the screen summary and the CSV
 * footer — carry the identical page-independent totals (EXP-2 parity by construction). The screen
 * pages the mapped rows in-app over an already-grouped result (bounded by distinct active products,
 * not raw transactions — OP-5 still holds, mirroring the bounded estado-facturas grid).
 *
 * REN-3: the cost-basis limitation is a frozen domain constant the UI and CSV both render; it is
 * surfaced here nowhere (no computation depends on it) but is imported by the panel + exporter so
 * the two can never word it differently.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { REPORTE_ID } from "../domain/catalogo";
import {
  calcularFilaRentabilidad,
  resumirRentabilidad,
  type RentabilidadFila,
  type RentabilidadResumen,
} from "../domain/margen";
import {
  type Pagina,
  type ReportResult,
} from "../domain/reporte-resultado";
import {
  calcularOffset,
  calcularTotalPages,
  type ReporteFiltro,
} from "../domain/reporte-filtro";
import { rentabilidadFilasEnTx } from "../infrastructure/rentabilidad-repository";
import { conPermisoOperativo, ventanaDe } from "./operacional";

/** The full computed rentabilidad dataset: every row + the page-independent Decimal summary. */
export interface RentabilidadCompleta {
  readonly filas: readonly RentabilidadFila[];
  readonly resumen: RentabilidadResumen;
}

/**
 * Read + compute the whole filtered profitability dataset under the SAME gate + widen as the screen.
 * Exported so the CSV path reuses the IDENTICAL authorization and the SAME canonical aggregate
 * (EXP-4 gate parity, EXP-2 totals parity): an export can never be looser or measure differently.
 */
export async function leerRentabilidadCompleta(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<RentabilidadCompleta>> {
  return conPermisoOperativo(tx, ctx, REPORTE_ID.RENTABILIDAD, async (txw) => {
    const insumos = await rentabilidadFilasEnTx(txw, ctx, ventanaDe(filtro));
    const filas = insumos.map((ins) => calcularFilaRentabilidad(ins));
    return { filas, resumen: resumirRentabilidad(filas) };
  });
}

/** The Decimal summary as the `Pagina.resumen` label→string map the screen + CSV footer render (EXP-2). */
function resumenComoMap(r: RentabilidadResumen): Record<string, string> {
  return {
    productos: r.productos,
    unidadesVendidas: r.unidadesVendidas,
    unidadesCompradas: r.unidadesCompradas,
    ventas: r.ventas,
    inversion: r.inversion,
    capital: r.capital,
    margen: r.margen,
    margenPorciento: r.margenPorciento,
  };
}

/**
 * REN-1 / REN-2 — the rentabilidad page. The screen renders one page of rows (25 default / 100 clamp,
 * DB-5); the `resumen` is computed over the WHOLE filtered set so a summary never tracks the page.
 */
export async function consultarRentabilidad(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<Pagina<RentabilidadFila>>> {
  const resultado = await leerRentabilidadCompleta(tx, ctx, filtro);
  if (!resultado.ok) return resultado;

  const { filas, resumen } = resultado.data;
  const total = filas.length;
  const offset = calcularOffset(filtro);
  const paginaFilas = filas.slice(offset, offset + filtro.pageSize);

  const pagina: Pagina<RentabilidadFila> = {
    filas: paginaFilas,
    total,
    page: filtro.page,
    pageSize: filtro.pageSize,
    totalPages: calcularTotalPages(total, filtro.pageSize),
    resumen: resumenComoMap(resumen),
  };
  return { ok: true, data: pagina };
}
