/**
 * Reportes infrastructure — the operational report aggregate reads (OP-1, OP-3, OP-4, OP-5).
 *
 * Every function is ONE tenant-pinned SQL aggregate/`GROUP BY` inside `infrastructure/`
 * (ADR-013): never a fetch-then-sum in JS, never a `findMany` without a bound, never a query
 * in a loop (AGENTS.md "Reports/KPIs via SQL aggregation"; OP-5 "fetching rows to sum in JS is
 * a defect"). Money crosses the SQL boundary CAST to TEXT (`numeric(12,2)`/`numeric(12,3)`) so
 * a `Decimal` string — never a JS float — reaches the app (OP-5 / AGENTS.md "Money = Decimal");
 * counts are `::int`. Each statement pins `empresaId` (first defense) AND runs inside the
 * caller's `withTenantTransaction` (RLS GUCs in force, second defense — DB-3), and adds only
 * OPTIONAL explicit `sucursalId` + date-window narrowing (ANDed, DB-5/OP-6); a `null` bound
 * drops that predicate but never the tenant pin.
 *
 * PAGINATION IS AN OPTIONAL ARGUMENT (`pag`): when present the aggregate is `LIMIT`/`OFFSET`-
 * paged (the 25-default / 100-clamp screen); when ABSENT the SAME predicate returns the FULL
 * filtered dataset. The CSV export calls these with `pag` omitted and the screen calls them
 * with a page — the WHERE clause is byte-identical, which is what makes screen totals and CSV
 * totals agree to the cent by construction (EXP-2 "exports reuse the screen's canonical query").
 *
 * The company-wide vs branch decision (DB-2/DB-4) is the CALLER's (the use case wraps Admin
 * reads in `conSucursalAmpliadaEnTx`); these queries only ever apply the explicit filter.
 */

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { VentanaFiltro } from "./dashboard-repository";
import type {
  EstadoFacturaCelda,
  VentasPeriodoFila,
} from "../domain/operacional";

/** A `[offset, limit)` page window over an aggregate's rows (omit → the full dataset). */
export interface Paginacion {
  readonly offset: number;
  readonly limit: number;
}

/** A raw sold-product row (ranking + `estadoStock` mapping happen upstream, purely). */
export interface ProductoVendidoLeido {
  readonly productoId: number;
  readonly nombre: string;
  readonly unidades: string;
  readonly monto: string;
}

/** A raw valorized-inventory row (the `estadoStock` flag is derived in the app via `clasificarStock`). */
export interface InventarioValorizadoLeido {
  readonly inventarioId: number;
  readonly sucursalId: number;
  readonly sucursalNombre: string;
  readonly productoId: number;
  readonly productoNombre: string;
  readonly cantidad: string;
  readonly costoPromedio: string;
  readonly valor: string;
  readonly stockMinimo: number;
}

/** Σ units + Σ monto across all sold-product rows (the productos report summary). */
export interface TotalesProductosLeidos {
  readonly totalUnidades: string;
  readonly totalMonto: string;
}

/** `empresaId` + optional branch/window params normalised to SQL-null bindables. */
function paramVentana(ventana: VentanaFiltro): {
  sucursal: number | null;
  desde: Date | null;
  hasta: Date | null;
} {
  return {
    sucursal: ventana.sucursalId ?? null,
    desde: ventana.desde ?? null,
    hasta: ventana.hasta ?? null,
  };
}

/**
 * Named SQL fragment — the `LIMIT`/`OFFSET` page tail. When `pag` is present the
 * aggregate is paged (25-default / 100-clamp screen); when absent it returns the
 * FULL filtered set (the CSV export). Both paths share this one fragment so the
 * predicate is byte-identical and screen totals agree with exports by
 * construction (EXP-2). Named by business intent; extracted from the repeated
 * raw `pag ? Prisma.sql`...` : Prisma.empty` tail (S4624).
 */
export function limitePaginaSql(pag?: Paginacion): Prisma.Sql {
  return pag ? Prisma.sql`LIMIT ${pag.limit} OFFSET ${pag.offset}` : Prisma.empty;
}

