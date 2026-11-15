/**
 * Use case — admin-only listing of ALL the caller-empresa's branches, active AND
 * inactive, for the Administración > Sucursales tab (odd/tasks/
 * administracion-sucursales-activar.md, S7).
 *
 * This is a SIBLING of `listarSucursalesDeEmpresa`, not a change to it: that one
 * stays ACTIVE-ONLY because the branch selector, the "Mover de sucursal" dialog
 * and the login count rely on it. Scope comes EXCLUSIVELY from the session
 * `TenantCtx.empresaId`; a non-admin is refused BEFORE any read.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_OPS_NO_AUTORIZADO,
  messageFor,
  type TenantErrorCode,
} from "../domain/errors";
import {
  listarSucursalesConEstadoEnTx as listarSucursalesConEstadoPorDefecto,
  type SucursalGestionable,
} from "../infrastructure/sucursal-gestion-repository";

export type ListarSucursalesAdministracionResult =
  | { ok: true; sucursales: readonly SucursalGestionable[] }
  | { ok: false; code: TenantErrorCode; message: string };

const defaultDeps = {
  listarSucursalesConEstadoEnTx: listarSucursalesConEstadoPorDefecto,
};

export async function listarSucursalesAdministracion(
  ctx: TenantCtx,
  tx: PrismaTx,
  deps: {
    readonly listarSucursalesConEstadoEnTx: typeof listarSucursalesConEstadoPorDefecto;
  } = defaultDeps,
): Promise<ListarSucursalesAdministracionResult> {
  if (!ctx.esAdmin) {
    return {
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
      message: messageFor(TEN_OPS_NO_AUTORIZADO),
    };
  }
  return {
    ok: true,
    sucursales: await deps.listarSucursalesConEstadoEnTx(tx, ctx.empresaId),
  };
}
