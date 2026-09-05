import { Decimal } from "decimal.js";
import { listarProductos } from "./listar-productos";
import {
  contarProductos,
  listarProductosEnTx,
  registrarProductoListadoEnTx,
} from "../infrastructure/producto-repository";
import {
  LIMITE_PAGINACION_INVALIDO,
  PAGINA_INVALIDA,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { ListarProductosQuery } from "../infrastructure/producto-repository";

jest.mock("../infrastructure/producto-repository", () => ({
  contarProductos: jest.fn(),
  listarProductosEnTx: jest.fn(),
  registrarProductoListadoEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: false,
};

function makeTx(): PrismaTx {
  // The application layer no longer touches Prisma directly; the transaction
  // handle is only forwarded to the (mocked) repository functions.
  return {} as unknown as PrismaTx;
}

function makeProducto(id: number, codigo: string, descripcion?: string) {
  return {
    id,
    empresaId: 1,
    categoriaId: 1,
    codigo,
    nombre: `Producto ${codigo}`,
    descripcion: (descripcion ?? null) as string | null,
    precioVenta: new Decimal("100.00"),
    itbis: {
      tasa: "18" as const,
      vigenteDesde: new Date("2026-01-01"),
      vigenteHasta: null,
      aplicaRetencionITBIS: false,
    },
    exento: false,
    activo: true,
  };
}

describe("listarProductos", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns page 1 of 25", async () => {
    const tx = makeTx();
    const query: ListarProductosQuery = { page: 1, limit: 25 };
    const items = Array.from({ length: 25 }, (_, i) => makeProducto(i + 1, `P${i + 1}`));
    (listarProductosEnTx as jest.Mock).mockResolvedValue(items);
    (contarProductos as jest.Mock).mockResolvedValue(30);

    const result = await listarProductos(tx, ctx, query);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(25);
      expect(result.data.total).toBe(30);
      expect(result.data.page).toBe(1);
    }
    expect(registrarProductoListadoEnTx).toHaveBeenCalledTimes(1);
  });

  it("returns page 2 with remaining items", async () => {
    const tx = makeTx();
    const query: ListarProductosQuery = { page: 2, limit: 25 };
    const items = Array.from({ length: 5 }, (_, i) => makeProducto(i + 26, `P${i + 26}`));
    (listarProductosEnTx as jest.Mock).mockResolvedValue(items);
    (contarProductos as jest.Mock).mockResolvedValue(30);

    const result = await listarProductos(tx, ctx, query);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(5);
      expect(result.data.total).toBe(30);
      expect(result.data.page).toBe(2);
    }
  });

  it("returns empty result", async () => {
    const tx = makeTx();
    const query: ListarProductosQuery = { page: 1, limit: 25 };
    (listarProductosEnTx as jest.Mock).mockResolvedValue([]);
    (contarProductos as jest.Mock).mockResolvedValue(0);

    const result = await listarProductos(tx, ctx, query);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it("filters by descripcion", async () => {
    const tx = makeTx();
    const query: ListarProductosQuery = { page: 1, limit: 25, descripcion: "laptop" };
    const laptop = makeProducto(1, "LAP001", "Laptop Dell 15 pulgadas");
    (listarProductosEnTx as jest.Mock).mockResolvedValue([laptop]);
    (contarProductos as jest.Mock).mockResolvedValue(1);

    const result = await listarProductos(tx, ctx, query);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].codigo).toBe("LAP001");
      expect(result.data.total).toBe(1);
    }
    expect(listarProductosEnTx).toHaveBeenCalledWith(tx, ctx, query);
    expect(contarProductos).toHaveBeenCalledWith(tx, ctx, query);
  });

  it("rejects limit above 100", async () => {
    const tx = makeTx();
    const result = await listarProductos(tx, ctx, { page: 1, limit: 101 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(LIMITE_PAGINACION_INVALIDO);
    }
  });

  it("rejects page below 1", async () => {
    const tx = makeTx();
    const result = await listarProductos(tx, ctx, { page: 0, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(PAGINA_INVALIDA);
    }
  });
});
