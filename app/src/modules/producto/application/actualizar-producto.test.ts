import { Decimal } from "decimal.js";
import { actualizarProducto, type ActualizarProductoInput } from "./actualizar-producto";
import {
  obtenerProductoPorId,
  existeCodigoEnEmpresa,
  actualizarProductoEnTx,
  registrarProductoActualizadoEnTx,
} from "../infrastructure/producto-repository";
// Design D3 (fase-3-2): helper relocated to the Categoria module.
import { categoriaPerteneceAEmpresa } from "@/modules/categoria/infrastructure/categoria-repository";
import {
  CONCURRENCIA_CONFLICTO,
  PRODUCTO_NO_ENCONTRADO,
  CODIGO_PRODUCTO_DUPLICADO,
  PRECIO_BASE_INVALIDO,
  TASA_ITBIS_INVALIDA,
  VIGENCIA_INVALIDA,
  CATEGORIA_INVALIDA,
  VALIDATION_ERROR,
  ProductoDomainError,
} from "../domain/errors";
import type { Producto } from "../domain/producto";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/producto-repository", () => ({
  obtenerProductoPorId: jest.fn(),
  existeCodigoEnEmpresa: jest.fn(),
  actualizarProductoEnTx: jest.fn(),
  registrarProductoActualizadoEnTx: jest.fn(),
}));

