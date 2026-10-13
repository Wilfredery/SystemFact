/**
 * Prisma port — SUCURSAL reads for the tenant module (“auth-tenant-selector”,
 * design D3). Narrow select: id + nombre only; no deep tenant data.
 *
 * The Prisma field is `activa` (schema.prisma pin; design resolves the delta
 * specs' generic "activo" wording) — ` @@map("SUCURSAL")`.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

/** Shape the selector screen consumes: id + nombre, nothing deeper. */
export type SucursalResumen = {
  readonly id: number;
  readonly nombre: string;
};

/**
 * Branch-GUC control inside a `withTenantTransaction` (`set_config(..., true)`
 * — the established mechanism, same as `withTenantTransaction`/`enlazarAuthSub`).
 *
 * Why the switch use case needs BOTH (design D1/D4 × RLS `usuario_modify`):
 * the UPDATE that rewrites `Usuario.sucursalId` is checked against the row's
 * own column — USING on the OLD row, WITH CHECK on the NEW row — so it can
 * only run while the GUC is BLANK (both clauses allow an empty
 * `app.current_sucursal_id`). The sequence inside the wrapper is therefore:
 *   liberarSucursalActivaEnTx → UPDATE → activarSucursalEnTx(target),
 * leaving the transaction pinned to the target for its remaining statements
 * and the DB row as the durable resolution point (D1).
 */
export async function liberarSucursalActivaEnTx(tx: PrismaTx): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
}

/** Pins `app.current_sucursal_id` to the target branch for the caller's tx. */
export async function activarSucursalEnTx(
  tx: PrismaTx,
  sucursalId: number,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
    sucursalId,
  )}, true)`;
}

/**
 * Target-branch probe for the switch use case (S2 gate 3): the row must be
 * the caller-empresa's AND active. Foreign-empresa and inactive targets are
 * indistinguishable by construction (P6 filter + RLS) — the caller maps null
 * to the single `TEN_SUCURSAL_NO_VALIDA` code.
 */
export async function leerSucursalActivaEnTx(
  tx: PrismaTx,
  empresaId: number,
  sucursalId: number,
): Promise<{ id: number } | null> {
  return tx.sucursal.findFirst({
    where: { id: sucursalId, empresaId, activa: true },
    select: { id: true },
  });
}

/**
 * The D1 rewrite: moves `Usuario.sucursalId` to the target branch inside the
 * caller's transaction. `version` increments so the optimistic-locking ledger
 * stays coherent with every other USUARIO writer; the concurrent-single-user
 * race is safe by last-write-inside-row-lock (design D1.6) — a stale retry
 * re-verifies (no-op shortcut) or re-validates against the now-current branch.
 */
export async function reescribirSucursalUsuarioEnTx(
  tx: PrismaTx,
  usuarioId: number,
  sucursalId: number,
): Promise<void> {
  await tx.usuario.update({
    where: { id: usuarioId },
    data: { sucursalId, version: { increment: 1 } },
  });
}

/**
 * Lists the caller-empresa's ACTIVE branches, ordered by nombre ascending.
 * Scope must be the session `empresaId` (P6 — never a client-provided filter).
 */
export async function listarSucursalesActivas(
  tx: PrismaTx,
  empresaId: number,
): Promise<{ id: number; nombre: string }[]> {
  return tx.sucursal.findMany({
    where: { empresaId, activa: true },
    select: { id: true, nombre: true },
    orderBy: { nombre: "asc" },
    // Branches are a master-data set; the guard is cheap defense-in-depth
    // against pathological rows (standard max page = 100).
    take: 100,
  });
}
