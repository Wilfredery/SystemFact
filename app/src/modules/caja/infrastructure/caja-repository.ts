/**
 * Caja infrastructure — the daily-close aggregate reads (S6).
 *
 * The close is DERIVED, never stored (S3: the ERD eliminated `CIERRE_CAJA`), so this module reads
 * the two existing sources of truth and nothing else:
 *
 *   - `PAGO`  — cash receipts (`tipo = 'COBRO'`, `estado = 'APLICADO'`, `metodoPago = 'EFECTIVO'`)
 *     and cash refunds (`tipo = 'REEMBOLSO'`, `estado = 'APLICADO'`, `metodoPago = 'EFECTIVO'`);
 *   - `VENTA` — the day's invoiced total (`estado = 'CONFIRMADA'`) and, joined with
 *     `DETALLE_VENTA ⋈ PRODUCTO`, the cost of goods sold valorized at `Producto.costoPromedio`.
 *
 * Every function is ONE tenant-pinned SQL aggregate inside `infrastructure/` (ADR-013): never a
 * fetch-then-sum in JS, never a query per row, never a query in a loop (AGENTS.md "Reports/KPIs via
 * SQL aggregation"). Money crosses the SQL boundary CAST to TEXT (`::numeric(12,2)::text`), so a
 * `Decimal` string — never a JS float — reaches the app (AGENTS.md "Money = Decimal"); counts are
 * `::int`.
 *
 * Two invariants every statement here shares:
 *
 * 1. TENANT PIN + OPTIONAL BRANCH. `empresaId` is always bound (first defense) and the statement
 *    runs inside the caller's `withTenantTransaction` (RLS GUCs, second defense — AGENTS.md
 *    "Multi-tenancy ALWAYS"). `sucursalId` is an explicit OPTIONAL narrowing: `null` drops the
 *    branch predicate but NEVER the tenant pin. The company-wide Admin read is the caller's job
 *    (it wraps these calls in `conSucursalAmpliadaEnTx` and passes `null`).
 * 2. HALF-OPEN DAY WINDOW. `zona.ts` resolves the Santo-Domingo day to `[inicio, fin)` where `fin`
 *    is the NEXT SD day's 00:00 EXCLUSIVE, so the filter is `fecha >= inicio AND fecha < fin`. A
 *    `<=` on that bound would double-count the following day's first instant.
 *
 * There is NO date parameter anywhere: the window is resolved from "today in SD" by the use case
 * (S1/S6 — the wireframe has no date selector), so a retroactive day cannot reach these queries.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { VentanaDiaSD } from "../domain/zona";

/** One `Pago.metodoPago` row of the 06a table's COBROS column, plus its operation count. */
export interface CobroMetodoLeido {
  /** The `Pago.metodoPago` label (`EFECTIVO` in V1); never interpreted here. */
  readonly metodo: string;
  /** Σ `monto` for that method that SD day, `Decimal(12,2)` string. */
  readonly cobros: string;
  /** How many receipts make up that sum. */
  readonly cantidad: number;
}

/** The day's cash refunds as a MAGNITUDE (refunds are stored as a positive `monto`). */
export interface ReembolsoEfectivoLeido {
  /** Σ `monto` of REEMBOLSO EFECTIVO APLICADO that SD day, `Decimal(12,2)` string. */
  readonly devoluciones: string;
  /** How many refunds make up that sum. */
  readonly cantidad: number;
}

/** The day's invoiced total and how many confirmed sales produced it. */
export interface TotalesVentaDiaLeido {
  /** Σ `Venta.total` for CONFIRMADA sales that SD day, `Decimal(12,2)` string. */
  readonly totalFacturado: string;
  readonly operaciones: number;
}

/** Σ quantity × `Producto.costoPromedio` over the day's confirmed sale lines. */
export interface CostoVendidoLeido {
  /** The Costo de lo vendido at `Decimal(12,2)` (a Decimal string). */
  readonly costoVendido: string;
}

/**
 * Every statement below repeats the SAME predicate shape for `PAGO` — tenant pin, `tipo`,
 * `estado = 'APLICADO'`, `metodoPago = 'EFECTIVO'`, the optional branch narrowing and the half-open
 * SD window — because a receipt counted under a looser filter than a refund is a silently wrong
 * drawer. They are written inline (one readable statement each) and the colocated unit test pins
 * the predicate of BOTH, so a drift between the two is a test failure instead of a wrong close.
 *
 * Bind order in every statement is EMPRESA, then the branch (bound twice, `IS NULL OR =`), then
 * INICIO and FIN: the only date binds are the two window instants, which is what makes "no
 * retroactive day can reach the query" structural.
 */

/**
 * The 06a method rows: Σ cash receipts per `metodoPago` for the SD day, ordered by method so the
 * screen's rows are deterministic. One statement — the count comes from the SAME aggregate
 * (`COUNT(*)`), never a second query.
 */
export async function cobrosEfectivoPorMetodoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaDiaSD,
  sucursalId: number | null,
): Promise<CobroMetodoLeido[]> {
  return tx.$queryRaw<CobroMetodoLeido[]>`
    SELECT
      p."metodoPago"::text                             AS "metodo",
      COALESCE(SUM(p."monto"), 0)::numeric(12, 2)::text AS "cobros",
      COUNT(*)::int                                     AS "cantidad"
    FROM "PAGO" p
    WHERE p."empresaId" = ${ctx.empresaId}
      AND p."tipo" = 'COBRO'
      AND p."estado" = 'APLICADO'
      AND p."metodoPago" = 'EFECTIVO'
      AND (${sucursalId}::int IS NULL OR p."sucursalId" = ${sucursalId})
      AND p."fecha" >= ${ventana.inicio}
      AND p."fecha" < ${ventana.fin}
    GROUP BY p."metodoPago"
    ORDER BY p."metodoPago" ASC`;
}

/**
 * The corte panel's Devoluciones: Σ cash refunds (magnitude) for the SD day. One aggregate row —
 * a zero day yields `0.00` / `0`, never `undefined`.
 */
export async function reembolsosEfectivoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaDiaSD,
  sucursalId: number | null,
): Promise<ReembolsoEfectivoLeido> {
  const [fila] = await tx.$queryRaw<{ devoluciones: string; cantidad: number }[]>`
    SELECT
      COALESCE(SUM(p."monto"), 0)::numeric(12, 2)::text AS "devoluciones",
      COUNT(*)::int                                     AS "cantidad"
    FROM "PAGO" p
    WHERE p."empresaId" = ${ctx.empresaId}
      AND p."tipo" = 'REEMBOLSO'
      AND p."estado" = 'APLICADO'
      AND p."metodoPago" = 'EFECTIVO'
      AND (${sucursalId}::int IS NULL OR p."sucursalId" = ${sucursalId})
      AND p."fecha" >= ${ventana.inicio}
      AND p."fecha" < ${ventana.fin}`;
  return {
    devoluciones: fila?.devoluciones ?? "0.00",
    cantidad: fila?.cantidad ?? 0,
  };
}

/**
 * The canonical "total facturado del día": Σ `Venta.total` over CONFIRMADA sales in the SD window.
 * EXPORTED and shared by BOTH use cases on purpose — 06a's "Total facturado" KPI and 06b's "Ventas
 * del día" are the same figure, so they can never disagree by a second sum definition (the
 * AGENTS.md "one canonical query" rule). A zero day yields `0.00` / `0`.
 */
export async function totalesVentaDiaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaDiaSD,
  sucursalId: number | null,
): Promise<TotalesVentaDiaLeido> {
  const [fila] = await tx.$queryRaw<{ totalFacturado: string; operaciones: number }[]>`
    SELECT
      COALESCE(SUM(v."total"), 0)::numeric(12, 2)::text AS "totalFacturado",
      COUNT(*)::int                                     AS "operaciones"
    FROM "VENTA" v
    WHERE v."empresaId" = ${ctx.empresaId}
      AND v."estado" = 'CONFIRMADA'
      AND (${sucursalId}::int IS NULL OR v."sucursalId" = ${sucursalId})
      AND v."fecha" >= ${ventana.inicio}
      AND v."fecha" < ${ventana.fin}`;
  return {
    totalFacturado: fila?.totalFacturado ?? "0.00",
    operaciones: fila?.operaciones ?? 0,
  };
}

/**
 * The 06b Costo de lo vendido: Σ (`cantidad` × `Producto.costoPromedio`) over the day's CONFIRMADA
 * sale lines. ONE `DETALLE_VENTA ⋈ VENTA ⋈ PRODUCTO` aggregate — the join IS the grouping that
 * matters (no per-sale or per-product fetch, no query in a loop), so the cost reflects the sale
 * lines' quantities at the product's current average cost (per S5/S6).
 */
export async function costoVendidoDiaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaDiaSD,
  sucursalId: number | null,
): Promise<CostoVendidoLeido> {
  const [fila] = await tx.$queryRaw<{ costoVendido: string }[]>`
    SELECT
      COALESCE(SUM(d."cantidad" * pr."costoPromedio"), 0)::numeric(12, 2)::text AS "costoVendido"
    FROM "DETALLE_VENTA" d
    JOIN "VENTA" v    ON v."id" = d."ventaId"
    JOIN "PRODUCTO" pr ON pr."id" = d."productoId"
    WHERE v."empresaId" = ${ctx.empresaId}
      AND v."estado" = 'CONFIRMADA'
      AND (${sucursalId}::int IS NULL OR v."sucursalId" = ${sucursalId})
      AND v."fecha" >= ${ventana.inicio}
      AND v."fecha" < ${ventana.fin}`;
  return { costoVendido: fila?.costoVendido ?? "0.00" };
}
