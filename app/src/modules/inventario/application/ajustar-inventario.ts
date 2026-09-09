/**
 * Use case: authorized manual stock adjustment.
 *
 * The manual path carries a SIGNED delta (a negative adjustment reduces stock,
 * a positive one increases it). This use case:
 *   1. validates the mandatory reason,
 *   2. parses and validates the delta, rejecting a zero adjustment and any
 *      malformed magnitude via the domain validators,
 *   3. delegates the atomic, row-locked stock update + movement + audit to the
 *      repository, mapping the domain's non-negative / not-found rejections to
 *      stable typed error results.
 *
 * `costoPromedio` is intentionally never touched here (3.4a boundary).
 */

import { Decimal } from "decimal.js";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  CANTIDAD_INVALIDA,
  INVENTARIO_NO_ENCONTRADO,
  STOCK_INSUFICIENTE,
  messageFor,
  InventarioDomainError,
  type InventarioErrorCode,
} from "../domain/errors";
import {
  INVENTORY_SOURCE,
  validateAdjustmentQuantity,
  validateMotivo,
} from "../domain/inventario";
import { ajustarStockEnTx } from "../infrastructure/inventario-repository";

export interface AjustarInventarioInput {
  readonly productoId: number;
  /** Signed delta as a bounded decimal string, e.g. "5.000" or "-4". */
  readonly cantidad: string;
  readonly motivo: string;
}

export interface AjustarInventarioData {
  readonly inventarioId: number;
  readonly productoId: number;
  readonly cantidadAnterior: string;
  readonly cantidadNueva: string;
}

export type AjustarInventarioResult =
  | { ok: true; data: AjustarInventarioData }
  | { ok: false; code: InventarioErrorCode; message: string };

function buildError(
  code: InventarioErrorCode,
): { ok: false; code: InventarioErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

export async function ajustarInventario(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: AjustarInventarioInput,
): Promise<AjustarInventarioResult> {
  // Mandatory audit reason first — an adjustment without a motive is a gap.
  const motivoError = validateMotivo(input.motivo);
  if (motivoError !== null) {
    return buildError(motivoError);
  }

  // Parse the signed delta. A malformed value is rejected before any DB access.
  let delta: Decimal;
  try {
    delta = new Decimal(input.cantidad);
  } catch {
    return buildError(CANTIDAD_INVALIDA);
  }

  // A no-op adjustment is meaningless and would still pollute history.
  if (delta.isZero()) {
    return buildError(CANTIDAD_INVALIDA);
  }

  // The seam quantity is the NON-NEGATIVE magnitude; direction is the sign of
  // `delta`. validateAdjustmentQuantity guards the magnitude format.
  const magnitudeError = validateAdjustmentQuantity(delta.abs().toFixed(3));
  if (magnitudeError !== null) {
    return buildError(magnitudeError);
  }

  try {
    const moved = await ajustarStockEnTx(tx, ctx, {
      productoId: input.productoId,
      delta: delta.toString(),
      motivo: input.motivo.trim(),
      source: INVENTORY_SOURCE.MANUAL,
    });

    return {
      ok: true,
      data: {
        inventarioId: moved.inventoryId,
        productoId: input.productoId,
        cantidadAnterior: moved.previousQuantity,
        cantidadNueva: moved.newQuantity,
      },
    };
  } catch (err) {
    // The repository enforces the non-negative invariant and tenant scoping
    // under a row lock; those known rejections surface as stable results. Any
    // other error is a defect and must propagate, never be swallowed.
    if (
      err instanceof InventarioDomainError &&
      (err.code === STOCK_INSUFICIENTE || err.code === INVENTARIO_NO_ENCONTRADO)
    ) {
      return buildError(err.code);
    }
    throw err;
  }
}
