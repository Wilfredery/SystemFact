/**
 * Application unit tests — actualizar-compra (mocked).
 * Proves draft-only edit, immutable PENDIENTE, and lost-race conflict.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  actualizarCompraBorradorEnTx,
  leerCompraEnTx,
  leerProveedorClasificadoEnTx,
  leerProductosParaLineasEnTx,
  reemplazarLineasEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";
import { actualizarCompra } from "./actualizar-compra";

jest.mock("../infrastructure/compra-repository", () => ({
  actualizarCompraBorradorEnTx: jest.fn(),
  leerCompraEnTx: jest.fn(),
  leerProveedorClasificadoEnTx: jest.fn(),
  leerProductosParaLineasEnTx: jest.fn(),
  reemplazarLineasEnTx: jest.fn(),
  registrarAuditCompraEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;

const draft = {
  id: 7,
  estado: "BORRADOR",
  correlativoInterno: "",
  tipoCompra: "MERCANCIA",
  ncf: null,
  tipoNcf: null,
  proveedorId: 5,
  lineas: [],
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  (leerCompraEnTx as jest.Mock).mockResolvedValue(draft);
  (leerProveedorClasificadoEnTx as jest.Mock).mockResolvedValue({
    id: 5,
    activo: true,
    tipoProveedor: "FORMAL",
    tipoPersona: "JURIDICA",
  });
  (leerProductosParaLineasEnTx as jest.Mock).mockResolvedValue([
    { id: 10, activo: true, tasaItbis: "0" },
  ]);
  (actualizarCompraBorradorEnTx as jest.Mock).mockResolvedValue({ updated: true });
});

describe("actualizarCompra", () => {
  it("replaces lines while BORRADOR and recomputes totals", async () => {
    const result = await actualizarCompra(tx, ctx, {
      id: 7,
      lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "250.00" }],
    });
    expect(result).toEqual({ ok: true, data: { id: 7, total: "250.00" } });
    expect(reemplazarLineasEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditCompraEnTx).toHaveBeenCalledTimes(1);
  });

  it("rejects editing a PENDIENTE purchase (COMPRA_INMUTABLE)", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue({ ...draft, estado: "PENDIENTE" });
    const result = await actualizarCompra(tx, ctx, {
      id: 7,
      lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "250.00" }],
    });
    expect(result.ok === false && result.code).toBe("COMPRA_INMUTABLE");
    expect(actualizarCompraBorradorEnTx).not.toHaveBeenCalled();
  });

  it("returns CONCURRENCIA_CONFLICTO when the guarded header update loses", async () => {
    (actualizarCompraBorradorEnTx as jest.Mock).mockResolvedValue({ updated: false });
    const result = await actualizarCompra(tx, ctx, {
      id: 7,
      lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "250.00" }],
    });
    expect(result.ok === false && result.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(reemplazarLineasEnTx).not.toHaveBeenCalled();
  });

  it("returns COMPRA_NO_ENCONTRADA for a missing purchase", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue(null);
    const result = await actualizarCompra(tx, ctx, {
      id: 7,
      lineas: [{ productoId: 10, cantidad: "1.000", costoUnitario: "250.00" }],
    });
    expect(result.ok === false && result.code).toBe("COMPRA_NO_ENCONTRADA");
  });
});
