import { Decimal } from "decimal.js";
import { desactivarProducto } from "./desactivar-producto";
import {
  obtenerProductoPorId,
  tieneMovimientosActivos,
  desactivarProductoEnTx,
  registrarProductoDesactivadoEnTx,
} from "../infrastructure/producto-repository";
import {
  PRODUCTO_NO_ENCONTRADO,
  PRODUCTO_YA_INACTIVO,
  PRODUCTO_TIENE_MOVIMIENTOS,
} from "../domain/errors";
import type { Producto } from "../domain/producto";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/producto-repository", () => ({
  obtenerProductoPorId: jest.fn(),
  tieneMovimientosActivos: jest.fn(),
  desactivarProductoEnTx: jest.fn(),
  registrarProductoDesactivadoEnTx: jest.fn(),
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

describe("desactivarProducto", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (obtenerProductoPorId as jest.Mock).mockResolvedValue({
      producto: makeProducto(),
      version: 1,
    });
  });

  it("PROD-012-A: happy path deactivates and audits inside the transaction", async () => {
    (tieneMovimientosActivos as jest.Mock).mockResolvedValue(false);
    (desactivarProductoEnTx as jest.Mock).mockResolvedValue({ deactivated: true });

    const result = await desactivarProducto(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productoId).toBe(10);
      // codigo echoed so callers see the now-released code (partial unique).
      expect(result.codigo).toBe("LAPTOP-001");
    }
    expect(desactivarProductoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx.empresaId,
      10,
    );
    expect(registrarProductoDesactivadoEnTx).toHaveBeenCalledTimes(1);
  });

  it("PROD-012-B: active references block deactivation without any write", async () => {
    (tieneMovimientosActivos as jest.Mock).mockResolvedValue(true);

    const result = await desactivarProducto(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PRODUCTO_TIENE_MOVIMIENTOS);
    // Explicit business guard, never P2003: soft-delete never trips FK restrict.
    expect(desactivarProductoEnTx).not.toHaveBeenCalled();
    expect(registrarProductoDesactivadoEnTx).not.toHaveBeenCalled();
  });

  it("already inactive returns PRODUCTO_YA_INACTIVO (no double audit)", async () => {
    (obtenerProductoPorId as jest.Mock).mockResolvedValue({
      producto: makeProducto({ activo: false }),
      version: 3,
    });

    const result = await desactivarProducto(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PRODUCTO_YA_INACTIVO);
    expect(desactivarProductoEnTx).not.toHaveBeenCalled();
    expect(registrarProductoDesactivadoEnTx).not.toHaveBeenCalled();
  });

  it("concurrent deactivation (zero rows) maps to PRODUCTO_YA_INACTIVO", async () => {
    (tieneMovimientosActivos as jest.Mock).mockResolvedValue(false);
    (desactivarProductoEnTx as jest.Mock).mockResolvedValue({ deactivated: false });

    const result = await desactivarProducto(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PRODUCTO_YA_INACTIVO);
    expect(registrarProductoDesactivadoEnTx).not.toHaveBeenCalled();
  });

  it("PROD-013-B: missing or foreign-tenant product returns PRODUCTO_NO_ENCONTRADO", async () => {
    (obtenerProductoPorId as jest.Mock).mockResolvedValue(null);

    const result = await desactivarProducto(makeTx(), ctx, { id: 999 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PRODUCTO_NO_ENCONTRADO);
    expect(desactivarProductoEnTx).not.toHaveBeenCalled();
  });
});