jest.mock("@/modules/categoria/infrastructure/categoria-repository", () => ({
  categoriaPerteneceAEmpresa: jest.fn(),
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

function makeProducto(overrides: Partial<Producto> = {}): Producto {
  return {
    id: 10,
    empresaId: 1,
    categoriaId: 1,
    codigo: "LAPTOP-001",
    nombre: "Laptop",
    descripcion: null,
    precioVenta: new Decimal("50000.00"),
    itbis: {
      tasa: "18",
      vigenteDesde: new Date("2026-01-01"),
      vigenteHasta: null,
      aplicaRetencionITBIS: false,
    },
    exento: false,
    activo: true,
    ...overrides,
  };
}

function mockCurrent(version = 2, producto: Producto = makeProducto()) {
  (obtenerProductoPorId as jest.Mock).mockResolvedValue({ producto, version });
}

const baseCommand: ActualizarProductoInput = {
  id: 10,
  version: 2,
  precioVenta: new Decimal("55000.00"),
};

describe("actualizarProducto", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("PROD-011-A: partial edit updates only supplied fields and bumps version", async () => {
    mockCurrent();
    (actualizarProductoEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });
    // Re-fetch after the UPDATE returns the new state.
    (obtenerProductoPorId as jest.Mock).mockResolvedValueOnce({
      producto: makeProducto(),
      version: 2,
    });
    (obtenerProductoPorId as jest.Mock).mockResolvedValueOnce({
      producto: makeProducto({ precioVenta: new Decimal("55000.00") }),
      version: 3,
    });

    const result = await actualizarProducto(makeTx(), ctx, baseCommand);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe(3);
      expect(result.producto.precioVenta.toString()).toBe("55000");
    }
    // Patch semantics: only precioVenta reaches the UPDATE payload.
    const data = (actualizarProductoEnTx as jest.Mock).mock.calls[0][4];
    expect(Object.keys(data)).toEqual(["precioVenta"]);
    // Regression pin: the client-submitted version drives the optimistic lock.
    expect(actualizarProductoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx.empresaId,
      baseCommand.id,
      baseCommand.version,
      expect.anything(),
    );
    expect(registrarProductoActualizadoEnTx).toHaveBeenCalledTimes(1);
  });

  it("PROD-011-A: audit carries old and new values of the changed field", async () => {
    mockCurrent(2, makeProducto());
    (actualizarProductoEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });

    await actualizarProducto(makeTx(), ctx, { id: 10, version: 2, nombre: "Notebook" });

    const [oldVals, newVals] = (registrarProductoActualizadoEnTx as jest.Mock).mock
      .calls[0].slice(3);
    expect(oldVals).toEqual({ nombre: "Laptop" });
    expect(newVals).toEqual({ nombre: "Notebook" });
  });

  it("PROD-011-B: stale version returns CONCURRENCIA_CONFLICTO without audit", async () => {
    // Stored row is at version 5 while the client submits the stale version 2.
    const storedVersion = 5;
    mockCurrent(storedVersion, makeProducto());
    // Faithful stand-in for the real `UPDATE ... WHERE version` clause: it only
    // matches when the forwarded version equals the stored row version. This is
    // what makes the test meaningful — the previous mock returned `updated:false`
    // unconditionally and so hid the fact that the use case forwarded the
    // freshly-read DB version instead of the client one (CRITICAL-1).
    (actualizarProductoEnTx as jest.Mock).mockImplementation(
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

    const result = await actualizarProducto(makeTx(), ctx, baseCommand);

    // Optimistic lock must be driven by the CLIENT version, not the version
    // re-read inside the same transaction, or stale edits silently win.
    expect(actualizarProductoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx.empresaId,
      baseCommand.id,
      baseCommand.version,
      expect.anything(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CONCURRENCIA_CONFLICTO);
    expect(registrarProductoActualizadoEnTx).not.toHaveBeenCalled();
  });

  it("PROD-013-B: cross-tenant or missing id returns PRODUCTO_NO_ENCONTRADO", async () => {
    (obtenerProductoPorId as jest.Mock).mockResolvedValue(null);

    const result = await actualizarProducto(makeTx(), ctx, baseCommand);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PRODUCTO_NO_ENCONTRADO);
    expect(actualizarProductoEnTx).not.toHaveBeenCalled();
  });

  it("inactive product cannot be edited (PRODUCTO_NO_ENCONTRADO)", async () => {
    mockCurrent(2, makeProducto({ activo: false }));

    const result = await actualizarProducto(makeTx(), ctx, baseCommand);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PRODUCTO_NO_ENCONTRADO);
    expect(actualizarProductoEnTx).not.toHaveBeenCalled();
  });

  it("PROD-011-C: changed code already used by another product is rejected", async () => {
    mockCurrent();
    (existeCodigoEnEmpresa as jest.Mock).mockResolvedValue(true);

    const result = await actualizarProducto(makeTx(), ctx, {
      id: 10,
      version: 2,
      codigo: "OTRO-COD",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CODIGO_PRODUCTO_DUPLICADO);
    // Self-exclusion: the duplicate probe must exclude the edited row.
    expect(existeCodigoEnEmpresa).toHaveBeenCalledWith(
      expect.anything(),
      1,
      "OTRO-COD",
      10,
    );
    expect(actualizarProductoEnTx).not.toHaveBeenCalled();
  });

  it("same code (no change) skips the duplicate probe", async () => {
    mockCurrent();
    (actualizarProductoEnTx as jest.Mock).mockResolvedValue({
      updated: true,
      newVersion: 3,
    });

    const result = await actualizarProducto(makeTx(), ctx, {
      id: 10,
      version: 2,
      codigo: "LAPTOP-001",
    });

    expect(result.ok).toBe(true);
    expect(existeCodigoEnEmpresa).not.toHaveBeenCalled();
  });

  it("duplicate-code TOCTOU race from the repository maps to a result", async () => {
    mockCurrent();
    (actualizarProductoEnTx as jest.Mock).mockRejectedValue(
      new ProductoDomainError(CODIGO_PRODUCTO_DUPLICADO),
    );

    const result = await actualizarProducto(makeTx(), ctx, {
      id: 10,
      version: 2,
      codigo: "NUEVO",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CODIGO_PRODUCTO_DUPLICADO);
    expect(registrarProductoActualizadoEnTx).not.toHaveBeenCalled();
  });

  it("rejects negative price", async () => {
    mockCurrent();

    const result = await actualizarProducto(makeTx(), ctx, {
      id: 10,
      version: 2,
      precioVenta: new Decimal("-5"),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PRECIO_BASE_INVALIDO);
    expect(actualizarProductoEnTx).not.toHaveBeenCalled();
  });

  it("rejects invalid ITBIS rate", async () => {
    mockCurrent();

    const result = await actualizarProducto(makeTx(), ctx, {
      id: 10,
      version: 2,
      itbisTasa: "19" as "18",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(TASA_ITBIS_INVALIDA);
  });

  it("vigencia window is validated against merged values (new hasta vs old desde)", async () => {
    mockCurrent();

    const result = await actualizarProducto(makeTx(), ctx, {
      id: 10,
      version: 2,
      itbisVigenteHasta: new Date("2025-06-01"), // before current vigenteDesde
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VIGENCIA_INVALIDA);
    expect(actualizarProductoEnTx).not.toHaveBeenCalled();
  });

  it("rejects category owned by another tenant", async () => {
    mockCurrent();
    (categoriaPerteneceAEmpresa as jest.Mock).mockResolvedValue(false);

    const result = await actualizarProducto(makeTx(), ctx, {
      id: 10,
      version: 2,
      categoriaId: 99,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(CATEGORIA_INVALIDA);
    expect(actualizarProductoEnTx).not.toHaveBeenCalled();
  });

  it("patch with no editable fields returns VALIDATION_ERROR", async () => {
    mockCurrent();

    const result = await actualizarProducto(makeTx(), ctx, { id: 10, version: 2 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
    expect(obtenerProductoPorId).not.toHaveBeenCalled();
  });
});
