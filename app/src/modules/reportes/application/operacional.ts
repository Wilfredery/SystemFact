/**
 * Reportes application — the operational report use cases (slice B: OP-1..OP-6).
 *
 * Thin read orchestrations (ADR-013), each `(tx, ctx, filtro)` where `filtro` is ALREADY the
 * normalised, DB-ready {@link ReporteFiltro} (the HTTP adapter ran `normalizarFiltro`, which
 * rejects an invalid range with `REPORTE_VALIDACION` BEFORE any query — OP-6 "no query
 * executes"). All four share ONE gate+widen flow:
 *
 *   1. DENY-BY-DEFAULT on the report id via the slice-A role matrix (these four are
 *      Administrador-only — proposal decision 5); a Cobrador/Despachador/Operador is refused
 *      `REPORTE_NO_AUTORIZADO` with NO aggregate run (DB-2 "UI hiding is not the control").
 *   2. A permitted actor is an Admin → run the aggregates inside the ratified
 *      `conSucursalAmpliadaEnTx` widen (company-wide over the pinned empresa; branch GUC
 *      restored in `finally`, empresa never cleared — DB-4). An explicit `sucursalId` filter
 *      still narrows in the SQL `WHERE`, so "company-wide" and "branch X" share one path.
 *   3. Assemble the {@link Pagina} with its page-independent Decimal `resumen` (the SAME
 *      canonical aggregate the CSV footer reuses → EXP-2 parity).
 *
 * Money is Decimal-string end-to-end; counts cross SQL as `::int`. The queries themselves
 * live in `infrastructure/operacional-repository.ts` (SQL aggregation pushdown — OP-5).
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { ReporteFiltro } from "../domain/reporte-filtro";
import { calcularOffset } from "@/shared/domain/pagination";
import { ok, error, type Pagina, type ReportResult, pagina } from "../domain/reporte-resultado";
import { REPORTE_NO_AUTORIZADO, messageFor } from "../domain/errors";
import { rolPermitidoParaReporte } from "../domain/roles";
import type { ReporteId } from "../domain/catalogo";
import { REPORTE_ID } from "../domain/catalogo";
import { clasificarStock } from "../domain/operacional";
import type {
  EstadoFacturaCelda,
  InventarioValorizadoFila,
  ProductoVendidoFila,
  VentasPeriodoFila,
} from "../domain/operacional";
import { leerRolesUsuarioEnTx } from "../infrastructure/roles-repository";
import { conSucursalAmpliadaEnTx } from "../infrastructure/widen-sucursal-guc";
import type { VentanaFiltro } from "../infrastructure/dashboard-repository";
import { estadoInventarioEnTx, totalesVentasEnTx } from "../infrastructure/dashboard-repository";
import {
  contarDiasVentasEnTx,
  contarInventarioValorizadoEnTx,
  contarProductosVendidosEnTx,
  estadoFacturasGridEnTx,
  inventarioValorizadoEnTx,
  productosVendidosEnTx,
  totalesProductosVendidosEnTx,
  ventasPorPeriodoEnTx,
  type Paginacion,
} from "../infrastructure/operacional-repository";

/** The DB window a `ReporteFiltro` yields for the aggregate reads (dates already UTC).
 *  EXPORTED so the CSV export path derives the SAME window (shared canonical predicate). */
export function ventanaDe(filtro: ReporteFiltro): VentanaFiltro {
  return { desde: filtro.desde, hasta: filtro.hasta, sucursalId: filtro.sucursalId };
}

/**
 * The `[offset, pageSize)` page window for the aggregate reads. EXPORTED so the
 * rentabilidad use case (slice H2) derives its page window from the SAME
 * definition — the shared `calcularOffset` over the already-normalised filter —
 * never a second offset formula (R-QC-07; D3's `Paginacion` bind bundle).
 */
export function paginacionDe(filtro: ReporteFiltro): Paginacion {
  return { offset: calcularOffset(filtro.page, filtro.pageSize), limit: filtro.pageSize };
}

/**
 * The shared authorization + widen flow (DB-2, DB-4). Denies a non-permitted role BEFORE any
 * aggregate; otherwise runs `lectura` company-wide for the (only-permitted) Admin via the
 * ratified widen. Returns the typed result — a `ReportResult<never>` on refusal (the caller
 * propagates the code), otherwise the assembled payload wrapped in `ok`. EXPORTED so the CSV
 * export path reuses the IDENTICAL gate (EXP-4 "authorization identical to consultation") and
 * the SAME widen — an export can never carry a looser authorization than its screen.
 */
export async function conPermisoOperativo<T>(
  tx: PrismaTx,
  ctx: TenantCtx,
  reporteId: ReporteId,
  lectura: (tx: PrismaTx) => Promise<T>,
): Promise<ReportResult<T>> {
  const roles = await leerRolesUsuarioEnTx(tx, ctx);
  if (!rolPermitidoParaReporte(roles, reporteId)) {
    return error(REPORTE_NO_AUTORIZADO, messageFor(REPORTE_NO_AUTORIZADO));
  }
  // The only permitted role for every operational report is Administrador (decision 5), so a
  // permitted actor is an Admin and the company-wide widen is the correct scope.
  const data = await conSucursalAmpliadaEnTx(tx, ctx, lectura);
  return ok(data);
}