/**
 * Named SQL fragment — the confirmed-sale tenant predicate for a statement whose
 * `VENTA` relation is aliased `v` (both the direct reads and the
 * `DETALLE_VENTA ⋈ VENTA` reads share this alias). Pins `empresaId`, keeps only
 * `CONFIRMADA` rows, then adds the OPTIONAL Santo-Domingo date window and
 * branch narrowing: a `null` bound drops that predicate but NEVER the tenant
 * pin (DB-3/DB-5). Used identically by the day rows, day count, per-product
 * ranking, its count and its totals so screen and export never drift (EXP-2);
 * extracted from the repeated raw `WHERE` (S4624). Bind order is preserved:
 * empresaId, desde×2, hasta×2, sucursal×2.
 */
function whereVentaConfirmadaEnTx(
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Prisma.Sql {
  const { sucursal, desde, hasta } = paramVentana(ventana);
  return Prisma.sql`
    WHERE v."empresaId" = ${ctx.empresaId}
      AND v."estado" = 'CONFIRMADA'
      AND (${desde}::timestamptz IS NULL OR v."fecha" >= ${desde})
      AND (${hasta}::timestamptz IS NULL OR v."fecha" <= ${hasta})
      AND (${sucursal}::int IS NULL OR v."sucursalId" = ${sucursal})`;
}

/**
 * Named SQL fragment — the valorized-inventory tenant predicate. `INVENTARIO`
 * (`i`) is RLS-anchored through its `SUCURSAL` (`s`), so we pin `empresaId` via
 * the sucursal join and add the OPTIONAL explicit branch filter (a `null` bound
 * drops the branch narrowing, never the company pin). Used by both the detail
 * read and its count (S4624); bind order empresaId, sucursal×2.
 */
function whereInventarioPorEmpresaSucursal(
  ctx: TenantCtx,
  sucursal: number | null,
): Prisma.Sql {
  return Prisma.sql`
    WHERE s."empresaId" = ${ctx.empresaId}
      AND (${sucursal}::int IS NULL OR i."sucursalId" = ${sucursal})`;
}

/**
 * OP-1 — confirmed sales grouped by SANTO DOMINGO calendar day. `fecha AT TIME ZONE
 * 'America/Santo_Domingo'` lets the DB's IANA timezone database (a dedicated zone library,
 * AGENTS.md "no manual hour arithmetic") resolve the SD wall clock; the `::date` cast buckets
 * each sale into its SD calendar day (a 03:00 UTC sale lands on the PRIOR SD day). Only
 * `CONFIRMADA` rows count (BORRADOR/CANCELADA excluded). Ordered newest-SD-day first; an
 * optional `pag` pages the day rows, none returns every day in the window (export).
 */
export async function ventasPorPeriodoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
  pag?: Paginacion,
): Promise<VentasPeriodoFila[]> {
  return tx.$queryRaw<VentasPeriodoFila[]>`
    SELECT
      to_char((v."fecha" AT TIME ZONE 'America/Santo_Domingo')::date, 'YYYY-MM-DD') AS "fechaSD",
      COALESCE(SUM(v."total"), 0)::numeric(12, 2)::text AS "neto",
      COUNT(*)::int                                     AS "operaciones"
    FROM "VENTA" v
    ${whereVentaConfirmadaEnTx(ctx, ventana)}
    GROUP BY 1
    ORDER BY 1 DESC
    ${limitePaginaSql(pag)}`;
}

