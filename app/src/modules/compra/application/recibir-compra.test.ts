/**
 * Application unit tests — recibir-compra (mocked transaction + repos; no DB).
 *
 * Proves the orchestration contract: happy-path `PENDIENTE → RECIBIDA` delegating
 * every line to inventario once, branch/state guards rejecting BEFORE any write,
 * the guarded-update zero-row concurrency conflict producing ZERO inventory
 * calls, and — critically — that an inventario entry failure AFTER the guarded
 * flip THROWS a CompraDomainError (so the whole transaction rolls back rather
 * than committing a `RECIBIDA` purchase with no stock).
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import {
  leerCompraEnTx,
  recibirCompraEnTx,
  registrarAuditCompraEnTx,
} from "../infrastructure/compra-repository";
import { registrarEntradasCompra } from "@/modules/inventario/application/registrar-entrada-compra";
import {
  InventarioDomainError,
  INVENTARIO_NO_ENCONTRADO,
} from "@/modules/inventario/domain/errors";
import {
  CompraDomainError,
  INVENTARIO_ENTRADA_RECHAZADA,
} from "../domain/errors";
import { recibirCompra } from "./recibir-compra";

jest.mock("../infrastructure/compra-repository", () => ({
  leerCompraEnTx: jest.fn(),
  recibirCompraEnTx: jest.fn(),
  registrarAuditCompraEnTx: jest.fn(),
}));
jest.mock("@/modules/inventario/application/registrar-entrada-compra", () => ({
  registrarEntradasCompra: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;

const pendiente = {
  id: 42,
  estado: "PENDIENTE",
  correlativoInterno: "CMP-000001",
  tipoCompra: "MERCANCIA",
  ncf: null,
  tipoNcf: null,
  proveedorId: 5,
  sucursalId: 2, // matches ctx.sucursalId
  lineas: [
    { productoId: 10, cantidad: "3.000", costoUnitario: "100.00", tasaItbis: "18" },
    { productoId: 11, cantidad: "2.000", costoUnitario: "50.00", tasaItbis: "0" },
  ],
} as const;

beforeEach(() => {
  jest.clearAllMocks();
  (leerCompraEnTx as jest.Mock).mockResolvedValue(pendiente);
  (recibirCompraEnTx as jest.Mock).mockResolvedValue({ recibido: true });
  (registrarEntradasCompra as jest.Mock).mockResolvedValue([
    { inventoryId: 1, previousQuantity: "0.000", newQuantity: "3.000", productoId: 10 },
    { inventoryId: 2, previousQuantity: "0.000", newQuantity: "2.000", productoId: 11 },
  ]);
});

describe("recibirCompra", () => {
  it("receives a session-branch PENDIENTE purchase: flips state, delegates lines once, audits", async () => {
    const result = await recibirCompra(tx, ctx, { id: 42 });

    expect(result).toEqual({
      ok: true,
      data: { id: 42, estado: "RECIBIDA", movimientosAplicados: 2 },
    });
    // One guarded update, one batch inventory call, one audit row.
    expect(recibirCompraEnTx).toHaveBeenCalledTimes(1);
    expect(registrarAuditCompraEnTx).toHaveBeenCalledTimes(1);
    // The batch call maps persisted costoUnitario → ITBIS-exclusive net unit.
    expect(registrarEntradasCompra).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({
        compraId: 42,
        lineas: [
          { productoId: 10, cantidad: "3.000", costoUnitarioSinItbis: "100.00" },
          { productoId: 11, cantidad: "2.000", costoUnitarioSinItbis: "50.00" },
        ],
      }),
    );
  });

  it("returns COMPRA_NO_ENCONTRADA for a missing purchase with zero side effects", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue(null);
    const result = await recibirCompra(tx, ctx, { id: 999 });
    expect(result.ok === false && result.code).toBe("COMPRA_NO_ENCONTRADA");
    expect(recibirCompraEnTx).not.toHaveBeenCalled();
    expect(registrarEntradasCompra).not.toHaveBeenCalled();
  });

  it("rejects a foreign-branch purchase with COMPRA_SUCURSAL_INVALIDA and zero writes", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue({ ...pendiente, sucursalId: 99 });
    const result = await recibirCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("COMPRA_SUCURSAL_INVALIDA");
    expect(recibirCompraEnTx).not.toHaveBeenCalled();
    expect(registrarEntradasCompra).not.toHaveBeenCalled();
    expect(registrarAuditCompraEnTx).not.toHaveBeenCalled();
  });

  it("rejects a BORRADOR purchase with TRANSICION_INVALIDA before the guarded update", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue({ ...pendiente, estado: "BORRADOR" });
    const result = await recibirCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("TRANSICION_INVALIDA");
    expect(recibirCompraEnTx).not.toHaveBeenCalled();
    expect(registrarEntradasCompra).not.toHaveBeenCalled();
  });

  it("treats an already-RECIBIDA duplicate as CONCURRENCIA_CONFLICTO (idempotent, zero writes)", async () => {
    (leerCompraEnTx as jest.Mock).mockResolvedValue({ ...pendiente, estado: "RECIBIDA" });
    const result = await recibirCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("CONCURRENCIA_CONFLICTO");
    expect(recibirCompraEnTx).not.toHaveBeenCalled();
    expect(registrarEntradasCompra).not.toHaveBeenCalled();
  });

  it("returns CONCURRENCIA_CONFLICTO with ZERO inventory calls when the guarded update matched no row", async () => {
    (recibirCompraEnTx as jest.Mock).mockResolvedValue({ recibido: false });
    const result = await recibirCompra(tx, ctx, { id: 42 });
    expect(result.ok === false && result.code).toBe("CONCURRENCIA_CONFLICTO");
    // A losing concurrent race must NOT enter stock or write an audit row.
    expect(registrarEntradasCompra).not.toHaveBeenCalled();
    expect(registrarAuditCompraEnTx).not.toHaveBeenCalled();
  });

  it("THROWS the bridge error when inventario rejects AFTER the flip (so the tx rolls back)", async () => {
    (registrarEntradasCompra as jest.Mock).mockRejectedValue(
      new InventarioDomainError(INVENTARIO_NO_ENCONTRADO, { productoId: 10 }),
    );
    await expect(recibirCompra(tx, ctx, { id: 42 })).rejects.toBeInstanceOf(
      CompraDomainError,
    );
    await expect(recibirCompra(tx, ctx, { id: 42 })).rejects.toMatchObject({
      code: INVENTARIO_ENTRADA_RECHAZADA,
    });
    // No audit after a failed entry (the whole transaction aborts).
    expect(registrarAuditCompraEnTx).not.toHaveBeenCalled();
  });

  it("re-throws a NON-domain inventario error (a defect) unchanged", async () => {
    (registrarEntradasCompra as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(recibirCompra(tx, ctx, { id: 42 })).rejects.toThrow("boom");
  });
});
