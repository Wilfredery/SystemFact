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

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { SaldoCxcFila } from "../domain/pago";
import {
  limitePaginaSql,
  type Paginacion,
} from "@/modules/reportes/infrastructure/operacional-repository";
import { calcularOffset } from "@/shared/domain/pagination";
import type {
  FilaCxcAbierta,
  ResumenAging,
} from "@/modules/reportes/domain/aging";

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
 * COUPLING FRAGMENT (R-C9): the canonical ADR-017 statement THIS FILE EMBEDS
 * above (`consultarSaldoCxcEnTx`), SELECT + JOINs + WHERE, as a composable
 * fragment — WITHOUT its `ORDER BY` (D2: an outer wrapper cannot rely on inner
 * order; the wrapper re-applies the pinned order itself). This is a deliberate
 * in-file coupling copy — the SAME discipline `bloquearYCalcularSaldoFacturaEnTx`
 * documents ("if the canonical formula ever changes, BOTH statements must change
 * together"): here the count and the board page must never disagree with the
 * canonical aggregate, so ALL THREE move together. The canonical function itself
 * stays byte-identical — the page cut lives ONLY in the outward queries.
 */
function saldoCxcFragmentoCanonico(ctx: TenantCtx): Prisma.Sql {
  return Prisma.sql`
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
      AND f."estado" = 'VIGENTE'`;
}

/**
 * The board's SERVED set: the canonical fragment narrowed to the OUTSTANDING
 * receivables (`cobrosAplicados < total`), the pinned `fechaEmision DESC,
 * "facturaId" DESC` order re-applied by the WRAPPER (identical to the canonical
 * order — the inner alias IS the canonical `f."id"`), and the page cut executed
 * in SQL via the shared `limitePaginaSql` tail (D1 OFFSET, D2 pin). The filter
 * re-encodes ONLY the `clasificarEstadoPago` PAGADA threshold: rows the pure
 * classifier would call PAGADA (applied ≥ total, raw or via nota-de-débito
 * re-inflation) can never appear, and every remaining row derives PENDIENTE or
 * PARCIAL — whose parity is pinned by the tablero integration suite (R-C9).
 */
export async function consultarSaldoCxcTableroEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  pag?: Paginacion,
): Promise<SaldoCxcFila[]> {
  return tx.$queryRaw<SaldoCxcFila[]>`
    SELECT s.*
    FROM (${saldoCxcFragmentoCanonico(ctx)}) s
    WHERE s."cobrosAplicados"::numeric < s."total"::numeric
    ORDER BY s."fechaEmision" DESC, s."facturaId" DESC
    ${limitePaginaSql(pag)}`;
}

/** The two counts the board page needs, computed over the SAME fragment. */
export interface SaldoCxcConteo {
  /** VIGENTE invoices of every derived payment state. */
  readonly total: number;
  /** The board's filtered set: VIGENTE with `cobrosAplicados < total`. */
  readonly pendientes: number;
}

/**
 * Server-side filtered total (R-C9 "the server MUST compute … the filtered total
 * count"): ONE COUNT over the same canonical fragment with the SAME filtering
 * threshold — never a page-limited subset, never a different predicate than the
 * page query. One statement returns both counts (`FILTER` clause), so page and
 * total are a single round-trip over identical row predicates.
 */
export async function contarSaldoCxcEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
): Promise<SaldoCxcConteo> {
  const rows = await tx.$queryRaw<{ total: number; pendientes: number }[]>`
    SELECT
      COUNT(*)::int                                                      AS "total",
      COUNT(*) FILTER (
        WHERE s."cobrosAplicados"::numeric < s."total"::numeric
      )::int                                                             AS "pendientes"
    FROM (${saldoCxcFragmentoCanonico(ctx)}) s`;
  return rows[0] ?? { total: 0, pendientes: 0 };
}

/**
 * One OPEN receivable with the SQL-computed SD past-due day count that orders
 * the aging page (design D2's computed-field case). The aging MATH itself stays
 * pure — `construirFilaAging` recomputes day/date/bucket on the page rows — so
 * the only aging rule encoded here is the DAY COUNT expression the ORDER BY
 * needs, pinned equal to `diasVencidoEnSD` by the aging-sql-pin unit suite and
 * by the aging-paginado integration suite over 500+ boundary fixtures.
 */
export interface FilaCxcAgingSql extends FilaCxcAbierta {
  /** SQL SD-calendar days past due — the value the pinned `ORDER BY` uses (D2). */
  readonly diasVencido: number;
}

/**
 * The RESOLVED credit term expression (D2): the client's term wins when > 0,
 * else the DB `PLAZO_CREDITO` parameter bind (`dbPlazo`, 0 when absent). This
 * IS the paralización resolution `leerTerminosCreditoEnTx` + `leerPlazoCreditoEnTx`
 * produce in the pure mapping — never a hardcoded term (FIN-2).
 */
function plazoResueltoSql(dbPlazo: number | null): Prisma.Sql {
  return Prisma.sql`(CASE WHEN c."plazoCreditoDias" > 0 THEN c."plazoCreditoDias" ELSE COALESCE(${dbPlazo}::int, 0) END)::int`;
}

