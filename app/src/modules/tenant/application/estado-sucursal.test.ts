import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
  TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
  TEN_SUCURSAL_CON_STOCK,
  TEN_SUCURSAL_CON_USUARIOS,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
  TEN_SUCURSAL_ULTIMA_ACTIVA,
  messageFor,
} from "../domain/errors";
import { cambiarEstadoSucursal } from "./estado-sucursal";

jest.mock("../infrastructure/sucursal-gestion-repository", () => ({
  bloquearSucursalEnTx: jest.fn(),
  leerSucursalGestionableEnTx: jest.fn(),
  contarSucursalesActivasEnTx: jest.fn(),
  contarBloqueosSucursalEnTx: jest.fn(),
  actualizarSucursalEnTx: jest.fn(),
  registrarAuditSucursalActualizadaEnTx: jest.fn(),
}));
jest.mock("../infrastructure/repo-sucursal", () => ({
  liberarSucursalActivaEnTx: jest.fn(),
  activarSucursalEnTx: jest.fn(),
}));

import * as repo from "../infrastructure/sucursal-gestion-repository";
import * as repoSucursal from "../infrastructure/repo-sucursal";

const m = {
  bloquear: repo.bloquearSucursalEnTx as jest.Mock,
  leer: repo.leerSucursalGestionableEnTx as jest.Mock,
  activas: repo.contarSucursalesActivasEnTx as jest.Mock,
  conteos: repo.contarBloqueosSucursalEnTx as jest.Mock,
  actualizar: repo.actualizarSucursalEnTx as jest.Mock,
  audit: repo.registrarAuditSucursalActualizadaEnTx as jest.Mock,
  liberar: repoSucursal.liberarSucursalActivaEnTx as jest.Mock,
  pinar: repoSucursal.activarSucursalEnTx as jest.Mock,
};

const ctx: TenantCtx = { empresaId: 1, sucursalId: 5, usuarioId: 10, esAdmin: true };
const tx = {} as unknown as PrismaTx;
const LIBRE = { usuarios: 0, stock: 0, documentosAbiertos: 0, saldos: 0 };

const ACTIVA = {
  id: 7,
  nombre: "Norte",
  direccion: "Calle 1",
  telefono: "8095550000",
  activa: true,
  version: 3,
};
const INACTIVA = { ...ACTIVA, activa: false };

const desactivar = { sucursalId: 7, activa: false, versionEsperada: 3 };
const activar = { sucursalId: 7, activa: true, versionEsperada: 3 };

let orden: string[];

beforeEach(() => {
  jest.resetAllMocks();
  orden = [];
  m.bloquear.mockImplementation(async () => {
    orden.push("bloquear");
    return true;
  });
  m.leer.mockImplementation(async () => {
    orden.push("leer");
    return ACTIVA;
  });
  m.activas.mockResolvedValue(3);
  m.conteos.mockImplementation(async () => {
    orden.push("conteos");
    return LIBRE;
  });
  m.liberar.mockImplementation(async () => {
    orden.push("liberar");
  });
  m.pinar.mockImplementation(async () => {
    orden.push("pinar");
  });
  m.actualizar.mockImplementation(async () => {
    orden.push("actualizar");
    return { tipo: "APLICADA", version: 4 };
  });
});