/** OP-1 — confirmed sales grouped by SD calendar day, paged, with the full-window summary. */
export async function consultarVentasPorPeriodo(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<Pagina<VentasPeriodoFila>>> {
  return conPermisoOperativo(tx, ctx, REPORTE_ID.VENTAS, async (txw) => {
    const ventana = ventanaDe(filtro);
    const [filas, total, resumen] = await Promise.all([
      ventasPorPeriodoEnTx(txw, ctx, ventana, paginacionDe(filtro)),
      contarDiasVentasEnTx(txw, ctx, ventana),
      // REUSE the canonical confirmed-sales totals aggregate (shared with the dashboard tile
      // and the CSV footer) — never a second balance/sum definition (EXP-2, OP-5).
      totalesVentasEnTx(txw, ctx, ventana),
    ]);
    return pagina<VentasPeriodoFila>(filtro, filas, total, {
      totalNeto: resumen.neto,
      totalOperaciones: String(resumen.operaciones),
    });
  });
}

/** OP-2 — per-product sold units + monto (SQL-ordered by the domain ranking rule), paged. */
export async function consultarProductosVendidos(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<Pagina<ProductoVendidoFila>>> {
  return conPermisoOperativo(tx, ctx, REPORTE_ID.PRODUCTOS, async (txw) => {
    const ventana = ventanaDe(filtro);
    const [filas, total, resumen] = await Promise.all([
      productosVendidosEnTx(txw, ctx, ventana, paginacionDe(filtro)),
      contarProductosVendidosEnTx(txw, ctx, ventana),
      totalesProductosVendidosEnTx(txw, ctx, ventana),
    ]);
    return pagina<ProductoVendidoFila>(filtro, filas, total, {
      totalUnidades: resumen.totalUnidades,
      totalMonto: resumen.totalMonto,
    });
  });
}

/** OP-3 — current per-branch stock valorized at current `costoPromedio`, paged + flagged. */
export async function consultarInventarioValorizado(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<Pagina<InventarioValorizadoFila>>> {
  return conPermisoOperativo(tx, ctx, REPORTE_ID.INVENTARIO, async (txw) => {
    const filtroSucursal = { sucursalId: filtro.sucursalId };
    const [leidas, total, resumen] = await Promise.all([
      inventarioValorizadoEnTx(txw, ctx, filtroSucursal, paginacionDe(filtro)),
      contarInventarioValorizadoEnTx(txw, ctx, filtroSucursal),
      // REUSE the canonical inventory-state rollup (shared with the dashboard tile + CSV
      // footer): valor, units, low/out — one definition, no drift (EXP-2, OP-3).
      estadoInventarioEnTx(txw, ctx, filtroSucursal),
    ]);
    const filas: InventarioValorizadoFila[] = leidas.map((l) => ({
      ...l,
      estadoStock: clasificarStock(l.cantidad, l.stockMinimo),
    }));
    return pagina<InventarioValorizadoFila>(filtro, filas, total, {
      unidades: resumen.unidades,
      valor: resumen.valor,
      bajoStock: String(resumen.bajoStock),
      agotados: String(resumen.agotados),
    });
  });
}

/**
 * OP-4 — the estado × tipoNcf grid with the ADR-017 payment state DERIVED live (never
 * materialized). OP-6 (data-layer cut): the PAGE is read with a `LIMIT`/`OFFSET` tail
 * (`paginacionDe`) inside `estadoFacturasGridEnTx`'s explicit deterministic
 * `ORDER BY estado, tipoNcf`; the page-independent summary keeps its OWN full-grid read —
 * a ≤6-cell bounded aggregate documented in design risk #7 (doubling it is the accepted
 * cost; never re-engineer unless the grid's identity grows). The summary totals (invoice
 * count, grand monto, and the Pendiente/Parcial/Pagada split) are a Decimal reduction over
 * the SQL-derived cells (reducing an already-aggregated ≤6-row result — NOT a
 * fetch-then-sum over raw invoices, so OP-5 still holds).
 */
export async function consultarEstadoFacturas(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: ReporteFiltro,
): Promise<ReportResult<Pagina<EstadoFacturaCelda>>> {
  return conPermisoOperativo(tx, ctx, REPORTE_ID.FACTURAS, async (txw) => {
    const ventana = ventanaDe(filtro);
    const [celdasPagina, celdas] = await Promise.all([
      estadoFacturasGridEnTx(txw, ctx, ventana, paginacionDe(filtro)),
      // Summary's own full-grid read (risk #7: ≤6 cells, documented, not engineered).
      estadoFacturasGridEnTx(txw, ctx, ventana),
    ]);
    const total = celdas.length;
    const filas = celdasPagina;
    let monto = new Decimal(0);
    let facturas = 0;
    let pendientes = 0;
    let parciales = 0;
    let pagadas = 0;
    for (const c of celdas) {
      monto = monto.plus(new Decimal(c.monto));
      facturas += c.facturas;
      pendientes += c.pendientes;
      parciales += c.parciales;
      pagadas += c.pagadas;
    }
    return pagina<EstadoFacturaCelda>(filtro, filas, total, {
      totalFacturas: String(facturas),
      totalMonto: monto.toDecimalPlaces(2).toFixed(2),
      pendientes: String(pendientes),
      parciales: String(parciales),
      pagadas: String(pagadas),
    });
  });
}
