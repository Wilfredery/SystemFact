/**
 * Application unit tests — crear-compra (mocked transaction + repository).
 *
 * Proves the draft-create orchestration: valid draft saves, invalid/foreign/
 * inactive line rejection without any write, inactive/missing supplier,
 * duplicate-NCF mapping, and typed error codes.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  crearCompraConLineasEnTx,
  leerProveedorClasificadoEnTx,
  leerProductosParaLineasEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";
import { CompraDomainError, NFC_DUPLICADO } from "../domain/errors";
import { crearCompra, type CrearCompraInput } from "./crear-compra";

jest.mock("../infrastructure/compra-repository", () => ({
  crearCompraConLineasEnTx: jest.fn(),
  leerProveedorClasificadoEnTx: jest.fn(),
  leerProductosParaLineasEnTx: jest.fn(),
  registrarAuditCompraEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 2,
  usuarioId: 3,
  esAdmin: true,
};
const tx = {} as unknown as PrismaTx;

const proveedorFormal = {
  id: 5,
  activo: true,
  tipoProveedor: "FORMAL",
  tipoPersona: "JURIDICA",
} as const;

function baseInput(over: Partial<CrearCompraInput> = {}): CrearCompraInput {
  return {
    proveedorId: 5,
    tipoCompra: "MERCANCIA",
    fecha: new Date("2026-01-10T00:00:00.000Z"),
    ncf: null,
    tipoNcf: null,
    lineas: [{ productoId: 10, cantidad: "2.000", costoUnitario: "100.00" }],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (leerProveedorClasificadoEnTx as jest.Mock).mockResolvedValue(proveedorFormal);
  (leerProductosParaLineasEnTx as jest.Mock).mockResolvedValue([
    { id: 10, activo: true, tasaItbis: "18" },
  ]);
  (crearCompraConLineasEnTx as jest.Mock).mockResolvedValue({ id: 100 });
});

describe("crearCompra", () => {
  it("saves a valid BORRADOR draft and audits it", async () => {
    const result = await crearCompra(tx, ctx, baseInput());
    expect(result).toEqual({
      ok: true,
      data: { id: 100, estado: "BORRADOR", correlativoInterno: "", total: "236.00" },
    });
    // 2.000 * 100.00 = 200 gravado; itbis 36; total 236; retentions zero.
    expect(crearCompraConLineasEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditCompraEnTx).toHaveBeenCalledTimes(1);
  });

  it("freezes the product ITBIS rate per line at save time", async () => {
    await crearCompra(tx, ctx, baseInput());
    const arg = (crearCompraConLineasEnTx as jest.Mock).mock.calls[0]?.[2];
    expect(arg.lineas[0].tasaItbis).toBe("18");
    expect(arg.totales.retencionIsr).toBe("0.00");
    expect(arg.totales.retencionItbis).toBe("0.00");
  });

  it("rejects a non-positive quantity with no write", async () => {
    const result = await crearCompra(
      tx,
      ctx,
      baseInput({
        lineas: [{ productoId: 10, cantidad: "0.000", costoUnitario: "100.00" }],
      }),
    );
    expect(result).toEqual({
      ok: false,
      code: "LINEA_INVALIDA",
      message: expect.any(String),
    });
    expect(crearCompraConLineasEnTx).not.toHaveBeenCalled();
  });

  it("rejects a foreign/unknown product (empty lookup)", async () => {
    (leerProductosParaLineasEnTx as jest.Mock).mockResolvedValue([]);
    const result = await crearCompra(tx, ctx, baseInput());
    expect(result.ok === false && result.code).toBe("PRODUCTO_NO_ENCONTRADO");
    expect(crearCompraConLineasEnTx).not.toHaveBeenCalled();
  });

  it("rejects an inactive product with LINEA_INVALIDA", async () => {
    (leerProductosParaLineasEnTx as jest.Mock).mockResolvedValue([
      { id: 10, activo: false, tasaItbis: "18" },
    ]);
    const result = await crearCompra(tx, ctx, baseInput());
    expect(result.ok === false && result.code).toBe("LINEA_INVALIDA");
    expect(crearCompraConLineasEnTx).not.toHaveBeenCalled();
  });

  it("rejects an inactive supplier", async () => {
    (leerProveedorClasificadoEnTx as jest.Mock).mockResolvedValue({
      ...proveedorFormal,
      activo: false,
    });
    const result = await crearCompra(tx, ctx, baseInput());
    expect(result.ok === false && result.code).toBe("PROVEEDOR_INACTIVO");
  });

  it("rejects a missing supplier", async () => {
    (leerProveedorClasificadoEnTx as jest.Mock).mockResolvedValue(null);
    const result = await crearCompra(tx, ctx, baseInput());
    expect(result.ok === false && result.code).toBe("PROVEEDOR_NO_ENCONTRADO");
  });

  it("maps a duplicate NCF to a typed NFC_DUPLICADO result", async () => {
    (crearCompraConLineasEnTx as jest.Mock).mockRejectedValue(
      new CompraDomainError(NFC_DUPLICADO),
    );
    const result = await crearCompra(tx, ctx, baseInput({ ncf: "B01-001" }));
    expect(result.ok === false && result.code).toBe("NFC_DUPLICADO");
  });
});
