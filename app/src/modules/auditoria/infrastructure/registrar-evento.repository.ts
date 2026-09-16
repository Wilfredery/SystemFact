/**
 * Auditoria infrastructure — the append-only WRITE adapter (AU-1).
 *
 * Runs INSIDE the caller's `withTenantTransaction` (or, for the auth standalone
 * path, inside the caller's own direct `prisma.$transaction` that has already set
 * the tenant GUCs). It never opens a transaction of its own — the `EnTx`
 * convention — so the audit row is atomic with the effect it describes: if the
 * business operation later rolls back, so does the audit row, and vice-versa.
 *
 * INSERT-only by construction: this module exposes no update or delete. The log is
 * append-only per ADR-016, and `MOVIMIENTO_AUDITORIA` has no RLS UPDATE/DELETE
 * policy, so a mutation attempt would match zero rows anyway.
 *
 * A failing audit insert is NOT swallowed: it propagates and aborts the owning
 * transaction (design.md — "Failed audit inserts roll back with the owning
 * transaction"; "failure propagates rather than silently losing security
 * evidence"). We therefore deliberately write no try/catch around the create.
 *
 * The tenant RLS anchor (`app.current_empresa_id`) must already be pinned to
 * `ctx.empresaId` by the caller before this runs — the cobros path gets that from
 * `setTenantContext`; the auth path sets it explicitly in its standalone tx. The
 * `audit_insert` policy (WITH CHECK empresa GUC = empresaId) is the enforcement
 * backstop: an anchor that does not match the GUC is rejected by the DB.
 */

import type { Prisma } from "@/generated/prisma/client";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type {
  AuditoriaTenantAnchor,
  AuditoriaWriteEvent,
} from "../domain/auditoria";
import { accionAuditoriaADb } from "./prisma-accion";

/**
 * Appends exactly one `MovimientoAuditoria` row for `event`, scoped to `ctx`'s
 * company/user. `ctx` accepts the full `TenantCtx` (cobros) or a narrower
 * tenant anchor without a branch (the auth LOGIN/LOGOUT path); the per-row branch
 * is `event.sucursalId` when provided (so a session event can force `null`),
 * otherwise the anchor's branch, otherwise `null`.
 */
export async function registrarEventoAuditoriaEnTx(
  tx: PrismaTx,
  ctx: AuditoriaTenantAnchor,
  event: AuditoriaWriteEvent,
): Promise<void> {
  // `TenantCtx` (required branch) and a bare `{empresaId, usuarioId}` anchor are
  // both structurally assignable to `AuditoriaTenantAnchor`, whose `sucursalId`
  // is optional so the auth path may omit it entirely.
  const sucursalId =
    event.sucursalId !== undefined
      ? event.sucursalId
      : (ctx.sucursalId ?? null);

  const data: Prisma.MovimientoAuditoriaUncheckedCreateInput = {
    empresaId: ctx.empresaId,
    sucursalId,
    usuarioId: ctx.usuarioId,
    fechaHora: event.fechaHora ?? new Date(),
    accion: accionAuditoriaADb(event.accion),
    entidad: event.entidad,
    idEntidad: event.idEntidad,
    valorAnterior: event.valorAnterior ?? null,
    valorNuevo: event.valorNuevo ?? null,
    motivo: event.motivo ?? null,
  };

  await tx.movimientoAuditoria.create({ data });
}
