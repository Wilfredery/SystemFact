import { listarProveedores } from "./listar-proveedores";
import {
  listarProveedoresEnEmpresa,
  contarProveedoresEnEmpresa,
} from "../infrastructure/proveedor-repository";
import { VALIDATION_ERROR } from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { ListarProveedoresQuery } from "../infrastructure/proveedor-repository";

jest.mock("../infrastructure/proveedor-repository", () => ({
  listarProveedoresEnEmpresa: jest.fn(),
  contarProveedoresEnEmpresa: jest.fn(),
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

function makeProveedor(id: number, activo = true) {
  return {
    id,
    empresaId: 1,
    nombre: `Prov ${id}`,
    contacto: "—",
    telefono: "—",
    rnc: null,
    tipoProveedor: "INFORMAL",
    tipoPersona: "FISICA",
    activo,
    version: 1,
  };
}

describe("listarProveedores", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("PRV-LIST-A: page 2 of 30 returns items with total and page metadata", async () => {
    const query: ListarProveedoresQuery = { page: 2, limit: 25 };
    (listarProveedoresEnEmpresa as jest.Mock).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => makeProveedor(26 + i)),
    );
    (contarProveedoresEnEmpresa as jest.Mock).mockResolvedValue(30);

    const result = await listarProveedores(makeTx(), ctx, query);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(5);
      expect(result.data.total).toBe(30);
      expect(result.data.page).toBe(2);
    }
  });

  it("PRV-LIST-B: limit above 100 fails validation without any query", async () => {
    const result = await listarProveedores(makeTx(), ctx, { page: 1, limit: 101 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
    expect(listarProveedoresEnEmpresa).not.toHaveBeenCalled();
  });

  it("PRV-LIST-B: page below 1 fails validation", async () => {
    const result = await listarProveedores(makeTx(), ctx, { page: 0, limit: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
  });

  it("PRV-LIST-C: inactive rows stay out unless incluirInactivos is set", async () => {
    // The repository owns the WHERE translation; the use case must forward the
    // flag verbatim (default active-only is asserted against the real repo).
    (listarProveedoresEnEmpresa as jest.Mock).mockResolvedValue([
      makeProveedor(1),
    ]);
    (contarProveedoresEnEmpresa as jest.Mock).mockResolvedValue(1);

    const excluyentes = await listarProveedores(makeTx(), ctx, {
      page: 1,
      limit: 25,
      incluirInactivos: false,
    });
    expect(excluyentes.ok).toBe(true);
    expect(listarProveedoresEnEmpresa).toHaveBeenLastCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ incluirInactivos: false }),
    );

    (listarProveedoresEnEmpresa as jest.Mock).mockResolvedValue([
      makeProveedor(1),
      makeProveedor(2, false),
    ]);
    await listarProveedores(makeTx(), ctx, {
      page: 1,
      limit: 25,
      incluirInactivos: true,
    });
    expect(listarProveedoresEnEmpresa).toHaveBeenLastCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ incluirInactivos: true }),
    );
  });

  it("PRV-LIST-B: buscar is forwarded verbatim for the nombre/rnc OR filter", async () => {
    (listarProveedoresEnEmpresa as jest.Mock).mockResolvedValue([]);
    (contarProveedoresEnEmpresa as jest.Mock).mockResolvedValue(0);

    const result = await listarProveedores(makeTx(), ctx, {
      page: 1,
      limit: 25,
      buscar: "1-3800",
    });

    expect(result.ok).toBe(true);
    expect(listarProveedoresEnEmpresa).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ buscar: "1-3800" }),
    );
  });
});
