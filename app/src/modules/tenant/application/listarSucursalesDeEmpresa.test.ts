import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { listarSucursalesDeEmpresa } from "./listarSucursalesDeEmpresa";
import {
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  messageFor,
} from "../domain/errors";
import type { SucursalResumen } from "../infrastructure/repo-sucursal";

jest.mock("../infrastructure/repo-sucursal", () => ({
  listarSucursalesActivas: jest.fn(),
  __esModule: true,
}));

import { listarSucursalesActivas } from "../infrastructure/repo-sucursal";

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1,
  usuarioId: 1,
  esAdmin: true,
};

function makeTx(): PrismaTx {
  return {} as unknown as PrismaTx;
}

function makeSucursal(overrides: Partial<SucursalResumen> = {}): SucursalResumen {
  return { id: 10, nombre: "Matriz", ...overrides };
}

describe("listarSucursalesDeEmpresa", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns exactly the port result for an admin (scope from ctx.empresaId only)", async () => {
    const port = listarSucursalesActivas as jest.Mock;
    port.mockResolvedValue([makeSucursal(), makeSucursal({ id: 11, nombre: "Zona Este" })]);

    const result = await listarSucursalesDeEmpresa(ctx, makeTx());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sucursales).toHaveLength(2);
    }
    // TEN-LIST-01-B: the ONLY empresaId in the where-clause comes from ctx.
    expect(port).toHaveBeenCalledWith(expect.anything(), ctx.empresaId);
  });

  it("TEN-CAT-02-A: non-admin denial carries the stable catalog code + messageFor copy", async () => {
    const port = listarSucursalesActivas as jest.Mock;
    const result = await listarSucursalesDeEmpresa(
      { ...ctx, esAdmin: false },
      makeTx(),
    );

    expect(result).toEqual({
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
      message: messageFor(TEN_OPS_NO_AUTORIZADO),
    });
    // Deny BEFORE any read: no row data ever leaves, no query runs.
    expect(port).not.toHaveBeenCalled();
  });

  it("TEN-LIST-03-A: empty active set is a success with an empty list", async () => {
    const port = listarSucursalesActivas as jest.Mock;
    port.mockResolvedValue([]);

    const result = await listarSucursalesDeEmpresa(ctx, makeTx());

    expect(result).toEqual({ ok: true, sucursales: [] });
  });

  it("the denial message never leaks ids or internals", () => {
    const message = messageFor(TEN_SUCURSAL_NO_VALIDA);
    expect(message).not.toMatch(/\d+/);
    expect(message).not.toMatch(/prisma|stack|query/i);
  });
});
