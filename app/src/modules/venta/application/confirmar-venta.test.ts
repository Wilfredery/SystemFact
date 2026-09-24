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
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { StockWarning } from "../domain/errors";
import { confirmarVenta, verificarDisponibilidadPreNcf } from "./confirmar-venta";
import {
  crearFacturaEnTx,
  confirmarVentaFlipEnTx,
  leerClienteParaElegibilidadEnTx,
  leerFacturaAutomaticaDeEmpresaEnTx,
  leerStockSucursalEnTx,
  leerVentaParaConfirmarEnTx,
  asignarCorrelativoFacturaEnTx,
} from "../infrastructure/venta-repository";
import { evaluarCreditoPort } from "@/modules/cobros/application/credit-port";
import { registrarCobro } from "@/modules/cobros/application/registrar-cobro";
import { consumirNcfEnTx } from "@/modules/ncf/application/consumir-ncf";

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

// --- confirmarVenta orchestration (v2r-10 regression) -------------------------
// Proves the guarded flip is invoked with the optimistic `updatedAt` token read
// at step 1 (a concurrent draft edit bumps the column, so the flip's WHERE must
// miss and the whole post-consume transaction throws — rolling the consumed NCF
// back). GREEN in this suite requires naming the token in the flip contract.

const txMock = {} as unknown as PrismaTx;
const ctxMock: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const UPDATED_AT = new Date("2026-01-10T00:00:00.000Z");

describe("confirmarVenta (mocked repos, v2r-10 optimistic flip)", () => {
  const ventaBorrador = {
    id: 7,
    estado: "BORRADOR",
    sucursalId: 2,
    clienteId: 99,
    updatedAt: UPDATED_AT,
    subtotal: "100.00",
    descuento: "0.00",
    lineas: [
      {
        productoId: 10,
        cantidad: "1.000",
        tasaItbis: "18",
        subtotalLinea: "100.00",
        itbisLinea: "18.00",
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (leerVentaParaConfirmarEnTx as jest.Mock).mockResolvedValue(ventaBorrador);
    (leerFacturaAutomaticaDeEmpresaEnTx as jest.Mock).mockResolvedValue(true);
    (leerClienteParaElegibilidadEnTx as jest.Mock).mockResolvedValue({
      esConsumidorFinal: true,
      identificacionFiscal: null,
    });
    (leerStockSucursalEnTx as jest.Mock).mockResolvedValue([
      { productoId: 10, disponible: "50.000" },
    ]);
    (evaluarCreditoPort.evaluarCreditoCliente as jest.Mock).mockResolvedValue({
      forma: "CONTADO",
    });
    (consumirNcfEnTx as jest.Mock).mockResolvedValue({
      ncf: "B0200000522",
      warning: undefined,
    });
    (confirmarVentaFlipEnTx as jest.Mock).mockResolvedValue({ flipUpdated: true });
    (asignarCorrelativoFacturaEnTx as jest.Mock).mockResolvedValue("FAC-000001");
    (crearFacturaEnTx as jest.Mock).mockResolvedValue({ id: 80 });
    (registrarCobro as jest.Mock).mockResolvedValue({ ok: true });
  });

  it("passes the step-1 read updatedAt as the flip's optimistic token (v2r-10)", async () => {
    const resultado = await confirmarVenta(txMock, ctxMock, { id: 7 });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.data.estado).toBe("CONFIRMADA");
    expect(confirmarVentaFlipEnTx).toHaveBeenCalledWith(txMock, ctxMock, 7, UPDATED_AT);
  });

  it("THROWS CONCURRENCIA_CONFLICTO when the flip misses an edited draft — the consume rolls back (v2r-10)", async () => {
    (confirmarVentaFlipEnTx as jest.Mock).mockResolvedValue({ flipUpdated: false });
    await expect(confirmarVenta(txMock, ctxMock, { id: 7 })).rejects.toMatchObject({
      code: "CONCURRENCIA_CONFLICTO",
    });
    // The reject (never a returned error) is what aborts the caller's
    // `withTenantTransaction`, un-burning the already-consumed sequence number.
    expect(crearFacturaEnTx).not.toHaveBeenCalled();
  });

  it("returns VENTA_INMUTABLE for an already-CONFIRMADA sale BEFORE any flip call", async () => {
    (leerVentaParaConfirmarEnTx as jest.Mock).mockResolvedValue({
      ...ventaBorrador,
      estado: "CONFIRMADA",
    });
    const resultado = await confirmarVenta(txMock, ctxMock, { id: 7 });
    expect(resultado).toEqual({
      ok: false,
      code: "VENTA_INMUTABLE",
      message: expect.any(String),
    });
    expect(confirmarVentaFlipEnTx).not.toHaveBeenCalled();
    expect(consumirNcfEnTx).not.toHaveBeenCalled();
  });
});
