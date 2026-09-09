/**
 * Application integration tests for the manual adjustment (tasks 5.4).
 *
 * The repository (which owns the row lock, the non-negative invariant and the
 * movement/audit appends) is mocked so the use-case orchestration and its typed
 * error mapping are proven DB-free, consistent with the producto convention.
 */

import { ajustarInventario } from "./ajustar-inventario";
import { ajustarStockEnTx } from "../infrastructure/inventario-repository";
import {
  CANTIDAD_INVALIDA,
  INVENTARIO_NO_ENCONTRADO,
  MOTIVO_VACIO,
  STOCK_INSUFICIENTE,
  InventarioDomainError,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/inventario-repository", () => ({
  ajustarStockEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 7,
  esAdmin: false,
};

function makeTx(): PrismaTx {
  return {} as unknown as PrismaTx;
}

describe("ajustarInventario", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("applies a positive adjustment and returns the before/after snapshot", async () => {
    const tx = makeTx();
    (ajustarStockEnTx as jest.Mock).mockResolvedValue({
      inventoryId: 100,
      previousQuantity: "3.000",
      newQuantity: "8.000",
    });

    const result = await ajustarInventario(tx, ctx, {
      productoId: 5,
      cantidad: "5",
      motivo: "Inventario físico inicial",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        inventarioId: 100,
        productoId: 5,
        cantidadAnterior: "3.000",
        cantidadNueva: "8.000",
      });
    }
    // The signed delta reaches the repository with the manual source.
    expect(ajustarStockEnTx).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({
        productoId: 5,
        delta: "5",
        motivo: "Inventario físico inicial",
      }),
    );
  });

  it("passes a negative delta through for a stock-reducing adjustment", async () => {
    (ajustarStockEnTx as jest.Mock).mockResolvedValue({
      inventoryId: 100,
      previousQuantity: "10.000",
      newQuantity: "6.000",
    });

    const result = await ajustarInventario(makeTx(), ctx, {
      productoId: 5,
      cantidad: "-4",
      motivo: "Merma por rotura",
    });

    expect(result.ok).toBe(true);
    const passed = (ajustarStockEnTx as jest.Mock).mock.calls[0][2];
    expect(passed.delta).toBe("-4");
  });

  it("rejects an empty motivo with MOTIVO_VACIO and does not mutate", async () => {
    const result = await ajustarInventario(makeTx(), ctx, {
      productoId: 5,
      cantidad: "5",
      motivo: "   ",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(MOTIVO_VACIO);
    expect(ajustarStockEnTx).not.toHaveBeenCalled();
  });

  it("rejects a zero adjustment with CANTIDAD_INVALIDA and no DB access", async () => {
    const result = await ajustarInventario(makeTx(), ctx, {
      productoId: 5,
      cantidad: "0",
      motivo: "Sin efecto",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CANTIDAD_INVALIDA);
    expect(ajustarStockEnTx).not.toHaveBeenCalled();
  });

  it("rejects a malformed quantity with CANTIDAD_INVALIDA before any DB access", async () => {
    const result = await ajustarInventario(makeTx(), ctx, {
      productoId: 5,
      cantidad: "abc",
      motivo: "Razón válida",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CANTIDAD_INVALIDA);
    expect(ajustarStockEnTx).not.toHaveBeenCalled();
  });

  it("maps the repository's insufficient-stock rejection to STOCK_INSUFICIENTE", async () => {
    (ajustarStockEnTx as jest.Mock).mockRejectedValue(
      new InventarioDomainError(STOCK_INSUFICIENTE),
    );

    const result = await ajustarInventario(makeTx(), ctx, {
      productoId: 5,
      cantidad: "-4",
      motivo: "Salida mayor al stock",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(STOCK_INSUFICIENTE);
  });

  it("maps a foreign/non-existent product rejection to INVENTARIO_NO_ENCONTRADO", async () => {
    (ajustarStockEnTx as jest.Mock).mockRejectedValue(
      new InventarioDomainError(INVENTARIO_NO_ENCONTRADO),
    );

    const result = await ajustarInventario(makeTx(), ctx, {
      productoId: 999,
      cantidad: "5",
      motivo: "Intento cross-tenant",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(INVENTARIO_NO_ENCONTRADO);
  });

  it("re-throws unexpected repository errors instead of swallowing them", async () => {
    (ajustarStockEnTx as jest.Mock).mockRejectedValue(new Error("boom"));

    await expect(
      ajustarInventario(makeTx(), ctx, {
        productoId: 5,
        cantidad: "5",
        motivo: "Razón válida",
      }),
    ).rejects.toThrow("boom");
  });
});
