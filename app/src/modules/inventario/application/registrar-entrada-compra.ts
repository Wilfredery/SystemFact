/**
 * Use case: purchase-receipt inventory entry — the fase-3-4b realization of the
 * reserved `InventoryEntryPort` from the inventario side (PR-1).
 *
 * Two entry points, both DB-effecting inside the CALLER's `PrismaTx` (no new
 * transaction — the surrounding `withTenantTransaction` owns atomicity):
 *
 *   - `registrarEntradasCompra` — the batch primitive PR-2's `recibirCompra`
 *     invokes once for the whole receipt. It runs the repository's three-phase
 *     path (ownership guard → locked company-wide cost → per-line movement) and
 *     THROWS `InventarioDomainError` on any rejected line so the entire receipt
 *     rolls back atomically (spec "Mid-line failure rolls back"). It is the
 *     mechanism that turns duplicate product lines into ONE cost update while
 *     keeping ONE movement per line, with deterministic ascending-product-id
 *     row locks.
 *
 *   - `registrarEntradaCompra` — the single-line port shape
 *     (`InventoryEntryPort.applyEntry`), returning a typed success/error result
 *     and mapping known domain rejections (foreign product, bad quantity) to
 *     stable codes WITHOUT disclosure. For a single line the guard precedes every
 *     write, so a cross-tenant line changes NOTHING (spec "Cross-tenant line
 *     rejected").
 *
 * The manual-adjustment use case (`ajustar-inventario.ts`) remains the only
 * other mutator of stock and still never touches `costoPromedio` (3.4a boundary).
 * The cost math itself is pure and lives in `../domain/costo-promedio`.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  CANTIDAD_INVALIDA,
  INVENTARIO_NO_ENCONTRADO,
  messageFor,
  InventarioDomainError,
  type InventarioErrorCode,
} from "../domain/errors";
import {
  validateAdjustmentQuantity,
  validateMotivo,
  type InventoryMovementResult,
} from "../domain/inventario";
import {
  registrarEntradasCompraEnTx,
  type EntradaMovimientoAplicado,
  type EntradaCompraLinea,
} from "../infrastructure/inventario-repository";
import { Decimal } from "decimal.js";

/** A single received purchase line pushed through the entry port. */
export interface RegistrarEntradaCompraInput {
  readonly productoId: number;
  /** The purchase that caused the entry (written to `MovimientoInventario.compraId`). */
  readonly compraId: number;
  /** Positive received quantity as a `Decimal(12,3)` string. */
  readonly cantidad: string;
  /** ITBIS-exclusive unit cost as a `Decimal(12,2)` string (net basis). */
  readonly costoUnitarioSinItbis: string;
  /** Audit reason. */
  readonly motivo: string;
}

export type RegistrarEntradaCompraResult =
  | { ok: true; data: InventoryMovementResult }
  | { ok: false; code: InventarioErrorCode; message: string };

/** A validated batch entry input for the atomic multi-line primitive. */
export interface RegistrarEntradasCompraInput {
  readonly compraId: number;
  readonly motivo: string;
  readonly lineas: readonly EntradaCompraLinea[];
}

function buildError(
  code: InventarioErrorCode,
): { ok: false; code: InventarioErrorCode; message: string } {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * Validate an entry line at the domain boundary WITHOUT touching the DB: a
 * present reason, a well-formed magnitude, and a strictly positive quantity (an
 * entry only ever adds stock). Returns the first failing stable code, or `null`.
 */
function validarEntrada(input: {
  readonly cantidad: string;
  readonly costoUnitarioSinItbis: string;
  readonly motivo: string;
}): InventarioErrorCode | null {
  const motivoError = validateMotivo(input.motivo);
  if (motivoError !== null) return motivoError;

  const cantidadError = validateAdjustmentQuantity(input.cantidad);
  if (cantidadError !== null) return cantidadError;

  // A receipt of zero units is a no-op that would still pollute the ledger.
  if (new Decimal(input.cantidad).isZero()) return CANTIDAD_INVALIDA;

  const costoError = validateAdjustmentQuantity(input.costoUnitarioSinItbis);
  if (costoError !== null) return costoError;

  return null;
}

/**
 * Atomic multi-line purchase entry. Invoked ONCE by the receipt orchestrator
 * (PR-2) inside the receipt transaction. Any rejected line throws
 * `InventarioDomainError` so the caller's transaction rolls back every prior
 * line's stock/movement/cost change.
 *
 * @throws InventarioDomainError(CANTIDAD_INVALIDA | INVENTARIO_NO_ENCONTRADO)
 */
export async function registrarEntradasCompra(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarEntradasCompraInput,
): Promise<EntradaMovimientoAplicado[]> {
  const motivoError = validateMotivo(input.motivo);
  if (motivoError !== null) {
    throw new InventarioDomainError(motivoError);
  }
  return registrarEntradasCompraEnTx(tx, ctx, {
    compraId: input.compraId,
    motivo: input.motivo.trim(),
    lineas: input.lineas,
  });
}

/**
 * Single-line port realization of `InventoryEntryPort.applyEntry`, returning a
 * typed result. A rejected line surfaces a stable code with no internal detail;
 * because the ownership guard runs before any write, a cross-tenant line leaves
 * zero persisted changes.
 */
export async function registrarEntradaCompra(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: RegistrarEntradaCompraInput,
): Promise<RegistrarEntradaCompraResult> {
  const invalid = validarEntrada(input);
  if (invalid !== null) {
    return buildError(invalid);
  }

  try {
    const [applied] = await registrarEntradasCompraEnTx(tx, ctx, {
      compraId: input.compraId,
      motivo: input.motivo.trim(),
      lineas: [
        {
          productoId: input.productoId,
          cantidad: input.cantidad,
          costoUnitarioSinItbis: input.costoUnitarioSinItbis,
        },
      ],
    });

    return {
      ok: true,
      data: {
        inventoryId: applied.inventoryId,
        previousQuantity: applied.previousQuantity,
        newQuantity: applied.newQuantity,
      },
    };
  } catch (err) {
    // Known domain rejections become stable typed codes; anything else is a
    // defect and must propagate (never swallow). The repository already scoped
    // every read/write to `ctx.empresaId`, so a foreign product is the only
    // expected throw here.
    if (
      err instanceof InventarioDomainError &&
      (err.code === INVENTARIO_NO_ENCONTRADO || err.code === CANTIDAD_INVALIDA)
    ) {
      return buildError(err.code);
    }
    throw err;
  }
}
