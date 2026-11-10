/**
 * Application unit tests — listing + detail (mocked).
 * Proves pagination bounds are enforced in the use case and that a foreign /
 * missing detail returns COMPRA_NO_ENCONTRADA (never a cross-tenant leak).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  listarComprasEnTx,
  contarComprasEnTx,
  obtenerCompraDetalleEnTx,
} from "../infrastructure/compra-repository";
import { listarCompras } from "./listar-compras";
import { obtenerCompra } from "./obtener-compra";

jest.mock("../infrastructure/compra-repository", () => ({
  listarComprasEnTx: jest.fn(),
  contarComprasEnTx: jest.fn(),
  obtenerCompraDetalleEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;

beforeEach(() => {
  jest.clearAllMocks();
  (listarComprasEnTx as jest.Mock).mockResolvedValue([]);
  (contarComprasEnTx as jest.Mock).mockResolvedValue(0);
});

describe("listarCompras", () => {
  it("defaults are honored and the repo is queried with them", async () => {
    const result = await listarCompras(tx, ctx, { page: 1, limit: 25 });
    expect(result.ok).toBe(true);
    expect(listarComprasEnTx).toHaveBeenCalledWith(tx, ctx, { page: 1, limit: 25 });
  });

  it("rejects a limit above 100 without querying", async () => {
    const result = await listarCompras(tx, ctx, { page: 1, limit: 101 });
    expect(result.ok === false && result.code).toBe("VALIDATION_ERROR");
    expect(listarComprasEnTx).not.toHaveBeenCalled();
  });

  it("rejects page 0 without querying", async () => {
    const result = await listarCompras(tx, ctx, { page: 0, limit: 25 });
    expect(result.ok === false && result.code).toBe("VALIDATION_ERROR");
    expect(contarComprasEnTx).not.toHaveBeenCalled();
  });
});

describe("obtenerCompra", () => {
  it("returns the detail projection for an owned purchase", async () => {
    (obtenerCompraDetalleEnTx as jest.Mock).mockResolvedValue({ id: 42 });
    const result = await obtenerCompra(tx, ctx, { id: 42 });
    expect(result).toEqual({ ok: true, data: { id: 42 } });
  });

  it("returns COMPRA_NO_ENCONTRADA for a foreign/missing id", async () => {
    (obtenerCompraDetalleEnTx as jest.Mock).mockResolvedValue(null);
    const result = await obtenerCompra(tx, ctx, { id: 999 });
    expect(result.ok === false && result.code).toBe("COMPRA_NO_ENCONTRADA");
  });

  it("rejects a non-positive id with VALIDATION_ERROR", async () => {
    const result = await obtenerCompra(tx, ctx, { id: 0 });
    expect(result.ok === false && result.code).toBe("VALIDATION_ERROR");
    expect(obtenerCompraDetalleEnTx).not.toHaveBeenCalled();
  });
});

/**
 * S7 — filtered listing. The filters travel to BOTH the page query and the
 * count (otherwise the total would describe a different result set); absent
 * filters are not forwarded at all.
 */
describe("listarCompras — filters (S7)", () => {
  it("forwards estado, tipoCompra and proveedorBusqueda to page and count", async () => {
    const result = await listarCompras(tx, ctx, {
      page: 1,
      limit: 25,
      estado: "PENDIENTE",
      tipoCompra: "MERCANCIA",
      proveedorBusqueda: "Acme",
    });

    expect(result.ok).toBe(true);
    const esperado = {
      page: 1,
      limit: 25,
      estado: "PENDIENTE",
      tipoCompra: "MERCANCIA",
      proveedorBusqueda: "Acme",
    };
    expect(listarComprasEnTx).toHaveBeenCalledWith(tx, ctx, esperado);
    expect(contarComprasEnTx).toHaveBeenCalledWith(tx, ctx, esperado);
  });

  it("does not invent filter keys when none is given", async () => {
    await listarCompras(tx, ctx, { page: 1, limit: 25 });
    expect(contarComprasEnTx).toHaveBeenCalledWith(tx, ctx, { page: 1, limit: 25 });
  });
});