/**
 * The SD past-due day-count expression (D2, computed-field case): the client's
 * SOUTH-DOMINGO calendar due date is `fechaEmision + plazo days` resolved with
 * the same `AT TIME ZONE 'America/Santo_Domingo'::date` idiom the codebase
 * already ratifies for SD calendar days (no manual hour arithmetic); `date -
 * date` subtracts whole SD days and `GREATEST(..., 0)` clamps the not-yet-due
 * flank — exactly `diasVencidoEnSD`'s rule. Run inside the aging fragment so
 * `s."fechaEmision"` and the CLIENTE alias exist.
 */
function diasVencidoSql(now: Date, plazo: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`GREATEST(
        ((${now} AT TIME ZONE 'America/Santo_Domingo')::date
         - ((s."fechaEmision" + (${plazo}::text || ' days')::interval)
            AT TIME ZONE 'America/Santo_Domingo')::date)::int,
        0)`;
}

/**
 * The OPEN (`saldoPendiente > 0`) receivable set of the CANONICAL fragment,
 * enriched with the CLIENTE plazo join + `dbPlazo` bind and the SQL
 * `diasVencido`. This is the aging data layer (FIN-6): it shares the canonical
 * balance fragment verbatim (ADR-017 — the balances can never drift from the
 * canonical digest) and narrows it to the open receivables the aging set owns,
 * mirroring the old in-app `saldoPendiente > 0` filter.
 */
function fragmentoAgingAbiertas(
  ctx: TenantCtx,
  now: Date,
  dbPlazo: number | null,
): Prisma.Sql {
  const plazo = plazoResueltoSql(dbPlazo);
  return Prisma.sql`
    SELECT
      s."facturaId"                                       AS "facturaId",
      s."clienteId"                                       AS "clienteId",
      s."saldoPendiente"                                  AS "saldoPendiente",
      s."fechaEmision"                                    AS "fechaEmision",
      ${plazo}                                            AS "plazoCreditoDias",
      ${diasVencidoSql(now, plazo)}                       AS "diasVencido"
    FROM (${saldoCxcFragmentoCanonico(ctx)}) s
    LEFT JOIN "CLIENTE" c
      ON c."id" = s."clienteId"
      AND c."empresaId" = ${ctx.empresaId}
    WHERE s."saldoPendiente"::numeric > 0`;
}

/**
 * ONE page of the CxC aging set, cut with `LIMIT`/`OFFSET` in SQL (FIN-6):
 * the pinned D2 order `diasVencido DESC, saldoPendiente::numeric DESC,
 * facturaId ASC` — identical to the pre-slice sort `cxc-aging.ts` applied —
 * plus the page tail via the shared `limitePaginaSql` contract (D1 OFFSET;
 * the offset is derived from the shared `calcularOffset`). The aging set is
 * smaller than the board's, so an OFFSET plan stays far below any interactive
 * budget; keyset was rejected by D1.
 */
export async function consultarSaldoCxcAgingEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  opts: {
    readonly page: number;
    readonly pageSize: number;
    readonly now: Date;
    readonly dbPlazo: number | null;
  },
): Promise<FilaCxcAgingSql[]> {
  return tx.$queryRaw<FilaCxcAgingSql[]>`
    SELECT
      a."facturaId"                                       AS "facturaId",
      a."clienteId"                                       AS "clienteId",
      a."saldoPendiente"                                  AS "saldoPendiente",
      a."fechaEmision"                                    AS "fechaEmision",
      a."plazoCreditoDias"                                AS "plazoCreditoDias",
      a."diasVencido"                                     AS "diasVencido"
    FROM (${fragmentoAgingAbiertas(ctx, opts.now, opts.dbPlazo)}) a
    ORDER BY a."diasVencido" DESC, a."saldoPendiente"::numeric DESC, a."facturaId" ASC
    ${limitePaginaSql({
      offset: calcularOffset(opts.page, opts.pageSize),
      limit: opts.pageSize,
    })}`;
}

/**
 * The page-independent bucket summary as a SQL aggregate (FIN-6 "the server
 * computes pages and total"): Σ open balance + open-invoice count + the four
 * bucket Σ/count pairs, with the bucket boundaries re-encoded ONLY as the
 * frozen `CASE` D2 sanctions (mirroring `clasificarBucketAging`; the
 * equivalence is pinned by aging-sql-pin over 0..400 and by the
 * aging-paginado SQL-vs-domain parity over 500+ fixtures). `saldoPendiente`
 * is summed NUMERICALLY — the canonical column is `::text`, and money
 * ordering/summing must never lean on lexicographic text.
 */
