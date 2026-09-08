import { actualizarCategoria } from "./actualizar-categoria";
import {
  categoriaByIdEnEmpresa,
  existeNombreEnEmpresa,
  actualizarCategoriaEnTx,
  registrarAuditCategoriaEnTx,
} from "../infrastructure/categoria-repository";
import {
  CONCURRENCIA_CONFLICTO,
  CATEGORIA_NO_ENCONTRADA,
  CATEGORIA_YA_INACTIVA,
  NOMBRE_CATEGORIA_DUPLICADO,
  VALIDATION_ERROR,
  CategoriaDomainError,
} from "../domain/errors";
import type { Categoria } from "../domain/categoria";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/categoria-repository", () => ({
  categoriaByIdEnEmpresa: jest.fn(),
  existeNombreEnEmpresa: jest.fn(),
  actualizarCategoriaEnTx: jest.fn(),
  registrarAuditCategoriaEnTx: jest.fn(),
}));

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};

function makeTx(): PrismaTx {
  return {} as unknown as PrismaTx;
}

function makeCategoria(overrides: Partial<Categoria> = {}): Categoria {
  return {
    id: 10,
    empresaId: 1,
    nombre: "Zapatos",
    activa: true,
    version: 2,
    ...overrides,
  };
}

describe("actualizarCategoria", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("CAT-004-A: valid rename bumps version and audits old and new values", async () => {
    (categoriaByIdEnEmpresa as jest.Mock)
      .mockResolvedValueOnce(makeCategoria({ version: 2 }))
      .mockResolvedValueOnce(makeCategoria({ nombre: "Calzado", version: 3 }));
    (actualizarCategoriaEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });

    const result = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "Calzado",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.nombre).toBe("Calzado");
      expect(result.data.version).toBe(3);
    }
    // Regression pin: the CLIENT version drives the optimistic lock (producto CRITICAL-1).
    expect(actualizarCategoriaEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      10,
      2,
      "Calzado",
    );
    const [oldVals, newVals] = (registrarAuditCategoriaEnTx as jest.Mock).mock
      .calls[0].slice(4);
    expect(oldVals).toEqual({ nombre: "Zapatos" });
    expect(newVals).toEqual({ nombre: "Calzado" });
  });

  it("CAT-004-B: stale version returns CONCURRENCIA_CONFLICTO without audit", async () => {
    const storedVersion = 5;
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(
      makeCategoria({ version: storedVersion }),
    );
    // Faithful stand-in for `UPDATE ... WHERE version`: only matches when the
    // forwarded client version equals the stored row version.
    (actualizarCategoriaEnTx as jest.Mock).mockImplementation(
      async (
        _tx: unknown,
        _empresaId: number,
        _id: number,
        version: number,
      ) =>
        version === storedVersion
          ? { updated: true, newVersion: storedVersion + 1 }
          : { updated: false, newVersion: storedVersion },
    );

    const result = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "Calzado",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CONCURRENCIA_CONFLICTO);
    expect(registrarAuditCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("CAT-002-A: rename onto another active category is rejected", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCategoria());
    (existeNombreEnEmpresa as jest.Mock).mockResolvedValue(true);

    const result = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "Bolsos",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(NOMBRE_CATEGORIA_DUPLICADO);
    // Self-exclusion: the probe must ignore the edited row.
    expect(existeNombreEnEmpresa).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "Bolsos",
      10,
    );
    expect(actualizarCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("same name (no change) skips the duplicate probe", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCategoria());
    (actualizarCategoriaEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });

    const result = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "  Zapatos  ",
    });

    expect(result.ok).toBe(true);
    expect(existeNombreEnEmpresa).not.toHaveBeenCalled();
  });

  it("edit on an inactive row is rejected with CATEGORIA_YA_INACTIVA", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(
      makeCategoria({ activa: false }),
    );

    const result = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "Calzado",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CATEGORIA_YA_INACTIVA);
    expect(actualizarCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("CAT-006-B: missing or foreign-tenant id maps to CATEGORIA_NO_ENCONTRADA", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(null);

    const result = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "Calzado",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CATEGORIA_NO_ENCONTRADA);
    expect(actualizarCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("duplicate-name TOCTOU race from the repository maps to a result", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCategoria());
    (actualizarCategoriaEnTx as jest.Mock).mockRejectedValue(
      new CategoriaDomainError(NOMBRE_CATEGORIA_DUPLICADO),
    );

    const result = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "Calzado",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(NOMBRE_CATEGORIA_DUPLICADO);
    expect(registrarAuditCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("empty patch and blank name return VALIDATION_ERROR", async () => {
    const sinNombre = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
    });
    expect(sinNombre.ok).toBe(false);
    if (!sinNombre.ok) expect(sinNombre.code).toBe(VALIDATION_ERROR);

    const nombreVacio = await actualizarCategoria(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "   ",
    });
    expect(nombreVacio.ok).toBe(false);
    if (!nombreVacio.ok) expect(nombreVacio.code).toBe(VALIDATION_ERROR);
    expect(categoriaByIdEnEmpresa).not.toHaveBeenCalled();
  });
});
