/**
 * Use case tests for the Inventario consulta screen. The repository is mocked
 * (the tenant SQL is proven by the integration test); here we prove the
 * pagination guard, the status projection and the output shape.
 */

import { consultarInventario } from "./consultar-inventario";
import {
  consultarInventarioEnTx,
  contarConsultaInventarioEnTx,
  listarCategoriasFiltroEnTx,
  resumenInventarioEnTx,
} from "../infrastructure/inventario-repository";
import { LIMITE_PAGINACION_INVALIDO, PAGINA_INVALIDA } from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/inventario-repository", () => ({
  consultarInventarioEnTx: jest.fn(),
  contarConsultaInventarioEnTx: jest.fn(),
  listarCategoriasFiltroEnTx: jest.fn(),
  resumenInventarioEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: false };
const tx = {} as unknown as PrismaTx;

function row(codigo: string, cantidad: string, stockMinimo: number) {
  return {
    productoId: 1,
    codigo,
    nombre: `Producto ${codigo}`,
    categoria: "Abarrotes",
    unidadMedida: "UND",
    cantidad,
    stockMinimo,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  (contarConsultaInventarioEnTx as jest.Mock).mockResolvedValue(3);
  (resumenInventarioEnTx as jest.Mock).mockResolvedValue({
    totalProductos: 3,
    bajoStock: 1,
    agotados: 1,
    valorInventario: "152700.00",
  });
  (listarCategoriasFiltroEnTx as jest.Mock).mockResolvedValue([{ id: 7, nombre: "Abarrotes" }]);
});

describe("consultarInventario", () => {
  it("classifies each row as normal, bajo_stock or agotado", async () => {
    (consultarInventarioEnTx as jest.Mock).mockResolvedValue([
      row("P001", "150", 20),
      row("P002", "8", 15),
      row("P003", "0", 10),
    ]);

    const result = await consultarInventario(tx, ctx, { page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items.map((i) => i.estado)).toEqual(["normal", "bajo_stock", "agotado"]);
    expect(result.data.total).toBe(3);
    expect(result.data.resumen.valorInventario).toBe("152700.00");
    expect(result.data.categorias).toEqual([{ id: 7, nombre: "Abarrotes" }]);
  });

  it("forwards the filters to the listing and the count, and the summary ignores them", async () => {
    (contarConsultaInventarioEnTx as jest.Mock).mockResolvedValue(25);
    (consultarInventarioEnTx as jest.Mock).mockResolvedValue([]);
    const query = { page: 2, limit: 10, busqueda: "arroz", categoriaId: 7, estado: "agotado" as const };

    await consultarInventario(tx, ctx, query);

    expect(consultarInventarioEnTx).toHaveBeenCalledWith(tx, ctx, query);
    expect(contarConsultaInventarioEnTx).toHaveBeenCalledWith(tx, ctx, query);
    expect(resumenInventarioEnTx).toHaveBeenCalledWith(tx, ctx);
  });

  it("clamps a page past the end to the last page and returns the page it served", async () => {
    (contarConsultaInventarioEnTx as jest.Mock).mockResolvedValue(30);
    (consultarInventarioEnTx as jest.Mock).mockResolvedValue([row("P001", "5", 1)]);

    const result = await consultarInventario(tx, ctx, { page: 99, limit: 25 });

    expect(consultarInventarioEnTx).toHaveBeenCalledWith(tx, ctx, { page: 2, limit: 25 });
    expect(result.ok && result.data.page).toBe(2);
  });

  it("serves page 1 when nothing matches, whatever page was asked", async () => {
    (contarConsultaInventarioEnTx as jest.Mock).mockResolvedValue(0);
    (consultarInventarioEnTx as jest.Mock).mockResolvedValue([]);

    const result = await consultarInventario(tx, ctx, { page: 7, limit: 25 });

    expect(consultarInventarioEnTx).toHaveBeenCalledWith(tx, ctx, { page: 1, limit: 25 });
    expect(result.ok && result.data.page).toBe(1);
  });

  it.each([0, 101])("rejects limit %s without touching the repository", async (limit) => {
    const result = await consultarInventario(tx, ctx, { page: 1, limit });

    expect(result).toMatchObject({ ok: false, code: LIMITE_PAGINACION_INVALIDO });
    expect(consultarInventarioEnTx).not.toHaveBeenCalled();
  });

  it("rejects page 0 without touching the repository", async () => {
    const result = await consultarInventario(tx, ctx, { page: 0, limit: 25 });

    expect(result).toMatchObject({ ok: false, code: PAGINA_INVALIDA });
    expect(consultarInventarioEnTx).not.toHaveBeenCalled();
  });
});
