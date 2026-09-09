import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  COMPRA_NO_ENCONTRADA,
  VALIDATION_ERROR,
  messageFor,
  type CompraErrorCode,
} from "../domain/errors";
import type { CompraResult } from "../domain/compra";
import {
  obtenerCompraDetalleEnTx,
  type CompraDetalle,
} from "../infrastructure/compra-repository";

export interface ObtenerCompraInput {
  readonly id: number;
}

export type ObtenerCompraResult = CompraResult<CompraDetalle>;

function buildError(
  code: CompraErrorCode,
): { ok: false; code: CompraErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * Load a single purchase with its supplier and frozen lines, strictly scoped to
 * the caller's empresa. A missing or foreign id returns `COMPRA_NO_ENCONTRADA`
 * (not a cross-tenant leak). All money crosses as Decimal strings.
 */
export async function obtenerCompra(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: ObtenerCompraInput,
): Promise<ObtenerCompraResult> {
  if (!Number.isInteger(input.id) || input.id <= 0) {
    return buildError(VALIDATION_ERROR);
  }
  const detalle = await obtenerCompraDetalleEnTx(tx, ctx, input.id);
  if (detalle === null) {
    return buildError(COMPRA_NO_ENCONTRADA);
  }
  return { ok: true, data: detalle };
}
