/**
 * Unit tests — `guardarTasasItbis` (feature itbis-tasas-edit) against mocked
 * repositories. The real-DB behavior (RLS, window semantics, audit persistence)
 * lives in `src/integration/config-tasas-edit.integration.test.ts`.
 */

import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import { guardarTasasItbis } from "./gestion-configuracion";
import { leerTasaItbisConfigEnTx } from "../infrastructure/administracion-config-repository";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";

jest.mock("../infrastructure/administracion-config-repository", () => ({
  leerTasaItbisConfigEnTx: jest.fn(),
}));
jest.mock("@/modules/auditoria/application/auditoria-write-port", () => ({
  registrarEventoAuditoriaEnTx: jest.fn(),
}));

const ctx: TenantCtx = { empresaId: 1, sucursalId: 2, usuarioId: 3, esAdmin: true };
const tx = {} as unknown as PrismaTx;
const AHORA = new Date("2026-11-16T12:00:00.000Z");

const filaActual = (valor = "18,16,0", version = 1) => ({
  id: 15,
  valor,
  vigenciaInicio: new Date("2000-01-01T00:00:00.000Z"),
  vigenciaFin: new Date("2099-12-31T23:59:59.000Z"),
  version,
});

beforeEach(() => {
  jest.clearAllMocks();
  (leerTasaItbisConfigEnTx as jest.Mock).mockResolvedValue(filaActual());
});

describe("guardarTasasItbis", () => {
  it("refuses a list that fails the shared parser with TEN_TASA_ITBIS_INVALIDA", async () => {
    const r = await guardarTasasItbis(tx, ctx, "18,,16", AHORA);
    expect(!r.ok && r.code).toBe("TEN_TASA_ITBIS_INVALIDA");
    expect(registrarEventoAuditoriaEnTx).not.toHaveBeenCalled();
  });

  it("refuses a duplicate rate with TEN_TASA_ITBIS_INVALIDA", async () => {
    const r = await guardarTasasItbis(tx, ctx, "18,18,0", AHORA);
    expect(!r.ok && r.code).toBe("TEN_TASA_ITBIS_INVALIDA");
  });

  it("is a no-op (no write, no audit) when the set is unchanged", async () => {
    const r = await guardarTasasItbis(tx, ctx, "16,18,0", AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.cambioAplicado).toBe(false);
    expect(registrarEventoAuditoriaEnTx).not.toHaveBeenCalled();
  });

  it("closes the current row (version-checked) and opens the new one", async () => {
    (tx.configuracionEmpresa as unknown as Record<string, unknown>) = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 99 }),
      findFirst: jest.fn().mockResolvedValue(null),
    };
    const r = await guardarTasasItbis(tx, ctx, "18,16,0,7", AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.cambioAplicado).toBe(true);
    expect(r.data.valor).toBe("18,16,0,7");
    expect(tx.configuracionEmpresa.updateMany).toHaveBeenCalledWith({
      where: { id: 15, empresaId: 1, version: 1 },
      data: { vigenciaFin: AHORA, version: { increment: 1 } },
    });
    expect(tx.configuracionEmpresa.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          empresaId: 1,
          clave: "TASA_ITBIS",
          valor: "18,16,0,7",
          vigenciaInicio: AHORA,
        }),
      }),
    );
    expect(registrarEventoAuditoriaEnTx).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({
        accion: "ACTUALIZAR",
        entidad: "ConfiguracionEmpresa",
        sucursalId: null,
      }),
    );
  });

  it("distinguishes an authorization denial from a race (row unchanged)", async () => {
    (tx.configuracionEmpresa as unknown as Record<string, unknown>) = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ version: 1 }), // row still there, unchanged
      create: jest.fn(),
    };
    const r = await guardarTasasItbis(tx, ctx, "7", AHORA);
    expect(!r.ok && r.code).toBe("TEN_OPS_NO_AUTORIZADO");
    expect(tx.configuracionEmpresa.create).not.toHaveBeenCalled();
  });

  it("returns TEN_CONCURRENCIA_CONFLICTO when the version check loses the race", async () => {
    (tx.configuracionEmpresa as unknown as Record<string, unknown>) = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ version: 2 }), // someone else changed it
      create: jest.fn(),
      findFirst: jest.fn(),
    };
    const r = await guardarTasasItbis(tx, ctx, "7", AHORA);
    expect(!r.ok && r.code).toBe("TEN_CONCURRENCIA_CONFLICTO");
    expect(tx.configuracionEmpresa.create).not.toHaveBeenCalled();
    expect(registrarEventoAuditoriaEnTx).not.toHaveBeenCalled();
  });

  it("steps the new row's vigenciaInicio past an occupied instant", async () => {
    (tx.configuracionEmpresa as unknown as Record<string, unknown>) = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 99 }),
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ id: 50 }) // AHORA occupied
        .mockResolvedValue(null),
    };
    await guardarTasasItbis(tx, ctx, "7", AHORA);
    expect(tx.configuracionEmpresa.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vigenciaInicio: new Date(AHORA.getTime() + 1),
        }),
      }),
    );
  });

  it("handles an empresa with no TASA_ITBIS row yet (opens the first one)", async () => {
    (leerTasaItbisConfigEnTx as jest.Mock).mockResolvedValue(null);
    (tx.configuracionEmpresa as unknown as Record<string, unknown>) = {
      updateMany: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 99 }),
      findFirst: jest.fn().mockResolvedValue(null),
    };
    const r = await guardarTasasItbis(tx, ctx, "18,16,0", AHORA);
    expect(r.ok).toBe(true);
    expect(tx.configuracionEmpresa.updateMany).not.toHaveBeenCalled();
    expect(registrarEventoAuditoriaEnTx).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({ valorAnterior: null }),
    );
  });
});
