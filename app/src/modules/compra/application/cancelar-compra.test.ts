/**
 * Application unit tests — cancelar-compra (mocked).
 * Proves mandatory motivo, cancel from BORRADOR/PENDIENTE, terminal guard,
 * conflict, and no writes when the motivo is blank.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  cancelarCompraEnTx,
  leerCompraEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";
import { cancelarCompra } from "./cancelar-compra";

jest.mock("../infrastructure/compra-repository", () => ({
  cancelarCompraEnTx: jest.fn(),
  leerCompraEnTx: jest.fn(),
  registrarAuditCompraEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;

beforeEach(() => {
  jest.clearAllMocks();
  (leerCompraEnTx as jest.Mock).mockResolvedValue({
    id: 3,
    estado: "PENDIENTE",
    correlativoInterno: "CMP-000001",
    tipoCompra: "MERCANCIA",
    ncf: null,
    tipoNcf: null,
    proveedorId: 5,
    lineas: [],
  });
  (cancelarCompraEnTx as jest.Mock).mockResolvedValue({ cancelled: true });
});

describe("cancelarCompra", () => {
  it("cancels a PENDIENTE purchase and audits the motivo", async () => {
    const result = await cancelarCompra(tx, ctx, { id: 3, motivo: "Error de captura" });
    expect(result).toEqual({ ok: true, data: { id: 3, estado: "CANCELADA" } });
    const auditArgs = (registrarAuditCompraEnTx as jest.Mock).mock.calls[0];
    expect(auditArgs?.[2]).toBe("CANCELAR");
    expect(auditArgs?.[6]).toBe("Error de captura");
  });

  it("rejects a blank motivo with no read or write", async () => {
    const result = await cancelarCompra(tx, ctx, { id: 3, motivo: "   " });
    expect(result.ok === false && result.code).toBe("VALIDATION_ERROR");
    expect(leerCompraEnTx).not.toHaveBeenCalled();
    expect(cancelarCompraEnTx).not.toHaveBeenCalled();
  });

  it("rejects cancelling an already-CANCELADA purchase (TRANSICION_INVALIDA)", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue({ estado: "CANCELADA" });
    const result = await cancelarCompra(tx, ctx, { id: 3, motivo: "x" });
    expect(result.ok === false && result.code).toBe("TRANSICION_INVALIDA");
    expect(cancelarCompraEnTx).not.toHaveBeenCalled();
  });

  it("returns CONCURRENCIA_CONFLICTO when the guarded update loses", async () => {
    (cancelarCompraEnTx as jest.Mock).mockResolvedValue({ cancelled: false });
    const result = await cancelarCompra(tx, ctx, { id: 3, motivo: "x" });
    expect(result.ok === false && result.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(registrarAuditCompraEnTx).not.toHaveBeenCalled();
  });

  it("returns COMPRA_NO_ENCONTRADA for a missing purchase", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue(null);
    const result = await cancelarCompra(tx, ctx, { id: 999, motivo: "x" });
    expect(result.ok === false && result.code).toBe("COMPRA_NO_ENCONTRADA");
  });
});
