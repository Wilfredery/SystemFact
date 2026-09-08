import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  PROVEEDOR_NO_ENCONTRADO,
  PROVEEDOR_YA_INACTIVO,
  PROVEEDOR_TIENE_COMPRAS,
  messageFor,
  type ProveedorErrorCode,
} from "../domain/errors";
import type { ProveedorResult } from "../domain/proveedor";
import {
  proveedorByIdEnEmpresa,
  tieneComprasNoCanceladas,
  desactivarProveedorEnTx,
  registrarAuditProveedorEnTx,
} from "../infrastructure/proveedor-repository";

export interface DesactivarProveedorInput {
  readonly id: number;
}

export type DesactivarProveedorOutput = {
  readonly id: number;
  readonly nombre: string;
};

export type DesactivarProveedorResult =
  ProveedorResult<DesactivarProveedorOutput>;

function buildError(
  code: ProveedorErrorCode,
): { ok: false; code: ProveedorErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * PRV-DEACT: guarded soft deactivation — the row is never deleted. Blocked by
 * any non-cancelled purchase (explicit business guard, never Prisma P2003),
 * idempotent against concurrent deactivations, and the partial unique on
 * (empresaId, rnc) releases the RNC for reuse afterwards. Admin-only
 * authorization is enforced at the action layer; this use case keeps every
 * read/write tenant-scoped.
 */
export async function desactivarProveedor(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: DesactivarProveedorInput,
): Promise<DesactivarProveedorResult> {
  const actual = await proveedorByIdEnEmpresa(tx, ctx.empresaId, input.id);
  if (actual === null) {
    return buildError(PROVEEDOR_NO_ENCONTRADO);
  }
  if (!actual.activo) {
    return buildError(PROVEEDOR_YA_INACTIVO);
  }

  const enUso = await tieneComprasNoCanceladas(tx, ctx.empresaId, input.id);
  if (enUso) {
    return buildError(PROVEEDOR_TIENE_COMPRAS);
  }

  const { deactivated } = await desactivarProveedorEnTx(
    tx,
    ctx.empresaId,
    input.id,
  );
  if (!deactivated) {
    // Lost a race against a concurrent deactivation: same user-visible state.
    return buildError(PROVEEDOR_YA_INACTIVO);
  }

  // CANCELAR is the frozen-enum closest to "retire without destruction"
  // (no enum extension, no migration); motivo keeps it traceable.
  await registrarAuditProveedorEnTx(
    tx,
    ctx,
    "CANCELAR",
    input.id,
    { activo: true },
    { activo: false },
    "proveedor.desactivado",
  );

  return { ok: true, data: { id: input.id, nombre: actual.nombre } };
}
