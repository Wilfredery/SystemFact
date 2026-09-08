import { listarCategorias } from "./listar-categorias";
import {
  listarCategoriasEnEmpresa,
  contarCategoriasEnEmpresa,
  registrarAuditCategoriaEnTx,
} from "../infrastructure/categoria-repository";
import { VALIDATION_ERROR } from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { ListarCategoriasQuery } from "../infrastructure/categoria-repository";

jest.mock("../infrastructure/categoria-repository", () => ({
  listarCategoriasEnEmpresa: jest.fn(),
  contarCategoriasEnEmpresa: jest.fn(),
  registrarAuditCategoriaEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: false,
};

function makeTx(): PrismaTx {
  return {} as unknown as PrismaTx;
}

function makeCategoria(id: number, activa = true) {
  return { id, empresaId: 1, nombre: `Cat ${id}`, activa, version: 1 };
}

describe("listarCategorias", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("CAT-003-A: page 2 of 30 returns 5 items with total and page", async () => {
    const query: ListarCategoriasQuery = { page: 2, limit: 25 };
    (listarCategoriasEnEmpresa as jest.Mock).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => makeCategoria(26 + i)),
    );
    (contarCategoriasEnEmpresa as jest.Mock).mockResolvedValue(30);

    const result = await listarCategorias(makeTx(), ctx, query);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(5);
      expect(result.data.total).toBe(30);
      expect(result.data.page).toBe(2);
    }
    // Read audit inside the same transaction (design: listings are audited).
    expect(registrarAuditCategoriaEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "LEER",
      2,
      null,
      { count: 5, total: 30 },
    );
  });

  it("CAT-003-B: limit above 100 fails validation without any query", async () => {
    const result = await listarCategorias(makeTx(), ctx, { page: 1, limit: 101 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
    expect(listarCategoriasEnEmpresa).not.toHaveBeenCalled();
  });

  it("CAT-003-B: page below 1 fails validation", async () => {
    const result = await listarCategorias(makeTx(), ctx, { page: 0, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
  });

  it("CAT-003-B: inactive rows stay out unless incluirInactivas is set", async () => {
    // The repository owns the WHERE translation; the use case must forward the
    // flag verbatim (default active-only is asserted against the real repo).
    (listarCategoriasEnEmpresa as jest.Mock).mockResolvedValue([
      makeCategoria(1),
    ]);
    (contarCategoriasEnEmpresa as jest.Mock).mockResolvedValue(1);

    const excluyentes = await listarCategorias(makeTx(), ctx, {
      page: 1,
      limit: 25,
      incluirInactivas: false,
    });
    expect(excluyentes.ok).toBe(true);
    expect(listarCategoriasEnEmpresa).toHaveBeenLastCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ incluirInactivas: false }),
    );

    (listarCategoriasEnEmpresa as jest.Mock).mockResolvedValue([
      makeCategoria(1),
      makeCategoria(2, false),
    ]);
    await listarCategorias(makeTx(), ctx, { page: 1, limit: 25, incluirInactivas: true });
    expect(listarCategoriasEnEmpresa).toHaveBeenLastCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ incluirInactivas: true }),
    );
  });
});
