/**
 * Reportes infrastructure — the dashboard aggregation reads (DB-1, DB-3).
 *
 * Every function here is ONE tenant-pinned SQL aggregate/`GROUP BY` — never a fetch-then-
 * sum in JS, never a `findMany` without a bound, never a query inside a loop (AGENTS.md
 * "Reports/KPIs via SQL aggregation", "No N+1"). Money crosses the SQL boundary as a
 * `numeric(12,2)`/`numeric(12,3)` CAST to TEXT (a `Decimal` string), never a JS float
 * (AGENTS.md "Money = Decimal"); counts are `::int`. Each statement pins `empresaId` (the
 * first defense) AND runs inside the caller's `withTenantTransaction` (RLS GUCs in force,
 * the second defense — DB-3).
 *
 * The COMPANY-WIDE vs branch-pinned decision (DB-2/DB-4) is made by the CALLER: an Admin
 * runs these inside `conSucursalAmpliadaEnTx` (branch GUC cleared → every branch of the
 * pinned empresa), a Cobrador runs them with their branch GUC in force (RLS pins to the
 * assignment branch). The queries themselves only ever add an OPTIONAL explicit
 * `sucursalId` narrowing (DB-5 "filters combinable with AND"); they never read another
 * empresa's rows regardless of the GUC.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";

/** A UTC `[desde, hasta]` window plus an optional branch narrowing (ANDed). The bounds are
 *  OPTIONAL (open-ended when absent): the dashboard always passes a concrete SD day/month
 *  window, while the operational period report (slice B) may leave a date end unset to mean
 *  "no lower/upper bound". A `null`/absent bound simply drops that predicate (never a scan
 *  past the tenant pin — `empresaId` is always required). */
export interface VentanaFiltro {
  readonly desde?: Date;
  readonly hasta?: Date;
  readonly sucursalId?: number;
}

/** Σ total + operation count for a window of confirmed sales. Money as Decimal string. */
export interface TotalesVentasLeidos {
  readonly neto: string;
  readonly operaciones: number;
}

/** A single top-selling product row for the window. */
export interface TopVendedorLeido {
  readonly productoId: number;
  readonly nombre: string;
  readonly unidades: string;
  readonly monto: string;
}

/** The inventory valuation/state rollup for the active tenant scope. */
export interface EstadoInventarioLeido {
  readonly unidades: string;
  readonly valor: string;
  readonly bajoStock: number;
  readonly agotados: number;
}

/**
 * Σ `total` and COUNT of `CONFIRMADA` ventas inside the SD window (DB-1). `BORRADOR` and
 * `CANCELADA` ventas are excluded (only confirmed sales count). An empty window returns
 * `neto: "0.00"`, `operaciones: 0`.
 */
export async function totalesVentasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<TotalesVentasLeidos> {
  const sucursal = ventana.sucursalId ?? null;
  const desde = ventana.desde ?? null;
  const hasta = ventana.hasta ?? null;
  const [fila] = await tx.$queryRaw<
    { neto: string; operaciones: number }[]
  >`
    SELECT
      COALESCE(SUM(v."total"), 0)::numeric(12, 2)::text AS "neto",
      COUNT(*)::int                                     AS "operaciones"
    FROM "VENTA" v
    WHERE v."empresaId" = ${ctx.empresaId}
      AND v."estado" = 'CONFIRMADA'
      AND (${desde}::timestamptz IS NULL OR v."fecha" >= ${desde})
      AND (${hasta}::timestamptz IS NULL OR v."fecha" <= ${hasta})
      AND (${sucursal}::int IS NULL OR v."sucursalId" = ${sucursal})`;
  return {
    neto: fila?.neto ?? "0.00",
    operaciones: fila?.operaciones ?? 0,
  };
}

/**
 * Top-selling products by line subtotal over confirmed sales in the window, via a single
 * `DetalleVenta ⋈ Venta ⋈ Producto` `GROUP BY` (DB-1 — the SAME grouping the operational
 * report reuses, so no duplicated SQL). Units are `Decimal(12,3)` text, money `Decimal(12,2)`
 * text. `limite` is a DISPLAY cap on the KPI tile (not a paginated report).
 */
export async function topVendedoresEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
  limite: number,
): Promise<TopVendedorLeido[]> {
  const sucursal = ventana.sucursalId ?? null;
  const desde = ventana.desde ?? null;
  const hasta = ventana.hasta ?? null;
  return tx.$queryRaw<TopVendedorLeido[]>`
    SELECT
      p."id"::int                                                    AS "productoId",
      p."nombre"                                                     AS "nombre",
      SUM(d."cantidad")::numeric(12, 3)::text                        AS "unidades",
      SUM(d."subtotalLinea")::numeric(12, 2)::text                   AS "monto"
    FROM "DETALLE_VENTA" d
    JOIN "VENTA" v   ON v."id" = d."ventaId"
    JOIN "PRODUCTO" p ON p."id" = d."productoId"
    WHERE v."empresaId" = ${ctx.empresaId}
      AND v."estado" = 'CONFIRMADA'
      AND (${desde}::timestamptz IS NULL OR v."fecha" >= ${desde})
      AND (${hasta}::timestamptz IS NULL OR v."fecha" <= ${hasta})
      AND (${sucursal}::int IS NULL OR v."sucursalId" = ${sucursal})
    GROUP BY p."id", p."nombre"
    ORDER BY SUM(d."cantidad") DESC, SUM(d."subtotalLinea") DESC, p."id" ASC
    LIMIT ${limite}`;
}

/**
 * Inventory state for the active tenant scope (DB-1): total units, valuation at the
 * CURRENT `Producto.costoPromedio`, and low/out stock counts. INVENTARIO is per-branch and
 * its RLS policy anchors tenant via `SUCURSAL.empresaId`, so we pin through the sucursal
 * join (matching `cobros`/`inventario` tenant handling for a sucursal-anchored table).
 * An `agotado` is stock ≤ 0; `bajoStock` is 0 < cantidad ≤ stockMinimo.
 */
export async function estadoInventarioEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: { readonly sucursalId?: number } = {},
): Promise<EstadoInventarioLeido> {
  const sucursal = filtro.sucursalId ?? null;
  const [fila] = await tx.$queryRaw<
    { unidades: string; valor: string; bajoStock: number; agotados: number }[]
  >`
    SELECT
      COALESCE(SUM(i."cantidad"), 0)::numeric(12, 3)::text            AS "unidades",
      COALESCE(SUM(i."cantidad" * p."costoPromedio"), 0)::numeric(12, 2)::text AS "valor",
      COUNT(*) FILTER (
        WHERE i."cantidad" > 0 AND i."cantidad" <= p."stockMinimo"
      )::int                                                          AS "bajoStock",
      COUNT(*) FILTER (
        WHERE i."cantidad" <= 0
      )::int                                                          AS "agotados"
    FROM "INVENTARIO" i
    JOIN "PRODUCTO" p ON p."id" = i."productoId"
    JOIN "SUCURSAL" s ON s."id" = i."sucursalId"
    WHERE s."empresaId" = ${ctx.empresaId}
      AND (${sucursal}::int IS NULL OR i."sucursalId" = ${sucursal})`;
  return {
    unidades: fila?.unidades ?? "0.000",
    valor: fila?.valor ?? "0.00",
    bajoStock: fila?.bajoStock ?? 0,
    agotados: fila?.agotados ?? 0,
  };
}
