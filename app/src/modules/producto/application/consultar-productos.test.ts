import { Decimal } from "decimal.js";
import { consultarProductos } from "./consultar-productos";
import {
  contarConsultaProductosEnTx,
  consultarProductosEnTx,
  listarCategoriasProductoEnTx,
} from "../infrastructure/producto-repository";
import { LIMITE_PAGINACION_INVALIDO, PAGINA_INVALIDA } from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/producto-repository", () => ({
  contarConsultaProductosEnTx: jest.fn(),
  consultarProductosEnTx: jest.fn(),
  listarCategoriasProductoEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: false,
};

function makeTx(): PrismaTx {
  // The application layer forwards the handle to the (mocked) repository.
  return {} as unknown as PrismaTx;
}

/** One flat repository row: the shape the consulta projection is built from. */
function fila(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    codigo: "P-007",
    nombre: "Arroz",
    descripcion: "Arroz selecto",
    categoriaId: 3,
    categoriaNombre: "Granos",
    unidadMedida: "Libra",
    precioVenta: new Decimal("125.50"),
    tasaItbis: new Decimal("18"),
    itbisVigenteDesde: new Date("2026-01-01T00:00:00.000Z"),
    itbisVigenteHasta: null as Date | null,
    itbisAplicaRetencionITBIS: true,
    activo: true,
    version: 4,
    ...overrides,
  };
}

function mockRepo(items: ReturnType<typeof fila>[], total = items.length) {
  (consultarProductosEnTx as jest.Mock).mockResolvedValue(items);
  (contarConsultaProductosEnTx as jest.Mock).mockResolvedValue(total);
  (listarCategoriasProductoEnTx as jest.Mock).mockResolvedValue([
    { id: 3, nombre: "Granos" },
  ]);
}

describe("consultarProductos", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("S1: returns the enriched projection (category name, unit, Decimal price, ITBIS with vigencia and version)", async () => {
    mockRepo([fila()]);

    const result = await consultarProductos(makeTx(), ctx, { page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toEqual([
      {
        id: 7,
        codigo: "P-007",
        nombre: "Arroz",
        descripcion: "Arroz selecto",
        categoriaId: 3,
        categoria: "Granos",
        unidadMedida: "Libra",
        precioVenta: "125.50",
        tasaItbis: "18",
        itbisVigenteDesde: "2026-01-01T00:00:00.000Z",
        itbisVigenteHasta: null,
        itbisAplicaRetencionITBIS: true,
        activo: true,
        version: 4,
      },
    ]);
    expect(result.data.total).toBe(1);
    expect(result.data.page).toBe(1);
    expect(result.data.limit).toBe(25);
    expect(result.data.categorias).toEqual([{ id: 3, nombre: "Granos" }]);
  });

  it("S1: a product with a closing ITBIS validity keeps it as an ISO instant", async () => {
    mockRepo([fila({ itbisVigenteHasta: new Date("2027-12-31T12:00:00.000Z") })]);

    const result = await consultarProductos(makeTx(), ctx, { page: 1, limit: 25 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0].itbisVigenteHasta).toBe("2027-12-31T12:00:00.000Z");
  });

  it("S4: defaults to active products only, keeps incluirInactivos for old callers, and an explicit estado wins", async () => {
    mockRepo([]);

    await consultarProductos(makeTx(), ctx, { page: 1, limit: 25 });
    expect((consultarProductosEnTx as jest.Mock).mock.calls[0][2]).toMatchObject({
      estado: "activos",
      page: 1,
      limit: 25,
    });

    (consultarProductosEnTx as jest.Mock).mockClear();
    await consultarProductos(makeTx(), ctx, { page: 1, limit: 25, incluirInactivos: true });
    expect((consultarProductosEnTx as jest.Mock).mock.calls[0][2]).toMatchObject({
      estado: "todos",
    });

    (consultarProductosEnTx as jest.Mock).mockClear();
    await consultarProductos(makeTx(), ctx, {
      page: 1,
      limit: 25,
      incluirInactivos: true,
      estado: "inactivos",
    });
    expect((consultarProductosEnTx as jest.Mock).mock.calls[0][2]).toMatchObject({
      estado: "inactivos",
    });
  });

  it("S1: the search term and the category filter reach both the page and the count query", async () => {
    mockRepo([], 30);

    await consultarProductos(makeTx(), ctx, {
      page: 2,
      limit: 10,
      busqueda: "  arroz ",
      categoriaId: 3,
      estado: "todos",
    });

    const esperado = { page: 2, limit: 10, busqueda: "  arroz ", categoriaId: 3, estado: "todos" };
    expect((consultarProductosEnTx as jest.Mock).mock.calls[0][2]).toMatchObject(esperado);
    expect((contarConsultaProductosEnTx as jest.Mock).mock.calls[0][2]).toMatchObject(esperado);
  });

  it("S4: a page past the end is clamped to the last page instead of rendering an empty table", async () => {
    mockRepo([fila()], 1);

    const result = await consultarProductos(makeTx(), ctx, { page: 3, limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.page).toBe(1);
    expect((consultarProductosEnTx as jest.Mock).mock.calls[0][2]).toMatchObject({ page: 1 });
  });

  it("S4: rejects a limit above 100 and a page below 1 before touching the repository", async () => {
    const alto = await consultarProductos(makeTx(), ctx, { page: 1, limit: 101 });
    expect(alto.ok).toBe(false);
    if (!alto.ok) expect(alto.code).toBe(LIMITE_PAGINACION_INVALIDO);

    const cero = await consultarProductos(makeTx(), ctx, { page: 0, limit: 25 });
    expect(cero.ok).toBe(false);
    if (!cero.ok) expect(cero.code).toBe(PAGINA_INVALIDA);

    expect(consultarProductosEnTx).not.toHaveBeenCalled();
    expect(contarConsultaProductosEnTx).not.toHaveBeenCalled();
  });
});