/** Number of distinct SD calendar days with confirmed sales in the filter (the row total). */
export async function contarDiasVentasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<number> {
  const [fila] = await tx.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS "total" FROM (
      SELECT DISTINCT (v."fecha" AT TIME ZONE 'America/Santo_Domingo')::date AS d
      FROM "VENTA" v
      ${whereVentaConfirmadaEnTx(ctx, ventana)}
    ) s`;
  return fila?.total ?? 0;
}

/**
 * OP-2 — per-product sold units + monto over confirmed sales in the window, via a single
 * `DetalleVenta ⋈ Venta ⋈ Producto` `GROUP BY` (same shape/predicate as the dashboard's
 * `topVendedoresEnTx`, so the two share ONE aggregation contract). The `ORDER BY` mirrors the
 * domain {@link compararPorUnidades} rule (units DESC, monto DESC on tie) so SQL pushdown and
 * the pure ranking never drift. Optional `pag` pages products; none returns all (export).
 */
export async function productosVendidosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
  pag?: Paginacion,
): Promise<ProductoVendidoLeido[]> {
  return tx.$queryRaw<ProductoVendidoLeido[]>`
    SELECT
      p."id"::int                                     AS "productoId",
      p."nombre"                                      AS "nombre",
      COALESCE(SUM(d."cantidad"), 0)::numeric(12, 3)::text      AS "unidades",
      COALESCE(SUM(d."subtotalLinea"), 0)::numeric(12, 2)::text AS "monto"
    FROM "DETALLE_VENTA" d
    JOIN "VENTA" v    ON v."id" = d."ventaId"
    JOIN "PRODUCTO" p ON p."id" = d."productoId"
    ${whereVentaConfirmadaEnTx(ctx, ventana)}
    GROUP BY p."id", p."nombre"
    ORDER BY SUM(d."cantidad") DESC, SUM(d."subtotalLinea") DESC, p."id" ASC
    ${limitePaginaSql(pag)}`;
}

/** Number of distinct products sold in the window (the row total for pagination). */
export async function contarProductosVendidosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<number> {
  const [fila] = await tx.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS "total" FROM (
      SELECT d."productoId"
      FROM "DETALLE_VENTA" d
      JOIN "VENTA" v ON v."id" = d."ventaId"
      ${whereVentaConfirmadaEnTx(ctx, ventana)}
      GROUP BY d."productoId"
    ) s`;
  return fila?.total ?? 0;
}

/** Σ units + Σ monto across ALL sold products in the window (page-independent report summary). */
export async function totalesProductosVendidosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<TotalesProductosLeidos> {
  const [fila] = await tx.$queryRaw<{ totalUnidades: string; totalMonto: string }[]>`
    SELECT
      COALESCE(SUM(d."cantidad"), 0)::numeric(12, 3)::text      AS "totalUnidades",
      COALESCE(SUM(d."subtotalLinea"), 0)::numeric(12, 2)::text AS "totalMonto"
    FROM "DETALLE_VENTA" d
    JOIN "VENTA" v ON v."id" = d."ventaId"
    ${whereVentaConfirmadaEnTx(ctx, ventana)}`;
  return {
    totalUnidades: fila?.totalUnidades ?? "0.000",
    totalMonto: fila?.totalMonto ?? "0.00",
  };
}

/**
 * OP-3 — current stock per branch valorized at the CURRENT `Producto.costoPromedio`
 * (`cantidad × costoPromedio`). INVENTARIO is per-branch and RLS-anchored through
 * `SUCURSAL.empresaId`, so we pin via the sucursal join (same handling as the dashboard
 * rollup). `stockMinimo` is projected so the app derives the NORMAL/BAJO/AGOTADO flag with
 * the pure `clasificarStock`. Ordered by valuation desc. Optional `pag` pages lines.
 */
export async function inventarioValorizadoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: { readonly sucursalId?: number },
  pag?: Paginacion,
): Promise<InventarioValorizadoLeido[]> {
  const sucursal = filtro.sucursalId ?? null;
  return tx.$queryRaw<InventarioValorizadoLeido[]>`
    SELECT
      i."id"::int                                                 AS "inventarioId",
      i."sucursalId"::int                                         AS "sucursalId",
      s."nombre"                                                  AS "sucursalNombre",
      p."id"::int                                                 AS "productoId",
      p."nombre"                                                  AS "productoNombre",
      i."cantidad"::numeric(12, 3)::text                          AS "cantidad",
      p."costoPromedio"::numeric(12, 2)::text                     AS "costoPromedio",
      (i."cantidad" * p."costoPromedio")::numeric(12, 2)::text    AS "valor",
      p."stockMinimo"::int                                        AS "stockMinimo"
    FROM "INVENTARIO" i
    JOIN "PRODUCTO" p ON p."id" = i."productoId"
    JOIN "SUCURSAL" s ON s."id" = i."sucursalId"
    ${whereInventarioPorEmpresaSucursal(ctx, sucursal)}
    ORDER BY (i."cantidad" * p."costoPromedio") DESC, i."sucursalId" ASC, p."id" ASC
    ${limitePaginaSql(pag)}`;
}

