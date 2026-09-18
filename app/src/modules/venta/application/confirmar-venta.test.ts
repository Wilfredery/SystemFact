/**
 * Colocated unit tests — pure pre-consume availability helper (quality-polish 1e).
 *
 * Locks the EXACT predicate `verificarDisponibilidadPreNcf` inherited from the
 * inline R-V15 hard preview: a shortage is `requested > available` (strict —
 * an exact fit is sufficient), a product missing from the stock rows counts as
 * zero, and only DEMANDED products are considered. The reject-before-any-burn
 * ordering around the NCF consume stays under the integration suite
 * (`src/integration/confirmar-venta.integration.test.ts`); this file proves
 * only that the pure extraction is behavior-identical without a database.
 */

import { Decimal } from "decimal.js";
import type { StockWarning } from "../domain/errors";
import { verificarDisponibilidadPreNcf } from "./confirmar-venta";

// The helper under test is pure; stub the use case's DB-facing graph so the
// module loads without touching the (jest-stubbed) generated Prisma enums —
// the same isolation `venta-service.test.ts` uses. None of these are called.
jest.mock("../infrastructure/venta-repository", () => ({
  crearFacturaEnTx: jest.fn(),
  confirmarVentaFlipEnTx: jest.fn(),
  leerClienteParaElegibilidadEnTx: jest.fn(),
  leerFacturaAutomaticaDeEmpresaEnTx: jest.fn(),
  leerFacturaDeVentaEnTx: jest.fn(),
  leerStockSucursalEnTx: jest.fn(),
  leerVentaParaConfirmarEnTx: jest.fn(),
  asignarCorrelativoFacturaEnTx: jest.fn(),
}));
jest.mock("@/modules/inventario/application/registrar-salidas-venta", () => ({
  registrarSalidasVenta: jest.fn(),
}));
jest.mock("@/modules/cobros/application/credit-port", () => ({
  evaluarCreditoPort: { evaluarCreditoCliente: jest.fn() },
}));
jest.mock("@/modules/cobros/application/registrar-cobro", () => ({
  registrarCobro: jest.fn(),
}));
jest.mock("@/modules/ncf/application/consumir-ncf", () => ({
  consumirNcfEnTx: jest.fn(),
  NcfConsumoError: class NcfConsumoError extends Error {},
}));

const demandaDe = (entradas: readonly (readonly [number, string])[]): Map<number, Decimal> =>
  new Map(entradas.map(([productoId, cantidad]) => [productoId, new Decimal(cantidad)]));

const stock = (productoId: number, disponible: string) => ({ productoId, disponible });

describe("verificarDisponibilidadPreNcf (pure pre-consume availability)", () => {
  it("returns no warnings for an empty demand, even with stock rows present", () => {
    const resultado = verificarDisponibilidadPreNcf(
      new Map<number, Decimal>(),
      [stock(1, "10.000")],
    );
    expect(resultado).toEqual([]);
  });

  it("returns no warnings when every requested quantity is fully available", () => {
    const resultado = verificarDisponibilidadPreNcf(
      demandaDe([
        [1, "2.5"],
        [2, "1"],
      ]),
      [stock(1, "2.500"), stock(2, "9.000")],
    );
    expect(resultado).toEqual([]);
  });

  it("treats an exact fit as sufficient (strict greater-than, mirroring the inline loop)", () => {
    const resultado = verificarDisponibilidadPreNcf(demandaDe([[7, "3.000"]]), [
      stock(7, "3.000"),
    ]);
    expect(resultado).toEqual([]);
  });

  it("reports one STOCK_INSUFICIENTE warning per short product with Decimal(12,3) strings", () => {
    const resultado = verificarDisponibilidadPreNcf(
      demandaDe([
        [1, "4.5"],
        [2, "0.5"],
      ]),
      [stock(1, "4.000"), stock(2, "0.501")],
    );
    const esperado: StockWarning[] = [
      {
        code: "STOCK_INSUFICIENTE",
        productoId: 1,
        available: "4.000",
        requested: "4.500",
      },
    ];
    expect(resultado).toEqual(esperado);
  });

  it("counts a missing stock row as zero availability (any positive request is short)", () => {
    const resultado = verificarDisponibilidadPreNcf(demandaDe([[9, "0.001"]]), []);
    expect(resultado).toEqual([
      {
        code: "STOCK_INSUFICIENTE",
        productoId: 9,
        available: "0.000",
        requested: "0.001",
      },
    ]);
  });

  it("ignores stock rows for products outside the demand", () => {
    const resultado = verificarDisponibilidadPreNcf(demandaDe([[3, "2"]]), [
      stock(3, "5.000"),
      stock(4, "0.000"),
    ]);
    expect(resultado).toEqual([]);
  });
});
