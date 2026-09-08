import { desactivarProveedor } from "./desactivar-proveedor";
import { crearProveedor } from "./crear-proveedor";
import {
  proveedorByIdEnEmpresa,
  tieneComprasNoCanceladas,
  desactivarProveedorEnTx,
  existeRncEnEmpresa,
  crearProveedorEnTx,
  registrarAuditProveedorEnTx,
} from "../infrastructure/proveedor-repository";
import {
  PROVEEDOR_TIENE_COMPRAS,
  PROVEEDOR_YA_INACTIVO,
  PROVEEDOR_NO_ENCONTRADO,
} from "../domain/errors";
import type { Proveedor } from "../domain/proveedor";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/proveedor-repository", () => ({
  proveedorByIdEnEmpresa: jest.fn(),
  tieneComprasNoCanceladas: jest.fn(),
  desactivarProveedorEnTx: jest.fn(),
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
    version: 1,
    ...overrides,
  };
}

describe("desactivarProveedor", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("PRV-GUARD-A: non-cancelled purchases block deactivation with no write", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(makeProveedor());
    (tieneComprasNoCanceladas as jest.Mock).mockResolvedValue(true);

    const result = await desactivarProveedor(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PROVEEDOR_TIENE_COMPRAS);
    expect(desactivarProveedorEnTx).not.toHaveBeenCalled();
    expect(registrarAuditProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-DEACT-B: repeated deactivation returns PROVEEDOR_YA_INACTIVO", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(
      makeProveedor({ activo: false }),
    );

    const result = await desactivarProveedor(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PROVEEDOR_YA_INACTIVO);
    expect(desactivarProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-DEACT-A: success flips activo and appends exactly one CANCELAR audit", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(makeProveedor());
    (tieneComprasNoCanceladas as jest.Mock).mockResolvedValue(false);
    (desactivarProveedorEnTx as jest.Mock).mockResolvedValue({
      deactivated: true,
    });

    const result = await desactivarProveedor(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ id: 10, nombre: "Distribuidora Norte" });
    expect(registrarAuditProveedorEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditProveedorEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      "CANCELAR",
      10,
      { activo: true },
      { activo: false },
      "proveedor.desactivado",
    );
  });

  it("lost race against a concurrent deactivation maps to YA_INACTIVO without audit", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(makeProveedor());
    (tieneComprasNoCanceladas as jest.Mock).mockResolvedValue(false);
    (desactivarProveedorEnTx as jest.Mock).mockResolvedValue({
      deactivated: false,
    });

    const result = await desactivarProveedor(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PROVEEDOR_YA_INACTIVO);
    expect(registrarAuditProveedorEnTx).not.toHaveBeenCalled();
  });

  it("PRV-ISO-A: missing or foreign-tenant id maps to PROVEEDOR_NO_ENCONTRADO", async () => {
    (proveedorByIdEnEmpresa as jest.Mock).mockResolvedValue(null);

    const result = await desactivarProveedor(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PROVEEDOR_NO_ENCONTRADO);
  });

  it("PRV-DEACT-C: deactivation releases the RNC for reuse", async () => {
    // Small in-memory fake honoring the "active rows only" uniqueness rule.
    type MutableRow = Omit<Proveedor, "activo"> & { activo: boolean };
    const rows: MutableRow[] = [makeProveedor({ id: 10 })];
    (proveedorByIdEnEmpresa as jest.Mock).mockImplementation(
      async (_tx: unknown, empresaId: number, id: number) =>
        rows.find((r) => r.id === id && r.empresaId === empresaId) ?? null,
    );
    (tieneComprasNoCanceladas as jest.Mock).mockResolvedValue(false);
    (desactivarProveedorEnTx as jest.Mock).mockImplementation(
      async (_tx: unknown, empresaId: number, id: number) => {
        const row = rows.find((r) => r.id === id && r.empresaId === empresaId);
        if (row === undefined || !row.activo) return { deactivated: false };
        row.activo = false;
        return { deactivated: true };
      },
    );
    (existeRncEnEmpresa as jest.Mock).mockImplementation(
      async (
        _tx: unknown,
        empresaId: number,
        rnc: string | null,
        exclude?: number,
      ) =>
        rnc !== null &&
        rows.some(
          (r) =>
            r.empresaId === empresaId &&
            r.activo &&
            r.rnc === rnc &&
            r.id !== exclude,
        ),
    );
    (crearProveedorEnTx as jest.Mock).mockImplementation(
      async (_tx: unknown, _ctx: TenantCtx, data: Record<string, unknown>) => {
        const created: MutableRow = {
          id: 11,
          empresaId: _ctx.empresaId,
          nombre: String(data.nombre),
          contacto: String(data.contacto),
          telefono: String(data.telefono),
          rnc: (data.rnc as string | null) ?? null,
          tipoProveedor: data.tipoProveedor as Proveedor["tipoProveedor"],
          tipoPersona: data.tipoPersona as Proveedor["tipoPersona"],
          activo: true,
          version: 1,
        };
        rows.push(created);
        return created;
      },
    );

    const off = await desactivarProveedor(makeTx(), ctx, { id: 10 });
    expect(off.ok).toBe(true);

    const again = await crearProveedor(makeTx(), ctx, {
      nombre: "Otra Razón",
      contacto: "—",
      telefono: "—",
      rnc: "138000001",
      tipoProveedor: "FORMAL",
      tipoPersona: "JURIDICA",
    });
    expect(again.ok).toBe(true);
  });
});
