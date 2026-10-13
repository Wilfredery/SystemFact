/**
 * S2 use case — switch the admin's active sucursal (“auth-tenant-selector”,
 * design D1/D4).
 *
 * Persistence per D1: REWRITE `Usuario.sucursalId` (version++ via the
 * infrastructure port) inside the single `withTenantTransaction` opened by
 * the http adapter — never nested here. All DB access lives in
 * `infrastructure/repo-sucursal.ts`; this file only orders the gates:
 *
 *   1. Role gate — non-admin denied server-side (deny-by-default, doc 04).
 *   2. Idempotent shortcut — re-confirming the current branch is a no-op
 *      success: no write, no audit (TEN-SWITCH-04-E).
 *   3. Target validation — foreign-empresa AND inactive targets share ONE
 *      code (cross-tenant indistinguishability, 04-B/D).
 *   4. Blank GUC → rewrite → pin target (RLS `usuario_modify` + D1).
 *
 * Anti-requirements held: ZERO audit rows (REQ-AUTH-AUD-001 untouched — the
 * branch change is NOT re-authentication), no `app.is_login_flow` widening,
 * no synthetic-email reads (identity flows via ctx.usuarioId), no new
 * tokens/enums/free strings.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  messageFor,
  type TenantErrorCode,
} from "../domain/errors";
import {
  activarSucursalEnTx,
  liberarSucursalActivaEnTx,
  leerSucursalActivaEnTx,
  reescribirSucursalUsuarioEnTx,
} from "../infrastructure/repo-sucursal";

export type CambiarSucursalResult =
  | { ok: true }
  | { ok: false; code: TenantErrorCode; message: string };

export async function cambiarSucursalActiva(
  ctx: TenantCtx,
  input: { readonly sucursalId: number },
  tx: PrismaTx,
): Promise<CambiarSucursalResult> {
  // 1. Role gate (server-side; no client input can authorize this).
  if (!ctx.esAdmin) {
    return {
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
      message: messageFor(TEN_OPS_NO_AUTORIZADO),
    };
  }

  // 2. Idempotent no-op: re-confirming the current branch changes nothing.
  if (input.sucursalId === ctx.sucursalId) {
    return { ok: true };
  }

  // 3. Target validation inside the empresa scope + activa; a foreign-empresa
  //    branch and an inactive own branch are unobservable — one shared code.
  const target = await leerSucursalActivaEnTx(
    tx,
    ctx.empresaId,
    input.sucursalId,
  );
  if (target === null) {
    return {
      ok: false,
      code: TEN_SUCURSAL_NO_VALIDA,
      message: messageFor(TEN_SUCURSAL_NO_VALIDA),
    };
  }

  // 4. Rewrite the resolution point (D1): blank the branch GUC (RLS checks
  //    old/new rows against it), rewrite the row, then pin the target for the
  //    remaining statements of this wrapper. Every NEXT request reads the
  //    updated row and comes out on the new branch, by construction.
  await liberarSucursalActivaEnTx(tx);
  await reescribirSucursalUsuarioEnTx(tx, ctx.usuarioId, input.sucursalId);
  await activarSucursalEnTx(tx, input.sucursalId);

  return { ok: true };
}
