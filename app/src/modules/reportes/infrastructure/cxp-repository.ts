/**
 * Reportes infrastructure — the CxP (accounts payable) derived-balance read (FIN-4, slice C).
 *
 * One tenant-pinned SQL aggregate inside `infrastructure/` (ADR-013): never a fetch-then-sum in
 * JS, money CAST to `numeric(12,2)::text` (Decimal string — AGENTS.md "Money = Decimal"), counts
 * `::int`, `empresaId` pinned (first defense) + RLS in force (second, DB-3). The outstanding
 * balance is DERIVED at query time — `Compra.total − Σ PAGO_PROVEEDOR(estado='APLICADO')` over
 * `Compra.estado ∈ {PENDIENTE, RECIBIDA}` — so a `PAGADA` purchase (or a fully-settled `RECIBIDA`)
 * nets to zero and is excluded (FIN-4 "never materialized"; ADR-017). There is NO stored
 * payable/balance column on `COMPRA` (a schema-column assertion guards this in the integration
 * suite, mirroring OP-4's "payment state is never materialized" check).
 *
 * The company-wide vs branch scope is the CALLER's: an Admin read runs inside
 * `conSucursalAmpliadaEnTx` (branch GUC cleared), so these rows span every branch of the pinned
 * empresa; an explicit `sucursalId` still narrows with a plain `WHERE` (ANDed). Optional `pag`
 * pages the screen; OMITTED → the full filtered dataset (the CSV reuses the SAME predicate →
 * EXP-2 parity by construction). CxP is Administrador-only, so no Cobrador ever reaches it (FIN-3).
 */

import { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { VentanaFiltro } from "./dashboard-repository";
import type { Paginacion } from "./operacional-repository";
import type { CxpFila } from "../domain/financiero";

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
 * The shared `WHERE` for an outstanding-payable row: compras still open (PENDIENTE/RECIBIDA),
 * inside the SD window (on `Compra.fecha`), optionally branch-narrowed, and only genuinely
 * unpaid (derived `total − Σpagos > 0`; a PAGADA or fully-collected RECIBIDA nets out). Inlined
 * identically in the detail and the summary statements so screen and CSV share one predicate.
 */
function whereCxP(
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Prisma.Sql {
  const { sucursal, desde, hasta } = paramVentana(ventana);
  return Prisma.sql`
    WHERE c."empresaId" = ${ctx.empresaId}
      AND c."estado" IN ('PENDIENTE', 'RECIBIDA')
      AND (${desde}::timestamptz IS NULL OR c."fecha" >= ${desde})
      AND (${hasta}::timestamptz IS NULL OR c."fecha" <= ${hasta})
      AND (${sucursal}::int IS NULL OR c."sucursalId" = ${sucursal})
      AND (c."total" - COALESCE(pp."pagos", 0)) > 0`;
}

/**
 * The outstanding supplier-purchase rows (FIN-4). `pagos` is a pre-aggregated sub-join so there
 * is no per-purchase query (AGENTS.md "No N+1"); the derived `saldoPendiente` is `total − pagos`,
 * both `Decimal(12,2)` text. Ordered by oldest obligation first (the credit-control convention).
 */
export async function cxpPendienteEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
  pag?: Paginacion,
): Promise<CxpFila[]> {
  return tx.$queryRaw<CxpFila[]>`
    SELECT
      c."id"::int                                                        AS "compraId",
      c."proveedorId"::int                                               AS "proveedorId",
      pr."nombre"                                                        AS "proveedorNombre",
      c."sucursalId"::int                                                AS "sucursalId",
      s."nombre"                                                         AS "sucursalNombre",
      to_char((c."fecha" AT TIME ZONE 'America/Santo_Domingo')::date, 'YYYY-MM-DD') AS "fechaSD",
      c."estado"                                                         AS "estado",
      c."total"::numeric(12, 2)::text                                    AS "total",
      COALESCE(pp."pagos", 0)::numeric(12, 2)::text                      AS "pagado",
      (c."total" - COALESCE(pp."pagos", 0))::numeric(12, 2)::text        AS "saldoPendiente"
    FROM "COMPRA" c
    JOIN "PROVEEDOR" pr ON pr."id" = c."proveedorId"
    JOIN "SUCURSAL" s   ON s."id" = c."sucursalId"
    LEFT JOIN (
      SELECT "compraId", SUM("monto") AS "pagos"
      FROM "PAGO_PROVEEDOR"
      WHERE "empresaId" = ${ctx.empresaId}
        AND "estado" = 'APLICADO'
      GROUP BY "compraId"
    ) pp ON pp."compraId" = c."id"
    ${whereCxP(ctx, ventana)}
    ORDER BY c."fecha" ASC, c."id" ASC
    ${pag ? Prisma.sql`LIMIT ${pag.limit} OFFSET ${pag.offset}` : Prisma.empty}`;
}

/** Number of outstanding purchase rows in the filter (the page-independent row total). */
export async function contarCxPEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<number> {
  const [fila] = await tx.$queryRaw<{ total: number }[]>`
    SELECT COUNT(*)::int AS "total"
    FROM "COMPRA" c
    LEFT JOIN (
      SELECT "compraId", SUM("monto") AS "pagos"
      FROM "PAGO_PROVEEDOR"
      WHERE "empresaId" = ${ctx.empresaId}
        AND "estado" = 'APLICADO'
      GROUP BY "compraId"
    ) pp ON pp."compraId" = c."id"
    ${whereCxP(ctx, ventana)}`;
  return fila?.total ?? 0;
}

/** Σ derived outstanding balance across every open purchase (the CxP summary total). */
export async function totalesCxPEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  ventana: VentanaFiltro,
): Promise<{ saldoTotal: string }> {
  const [fila] = await tx.$queryRaw<{ saldoTotal: string }[]>`
    SELECT
      COALESCE(SUM(c."total" - COALESCE(pp."pagos", 0)), 0)::numeric(12, 2)::text AS "saldoTotal"
    FROM "COMPRA" c
    LEFT JOIN (
      SELECT "compraId", SUM("monto") AS "pagos"
      FROM "PAGO_PROVEEDOR"
      WHERE "empresaId" = ${ctx.empresaId}
        AND "estado" = 'APLICADO'
      GROUP BY "compraId"
    ) pp ON pp."compraId" = c."id"
    ${whereCxP(ctx, ventana)}`;
  return { saldoTotal: fila?.saldoTotal ?? "0.00" };
}
