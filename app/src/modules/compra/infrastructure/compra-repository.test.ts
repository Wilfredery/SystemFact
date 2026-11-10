/**
 * Compra repository — filtered listing `where` (S7), unit level with a fake tx.
 *
 * The filters are AND-combined on top of the tenant anchor: `empresaId` is
 * always present (never a filter-only query), and page and count must share the
 * SAME `where` so the total describes the rows actually shown. A blank search
 * term is not a filter at all (it would otherwise match every supplier).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  listarComprasEnTx,
  contarComprasEnTx,
} from "./compra-repository";

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 2,
  usuarioId: 3,
  esAdmin: true,
};

function makeTx(): PrismaTx {
  return {
    compra: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaTx;
}

describe("listarComprasEnTx — filters (S7)", () => {
  it("pins empresaId only when no filter is given", async () => {
    const tx = makeTx();
    await listarComprasEnTx(tx, ctx, { page: 1, limit: 25 });

    const args = (tx.compra.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ empresaId: 1 });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(25);
  });

  it("AND-combines estado, tipoCompra and an insensitive supplier search", async () => {
    const tx = makeTx();
    await listarComprasEnTx(tx, ctx, {
      page: 3,
      limit: 10,
      estado: "PENDIENTE",
      tipoCompra: "MERCANCIA",
      proveedorBusqueda: "Acme",
    });

    const args = (tx.compra.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({
      empresaId: 1,
      estado: "PENDIENTE",
      tipoCompra: "MERCANCIA",
      proveedor: { nombre: { contains: "Acme", mode: "insensitive" } },
    });
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual([{ fecha: "desc" }, { id: "desc" }]);
  });

  it("ignores a blank supplier search instead of matching everything", async () => {
    const tx = makeTx();
    await listarComprasEnTx(tx, ctx, {
      page: 1,
      limit: 25,
      proveedorBusqueda: "   ",
    });

    const args = (tx.compra.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ empresaId: 1 });
  });
});

describe("contarComprasEnTx — filters (S7)", () => {
  it("counts with the same filtered where as the page query", async () => {
    const tx = makeTx();
    const query = {
      page: 1,
      limit: 25,
      estado: "RECIBIDA" as const,
      tipoCompra: "ALQUILER" as const,
      proveedorBusqueda: "Acme",
    };
    await listarComprasEnTx(tx, ctx, query);
    await contarComprasEnTx(tx, ctx, query);

    const findArgs = (tx.compra.findMany as jest.Mock).mock.calls[0][0];
    const countArgs = (tx.compra.count as jest.Mock).mock.calls[0][0];
    expect(countArgs.where).toEqual(findArgs.where);
    expect(countArgs.where).toEqual({
      empresaId: 1,
      estado: "RECIBIDA",
      tipoCompra: "ALQUILER",
      proveedor: { nombre: { contains: "Acme", mode: "insensitive" } },
    });
  });
});