export async function resumirAgingSqlEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  opts: { readonly now: Date; readonly dbPlazo: number | null },
): Promise<ResumenAging> {
  const bucket = Prisma.sql`(CASE
        WHEN a."diasVencido" = 0 THEN 'AL_DIA'
        WHEN a."diasVencido" <= 30 THEN 'VENCIDO_1_30'
        WHEN a."diasVencido" <= 60 THEN 'VENCIDO_31_60'
        ELSE 'MAYOR_60'
      END)`;
  const rows = await tx.$queryRaw<{
    saldoTotal: string;
    facturasAbiertas: number;
    al_dia: string;
    vencido_1_30: string;
    vencido_31_60: string;
    mayor_60: string;
    al_dia_cnt: number;
    vencido_1_30_cnt: number;
    vencido_31_60_cnt: number;
    mayor_60_cnt: number;
  }[]>`
    SELECT
      COALESCE(SUM(a."saldoPendiente"::numeric), 0)::numeric(12, 2)::text   AS "saldoTotal",
      COUNT(*)::int                                                       AS "facturasAbiertas",
      COALESCE(SUM(a."saldoPendiente"::numeric) FILTER (WHERE ${bucket} = 'AL_DIA'), 0)::numeric(12, 2)::text AS "al_dia",
      COALESCE(SUM(a."saldoPendiente"::numeric) FILTER (WHERE ${bucket} = 'VENCIDO_1_30'), 0)::numeric(12, 2)::text AS "vencido_1_30",
      COALESCE(SUM(a."saldoPendiente"::numeric) FILTER (WHERE ${bucket} = 'VENCIDO_31_60'), 0)::numeric(12, 2)::text AS "vencido_31_60",
      COALESCE(SUM(a."saldoPendiente"::numeric) FILTER (WHERE ${bucket} = 'MAYOR_60'), 0)::numeric(12, 2)::text AS "mayor_60",
      COUNT(*) FILTER (WHERE ${bucket} = 'AL_DIA')::int                   AS "al_dia_cnt",
      COUNT(*) FILTER (WHERE ${bucket} = 'VENCIDO_1_30')::int             AS "vencido_1_30_cnt",
      COUNT(*) FILTER (WHERE ${bucket} = 'VENCIDO_31_60')::int            AS "vencido_31_60_cnt",
      COUNT(*) FILTER (WHERE ${bucket} = 'MAYOR_60')::int                 AS "mayor_60_cnt"
    FROM (${fragmentoAgingAbiertas(ctx, opts.now, opts.dbPlazo)}) a`;
  const fila = rows[0] ?? {
    saldoTotal: "0.00",
    facturasAbiertas: 0,
    al_dia: "0.00",
    vencido_1_30: "0.00",
    vencido_31_60: "0.00",
    mayor_60: "0.00",
    al_dia_cnt: 0,
    vencido_1_30_cnt: 0,
    vencido_31_60_cnt: 0,
    mayor_60_cnt: 0,
  };
  return {
    saldoTotal: fila.saldoTotal,
    facturasAbiertas: fila.facturasAbiertas,
    porBucket: {
      AL_DIA: fila.al_dia,
      VENCIDO_1_30: fila.vencido_1_30,
      VENCIDO_31_60: fila.vencido_31_60,
      MAYOR_60: fila.mayor_60,
    },
    conteoPorBucket: {
      AL_DIA: fila.al_dia_cnt,
      VENCIDO_1_30: fila.vencido_1_30_cnt,
      VENCIDO_31_60: fila.vencido_31_60_cnt,
      MAYOR_60: fila.mayor_60_cnt,
    },
  };
}

/**
 * One VIGENTE invoice's frozen total, its recomputed pending balance, and the net
 * cash actually collected on it, all as `Decimal(12,2)` strings. Produced by
 * {@link bloquearYCalcularSaldoFacturaEnTx}.
 */
export interface SaldoFacturaBloqueado {
  readonly total: string;
  readonly saldoPendiente: string;
  /**
   * Net cash collected = Σ COBRO/APLICADO − Σ committed refund (REEMBOLSO in
   * REGISTRADO or APLICADO). A refund-bound-only fact (audit run-3): the
   * ADR-017 canonical payable state (`saldoPendiente`) intentionally does NOT
   * count refunds, so the refund guard gets its own signed term on the SAME
   * locked recompute.
   */
  readonly cobradoNeto: string;
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
  // against the pre-lock snapshot and let both payments through — R-C2). The
  // audit run-3 `cobradoNeto` column rides the same snapshot: Σ COBRO/APLICADO
  // − Σ committed REEMBOLSO, signed under the SAME row lock.
  const rows = await tx.$queryRaw<SaldoFacturaBloqueado[]>`
    SELECT
      f."total"::numeric(12, 2)::text AS "total",
      (
        COALESCE((
          SELECT SUM("monto") FROM "PAGO"
          WHERE "facturaId" = f."id"
            AND "empresaId" = ${ctx.empresaId}
            AND "tipo" = 'COBRO'
            AND "estado" = 'APLICADO'
        ), 0)
        - COALESCE((
            SELECT SUM("monto") FROM "PAGO"
            WHERE "facturaId" = f."id"
              AND "empresaId" = ${ctx.empresaId}
              AND "tipo" = 'REEMBOLSO'
              AND "estado" IN ('REGISTRADO', 'APLICADO')
          ), 0)
      )::numeric(12, 2)::text AS "cobradoNeto",
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