describe("cambiarEstadoSucursal — deactivation", () => {
  it("locks FIRST, then reads, counts under the widen (restored), updates and audits ONCE", async () => {
    const result = await cambiarEstadoSucursal(tx, ctx, desactivar);

    expect(result).toEqual({
      ok: true,
      data: { sucursalId: 7, activa: false, version: 4, cambio: true },
    });
    expect(orden).toEqual([
      "bloquear",
      "leer",
      "liberar",
      "conteos",
      "pinar",
      "actualizar",
    ]);
    expect(m.bloquear).toHaveBeenCalledWith(tx, ctx.empresaId, 7);
    expect(m.conteos).toHaveBeenCalledWith(tx, ctx, 7);
    expect(m.pinar).toHaveBeenCalledWith(tx, ctx.sucursalId);
    expect(m.actualizar).toHaveBeenCalledWith(tx, ctx.empresaId, 7, 3, { activa: false });
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledWith(tx, ctx, 7, { activa: true }, { activa: false });
  });

  it("the branch GUC is restored even when a count throws, and the error propagates", async () => {
    m.conteos.mockRejectedValue(new Error("boom"));

    await expect(cambiarEstadoSucursal(tx, ctx, desactivar)).rejects.toThrow("boom");

    expect(m.pinar).toHaveBeenCalledWith(tx, ctx.sucursalId);
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("every blocker alone refuses with ITS code and the counts; nothing is written", async () => {
    const casos = [
      [{ usuarios: 3 }, TEN_SUCURSAL_CON_USUARIOS],
      [{ stock: 12 }, TEN_SUCURSAL_CON_STOCK],
      [{ documentosAbiertos: 1 }, TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS],
      [{ saldos: 2 }, TEN_SUCURSAL_CON_SALDOS_PENDIENTES],
    ] as const;
    for (const [conteo, code] of casos) {
      m.conteos.mockResolvedValue({ ...LIBRE, ...conteo });
      const result = await cambiarEstadoSucursal(tx, ctx, desactivar);
      expect(result).toEqual({
        ok: false,
        code,
        message: messageFor(code),
        detalle: { ...LIBRE, ...conteo, codigos: [code] },
      });
    }
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("all blockers are reported together, primary code first", async () => {
    m.conteos.mockResolvedValue({ usuarios: 3, stock: 12, documentosAbiertos: 1, saldos: 2 });

    const result = await cambiarEstadoSucursal(tx, ctx, desactivar);

    expect(result).toEqual({
      ok: false,
      code: TEN_SUCURSAL_CON_USUARIOS,
      message: messageFor(TEN_SUCURSAL_CON_USUARIOS),
      detalle: {
        usuarios: 3,
        stock: 12,
        documentosAbiertos: 1,
        saldos: 2,
        codigos: [
          TEN_SUCURSAL_CON_USUARIOS,
          TEN_SUCURSAL_CON_STOCK,
          TEN_SUCURSAL_CON_DOCUMENTOS_ABIERTOS,
          TEN_SUCURSAL_CON_SALDOS_PENDIENTES,
        ],
      },
    });
  });

  it("the session's own branch has its own code", async () => {
    const result = await cambiarEstadoSucursal(tx, { ...ctx, sucursalId: 7 }, desactivar);

    expect(result).toMatchObject({
      ok: false,
      code: TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE,
      detalle: { codigos: [TEN_SUCURSAL_PROPIA_NO_DESACTIVABLE] },
    });
    expect(m.actualizar).not.toHaveBeenCalled();
  });

  it("the last active branch has its own code", async () => {
    m.activas.mockResolvedValue(1);

    const result = await cambiarEstadoSucursal(tx, ctx, desactivar);

    expect(result).toMatchObject({
      ok: false,
      code: TEN_SUCURSAL_ULTIMA_ACTIVA,
      message: messageFor(TEN_SUCURSAL_ULTIMA_ACTIVA),
    });
  });

  it("an already inactive branch is the idempotent no-op: no counts, no widen, no write, no audit", async () => {
    m.leer.mockResolvedValue(INACTIVA);

    const result = await cambiarEstadoSucursal(tx, ctx, desactivar);

    expect(result).toEqual({
      ok: true,
      data: { sucursalId: 7, activa: false, version: 3, cambio: false },
    });
    expect(m.conteos).not.toHaveBeenCalled();
    expect(m.liberar).not.toHaveBeenCalled();
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("cambiarEstadoSucursal — reactivation", () => {
  it("has no conditions: no counts, no widen, version-checked update and ONE audit", async () => {
    m.leer.mockResolvedValue(INACTIVA);

    const ctxEnLaInactiva = { ...ctx, sucursalId: 7 };
    const result = await cambiarEstadoSucursal(tx, ctxEnLaInactiva, activar);

    expect(result).toEqual({
      ok: true,
      data: { sucursalId: 7, activa: true, version: 4, cambio: true },
    });
    expect(m.conteos).not.toHaveBeenCalled();
    expect(m.liberar).not.toHaveBeenCalled();
    expect(m.actualizar).toHaveBeenCalledWith(tx, ctx.empresaId, 7, 3, { activa: true });
    expect(m.audit).toHaveBeenCalledWith(
      tx,
      ctxEnLaInactiva,
      7,
      { activa: false },
      { activa: true },
    );
  });

  it("an already active branch asked to activate is a no-op", async () => {
    const result = await cambiarEstadoSucursal(tx, ctx, activar);

    expect(result).toMatchObject({ ok: true, data: { cambio: false, version: 3 } });
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});

describe("cambiarEstadoSucursal — guards", () => {
  it("unknown/foreign branch: lock empty and nothing readable -> TEN_SUCURSAL_NO_VALIDA", async () => {
    m.bloquear.mockResolvedValue(false);
    m.leer.mockResolvedValue(null);

    const result = await cambiarEstadoSucursal(tx, ctx, desactivar);

    expect(result).toEqual({
      ok: false,
      code: TEN_SUCURSAL_NO_VALIDA,
      message: messageFor(TEN_SUCURSAL_NO_VALIDA),
    });
    expect(m.conteos).not.toHaveBeenCalled();
  });

  it("lock empty but the row is readable (RLS filtered the lock: not an admin) -> TEN_OPS_NO_AUTORIZADO", async () => {
    m.bloquear.mockResolvedValue(false);

    const result = await cambiarEstadoSucursal(tx, ctx, desactivar);

    expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
    expect(m.conteos).not.toHaveBeenCalled();
    expect(m.actualizar).not.toHaveBeenCalled();
  });

  it("a stale version ALWAYS conflicts, even when the state is already in place; no counts, no write", async () => {
    m.leer.mockResolvedValue({ ...INACTIVA, version: 4 });

    const result = await cambiarEstadoSucursal(tx, ctx, desactivar);

    expect(result).toEqual({
      ok: false,
      code: TEN_CONCURRENCIA_CONFLICTO,
      message: messageFor(TEN_CONCURRENCIA_CONFLICTO),
    });
    expect(m.conteos).not.toHaveBeenCalled();
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("an RLS-refused write maps to TEN_OPS_NO_AUTORIZADO with no audit", async () => {
    m.actualizar.mockResolvedValue({ tipo: "DENEGADA" });

    const result = await cambiarEstadoSucursal(tx, ctx, desactivar);

    expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("0 rows updated: same version afterwards = RLS filtered it; moved version = conflict; no audit", async () => {
    m.actualizar.mockResolvedValue({ tipo: "SIN_FILAS" });

    m.leer.mockResolvedValueOnce(ACTIVA).mockResolvedValueOnce(ACTIVA);
    expect(await cambiarEstadoSucursal(tx, ctx, desactivar)).toMatchObject({
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
    });

    m.leer.mockResolvedValueOnce(ACTIVA).mockResolvedValueOnce({ ...ACTIVA, version: 9 });
    expect(await cambiarEstadoSucursal(tx, ctx, desactivar)).toMatchObject({
      ok: false,
      code: TEN_CONCURRENCIA_CONFLICTO,
    });
    expect(m.audit).not.toHaveBeenCalled();
  });
});
