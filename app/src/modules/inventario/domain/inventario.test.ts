/**
 * DB-free unit tests for the inventario domain (tasks 5.1).
 * The domain imports nothing from Prisma/Next/React, so no harness is needed.
 */

import {
  INVENTORY_SOURCE,
  classifyStockKpi,
  validateAdjustmentQuantity,
  validateMotivo,
  type InventoryEntryPort,
  type InventoryExitPort,
  type InventoryMovementInput,
  type InventoryMovementResult,
  type StockKpi,
} from "./inventario";
import { CANTIDAD_INVALIDA, MOTIVO_VACIO } from "./errors";

describe("classifyStockKpi", () => {
  it("flags stock above the minimum as normal", () => {
    expect(classifyStockKpi("6.000", 5)).toBe<StockKpi>("normal");
    expect(classifyStockKpi("100.000", 10)).toBe("normal");
  });

  it("flags stock below or equal to the minimum as bajo_stock", () => {
    expect(classifyStockKpi("1.000", 5)).toBe("bajo_stock");
    // "below or equal" per spec: quantity exactly at the minimum is bajo_stock.
    expect(classifyStockKpi("5.000", 5)).toBe("bajo_stock");
  });

  it("flags zero or negative stock as agotado regardless of the minimum", () => {
    expect(classifyStockKpi("0.000", 5)).toBe("agotado");
    expect(classifyStockKpi("0", 0)).toBe("agotado");
    expect(classifyStockKpi("-2.000", 5)).toBe("agotado");
  });

  it("compares Decimal strings exactly (no float drift at the boundary)", () => {
    // 0.300 against a minimum of 1 is bajo_stock, not (via float rounding) a
    // false normal.
    expect(classifyStockKpi("0.300", 1)).toBe("bajo_stock");
  });
});

describe("validateAdjustmentQuantity", () => {
  it("accepts a well-formed non-negative magnitude up to 3 decimals", () => {
    expect(validateAdjustmentQuantity("0")).toBeNull();
    expect(validateAdjustmentQuantity("12")).toBeNull();
    expect(validateAdjustmentQuantity("12.345")).toBeNull();
  });

  it("rejects a negative magnitude with CANTIDAD_INVALIDA", () => {
    expect(validateAdjustmentQuantity("-4")).toBe(CANTIDAD_INVALIDA);
    expect(validateAdjustmentQuantity("-0.001")).toBe(CANTIDAD_INVALIDA);
  });

  it("rejects non-numeric input with CANTIDAD_INVALIDA", () => {
    expect(validateAdjustmentQuantity("abc")).toBe(CANTIDAD_INVALIDA);
    expect(validateAdjustmentQuantity("")).toBe(CANTIDAD_INVALIDA);
    expect(validateAdjustmentQuantity("12.3456")).toBe(CANTIDAD_INVALIDA); // > 3 dp
    expect(validateAdjustmentQuantity("1e3")).toBe(CANTIDAD_INVALIDA);
  });
});

describe("validateMotivo", () => {
  it("accepts a non-empty trimmed reason", () => {
    expect(validateMotivo("Ajuste por inventario físico")).toBeNull();
  });

  it("rejects empty and whitespace-only reasons with MOTIVO_VACIO", () => {
    expect(validateMotivo("")).toBe(MOTIVO_VACIO);
    expect(validateMotivo("   ")).toBe(MOTIVO_VACIO);
    expect(validateMotivo("\t \n")).toBe(MOTIVO_VACIO);
  });
});

describe("typed entry/exit seams (3.4b contracts)", () => {
  const input: InventoryMovementInput = {
    branchId: 1,
    productId: 2,
    quantity: "10.000",
    reason: "recepción de compra",
    source: INVENTORY_SOURCE.PURCHASE,
  };

  const result: InventoryMovementResult = {
    inventoryId: 3,
    previousQuantity: "0.000",
    newQuantity: "10.000",
  };

  it("exposes the reserved manual/purchase/sale/return source vocabulary", () => {
    expect(INVENTORY_SOURCE).toEqual({
      MANUAL: "manual",
      PURCHASE: "purchase",
      SALE: "sale",
      RETURN: "return",
    });
  });

  it("an object satisfying the seams type-checks and resolves a movement result", async () => {
    const entry: InventoryEntryPort = {
      applyEntry: async () => result,
    };
    const exit: InventoryExitPort = {
      applyExit: async () => result,
    };
    await expect(entry.applyEntry(input)).resolves.toEqual(result);
    await expect(exit.applyExit(input)).resolves.toEqual(result);
  });
});
