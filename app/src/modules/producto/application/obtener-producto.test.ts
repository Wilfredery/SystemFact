import { Decimal } from "decimal.js";
import { obtenerProductoDetalle } from "./obtener-producto";
import { obtenerProductoDetalleEnTx } from "../infrastructure/producto-repository";
import {
  PRODUCTO_NO_ENCONTRADO,
  VALIDATION_ERROR,
} from "../domain/errors";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("../infrastructure/producto-repository", () => ({
  obtenerProductoDetalleEnTx: jest.fn(),
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

function fila() {
  return {
    id: 10,
    codigo: "LAP-001",
    nombre: "Laptop",
    descripcion: null as string | null,
    categoriaId: 2,
    categoriaNombre: "Equipos",
    unidadMedida: "Unidad",
    precioVenta: new Decimal("55000.00"),
    tasaItbis: new Decimal("18"),
    itbisVigenteDesde: new Date("2026-01-01T00:00:00.000Z"),
    itbisVigenteHasta: null as Date | null,
    itbisAplicaRetencionITBIS: false,
    activo: true,
    version: 7,
  };
}

describe("obtenerProductoDetalle", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("S1: returns the full detail including the row version for the edit dialog", async () => {
    (obtenerProductoDetalleEnTx as jest.Mock).mockResolvedValue(fila());

    const result = await obtenerProductoDetalle(makeTx(), ctx, { id: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.producto).toEqual({
      id: 10,
      codigo: "LAP-001",
      nombre: "Laptop",
      descripcion: null,
      categoriaId: 2,
      categoria: "Equipos",
      unidadMedida: "Unidad",
      precioVenta: "55000.00",
      tasaItbis: "18",
      itbisVigenteDesde: "2026-01-01T00:00:00.000Z",
      itbisVigenteHasta: null,
      itbisAplicaRetencionITBIS: false,
      activo: true,
      version: 7,
    });
    // Tenant scoping: the lookup carries the caller's company, never a bare id.
    expect(obtenerProductoDetalleEnTx).toHaveBeenCalledWith(expect.anything(), 1, 10);
  });

  it("S4: a missing or foreign-tenant id is PRODUCTO_NO_ENCONTRADO", async () => {
    (obtenerProductoDetalleEnTx as jest.Mock).mockResolvedValue(null);

    const result = await obtenerProductoDetalle(makeTx(), ctx, { id: 99 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(PRODUCTO_NO_ENCONTRADO);
  });

  it("S4: rejects a non-positive id before any database access", async () => {
    const result = await obtenerProductoDetalle(makeTx(), ctx, { id: 0 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(VALIDATION_ERROR);
    expect(obtenerProductoDetalleEnTx).not.toHaveBeenCalled();
  });
});
