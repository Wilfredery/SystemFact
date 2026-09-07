import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  PRODUCTO_NO_ENCONTRADO,
  PRODUCTO_YA_INACTIVO,
  PRODUCTO_TIENE_MOVIMIENTOS,
  messageFor,
  type ProductoErrorCode,
} from "../domain/errors";
import {
  obtenerProductoPorId,
  tieneMovimientosActivos,
  desactivarProductoEnTx,
  registrarProductoDesactivadoEnTx,
} from "../infrastructure/producto-repository";

export interface DesactivarProductoInput {
  readonly id: number;
}

export type DesactivarProductoResult =
  | { ok: true; productoId: number; codigo: string }
  | { ok: false; code: ProductoErrorCode; message: string };

function buildError(
  code: ProductoErrorCode,
): { ok: false; code: ProductoErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * Individual soft-deactivation (REQ-PROD-012). The product row is never
 * deleted: `activo=false` preserves history and the partial unique index on
 * (empresaId, codigo) automatically releases the code for reuse. Admin-only
 * authorization is enforced at the action layer; this use case assumes an
 * authorized tenant context and keeps every read/write tenant-scoped.
 */
export async function desactivarProducto(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: DesactivarProductoInput,
): Promise<DesactivarProductoResult> {
  const current = await obtenerProductoPorId(tx, ctx.empresaId, input.id);
  if (current === null) {
    return buildError(PRODUCTO_NO_ENCONTRADO);
  }
  if (!current.producto.activo) {
    return buildError(PRODUCTO_YA_INACTIVO);
  }

  // Soft-delete never trips FK Restrict, so the reference guard must be an
  // explicit business check (design decision over P2003 error mapping).
  const enUso = await tieneMovimientosActivos(tx, ctx.empresaId, input.id);
  if (enUso) {
    return buildError(PRODUCTO_TIENE_MOVIMIENTOS);
  }

  const { deactivated } = await desactivarProductoEnTx(
    tx,
    ctx.empresaId,
    input.id,
  );
  if (!deactivated) {
    // Lost a race against a concurrent deactivation: same user-visible state.
    return buildError(PRODUCTO_YA_INACTIVO);
  }

  // In-transaction, append-only (REQ-PROD-014): if this INSERT or any earlier
  // statement rolls back, neither the flag change nor this event survives.
  await registrarProductoDesactivadoEnTx(tx, ctx, input.id);

  return { ok: true, productoId: input.id, codigo: current.producto.codigo };
}
