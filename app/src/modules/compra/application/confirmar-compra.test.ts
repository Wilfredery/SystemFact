/**
 * Application unit tests — confirmar-compra (mocked transaction + repos).
 *
 * Proves: happy-path confirm (PENDIENTE + CMP + computed retentions), a missing
 * applicable retention key BLOCKS confirm with no transition, a `PENDIENTE`
 * draft is immutable, and a lost guarded-update race yields CONCURRENCIA_CONFLICTO.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  bloquearCompraParaConfirmarEnTx,
  confirmarCompraEnTx,
  leerCompraEnTx,
  leerProveedorClasificadoEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";
import { leerTasasRetencionEnTx } from "../infrastructure/configuracion-repository";
import { CompraDomainError, CONFIG_RETENCION_FALTANTE } from "../domain/errors";
import { confirmarCompra } from "./confirmar-compra";

jest.mock("../infrastructure/compra-repository", () => ({
  bloquearCompraParaConfirmarEnTx: jest.fn(),
  confirmarCompraEnTx: jest.fn(),
  leerCompraEnTx: jest.fn(),
  leerProveedorClasificadoEnTx: jest.fn(),
  registrarAuditCompraEnTx: jest.fn(),
}));
jest.mock("../infrastructure/configuracion-repository", () => ({
  leerTasasRetencionEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;

const draft = {
  id: 42,
  estado: "BORRADOR",
  correlativoInterno: "",
  tipoCompra: "SERVICIO_PROFESIONAL",
  ncf: null,
  tipoNcf: null,
  proveedorId: 5,
  lineas: [
    { productoId: 10, cantidad: "1.000", costoUnitario: "1000.00", tasaItbis: "18" },
  ],
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  (leerCompraEnTx as jest.Mock).mockResolvedValue(draft);
  (bloquearCompraParaConfirmarEnTx as jest.Mock).mockResolvedValue({ lockable: true });
  (leerProveedorClasificadoEnTx as jest.Mock).mockResolvedValue({
    id: 5,
    activo: true,
    tipoProveedor: "FORMAL",
    tipoPersona: "FISICA",
  });
  (leerTasasRetencionEnTx as jest.Mock).mockResolvedValue({
    isr15: "15",
    isr2: "2",
    itbis100: "100",
    itbis30: "30",
  });
  (confirmarCompraEnTx as jest.Mock).mockResolvedValue({
    confirmed: true,
    correlativo: "CMP-000001",
  });
});

describe("confirmarCompra", () => {
  it("confirms to PENDIENTE with a CMP number and computed ISR retention", async () => {
    // 1000 gravado, itbis 180, total 1180; professional/fisica → ISR 15% of gravado = 150.
    const result = await confirmarCompra(tx, ctx, { id: 42 });
    expect(result).toEqual({
      ok: true,
      data: {
        id: 42,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000001",
        total: "1180.00",
        retencionIsr: "150.00",
        retencionItbis: "0.00",
      },
    });
    expect(registrarAuditCompraEnTx).toHaveBeenCalledTimes(1);
  });

  it("blocks confirm when an applicable retention key is missing (no transition)", async () => {
    (leerTasasRetencionEnTx as jest.Mock).mockRejectedValue(
      new CompraDomainError(CONFIG_RETENCION_FALTANTE, {
        clavesFaltantes: ["RET_ISR_15"],
      }),
    );
    const result = await confirmarCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("CONFIG_RETENCION_FALTANTE");
    expect(confirmarCompraEnTx).not.toHaveBeenCalled();
    expect(registrarAuditCompraEnTx).not.toHaveBeenCalled();
  });

  it("rejects confirming an already-PENDIENTE purchase as immutable", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue({ ...draft, estado: "PENDIENTE" });
    const result = await confirmarCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("COMPRA_INMUTABLE");
    expect(confirmarCompraEnTx).not.toHaveBeenCalled();
  });

  it("returns CONCURRENCIA_CONFLICTO when the guarded update matched no row", async () => {
    (confirmarCompraEnTx as jest.Mock).mockResolvedValue({
      confirmed: false,
      correlativo: "CMP-000001",
    });
    const result = await confirmarCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(registrarAuditCompraEnTx).not.toHaveBeenCalled();
  });

  it("returns COMPRA_NO_ENCONTRADA for a missing purchase", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue(null);
    const result = await confirmarCompra(tx, ctx, { id: 999 });
    expect(result.ok === false && result.code).toBe("COMPRA_NO_ENCONTRADA");
  });

  it("converges on lines edited after its primal read: totals come from the re-read under the lock (v2r-03)", async () => {
    // A draft edit interleaved between the step-1 read and the confirm's guarded
    // UPDATE used to be a lost race: totals derived from STALE lines while the
    // FINAL pending purchase carries the edited ones (TOCTOU, v2r-03). Post-fix,
    // the compra row lock serializes the edit, the re-read converges, and both the
    // persisted totals AND the confirm result come from the fresh lines.
    (leerCompraEnTx as jest.Mock)
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({
        ...draft,
        lineas: [
          { productoId: 10, cantidad: "2.000", costoUnitario: "500.00", tasaItbis: "18" },
        ],
      });
    const result = await confirmarCompra(tx, ctx, { id: 42 });
    expect(bloquearCompraParaConfirmarEnTx).toHaveBeenCalledWith(tx, ctx, 42);
    // 2×500 = 1000 gravado, itbis 180, total 1180; professional/fisica → ISR 15% = 150.
    expect(result).toEqual({
      ok: true,
      data: {
        id: 42,
        estado: "PENDIENTE",
        correlativoInterno: "CMP-000001",
        total: "1180.00",
        retencionIsr: "150.00",
        retencionItbis: "0.00",
      },
    });
  });

  it("returns CONCURRENCIA_CONFLICTO when the row is not lockable (concurrent edit holds it)", async () => {
    (bloquearCompraParaConfirmarEnTx as jest.Mock).mockResolvedValue({ lockable: false });
    const result = await confirmarCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(confirmarCompraEnTx).not.toHaveBeenCalled();
    expect(registrarAuditCompraEnTx).not.toHaveBeenCalled();
  });

  it("returns COMPRA_NO_ENCONTRADA when the row vanished between the read and the lock", async () => {
    (bloquearCompraParaConfirmarEnTx as jest.Mock).mockResolvedValue({ lockable: false });
    (leerCompraEnTx as jest.Mock)
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(null);
    const result = await confirmarCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("COMPRA_NO_ENCONTRADA");
    expect(confirmarCompraEnTx).not.toHaveBeenCalled();
  });
});
