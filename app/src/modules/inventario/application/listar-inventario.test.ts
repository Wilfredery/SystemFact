/**
 * Application integration tests for the stock listing (tasks 5.3).
 *
 * Following the established producto convention, the repository is mocked: the
 * tenant SQL runs inside it, and what the use case must prove here is the
 * pagination guard and the KPI projection. "No database write occurs" on an
 * invalid page/limit is proven by asserting the repository is never called.
 */

import { listarInventario } from "./listar-inventario";
import {
  contarInventarioEnTx,
  listarInventarioEnTx,
} from "../infrastructure/inventario-repository";
import {
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
} from "../domain/errors";
import type { InventarioStockRow } from "../domain/inventario";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/inventario-repository", () => ({
  listarInventarioEnTx: jest.fn(),
  contarInventarioEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: false,
};

function makeTx(): PrismaTx {
  // The tx handle is only forwarded to the (mocked) repository functions.
  return {} as unknown as PrismaTx;
}

function makeRow(
  id: number,
  cantidad: string,
  stockMinimo: number,
): InventarioStockRow {
  return {
    inventarioId: id,
    productoId: id,
    codigo: `P${id}`,
    nombre: `Producto ${id}`,
    cantidad,
    stockMinimo,
  };
}

describe("listarInventario", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns the paginated page with a per-row stockMinimo KPI", async () => {
    const tx = makeTx();
    // 25 rows on page 1 of 30 total, mixed KPI states.
    const rows = [
      makeRow(1, "50.000", 5), // normal
      makeRow(2, "3.000", 5), // bajo_stock
      makeRow(3, "0.000", 5), // agotado
      ...Array.from({ length: 22 }, (_, i) => makeRow(4 + i, "20.000", 10)),
    ];
    (listarInventarioEnTx as jest.Mock).mockResolvedValue(rows);
    (contarInventarioEnTx as jest.Mock).mockResolvedValue(30);

    const result = await listarInventario(tx, ctx, { page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(25);
      expect(result.data.total).toBe(30);
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(25);
      expect(result.data.items[0].kpi).toBe("normal");
      expect(result.data.items[1].kpi).toBe("bajo_stock");
      expect(result.data.items[2].kpi).toBe("agotado");
    }
    // Reads are threaded through the transaction with the active tenant ctx.
    expect(listarInventarioEnTx).toHaveBeenCalledWith(tx, ctx, { page: 1, limit: 25 });
    expect(contarInventarioEnTx).toHaveBeenCalledWith(tx, ctx);
  });

  it("rejects page 0 with PAGINA_INVALIDA and never touches the DB", async () => {
    const result = await listarInventario(makeTx(), ctx, { page: 0, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PAGINA_INVALIDA);
    expect(listarInventarioEnTx).not.toHaveBeenCalled();
    expect(contarInventarioEnTx).not.toHaveBeenCalled();
  });

  it("rejects limit above 100 with LIMITE_PAGINACION_INVALIDO and no DB access", async () => {
    const result = await listarInventario(makeTx(), ctx, { page: 1, limit: 101 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIMITE_PAGINACION_INVALIDO);
    expect(listarInventarioEnTx).not.toHaveBeenCalled();
    expect(contarInventarioEnTx).not.toHaveBeenCalled();
  });

  it("returns an empty page without error when there is no stock", async () => {
    const tx = makeTx();
    (listarInventarioEnTx as jest.Mock).mockResolvedValue([]);
    (contarInventarioEnTx as jest.Mock).mockResolvedValue(0);

    const result = await listarInventario(tx, ctx, { page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });
});
