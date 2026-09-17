/**
 * Reportes infrastructure — the ADMIN company-wide READ widen helper (DB-4).
 *
 * This is the RATIFIED auditoria/inventario widen pattern extracted into a single,
 * reusable primitive so every reportes read that needs a company-wide aggregate widens
 * the SAME way and no repository re-implements the SET/restore dance. `auditoria`'s own
 * repository is left untouched (the proposal lists it as a read-only template); we
 * GENERALIZE its proven mechanism, we do not duplicate it per call site.
 *
 * The invariant the spec freezes (DB-4):
 *   - inside a transaction ALREADY pinned to `empresaId` (by `withTenantTransaction`),
 *     clear ONLY the branch GUC `app.current_sucursal_id` to empty — every tenant RLS
 *     policy treats an empty branch GUC as "company-wide over the pinned empresa";
 *   - run the read;
 *   - restore the branch GUC to the caller's `ctx.sucursalId` in a `finally`, so a FAILED
 *     read still un-widens — the never-ending transaction is not ours to leave wide.
 *   - the `app.current_empresa_id` GUC is NEVER touched — the tenant anchor stays pinned.
 *
 * Read-only by construction: this helper performs no write and is the widen seam every
 * company-wide report/dashboard read funnels through, so a mutation path can never reach
 * it (DB-4 "The widen is read-only"). The restore is asserted with a mock `tx` in the
 * colocated unit test (success + failure) and end-to-end in the DB-4 integration test.
 */

import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

/**
 * Run `lectura` with the branch GUC cleared (company-wide over the pinned empresa), then
 * restore it in `finally` — including when `lectura` throws. The callback receives the
 * SAME `tx` so it runs inside the caller's transaction (never a nested one).
 */
export async function conSucursalAmpliadaEnTx<T>(
  tx: PrismaTx,
  ctx: TenantCtx,
  lectura: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  // SET LOCAL (is_local=true): clear the branch GUC — the ONLY tenant GUC we ever touch.
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', '', true)`;
  try {
    return await lectura(tx);
  } finally {
    // Restore the caller's branch so later statements in the SAME tx see it again. The
    // empresa GUC was never cleared, so the tenant anchor holds even on failure.
    await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
      ctx.sucursalId,
    )}, true)`;
  }
}

/**
 * Run `lectura` with the branch GUC PINNED to a single, explicit branch — the CxC branch-
 * narrowing counterpart to the company-wide widen (FIN-1). Unlike {@link conSucursalAmpliadaEnTx}
 * this NEVER empties the branch GUC: it sets it to exactly `sucursalId`, so RLS bounds the read
 * to that one branch (a plain single-branch predicate), and restores the caller's own branch in
 * `finally`. The `app.current_empresa_id` GUC is never touched, so the tenant anchor holds and a
 * branch OUTSIDE the pinned empresa yields zero rows (RLS). This is how an ADMIN ages one branch's
 * receivables without ever widening to company-wide; the Cobrador path uses no pin at all (their
 * own branch is already pinned by the session context, so a client-supplied branch cannot override
 * it — FIN-3).
 */
export async function conSucursalFijadaEnTx<T>(
  tx: PrismaTx,
  ctx: TenantCtx,
  sucursalId: number,
  lectura: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  // SET LOCAL to the requested branch — NEVER the empty ("") widen value.
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
    sucursalId,
  )}, true)`;
  try {
    return await lectura(tx);
  } finally {
    // Restore the caller's assignment branch so later statements see it again.
    await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(
      ctx.sucursalId,
    )}, true)`;
  }
}
