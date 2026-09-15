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

/**
 * One VIGENTE invoice's frozen total and its recomputed pending balance, both as
 * `Decimal(12,2)` strings. Produced by {@link bloquearYCalcularSaldoFacturaEnTx}.
 */
export interface SaldoFacturaBloqueado {
  readonly total: string;
  readonly saldoPendiente: string;
}

/**
 * Re-reads a single invoice's pending balance INSIDE the caller's transaction
 * while taking a `FOR UPDATE` row lock on the `FACTURA` row (R-C2). This is the
 * serialization point for concurrent collections: every `registrarCobro` on the
 * same invoice blocks here until the prior transaction commits, so each one
 * judges its amount against the balance AS OF its own snapshot — never a stale
 * read. Returns `null` when the invoice is missing, not owned by this tenant, or
 * not `VIGENTE`; the caller maps that to `FACTURA_COBRO_NO_VIGENTE`.
 *
 * The pending-balance expression is the SINGLE canonical ADR-017 derivation,
 * term-for-term identical to {@link consultarSaldoCxcEnTx} (total − Σ COBRO/APLICADO
 * − Σ VIGENTE credit-note + Σ VIGENTE debit-note); it is written as correlated
 * scalar subqueries only to (a) avoid scanning the whole board for a one-invoice
 * revalidation and (b) hold the row lock in the same statement. If the canonical
 * formula ever changes, BOTH statements must change together — that coupling is
 * deliberate (the board and the over-payment guard must never disagree).
 *
 * `FOR UPDATE OF f` locks only the invoice row; the scalar subqueries still run
 * under the app role's RLS (empresa GUC enforced, branch GUC bounding the sums),
 * so the recomputed balance is tenant-scoped by construction.
 */
export async function bloquearYCalcularSaldoFacturaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  facturaId: number,
): Promise<SaldoFacturaBloqueado | null> {
  const rows = await tx.$queryRaw<SaldoFacturaBloqueado[]>`
    SELECT
      f."total"::numeric(12, 2)::text AS "total",
      (
        f."total"
        - COALESCE((
            SELECT SUM("monto") FROM "PAGO"
            WHERE "facturaId" = f."id"
              AND "empresaId" = ${ctx.empresaId}
              AND "tipo" = 'COBRO'
              AND "estado" = 'APLICADO'
          ), 0)
        - COALESCE((
            SELECT SUM("monto") FROM "NOTA_CREDITO"
            WHERE "facturaOriginalId" = f."id"
              AND "empresaId" = ${ctx.empresaId}
              AND "estado" = 'VIGENTE'
          ), 0)
        + COALESCE((
            SELECT SUM("monto") FROM "NOTA_DEBITO"
            WHERE "facturaOriginalId" = f."id"
              AND "empresaId" = ${ctx.empresaId}
              AND "estado" = 'VIGENTE'
          ), 0)
      )::numeric(12, 2)::text AS "saldoPendiente"
    FROM "FACTURA" f
    WHERE f."id" = ${facturaId}
      AND f."empresaId" = ${ctx.empresaId}
      AND f."estado" = 'VIGENTE'
    FOR UPDATE OF f`;

  return rows[0] ?? null;
}
