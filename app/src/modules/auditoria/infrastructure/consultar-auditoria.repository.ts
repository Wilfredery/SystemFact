/**
 * Auditoria infrastructure — company-wide ADMIN read of the append-only audit
 * log inside the caller's tenant transaction (RLS enforced by the app role).
 *
 * Runs within the enclosing `withTenantTransaction`; the explicit `empresaId`
 * pin and the RLS GUCs are two independent defenses (AGENTS.md "Multi-tenancy
 * ALWAYS", ADR-019 defense-in-depth). This function is READ-only by
 * construction: it exposes no create, update or delete — the log is
 * append-only per ADR-016 (AC-5).
 *
 * Admin company-wide visibility:
 *   `TenantCtx` is branch-shaped and `setTenantContext` writes the caller's
 *   `sucursalId` into `app.current_sucursal_id`. The audit `audit_select` RLS
 *   policy (`20260902120000_enable_rls`) treats an EMPTY branch GUC as
 *   "company-wide visibility over the pinned empresa": it allows rows whose
 *   `sucursalId` IS NULL or equals the branch GUC, and short-circuits to allow
 *   every branch when the GUC is empty. We therefore issue a `SET LOCAL` clear
 *   of the branch GUC inside the transaction (`set_config(..., true)`) so the
 *   Admin sees every branch of the company plus the enterprise-level rows
 *   (LOGIN/LOGOUT with `sucursalId IS NULL`), and restore it in `finally` so
 *   later statements inside the same transaction still see the caller's branch.
 *   The empresa GUC is never cleared — the tenant anchor stays pinned. An
 *   optional `filtro.sucursalId` then narrows the set at the Prisma level for
 *   a per-branch audit view.
 *
 * Explicit `select` (all scalar columns, no relations) plus ordered `findMany`
 * + `count` — never a raw SQL and never a full include (AGENTS.md "Explicit
 * `select` on heavy lists; `full include` only on detail views"). Ordering is
 * `fechaHora DESC, id DESC`; the `(empresaId, fechaHora, id)` index added in
 * Slice A is the access path for the default page.
 */

import { type Prisma } from "@/generated/prisma/client";
import { tenantFilter, type TenantCtx } from "@/modules/tenant/domain/tenant";
import { tenantWhere } from "@/modules/tenant/infrastructure/tenant-where";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import {
  CAMPOS_TEXTO_LIBRE,
  accionAuditoriaDesdeDb,
  calcularOffset,
  type AuditoriaFiltro,
  type AuditoriaRegistro,
} from "../domain/auditoria";
import { accionAuditoriaADb } from "./prisma-accion";

/**
 * Explicit scalar projection — exactly the fields the DTO surfaces, never the
 * relations. Prisma would still return scalars only, but the named select
 * documents the contract: no `usuario`, `sucursal` or `empresa` navigation
 * happens on a list view (AGENTS.md "Explicit `select` on heavy lists").
 */
const SELECCION = {
  id: true,
  empresaId: true,
  sucursalId: true,
  usuarioId: true,
  fechaHora: true,
  accion: true,
  entidad: true,
  idEntidad: true,
  valorAnterior: true,
  valorNuevo: true,
  motivo: true,
} satisfies Prisma.MovimientoAuditoriaSelect;

/** The row + count the caller assembles into a paginated DTO. */
export interface ConsultaAuditoriaLeida {
  readonly filas: AuditoriaRegistro[];
  readonly total: number;
}

/**
 * Reads one page of the tenant's audit log, ordered newest-first, plus the
 * matching total over the SAME filter (never a page-limited subset). `total`
 * counts every row visible under the empty branch GUC — company-wide by
 * construction. `findMany` and `count` run in one transaction and one
 * `Promise.all` — a single round-trip pair, not an N+1 (AGENTS.md "No N+1").
 */
export async function consultarAuditoriaEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  filtro: AuditoriaFiltro,
): Promise<ConsultaAuditoriaLeida> {
  // SET LOCAL: clear the branch GUC so RLS widens to the whole company. This
  // is the ONLY tenant GUC we ever touch here — the empresa GUC stays pinned.
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
  try {
    // Pin empresaId ONLY (never the caller's branch); an optional
    // `filtro.sucursalId` narrows further for a per-branch admin view.
    const where: Prisma.MovimientoAuditoriaWhereInput = {
      ...tenantWhere(tenantFilter(ctx), /* omitSucursalId */ true),
    };
    if (filtro.accion !== undefined) {
      where.accion = accionAuditoriaADb(filtro.accion);
    }
    if (filtro.usuarioId !== undefined) {
      where.usuarioId = filtro.usuarioId;
    }
    if (filtro.sucursalId !== undefined) {
      where.sucursalId = filtro.sucursalId;
    }
    if (filtro.desde !== undefined || filtro.hasta !== undefined) {
      const fechaHora: { gte?: Date; lte?: Date } = {};
      if (filtro.desde !== undefined) fechaHora.gte = filtro.desde;
      if (filtro.hasta !== undefined) fechaHora.lte = filtro.hasta;
      where.fechaHora = fechaHora;
    }
    if (filtro.texto !== undefined) {
      // Free-text targets are `entidad` / `idEntidad` / `motivo` ONLY. The
      // JSON payload columns (`valorAnterior` / `valorNuevo`) are deliberately
      // excluded (AC-3) and asserted so by a unit guard in Slice A's tests.
      where.OR = CAMPOS_TEXTO_LIBRE.map((campo) => ({
        [campo]: { contains: filtro.texto },
      }));
    }

    const [filas, total] = await Promise.all([
      tx.movimientoAuditoria.findMany({
        where,
        select: SELECCION,
        orderBy: [{ fechaHora: "desc" }, { id: "desc" }],
        skip: calcularOffset(filtro),
        take: filtro.pageSize,
      }),
      tx.movimientoAuditoria.count({ where }),
    ]);

    return {
      filas: filas.map((r) => ({
        id: r.id,
        empresaId: r.empresaId,
        sucursalId: r.sucursalId,
        usuarioId: r.usuarioId,
        fechaHora: r.fechaHora,
        accion: accionAuditoriaDesdeDb(r.accion),
        entidad: r.entidad,
        idEntidad: r.idEntidad,
        valorAnterior: r.valorAnterior,
        valorNuevo: r.valorNuevo,
        motivo: r.motivo,
      })),
      total,
    };
  } finally {
    // Restore the branch GUC (SET LOCAL) so any later statement in the SAME
    // transaction sees the caller's branch again — a no-op for the audit read
    // itself, but the transaction is not ours to leave in a widened state.
    await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
      ctx.sucursalId,
    )}, true)`;
  }
}
