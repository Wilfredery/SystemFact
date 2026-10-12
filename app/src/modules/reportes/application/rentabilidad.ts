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
  pagina,
  type ReportResult,
} from "../domain/reporte-resultado";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import {
  contarRentabilidadFilasEnTx,
  rentabilidadFilasEnTx,
} from "../infrastructure/rentabilidad-repository";
import { conPermisoOperativo, paginacionDe, ventanaDe } from "./operacional";

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
 * REN-1 / REN-2 / REN-4 — the rentabilidad page. The page is cut IN SQL
 * (`rentabilidadFilasEnTx`'s pinned `ORDER BY p."id" ASC` + `LIMIT`/`OFFSET` via
 * `paginacionDe`), the filtered `total` is the server-side COUNT over the same
 * CTE-filtered join, and every served row is pure `calcularFilaRentabilidad`
 * (REN-1 formula math — identical across page sizes since it depends only on the
 * row's own insumos). The `resumen` is the page-independent FULL-SET reduction:
 * it keeps `resumirRentabilidad` over the SAME un-paged grouped read the CSV
 * path reuses (`leerRentabilidadCompleta`), a bounded distinct-product aggregate
 * documented like the estado-facturas risk #7 — never re-encoded in SQL, so the
 * screen summary and the CSV footer stay byte-equal (EXP-2).
 */
export async function consultarRentabilidad(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<Pagina<RentabilidadFila>>> {
  return conPermisoOperativo(tx, ctx, REPORTE_ID.RENTABILIDAD, async (txw) => {
    const ventana = ventanaDe(filtro);
    const [insumosPagina, insumosFull, total] = await Promise.all([
      rentabilidadFilasEnTx(txw, ctx, ventana, paginacionDe(filtro)),
      // Page-independent summary over the full grouped set (bounded by DISTINCT
      // products; REN-4's LIMIT/OFFSET governs the screen page only).
      rentabilidadFilasEnTx(txw, ctx, ventana),
      contarRentabilidadFilasEnTx(txw, ctx, ventana),
    ]);
    const resumen = resumirRentabilidad(insumosFull.map((i) => calcularFilaRentabilidad(i)));

    return pagina<RentabilidadFila>(
      filtro,
      insumosPagina.map((i) => calcularFilaRentabilidad(i)),
      total,
      resumenComoMap(resumen),
    );
  });
}
