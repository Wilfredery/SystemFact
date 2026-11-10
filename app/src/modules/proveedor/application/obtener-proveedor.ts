import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  PROVEEDOR_NO_ENCONTRADO,
  VALIDATION_ERROR,
  messageFor,
  type ProveedorErrorCode,
} from "../domain/errors";
import type { Proveedor, ProveedorResult } from "../domain/proveedor";
import { proveedorByIdEnEmpresa } from "../infrastructure/proveedor-repository";

export interface ObtenerProveedorInput {
  readonly id: number;
}

export type ObtenerProveedorResult = ProveedorResult<Proveedor>;

function buildError(
  code: ProveedorErrorCode,
): { ok: false; code: ProveedorErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * PRV-GET (screens plan Step 4): the single-supplier read the edit dialog needs.
 * It returns the stored `version`, so a concurrent edit is refused instead of
 * silently overwritten (AGENTS.md optimistic locking). The read is tenant
 * scoped from the caller's context; a foreign-tenant id is indistinguishable
 * from a missing one (PRV-ISO). Inactive rows stay readable — the deactivation
 * guard lives in the edit/deactivate use cases, not here.
 */
export async function obtenerProveedor(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ObtenerProveedorInput,
): Promise<ObtenerProveedorResult> {
  if (!Number.isInteger(input.id) || input.id < 1) {
    return buildError(VALIDATION_ERROR);
  }

  const proveedor = await proveedorByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (proveedor === null) {
    return buildError(PROVEEDOR_NO_ENCONTRADO);
  }

  return { ok: true, data: proveedor };
}
