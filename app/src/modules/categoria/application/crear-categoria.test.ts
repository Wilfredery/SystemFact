import { crearCategoria } from "./crear-categoria";
import {
  existeNombreEnEmpresa,
  crearCategoriaEnTx,
  registrarAuditCategoriaEnTx,
} from "../infrastructure/categoria-repository";
import {
  NOMBRE_CATEGORIA_DUPLICADO,
  VALIDATION_ERROR,
  CategoriaDomainError,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/categoria-repository", () => ({
  existeNombreEnEmpresa: jest.fn(),
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
  // The application layer forwards the handle to mocked repository functions.
  return {} as unknown as PrismaTx;
}

function makeCategoria(overrides: Partial<{ nombre: string }> = {}) {
  return {
    id: 1,
    empresaId: 1,
    nombre: overrides.nombre ?? "Zapatos",
    activa: true,
    version: 1,
  };
}

describe("crearCategoria", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("CAT-001-A: returns the created category with version 1 and one audit row", async () => {
    (existeNombreEnEmpresa as jest.Mock).mockResolvedValue(false);
    (crearCategoriaEnTx as jest.Mock).mockResolvedValue(makeCategoria());

    const result = await crearCategoria(makeTx(), ctx, { nombre: "Zapatos" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        id: 1,
        empresaId: 1,
        nombre: "Zapatos",
        activa: true,
        version: 1,
      });
    }
    expect(registrarAuditCategoriaEnTx).toHaveBeenCalledTimes(1);
    // Frozen-enum CREAR is forwarded without importing the generated client.
    expect(registrarAuditCategoriaEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "CREAR",
      1,
      null,
      expect.objectContaining({ nombre: "Zapatos" }),
    );
  });

  it("CAT-001-B: blank name returns VALIDATION_ERROR without persistence", async () => {
    const result = await crearCategoria(makeTx(), ctx, { nombre: "   " });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
    expect(crearCategoriaEnTx).not.toHaveBeenCalled();
    expect(registrarAuditCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("CAT-002-A: duplicate active name is rejected before insert", async () => {
    (existeNombreEnEmpresa as jest.Mock).mockResolvedValue(true);

    const result = await crearCategoria(makeTx(), ctx, { nombre: "Zapatos" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(NOMBRE_CATEGORIA_DUPLICADO);
    expect(crearCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("CAT-002-B: concurrent duplicate (P2002 race) maps to the same result", async () => {
    (existeNombreEnEmpresa as jest.Mock).mockResolvedValue(false); // pre-check passes
    (crearCategoriaEnTx as jest.Mock).mockRejectedValue(
      new CategoriaDomainError(NOMBRE_CATEGORIA_DUPLICADO),
    );

    const result = await crearCategoria(makeTx(), ctx, { nombre: "Zapatos" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(NOMBRE_CATEGORIA_DUPLICADO);
    expect(registrarAuditCategoriaEnTx).not.toHaveBeenCalled();
  });

  it("normalizes whitespace before the duplicate probe and insert", async () => {
    (existeNombreEnEmpresa as jest.Mock).mockResolvedValue(false);
    (crearCategoriaEnTx as jest.Mock).mockResolvedValue(
      makeCategoria({ nombre: "Zapatos Deportivos" }),
    );

    const result = await crearCategoria(makeTx(), ctx, {
      nombre: "  Zapatos   Deportivos ",
    });

    expect(result.ok).toBe(true);
    expect(existeNombreEnEmpresa).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "Zapatos Deportivos",
    );
    expect(crearCategoriaEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "Zapatos Deportivos",
    );
  });
});
