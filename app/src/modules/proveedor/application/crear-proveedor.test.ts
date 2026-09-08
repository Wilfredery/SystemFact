import { crearProveedor } from "./crear-proveedor";
import {
  existeRncEnEmpresa,
  crearProveedorEnTx,
  registrarAuditProveedorEnTx,
} from "../infrastructure/proveedor-repository";
import {
  RNC_PROVEEDOR_DUPLICADO,
  RNC_FORMATO_INVALIDO,
  VALIDATION_ERROR,
  ProveedorDomainError,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/proveedor-repository", () => ({
  existeRncEnEmpresa: jest.fn(),
  crearProveedorEnTx: jest.fn(),
  registrarAuditProveedorEnTx: jest.fn(),
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

function makeProveedor(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    empresaId: 1,
    nombre: "Distribuidora Norte",
    contacto: "Juan Pérez",
    telefono: "809-555-1212",
    rnc: "138000001",
    tipoProveedor: "FORMAL",
    tipoPersona: "JURIDICA",
    activo: true,
    version: 1,
    ...overrides,
  };
}

const inputValido = {
  nombre: "Distribuidora Norte",
  contacto: "Juan Pérez",
  telefono: "809-555-1212",
  rnc: "1-3800000-1",
  tipoProveedor: "FORMAL" as const,
  tipoPersona: "JURIDICA" as const,
};

describe("crearProveedor", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("PRV-CREATE-A: returns the created supplier at version 1 with one CREAR audit", async () => {
    (existeRncEnEmpresa as jest.Mock).mockResolvedValue(false);
    (crearProveedorEnTx as jest.Mock).mockResolvedValue(makeProveedor());

    const result = await crearProveedor(makeTx(), ctx, inputValido);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        id: 1,
        nombre: "Distribuidora Norte",
        version: 1,
      });
    }
    expect(registrarAuditProveedorEnTx).toHaveBeenCalledTimes(1);
    // Frozen-enum CREAR is forwarded without importing the generated client.
    expect(registrarAuditProveedorEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "CREAR",
      1,
      null,
      expect.objectContaining({ nombre: "Distribuidora Norte", rnc: "138000001" }),
    );
  });

  it("PRV-RNC-A: stores the separator-stripped RNC and probes the normalized form", async () => {
    (existeRncEnEmpresa as jest.Mock).mockResolvedValue(false);
    (crearProveedorEnTx as jest.Mock).mockResolvedValue(makeProveedor());

    const result = await crearProveedor(makeTx(), ctx, inputValido);

    expect(result.ok).toBe(true);
    expect(existeRncEnEmpresa).toHaveBeenCalledWith(expect.anything(), 1, "138000001");
    expect(crearProveedorEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ rnc: "138000001" }),
    );
  });

  it("PRV-RNC-C: a null/blank RNC skips the duplicate probe entirely", async () => {
    (crearProveedorEnTx as jest.Mock).mockResolvedValue(
      makeProveedor({ rnc: null }),
    );

    const result = await crearProveedor(makeTx(), ctx, {
      ...inputValido,
      rnc: null,
    });

    expect(result.ok).toBe(true);
    expect(existeRncEnEmpresa).not.toHaveBeenCalled();
    expect(crearProveedorEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({ rnc: null }),
    );
  });

  it("PRV-CREATE-B: blank name returns VALIDATION_ERROR without persistence", async () => {
    const result = await crearProveedor(makeTx(), ctx, {
      ...inputValido,
      nombre: "   ",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
    expect(crearProveedorEnTx).not.toHaveBeenCalled();
    expect(registrarAuditProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-RNC-D: invalid RNC format (8 digits) returns RNC_FORMATO_INVALIDO", async () => {
    const result = await crearProveedor(makeTx(), ctx, {
      ...inputValido,
      rnc: "12345678",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(RNC_FORMATO_INVALIDO);
    expect(crearProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-RNC-B: duplicate active RNC is rejected before insert", async () => {
    (existeRncEnEmpresa as jest.Mock).mockResolvedValue(true);

    const result = await crearProveedor(makeTx(), ctx, inputValido);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(RNC_PROVEEDOR_DUPLICADO);
    expect(crearProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-RNC-D: concurrent duplicate (P2002 race) maps to the same result", async () => {
    (existeRncEnEmpresa as jest.Mock).mockResolvedValue(false); // pre-check passes
    (crearProveedorEnTx as jest.Mock).mockRejectedValue(
      new ProveedorDomainError(RNC_PROVEEDOR_DUPLICADO),
    );

    const result = await crearProveedor(makeTx(), ctx, inputValido);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(RNC_PROVEEDOR_DUPLICADO);
    expect(registrarAuditProveedorEnTx).not.toHaveBeenCalled();
  });
});