/** Number of per-branch stock lines in the (branch) filter (the row total for pagination). */
export async function contarInventarioValorizadoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: { readonly sucursalId?: number },
): Promise<number> {
  const sucursal = filtro.sucursalId ?? null;
  const [fila] = await tx.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS "total"
    FROM "INVENTARIO" i
    JOIN "SUCURSAL" s ON s."id" = i."sucursalId"
    ${whereInventarioPorEmpresaSucursal(ctx, sucursal)}`;
  return fila?.total ?? 0;
}

/**
 * OP-4 — the `estado` × `tipoNcf` facturas grid, with the ADR-017 payment state DERIVED live
 * (never materialized). The `base` CTE reproduces the CANONICAL receivables derivation from
 * `cobros/infrastructure/saldo-cxc.repository.ts` EXACTLY — `total − ΣPAGO(COBRO/APLICADO)
 * − ΣNOTA_CREDITO(VIGENTE) + ΣNOTA_DEBITO(VIGENTE)` — so the grid's Pendiente/Parcial/Pagada
 * classification is the same derived balance, not a stored column. The grid is bounded by the
 * small estado × tipoNcf domain (≤ 6 cells), so it is returned whole and paged in the app.
 * Payment-state counts apply to VIGENTE documents only (a cancelled/annulled invoice is not
 * outstanding). An empty window yields no cells.
 */
export async function estadoFacturasGridEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<EstadoFacturaCelda[]> {
  const { sucursal, desde, hasta } = paramVentana(ventana);
  return tx.$queryRaw<EstadoFacturaCelda[]>`
    WITH base AS (
      SELECT
        f."estado"                                        AS "estado",
        f."tipoNcf"                                       AS "tipo",
        f."total"                                         AS "total",
        (
          f."total"
          - COALESCE(p."cobros", 0)
          - COALESCE(nc."monto", 0)
          + COALESCE(nd."monto", 0)
        )                                                 AS "saldo"
      FROM "FACTURA" f
      LEFT JOIN (
        SELECT "facturaId", SUM("monto") AS "cobros"
        FROM "PAGO"
        WHERE "empresaId" = ${ctx.empresaId}
          AND "tipo" = 'COBRO'
          AND "estado" = 'APLICADO'
        GROUP BY "facturaId"
      ) p ON p."facturaId" = f."id"
      LEFT JOIN (
        SELECT "facturaOriginalId" AS "facturaId", SUM("monto") AS "monto"
        FROM "NOTA_CREDITO"
        WHERE "empresaId" = ${ctx.empresaId}
          AND "estado" = 'VIGENTE'
        GROUP BY "facturaOriginalId"
      ) nc ON nc."facturaId" = f."id"
      LEFT JOIN (
        SELECT "facturaOriginalId" AS "facturaId", SUM("monto") AS "monto"
        FROM "NOTA_DEBITO"
        WHERE "empresaId" = ${ctx.empresaId}
          AND "estado" = 'VIGENTE'
        GROUP BY "facturaOriginalId"
      ) nd ON nd."facturaId" = f."id"
      WHERE f."empresaId" = ${ctx.empresaId}
        AND (${sucursal}::int IS NULL OR f."sucursalId" = ${sucursal})
        AND (${desde}::timestamptz IS NULL OR f."fechaEmision" >= ${desde})
        AND (${hasta}::timestamptz IS NULL OR f."fechaEmision" <= ${hasta})
    )
    SELECT
      "estado"                                                          AS "estado",
      "tipo"                                                            AS "tipoNcf",
      COUNT(*)::int                                                     AS "facturas",
      COALESCE(SUM("total"), 0)::numeric(12, 2)::text                   AS "monto",
      COUNT(*) FILTER (WHERE "estado" = 'VIGENTE' AND "saldo" >= "total")::int AS "pendientes",
      COUNT(*) FILTER (WHERE "estado" = 'VIGENTE' AND "saldo" > 0 AND "saldo" < "total")::int AS "parciales",
      COUNT(*) FILTER (WHERE "estado" = 'VIGENTE' AND "saldo" <= 0)::int AS "pagadas"
    FROM base
    GROUP BY "estado", "tipo"
    ORDER BY "estado", "tipo"`;
}
