/**
 * Cobros infrastructure — canonical derived CxC balance aggregate (R-B1, ADR-017).
 *
 * The single grouped SQL source of truth for every receivable view (board, aging,
 * mora and — in fase-6 PR-3 — the credit gate). It is NOT materialized and there
 * is NO cache: re-running it always reflects any committed payment immediately
 * (spec: "Never stale after a new payment"). `consultarSaldoCxC` (application,
 * PR-2) is the only consumer; nothing else queries these tables for a balance.
 *
 * Pending balance per invoice is
 *   FACTURA.total
 *     − Σ PAGO.monto            (tipo=COBRO AND estado=APLICADO)
 *     − Σ VIGENTE nota-de-crédito.monto
 *     + Σ VIGENTE nota-de-débito.monto   (empty in V1; B03 deferred)
 * counting ONLY FACTURA.estado='VIGENTE'. It is ONE aggregate statement — the
 * per-invoice sums are pre-aggregated sub-joins, so there is no query-per-invoice
 * N+1 (AGENTS.md "No N+1", "Reports/KPIs via SQL aggregation").
 *
 * Multi-tenancy: the statement pins FACTURA by `empresaId` AND runs inside the
 * caller's `withTenantTransaction`, so the RLS GUCs are also in force (defense in
 * depth — AGENTS.md "Multi-tenancy ALWAYS"). CxC is intentionally COMPANY-wide,
 * not per-branch: a customer owes the empresa, not a branch, so the aggregate
 * scopes by `empresaId` only (the FACTURA/PAGO/NOTA_* RLS policies still bound it
 * to the tenant). Money is cast to text so `Decimal(12,2)` strings cross the
 * boundary without a JS float (AGENTS.md "Money = Decimal").
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { SaldoCxcFila } from "../domain/pago";

/**
 * The quoted SQL aliases below (`AS "facturaId"` …) make Postgres preserve the
 * camelCase column names, so `$queryRaw` returns keys identical to the
 * `SaldoCxcFila` field names. Prisma maps the `::int` ids to JS numbers, the
 * `::text` money to strings, and the `timestamptz` to a `Date` — exactly the
 * interface shape, so the rows are returned verbatim with no field remap.
 */

/**
 * Runs the canonical aggregate for one tenant and returns one row per VIGENTE
 * invoice, newest emission first. Empty array when the tenant has no VIGENTE
 * invoices (never `null`). The pure classifier/mora rules are applied by the
 * caller — this repository only produces the summed facts.
 */
export async function consultarSaldoCxcEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
): Promise<SaldoCxcFila[]> {
  const rows = await tx.$queryRaw<SaldoCxcFila[]>`
    SELECT
      f."id"::int                                                        AS "facturaId",
      f."clienteId"::int                                                 AS "clienteId",
      f."total"::numeric(12, 2)::text                                    AS "total",
      COALESCE(p."cobros", 0)::numeric(12, 2)::text                       AS "cobrosAplicados",
      COALESCE(nc."monto", 0)::numeric(12, 2)::text                       AS "ajustesCredito",
      COALESCE(nd."monto", 0)::numeric(12, 2)::text                       AS "ajustesDebito",
      (
        f."total"
        - COALESCE(p."cobros", 0)
        - COALESCE(nc."monto", 0)
        + COALESCE(nd."monto", 0)
      )::numeric(12, 2)::text                                             AS "saldoPendiente",
      f."fechaEmision"                                                    AS "fechaEmision"
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
      AND f."estado" = 'VIGENTE'
    ORDER BY f."fechaEmision" DESC, f."id" DESC`;

  return rows;
}
