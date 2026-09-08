import { desactivarCategoria } from "./desactivar-categoria";
import { crearCategoria } from "./crear-categoria";
import {
  categoriaByIdEnEmpresa,
  existeNombreEnEmpresa,
  tieneProductosActivos,
  desactivarCategoriaEnTx,
  crearCategoriaEnTx,
  registrarAuditCategoriaEnTx,
} from "../infrastructure/categoria-repository";
import {
  CATEGORIA_TIENE_PRODUCTOS,
  CATEGORIA_YA_INACTIVA,
  CATEGORIA_NO_ENCONTRADA,
} from "../domain/errors";
import type { Categoria } from "../domain/categoria";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/categoria-repository", () => ({
  categoriaByIdEnEmpresa: jest.fn(),
  existeNombreEnEmpresa: jest.fn(),
  tieneProductosActivos: jest.fn(),
  desactivarCategoriaEnTx: jest.fn(),
  crearCategoriaEnTx: jest.fn(),
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
    version: 1,
    ...overrides,
  };
}

describe("desactivarCategoria", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("CAT-005-A: active products block deactivation with no write", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCategoria());
    (tieneProductosActivos as jest.Mock).mockResolvedValue(true);

    const result = await desactivarCategoria(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CATEGORIA_TIENE_PRODUCTOS);
    expect(desactivarCategoriaEnTx).not.toHaveBeenCalled();
    expect(registrarAuditCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("CAT-005-B: repeated deactivation returns CATEGORIA_YA_INACTIVA", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(
      makeCategoria({ activa: false }),
    );

    const result = await desactivarCategoria(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CATEGORIA_YA_INACTIVA);
    expect(desactivarCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("CAT-005-B: success flips activa and appends exactly one CANCELAR audit", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCategoria());
    (tieneProductosActivos as jest.Mock).mockResolvedValue(false);
    (desactivarCategoriaEnTx as jest.Mock).mockResolvedValue({
      deactivated: true,
    });

    const result = await desactivarCategoria(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 10, nombre: "Zapatos" });
    expect(registrarAuditCategoriaEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditCategoriaEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "CANCELAR",
      10,
      { activa: true },
      { activa: false },
      "categoria.desactivada",
    );
  });

  it("lost race against a concurrent deactivation maps to YA_INACTIVA without audit", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(makeCategoria());
    (tieneProductosActivos as jest.Mock).mockResolvedValue(false);
    (desactivarCategoriaEnTx as jest.Mock).mockResolvedValue({
      deactivated: false,
    });

    const result = await desactivarCategoria(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CATEGORIA_YA_INACTIVA);
    expect(registrarAuditCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("CAT-006-B: missing or foreign-tenant id maps to CATEGORIA_NO_ENCONTRADA", async () => {
    (categoriaByIdEnEmpresa as jest.Mock).mockResolvedValue(null);

    const result = await desactivarCategoria(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CATEGORIA_NO_ENCONTRADA);
  });

  it("CAT-005-B: deactivation releases the name for reuse", async () => {
    // Small in-memory fake honoring the "active rows only" uniqueness rule.
    // Locally mutable copy: the domain entity is readonly; the fake must flip `activa`.
    type MutableRow = Omit<Categoria, "activa"> & { activa: boolean };
    const rows: MutableRow[] = [makeCategoria({ id: 10, nombre: "Zapatos" })];
    (categoriaByIdEnEmpresa as jest.Mock).mockImplementation(
      async (_tx: unknown, empresaId: number, id: number) =>
        rows.find((r) => r.id === id && r.empresaId === empresaId) ?? null,
    );
    (tieneProductosActivos as jest.Mock).mockResolvedValue(false);
    (desactivarCategoriaEnTx as jest.Mock).mockImplementation(
      async (_tx: unknown, empresaId: number, id: number) => {
        const row = rows.find((r) => r.id === id && r.empresaId === empresaId);
        if (row === undefined || !row.activa) return { deactivated: false };
        row.activa = false;
        return { deactivated: true };
      },
    );
    (existeNombreEnEmpresa as jest.Mock).mockImplementation(
      async (_tx: unknown, empresaId: number, nombre: string, exclude?: number) =>
        rows.some(
          (r) =>
            r.empresaId === empresaId &&
            r.activa &&
            r.nombre === nombre &&
            r.id !== exclude,
        ),
    );
    (crearCategoriaEnTx as jest.Mock).mockImplementation(
      async (_tx: unknown, empresaId: number, nombre: string) => {
        const created: MutableRow = {
          id: 11,
          empresaId,
          nombre,
          activa: true,
          version: 1,
        };
        rows.push(created);
        return created;
      },
    );

    const off = await desactivarCategoria(makeTx(), ctx, { id: 10 });
    expect(off.ok).toBe(true);

    const again = await crearCategoria(makeTx(), ctx, { nombre: "Zapatos" });
    expect(again.ok).toBe(true);
  });
});
