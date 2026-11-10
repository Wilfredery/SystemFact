/**
 * Use case: read ONE product with its full projection (plan Step 2, S1).
 *
 * Exists so the edit dialog can prefill every editable field, including the row
 * `version` that drives the optimistic lock, from a fresh read instead of a
 * possibly stale list row. A missing id and a foreign-tenant id are
 * indistinguishable (PRODUCTO_NO_ENCONTRADO): no cross-tenant disclosure.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  PRODUCTO_NO_ENCONTRADO,
  VALIDATION_ERROR,
  messageFor,
  type ProductoErrorCode,
} from "../domain/errors";
import { obtenerProductoDetalleEnTx } from "../infrastructure/producto-repository";
import {
  mapearProductoConsulta,
  type ProductoConsultaItem,
} from "./producto-consulta-projection";

export interface ObtenerProductoDetalleInput {
  readonly id: number;
}

export type ObtenerProductoDetalleResult =
  | { ok: true; producto: ProductoConsultaItem }
  | { ok: false; code: ProductoErrorCode; message: string };

function buildError(
  code: ProductoErrorCode,
): { ok: false; code: ProductoErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

export async function obtenerProductoDetalle(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ObtenerProductoDetalleInput,
): Promise<ObtenerProductoDetalleResult> {
  // The adapter validates too; the use case guards its own contract.
  if (!Number.isInteger(input.id) || input.id < 1) {
    return buildError(VALIDATION_ERROR);
  }

  const fila = await obtenerProductoDetalleEnTx(tx, ctx.empresaId, input.id);
  if (fila === null) {
    return buildError(PRODUCTO_NO_ENCONTRADO);
  }

  return { ok: true, producto: mapearProductoConsulta(fila) };
}
