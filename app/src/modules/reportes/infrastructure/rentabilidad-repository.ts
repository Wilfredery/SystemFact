/**
 * Reportes infrastructure — the per-product profitability aggregate read (REN-1, REN-2; slice D).
 *
 * ONE tenant-pinned SQL aggregate inside `infrastructure/` (ADR-013): a single statement with three
 * per-product `GROUP BY` CTEs (confirmed sales, received purchases, current stock) joined onto
 * `PRODUCTO`, so there is NO fetch-then-sum over line items and NO N+1 (AGENTS.md "Reports/KPIs via
 * SQL aggregation", "No N+1"; OP-5). Money crosses as `numeric(12,2)`/`numeric(12,3)` CAST to TEXT
 * (Decimal string — never a JS float); the per-line weighted price and margin are computed in the
 * PURE domain (`domain/margen.ts`), never here (ADR-013 "fiscal math lives in domain").
 *
 * TENANT PINNING (DB-3): every CTE pins `empresaId` (VENTA / COMPRA directly, INVENTARIO via the
 * SUCURSAL join) AND the outer `PRODUCTO.empresaId` is pinned, and the whole read runs inside the
 * caller's `withTenantTransaction` (RLS GUCs in force, the second defense). A row of another tenant
 * can never appear regardless of the branch GUC.
 *
 * BRANCH SCOPE (REN-2): sales scope via `VENTA.sucursalId`, purchases via `COMPRA.sucursalId`, stock
 * via `INVENTARIO.sucursalId` — all narrowed by the SAME optional `sucursalId` bind ANDed with the
 * date window (DB-5). Company-wide vs a single branch is the CALLER's choice (the use case wraps an
 * Admin read in the ratified widen); these queries only apply the explicit filter.
 *
 * PRODUCT UNIVERSE: a row exists per product with sales OR purchases in the window (a stock-only
 * product is NOT a profitability row; a purchase-only product shows Entrada/Inversión with Salida 0).
 *
 * FULL DATASET, UN-PAGED: like the bounded estado-facturas grid (slice B), this returns every
 * grouped per-product row and the application pages them in-app. Output is bounded by the number of
 * DISTINCT ACTIVE PRODUCTS (a GROUP BY, not raw transactions), so a screen page and the CSV footer
 * both consume the identical grouped result — the summary is page-independent by construction (EXP-2).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { VentanaFiltro } from "./dashboard-repository";
import type { RentabilidadInsumo } from "../domain/margen";

/**
 * The purchase states that count as a product's ENTRADA / Inversión (REN-1): goods actually
 * received. `costoPromedio` and stock move on receipt, and a `PAGADA` purchase was necessarily
 * received first — so an ordered-but-unreceived `PENDIENTE` (and `BORRADOR`/`CANCELADA`) never
 * contributes. A frozen pair (never free strings, AGENTS.md "State enums frozen").
 */
export const ESTADOS_COMPRA_ENTRADA = ["RECIBIDA", "PAGADA"] as const;

/**
 * The full, un-paged per-product profitability inputs for the window (REN-1). `desde`/`hasta` are
 * the UTC-bracketed SD window (the caller ran `normalizarFiltro`); `sucursalId` an optional branch
 * narrowing. Every money/quantity figure arrives as Decimal text (already `::text`-cast).
 */
export async function rentabilidadFilasEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<RentabilidadInsumo[]> {
  const sucursal = ventana.sucursalId ?? null;
  const desde = ventana.desde ?? null;
  const hasta = ventana.hasta ?? null;
  const [estadoA, estadoB] = ESTADOS_COMPRA_ENTRADA;

  return tx.$queryRaw<RentabilidadInsumo[]>`
    WITH ventas AS (
      SELECT
        d."productoId"                              AS "pid",
        COALESCE(SUM(d."cantidad"), 0)              AS "q_sold",
        COALESCE(SUM(d."cantidad" * d."precioUnitario"), 0) AS "ventas_brutas"
      FROM "DETALLE_VENTA" d
      JOIN "VENTA" v ON v."id" = d."ventaId"
      WHERE v."empresaId" = ${ctx.empresaId}
        AND v."estado" = 'CONFIRMADA'
        AND (${desde}::timestamptz IS NULL OR v."fecha" >= ${desde})
        AND (${hasta}::timestamptz IS NULL OR v."fecha" <= ${hasta})
        AND (${sucursal}::int IS NULL OR v."sucursalId" = ${sucursal})
      GROUP BY d."productoId"
    ),
    compras AS (
      SELECT
        dc."productoId"                             AS "pid",
        COALESCE(SUM(dc."cantidad"), 0)             AS "q_purch",
        COALESCE(SUM(dc."cantidad" * dc."costoUnitario"), 0) AS "inversion"
      FROM "DETALLE_COMPRA" dc
      JOIN "COMPRA" c ON c."id" = dc."compraId"
      WHERE c."empresaId" = ${ctx.empresaId}
        AND c."estado" IN (${estadoA}, ${estadoB})
        AND (${desde}::timestamptz IS NULL OR c."fecha" >= ${desde})
        AND (${hasta}::timestamptz IS NULL OR c."fecha" <= ${hasta})
        AND (${sucursal}::int IS NULL OR c."sucursalId" = ${sucursal})
      GROUP BY dc."productoId"
    ),
    stock AS (
      SELECT
        i."productoId"                              AS "pid",
        COALESCE(SUM(i."cantidad"), 0)              AS "q_stock"
      FROM "INVENTARIO" i
      JOIN "SUCURSAL" s ON s."id" = i."sucursalId"
      WHERE s."empresaId" = ${ctx.empresaId}
        AND (${sucursal}::int IS NULL OR i."sucursalId" = ${sucursal})
      GROUP BY i."productoId"
    )
    SELECT
      p."id"::int                                                          AS "productoId",
      p."nombre"                                                           AS "nombre",
      p."costoPromedio"::numeric(12, 2)::text                              AS "costoPromedio",
      COALESCE(v."q_sold", 0)::numeric(12, 3)::text                        AS "unidadesVendidas",
      COALESCE(v."ventas_brutas", 0)::numeric(12, 2)::text                 AS "ventasBrutas",
      COALESCE(c."q_purch", 0)::numeric(12, 3)::text                       AS "unidadesCompradas",
      COALESCE(c."inversion", 0)::numeric(12, 2)::text                     AS "inversion",
      COALESCE(s."q_stock", 0)::numeric(12, 3)::text                       AS "stockActual"
    FROM "PRODUCTO" p
    LEFT JOIN ventas v ON v."pid" = p."id"
    LEFT JOIN compras c ON c."pid" = p."id"
    LEFT JOIN stock s ON s."pid" = p."id"
    WHERE p."empresaId" = ${ctx.empresaId}
      AND (v."pid" IS NOT NULL OR c."pid" IS NOT NULL)
    ORDER BY p."id" ASC`;
}
