import { actualizarProveedor } from "./actualizar-proveedor";
import {
  proveedorByIdEnEmpresa,
  existeRncEnEmpresa,
  actualizarProveedorEnTx,
  registrarAuditProveedorEnTx,
} from "../infrastructure/proveedor-repository";
import {
  PROVEEDOR_NO_ENCONTRADO,
  PROVEEDOR_YA_INACTIVO,
  RNC_PROVEEDOR_DUPLICADO,
  RNC_FORMATO_INVALIDO,
  CONCURRENCIA_CONFLICTO,
  VALIDATION_ERROR,
} from "../domain/errors";
import type { Proveedor } from "../domain/proveedor";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/proveedor-repository", () => ({
  proveedorByIdEnEmpresa: jest.fn(),
  existeRncEnEmpresa: jest.fn(),
  actualizarProveedorEnTx: jest.fn(),
  registrarAuditProveedorEnTx: jest.fn(),
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

function makeProveedor(overrides: Partial<Proveedor> = {}): Proveedor {
  return {
    id: 10,
    empresaId: 1,
    nombre: "Distribuidora Norte",
    contacto: "Juan Pérez",
    telefono: "809-555-1212",
    rnc: "138000001",
    tipoProveedor: "FORMAL",
    tipoPersona: "JURIDICA",
    activo: true,
    version: 2,
    ...overrides,
  };
}

describe("actualizarProveedor", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("PRV-EDIT-A: valid patch saves, bumps version and audits old/new values", async () => {
    (proveedorByIdEnEmpresa as jest.Mock)
      .mockResolvedValueOnce(makeProveedor())
      .mockResolvedValueOnce(
        makeProveedor({ nombre: "Distribuidora Sur", version: 3 }),
      );
    (actualizarProveedorEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });

    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "Distribuidora Sur",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ id: 10, version: 3 });
    }
    expect(registrarAuditProveedorEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "ACTUALIZAR",
      10,
      { nombre: "Distribuidora Norte" },
      { nombre: "Distribuidora Sur" },
    );
  });

  it("PRV-EDIT-B: stale version maps to CONCURRENCIA_CONFLICTO without audit", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(makeProveedor());
    (actualizarProveedorEnTx as jest.Mock).mockResolvedValue({
      updated: false,
      newVersion: 2,
    });

    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 1, // client read a stale row
      nombre: "Cualquiera",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CONCURRENCIA_CONFLICTO);
    expect(registrarAuditProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-ISO-A: missing or foreign-tenant id maps to PROVEEDOR_NO_ENCONTRADO", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(null);

    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "X",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PROVEEDOR_NO_ENCONTRADO);
  });

  it("PRV-EDIT: editing an inactive supplier is rejected", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(
      makeProveedor({ activo: false }),
    );

    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 2,
      nombre: "X",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PROVEEDOR_YA_INACTIVO);
    expect(actualizarProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-RNC-B: renaming onto an active RNC taken by another supplier fails", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(makeProveedor());
    (existeRncEnEmpresa as jest.Mock).mockResolvedValue(true);

    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 2,
      rnc: "1-0000000-0",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(RNC_PROVEEDOR_DUPLICADO);
    expect(actualizarProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-RNC-A: an unchanged RNC is not re-probed against itself", async () => {
    (proveedorByIdEnEmpresa as jest.Mock)
      .mockResolvedValueOnce(makeProveedor())
      .mockResolvedValueOnce(makeProveedor({ telefono: "829-000-0000" }));
    (actualizarProveedorEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });

    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 2,
      telefono: "829-000-0000",
    });

    expect(result.ok).toBe(true);
    expect(existeRncEnEmpresa).not.toHaveBeenCalled();
  });

  it("PRV-RNC-C: clearing the RNC to null is allowed and skips the probe", async () => {
    (proveedorByIdEnEmpresa as jest.Mock)
      .mockResolvedValueOnce(makeProveedor())
      .mockResolvedValueOnce(makeProveedor({ rnc: null }));
    (actualizarProveedorEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });

    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 2,
      rnc: null,
    });

    expect(result.ok).toBe(true);
    expect(existeRncEnEmpresa).not.toHaveBeenCalled();
    expect(actualizarProveedorEnTx).toHaveBeenCalledWith(
      expect.anything(),
      1,
      10,
      2,
      expect.objectContaining({ rnc: null }),
    );
  });

  it("PRV-RNC-D: a malformed new RNC fails format validation before any write", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(makeProveedor());

    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 2,
      rnc: "abc-123",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(RNC_FORMATO_INVALIDO);
    expect(actualizarProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-EDIT: an empty patch (no editable fields) is a validation error", async () => {
    const result = await actualizarProveedor(makeTx(), ctx, {
      id: 10,
      version: 2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
    expect(actualizarProveedorEnTx).not.toHaveBeenCalled();
  });
});
