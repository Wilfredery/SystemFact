import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "@/modules/tenant/domain/tenant";
import { cambiarSucursalActiva } from "./cambiarSucursalActiva";
import {
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  messageFor,
} from "../domain/errors";

jest.mock("../infrastructure/repo-sucursal", () => ({
  liberarSucursalActivaEnTx: jest.fn(),
  activarSucursalEnTx: jest.fn(),
  leerSucursalActivaEnTx: jest.fn(),
  reescribirSucursalUsuarioEnTx: jest.fn(),
}));

import {
  activarSucursalEnTx,
  liberarSucursalActivaEnTx,
  leerSucursalActivaEnTx,
  reescribirSucursalUsuarioEnTx,
} from "../infrastructure/repo-sucursal";

const ctx: TenantCtx = {
  empresaId: 1,
  sucursalId: 100,
  usuarioId: 7,
  esAdmin: true,
};

const ports = {
  liberar: liberarSucursalActivaEnTx as jest.Mock,
  activar: activarSucursalEnTx as jest.Mock,
  leer: leerSucursalActivaEnTx as jest.Mock,
  reescribir: reescribirSucursalUsuarioEnTx as jest.Mock,
};

function makeTx(): PrismaTx {
  return {} as unknown as PrismaTx;
}

describe("cambiarSucursalActiva", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("TEN-SWITCH-04-C: non-admin denied before any read or write", async () => {
    const result = await cambiarSucursalActiva(
      { ...ctx, esAdmin: false },
      { sucursalId: 101 },
      makeTx(),
    );

    expect(result).toEqual({
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
      message: messageFor(TEN_OPS_NO_AUTORIZADO),
    });
    expect(ports.leer).not.toHaveBeenCalled();
    expect(ports.reescribir).not.toHaveBeenCalled();
  });

  it("TEN-SWITCH-04-E: re-confirming the current branch is a no-op success — no write, no read", async () => {
    const result = await cambiarSucursalActiva(
      ctx,
      { sucursalId: ctx.sucursalId },
      makeTx(),
    );

    expect(result).toEqual({ ok: true });
    expect(ports.leer).not.toHaveBeenCalled();
    expect(ports.reescribir).not.toHaveBeenCalled();
  });

  it("TEN-SWITCH-04-B/D: foreign-empresa AND inactive targets share ONE stable code", async () => {
    ports.leer.mockResolvedValue(null);

    const result = await cambiarSucursalActiva(ctx, { sucursalId: 999 }, makeTx());

    expect(result).toEqual({
      ok: false,
      code: TEN_SUCURSAL_NO_VALIDA,
      message: messageFor(TEN_SUCURSAL_NO_VALIDA),
    });
    expect(ports.reescribir).not.toHaveBeenCalled();
  });

  it("TEN-SWITCH-04-A: happy path validates target then rewrites Usuario.sucursalId (version++, D1)", async () => {
    ports.leer.mockResolvedValue({ id: 101 });
    const tx = makeTx();

    const result = await cambiarSucursalActiva(ctx, { sucursalId: 101 }, tx);

    expect(result).toEqual({ ok: true });
    expect(ports.leer).toHaveBeenCalledWith(tx, ctx.empresaId, 101);
    // One row, one rewrite; the version bump lives INSIDE the port.
    expect(ports.reescribir).toHaveBeenCalledTimes(1);
    expect(ports.reescribir).toHaveBeenCalledWith(tx, ctx.usuarioId, 101);
  });

  it("TEN-SWITCH-04-A: GUC blank → rewrite → re-pin target, all inside the wrapper's tx", async () => {
    ports.leer.mockResolvedValue({ id: 101 });
    const tx = makeTx();

    await cambiarSucursalActiva(ctx, { sucursalId: 101 }, tx);

    const order = [
      ports.liberar.mock.invocationCallOrder[0],
      ports.reescribir.mock.invocationCallOrder[0],
      ports.activar.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(ports.activar).toHaveBeenCalledWith(tx, 101);
  });

  it("the switch path performs ZERO audit writes (no auditoria port referenced)", async () => {
    // Contract guard: the use case source must not reference the auditoria
    // write port — the branch change is NOT re-authentication (REQ-AUTH-AUD-001).
    const source = readFileSync(
      path.join(__dirname, "cambiarSucursalActiva.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/auditoria|registrarEvento/i);
  });
});
