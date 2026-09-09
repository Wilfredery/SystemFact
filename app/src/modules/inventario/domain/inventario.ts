/**
 * Inventario domain — pure business rules, quantity math, KPI classification
 * and the typed entry/exit seams for future purchase/sale integration (3.4b).
 *
 * ADR-013: this module imports NOTHING from Next.js, React, Prisma or Supabase.
 * Quantities cross the domain boundary as `Decimal`-compatible strings (the
 * DB column is `Decimal(12,3)`); `decimal.js` is a pure numeric library and is
 * the same one the `producto` domain relies on, so comparisons are exact.
 */

import { Decimal } from "decimal.js";
import {
  CANTIDAD_INVALIDA,
  MOTIVO_VACIO,
  type InventarioErrorCode,
} from "./errors";

/**
 * Origin of an inventory movement.
 *
 * `MANUAL` is implemented by 3.4a (the manual-adjustment path). `PURCHASE`,
 * `SALE` and `RETURN` are RESERVED seam metadata only: they give the 3.4b
 * purchase/sale callers a stable, compile-checked vocabulary without 3.4a
 * shipping any caller for them.
 */
export const INVENTORY_SOURCE = {
  MANUAL: "manual",
  PURCHASE: "purchase",
  SALE: "sale",
  RETURN: "return",
} as const;

export type InventorySource =
  (typeof INVENTORY_SOURCE)[keyof typeof INVENTORY_SOURCE];

/**
 * A single, direction-agnostic inventory movement request flowing through the
 * entry/exit seams. `quantity` is always a NON-NEGATIVE magnitude; the sign is
 * encoded by WHICH port is invoked (`applyEntry` vs `applyExit`), so the seam
 * never carries a negative amount. `source` records the business origin.
 */
export interface InventoryMovementInput {
  readonly branchId: number;
  readonly productId: number;
  readonly quantity: string;
  readonly reason: string;
  readonly source: InventorySource;
}

/** Authoritative before/after snapshot returned after a movement commits. */
export interface InventoryMovementResult {
  readonly inventoryId: number;
  readonly previousQuantity: string;
  readonly newQuantity: string;
}

/**
 * Typed entry seam. 3.4b's purchase-receipt flow will implement this and gain
 * an atomic "add stock + append movement" behaviour WITHOUT touching the core.
 */
export interface InventoryEntryPort {
  applyEntry(input: InventoryMovementInput): Promise<InventoryMovementResult>;
}

/**
 * Typed exit seam. 3.4b's sale/return flow will implement this; the
 * non-negative invariant is enforced by the shared repository underneath.
 */
export interface InventoryExitPort {
  applyExit(input: InventoryMovementInput): Promise<InventoryMovementResult>;
}

/** Minimum-stock indicator exposed on every row of the stock listing. */
export type StockKpi = "normal" | "bajo_stock" | "agotado";

/**
 * Classifies current stock against the per-product `stockMinimo` threshold.
 *
 * Rules (spec "Branch-scoped paginated stock listing"):
 *   - `agotado`    when quantity <= 0
 *   - `bajo_stock` when 0 < quantity <= stockMinimo (below OR equal the min)
 *   - `normal`     otherwise
 *
 * @param cantidad   current quantity, a `Decimal(12,3)`-compatible string
 * @param stockMinimo per-product threshold (PRODUCTO.stockMinimo, an Int)
 */
export function classifyStockKpi(cantidad: string, stockMinimo: number): StockKpi {
  const qty = new Decimal(cantidad);
  if (qty.lte(0)) return "agotado";
  if (qty.lte(stockMinimo)) return "bajo_stock";
  return "normal";
}

/**
 * Validates the NON-NEGATIVE magnitude carried by a movement seam or derived
 * from a manual adjustment. Accepts up to 9 integer digits and 3 decimals
 * (`Decimal(12,3)` headroom). Rejects non-numeric input and any negative sign.
 *
 * @returns `null` when valid, otherwise the stable `CANTIDAD_INVALIDA` code.
 */
export function validateAdjustmentQuantity(cantidad: string): InventarioErrorCode | null {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(cantidad)) {
    return CANTIDAD_INVALIDA;
  }
  return null;
}

/**
 * Validates that an adjustment `motivo` is present. The audit trail is only
 * meaningful when every correction carries a reason, so an empty or whitespace
 * value is rejected at the domain boundary.
 *
 * @returns `null` when valid, otherwise the stable `MOTIVO_VACIO` code.
 */
export function validateMotivo(motivo: string): InventarioErrorCode | null {
  if (motivo.trim().length === 0) {
    return MOTIVO_VACIO;
  }
  return null;
}

/**
 * Row shape returned by the (tenant-scoped) listing repository, before the
 * application layer enriches it with a {@link StockKpi}. `cantidad` is a
 * Decimal string; `stockMinimo` is the per-product Int threshold.
 */
export interface InventarioStockRow {
  readonly inventarioId: number;
  readonly productoId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly cantidad: string;
  readonly stockMinimo: number;
}
