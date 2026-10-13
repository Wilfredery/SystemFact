/**
 * S1 use case — admin-only listing of the caller-empresa's active branches
 * (“auth-tenant-selector”, design D3).
 *
 * Scope comes EXCLUSIVELY from the session `TenantCtx.empresaId`: the surface
 * accepts NO empresa/sucursal scope parameters (P6 enforced by typecheck,
 * TEN-LIST-01-B). Deny-by-default: a non-admin is refused BEFORE any read
 * (TEN-LIST-01-C). An empty active set is a valid success (TEN-LIST-03-A).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_OPS_NO_AUTORIZADO,
  messageFor,
  type TenantErrorCode,
} from "../domain/errors";
import {
  listarSucursalesActivas as listarSucursalesActivasPorDefecto,
  type SucursalResumen,
} from "../infrastructure/repo-sucursal";

export type ListarSucursalesResult =
  | { ok: true; sucursales: readonly SucursalResumen[] }
  | { ok: false; code: TenantErrorCode; message: string };

const defaultDeps = {
  listarSucursalesActivas: listarSucursalesActivasPorDefecto,
};

/**
 * `ctx.sucursalId` (current branch) is carried for the UI current-branch
 * marker on the selector screen — no read here consumes it.
 */
export async function listarSucursalesDeEmpresa(
  ctx: TenantCtx,
  tx: PrismaTx,
  deps: {
    readonly listarSucursalesActivas: typeof listarSucursalesActivasPorDefecto;
  } = defaultDeps,
): Promise<ListarSucursalesResult> {
  if (!ctx.esAdmin) {
    return {
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
      message: messageFor(TEN_OPS_NO_AUTORIZADO),
    };
  }
  return {
    ok: true,
    sucursales: await deps.listarSucursalesActivas(tx, ctx.empresaId),
  };
}
