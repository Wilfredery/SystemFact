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

/** Active branch as the Administración tab shows it (S8): the edit dialog needs all of it. */
export type SucursalDetalle = {
  readonly id: number;
  readonly nombre: string;
  readonly direccion: string;
  readonly telefono: string;
  readonly version: number;
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
 * Destination-branch read for every path that PUTS a user in a branch (the user
 * move and the branch switch; odd/tasks/administracion-sucursales-activar.md S5b).
 * The row must be the caller-empresa's AND active, and it is read
 * `FOR SHARE`: the lock is held until the transaction ends, so a concurrent
 * deactivation (`FOR UPDATE`) waits for the move/switch to commit and then counts
 * the moved user; if the deactivation committed first, the re-evaluated row is
 * inactive and this returns `null` (READ COMMITTED re-checks the predicate after
 * the wait). Foreign-empresa and inactive targets are indistinguishable by
 * construction (P6 filter + RLS) — the caller maps null to the single
 * `TEN_SUCURSAL_NO_VALIDA` code. `FOR SHARE` needs only SELECT.
 */
export async function leerSucursalActivaConBloqueoEnTx(
  tx: PrismaTx,
  empresaId: number,
  sucursalId: number,
): Promise<{ id: number } | null> {
  const filas = await tx.$queryRaw<{ id: number }[]>`
    SELECT s."id"
    FROM "SUCURSAL" s
    WHERE s."id" = ${sucursalId}
      AND s."empresaId" = ${empresaId}
      AND s."activa" = true
    FOR SHARE`;
  return filas[0] ?? null;
}

/**
 * PLAIN (unlocked) active-branch probe. It exists only to CLASSIFY a refused
 * `leerSucursalActivaConBloqueoEnTx`: `FOR SHARE` takes a row lock, which RLS
 * only grants to rows the caller may UPDATE (admin-only `sucursal_update`), so a
 * non-admin gets no row from the locked read even for an active branch of its
 * own empresa. This read, which needs only SELECT, tells that apart from a
 * branch that is really unavailable (unknown, foreign or inactive).
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
 * PLAIN read of one branch of the empresa WITH its `activa` flag. Classifies an
 * empty `leerSucursalActivaConBloqueoEnTx` for the user activation (L8): `null`
 * = unknown or foreign branch, `activa=false` = a real but inactive branch.
 */
export async function leerSucursalEstadoEnTx(
  tx: PrismaTx,
  empresaId: number,
  sucursalId: number,
): Promise<{ id: number; activa: boolean } | null> {
  return tx.sucursal.findFirst({
    where: { id: sucursalId, empresaId },
    select: { id: true, activa: true },
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
  empresaId: number,
  usuarioId: number,
  sucursalId: number,
): Promise<boolean> {
  // Verified write: `empresaId` is pinned in the statement itself (AGENTS.md
  // defense in depth), not only by the RLS policy. A user that is not a row of
  // the caller empresa matches nothing: the caller gets `false` and fails closed.
  const resultado = await tx.usuario.updateMany({
    where: { id: usuarioId, empresaId },
    data: { sucursalId, version: { increment: 1 } },
  });
  return resultado.count === 1;
}

/**
 * Lists the caller-empresa's ACTIVE branches, ordered by nombre ascending.
 * Scope must be the session `empresaId` (P6 — never a client-provided filter).
 */
export async function listarSucursalesActivasConDetalle(
  tx: PrismaTx,
  empresaId: number,
): Promise<SucursalDetalle[]> {
  return tx.sucursal.findMany({
    where: { empresaId, activa: true },
    select: { id: true, nombre: true, direccion: true, telefono: true, version: true },
    orderBy: { nombre: "asc" },
    take: 100,
  });
}

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
