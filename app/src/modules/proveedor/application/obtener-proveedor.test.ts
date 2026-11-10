import { obtenerProveedor } from "./obtener-proveedor";
import { proveedorByIdEnEmpresa } from "../infrastructure/proveedor-repository";
import {
  PROVEEDOR_NO_ENCONTRADO,
  VALIDATION_ERROR,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/proveedor-repository", () => ({
  proveedorByIdEnEmpresa: jest.fn(),
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

function makeProveedor(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    empresaId: 1,
    nombre: "Distribuidora Norte",
    contacto: "Juan Pérez",
    telefono: "809-555-1212",
    rnc: "138000001",
    tipoProveedor: "FORMAL",
    tipoPersona: "JURIDICA",
    activo: true,
    version: 3,
    ...overrides,
  };
}

describe("obtenerProveedor (PRV-GET, screens plan Step 4)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("PRV-GET-A: returns the tenant-scoped supplier, version included for the optimistic lock", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(makeProveedor());

    const result = await obtenerProveedor(makeTx(), ctx, { id: 4 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(makeProveedor());
      expect(result.data.version).toBe(3);
    }
    // The read is scoped by the caller's empresa, never by a client-supplied one.
    expect(proveedorByIdEnEmpresa).toHaveBeenCalledWith(
      expect.anything(),
      1,
      4,
    );
  });

  it("PRV-GET-B: an id of another company is indistinguishable from a missing one", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(null);

    const result = await obtenerProveedor(makeTx(), ctx, { id: 99 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PROVEEDOR_NO_ENCONTRADO);
  });

  it("PRV-GET-C: a non-positive or non-integer id fails validation with no store access", async () => {
    for (const id of [0, -3, 1.5]) {
      const result = await obtenerProveedor(makeTx(), ctx, { id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
    }
    expect(proveedorByIdEnEmpresa).not.toHaveBeenCalled();
  });
});
