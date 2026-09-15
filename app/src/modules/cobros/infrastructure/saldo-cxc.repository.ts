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
  * The lock and the balance read are TWO statements, not one: under READ
  * COMMITTED the scalar subqueries of a single locking statement still evaluate
  * against that statement's snapshot, so a tx that waited on the lock would
  * recompute the balance WITHOUT the payment the winner just committed. Statement
  * 1 parks on the row lock; statement 2 runs after the lock is held and gets a
  * fresh snapshot — the twice-serialized ordering the R-C2 test demands.
  *
  * Both statements run under the app role's RLS (empresa GUC enforced, branch
  * GUC bounding the sums), so the recomputed balance is tenant-scoped by
  * construction.
  */
export async function bloquearYCalcularSaldoFacturaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  facturaId: number,
): Promise<SaldoFacturaBloqueado | null> {
  // Statement 1: take the blocking `FOR UPDATE` row lock FIRST. When two
  // concurrent cobros race, the loser parks here until the winner's
  // transaction commits or aborts.
  const locked = await tx.$queryRaw<{ id: number }[]>`
    SELECT f."id"
    FROM "FACTURA" f
    WHERE f."id" = ${facturaId}
      AND f."empresaId" = ${ctx.empresaId}
      AND f."estado" = 'VIGENTE'
    FOR UPDATE`;
  if (locked.length === 0) return null;

  // Statement 2: under READ COMMITTED every statement takes a fresh snapshot,
  // so this recomputation sees the cobros the winner committed while we were
  // waiting (the old single-statement version evaluated its SUM() subqueries
  // against the pre-lock snapshot and let both payments through — R-C2).
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
      AND f."estado" = 'VIGENTE'`;

  return rows[0] ?? null;
}

/** Client credit terms a CxC row needs for mora, aging and the credit gate. */
export interface TerminosCredito {
  readonly plazoCreditoDias: number;
  readonly creditoHabilitado: boolean;
  /** Frozen `Decimal(12,2)` limit as a string (never a float). */
  readonly limiteCredito: string;
}

/**
 * Batched read of CLIENTE credit terms for the distinct clients in a CxC result
 * set (ONE query for all ids — no per-invoice N+1, AGENTS.md "No N+1"). Feeds
 * `consultarSaldoCxC` (application), the sole entry point for board / aging /
 * mora / credit, so those views never re-query CLIENTE themselves. The explicit
 * `empresaId` filter plus the RLS GUC keep it tenant-bound; `limiteCredito` is
 * projected as a Decimal-string. Returns an empty map when there are no clients.
 */
export async function leerTerminosCreditoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  clienteIds: readonly number[],
): Promise<ReadonlyMap<number, TerminosCredito>> {
  if (clienteIds.length === 0) return new Map();
  const clientes = await tx.cliente.findMany({
    where: { id: { in: [...clienteIds] }, empresaId: ctx.empresaId },
    select: { id: true, plazoCreditoDias: true, creditoHabilitado: true, limiteCredito: true },
  });
  return new Map(
    clientes.map((c) => [
      c.id,
      {
        plazoCreditoDias: c.plazoCreditoDias,
        creditoHabilitado: c.creditoHabilitado,
        limiteCredito: c.limiteCredito.toFixed(2),
      },
    ]),
  );
}

/**
 * A single client's full credit profile for the fase-6 credit gate (R-K1/R-K2):
 * the fiscal classification needed to tell a CREDIT sale (a `CREDITO` client that
 * is not the generic Consumidor Final) from a contado one, plus the enabled flag,
 * frozen limit and payment term the rules consume. Owned here so the gate's
 * client reads live in exactly one module — `venta` never queries `CLIENTE` for a
 * credit decision (the port is its only window into cobros).
 *
 * Tenant-pinned by `empresaId` and run inside the caller's `withTenantTransaction`
 * (RLS GUCs in force). Returns `null` when the id is missing or foreign so the
 * caller can fail closed. `limiteCredito` is a `Decimal(12,2)` string.
 */
export async function leerPerfilCreditoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  clienteId: number,
): Promise<PerfilCredito | null> {
  const row = await tx.cliente.findFirst({
    where: { id: clienteId, empresaId: ctx.empresaId },
    select: {
      tipoCliente: true,
      esConsumidorFinal: true,
      creditoHabilitado: true,
      limiteCredito: true,
      plazoCreditoDias: true,
    },
  });
  if (row === null) return null;
  return {
    // A credit sale is a non-CF client classified `CREDITO`; everything else
    // (CF, MINORISTA, MAYORISTA) is a contado sale that skips the gate.
    esVentaCredito:
      !row.esConsumidorFinal && row.tipoCliente === "CREDITO",
    creditoHabilitado: row.creditoHabilitado,
    limiteCredito: row.limiteCredito.toFixed(2),
    plazoCreditoDias: row.plazoCreditoDias,
  };
}

/** Client facts the credit gate needs (produced by {@link leerPerfilCreditoEnTx}). */
export interface PerfilCredito {
  /** `true` only for a non-CF `tipoCliente=CREDITO` client → the gate applies. */
  readonly esVentaCredito: boolean;
  readonly creditoHabilitado: boolean;
  /** Frozen `Decimal(12,2)` limit as a string. */
  readonly limiteCredito: string;
  readonly plazoCreditoDias: number;
}
