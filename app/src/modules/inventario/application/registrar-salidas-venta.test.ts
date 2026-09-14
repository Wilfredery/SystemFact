/**
 * DB-free unit tests for the sale-exit use case guard.
 *
 * The repository is mocked, mirroring `registrar-entrada-compra.test.ts`, so
 * the use-case boundary — quantity validation and the delegation contract —
 * is proven without a database.
 *
 * REGRESSION (fase-5d GGA review): decimal.js `isPositive()` is sign-based and
 * returns TRUE for zero, so a former `!isPositive()` guard silently accepted
 * `"0.000"` when it only meant to reject negatives. These cases pin the correct
 * `lessThanOrEqualTo(0)` guard.
 */

import { registrarSalidasVenta } from "./registrar-salidas-venta";
import { registrarSalidasVentaEnTx } from "../infrastructure/inventario-repository";
import { CANTIDAD_INVALIDA, InventarioDomainError } from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/inventario-repository", () => ({
  registrarSalidasVentaEnTx: jest.fn(),
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

describe("registrarSalidasVenta quantity guard", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it.each(["0.000", "0", "-1.000"])(
    "rejects cantidad %s with CANTIDAD_INVALIDA before any DB access (sign-based isPositive trap)",
    async (cantidad) => {
      await expect(
        registrarSalidasVenta(makeTx(), ctx, {
          ventaId: 1,
          lineas: [{ productoId: 5, cantidad }],
        }),
      ).rejects.toMatchObject({ code: CANTIDAD_INVALIDA });
      expect(registrarSalidasVentaEnTx).not.toHaveBeenCalled();
    },
  );

  it("delegates a strictly positive line to the repository", async () => {
    (registrarSalidasVentaEnTx as jest.Mock).mockResolvedValue([
      { inventoryId: 1, previousQuantity: "10.000", newQuantity: "7.000", productoId: 5 },
    ]);

    const out = await registrarSalidasVenta(makeTx(), ctx, {
      ventaId: 3,
      lineas: [{ productoId: 5, cantidad: "3.000" }],
    });

    expect(out).toHaveLength(1);
    expect(registrarSalidasVentaEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({
        ventaId: 3,
        lineas: [{ productoId: 5, cantidad: "3.000" }],
      }),
    );
  });

  it("propagates the typed domain error thrown by the repository", async () => {
    (registrarSalidasVentaEnTx as jest.Mock).mockRejectedValue(
      new InventarioDomainError(CANTIDAD_INVALIDA, { productoId: 5 }),
    );
    await expect(
      registrarSalidasVenta(makeTx(), ctx, {
        ventaId: 1,
        lineas: [{ productoId: 5, cantidad: "-2.000" }],
      }),
    ).rejects.toThrow(InventarioDomainError);
  });
});
