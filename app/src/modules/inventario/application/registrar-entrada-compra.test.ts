/**
 * DB-free unit tests for the purchase-entry use case (fase-3-4b task 1.3).
 *
 * The repository (ownership guard, branch lock, movement, company-wide cost) is
 * mocked, mirroring `ajustar-inventario.test.ts`, so the use-case boundary —
 * validation, typed-error mapping and the batch delegation contract — is proven
 * without a database. The repository's real DB behaviour is covered by
 * `src/integration/inventario-entrada-compra.integration.test.ts`.
 */

import {
  registrarEntradaCompra,
  registrarEntradasCompra,
} from "./registrar-entrada-compra";
import {
  registrarEntradasCompraEnTx,
} from "../infrastructure/inventario-repository";
import {
  CANTIDAD_INVALIDA,
  INVENTARIO_NO_ENCONTRADO,
  MOTIVO_VACIO,
  InventarioDomainError,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/inventario-repository", () => ({
  registrarEntradasCompraEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 10,
  usuarioId: 7,
  esAdmin: true,
};

function makeTx(): PrismaTx {
  return {} as unknown as PrismaTx;
}

const valido = {
  productoId: 5,
  compraId: 99,
  cantidad: "10.000",
  costoUnitarioSinItbis: "100.00",
  motivo: "Recepción compra CMP-000001",
};

describe("registrarEntradaCompra (single-line port realization)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("delegates one line to the batch repository and returns the movement result", async () => {
    (registrarEntradasCompraEnTx as jest.Mock).mockResolvedValue([
      { inventoryId: 100, previousQuantity: "0.000", newQuantity: "10.000", productoId: 5 },
    ]);

    const result = await registrarEntradaCompra(makeTx(), ctx, valido);

    expect(result).toEqual({
      ok: true,
      data: { inventoryId: 100, previousQuantity: "0.000", newQuantity: "10.000" },
    });
    // The single line is pushed through the batch primitive with compraId + net cost.
    expect(registrarEntradasCompraEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({
        compraId: 99,
        lineas: [
          expect.objectContaining({
            productoId: 5,
            cantidad: "10.000",
            costoUnitarioSinItbis: "100.00",
          }),
        ],
      }),
    );
  });

  it("rejects an empty motivo with MOTIVO_VACIO before any DB access", async () => {
    const result = await registrarEntradaCompra(makeTx(), ctx, {
      ...valido,
      motivo: "   ",
    });
    expect(result).toEqual({ ok: false, code: MOTIVO_VACIO, message: expect.any(String) });
    expect(registrarEntradasCompraEnTx).not.toHaveBeenCalled();
  });

  it("rejects a zero quantity with CANTIDAD_INVALIDA (an entry must add stock)", async () => {
    const result = await registrarEntradaCompra(makeTx(), ctx, {
      ...valido,
      cantidad: "0",
    });
    expect(result).toEqual({ ok: false, code: CANTIDAD_INVALIDA, message: expect.any(String) });
    expect(registrarEntradasCompraEnTx).not.toHaveBeenCalled();
  });

  it("rejects a malformed quantity with CANTIDAD_INVALIDA", async () => {
    const result = await registrarEntradaCompra(makeTx(), ctx, {
      ...valido,
      cantidad: "abc",
    });
    expect(result).toEqual({ ok: false, code: CANTIDAD_INVALIDA, message: expect.any(String) });
    expect(registrarEntradasCompraEnTx).not.toHaveBeenCalled();
  });

  it("maps a foreign-product rejection to INVENTARIO_NO_ENCONTRADO (no disclosure)", async () => {
    (registrarEntradasCompraEnTx as jest.Mock).mockRejectedValue(
      new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, { productoId: 999 }),
    );

    const result = await registrarEntradaCompra(makeTx(), ctx, {
      ...valido,
      productoId: 999,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(INVENTARIO_NO_ENCONTRADO);
  });

  it("re-throws an unexpected repository error instead of swallowing it", async () => {
    (registrarEntradasCompraEnTx as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(registrarEntradaCompra(makeTx(), ctx, valido)).rejects.toThrow("boom");
  });
});

describe("registrarEntradasCompra (atomic batch primitive)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("throws MOTIVO_VACIO for an empty reason without touching the repository", async () => {
    await expect(
      registrarEntradasCompra(makeTx(), ctx, {
        compraId: 1,
        motivo: "  ",
        lineas: [{ productoId: 5, cantidad: "1.000", costoUnitarioSinItbis: "10.00" }],
      }),
    ).rejects.toThrow(InventarioDomainError);
    expect(registrarEntradasCompraEnTx).not.toHaveBeenCalled();
  });

  it("passes all lines through to the repository so duplicate products share one cost update", async () => {
    (registrarEntradasCompraEnTx as jest.Mock).mockResolvedValue([
      { inventoryId: 1, previousQuantity: "0.000", newQuantity: "2.000", productoId: 5 },
      { inventoryId: 1, previousQuantity: "2.000", newQuantity: "5.000", productoId: 5 },
    ]);

    const out = await registrarEntradasCompra(makeTx(), ctx, {
      compraId: 42,
      motivo: "Recepción",
      lineas: [
        { productoId: 5, cantidad: "2.000", costoUnitarioSinItbis: "10.00" },
        { productoId: 5, cantidad: "3.000", costoUnitarioSinItbis: "20.00" },
      ],
    });

    const passed = (registrarEntradasCompraEnTx as jest.Mock).mock.calls[0][2];
    expect(passed.compraId).toBe(42);
    // The aggregation into one cost update is the repository's responsibility;
    // the use case forwards both lines untouched (one movement per line).
    expect(passed.lineas).toHaveLength(2);
    expect(out).toHaveLength(2);
  });
});
