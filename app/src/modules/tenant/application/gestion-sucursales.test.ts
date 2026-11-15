import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_SUCURSAL_NOMBRE_DUPLICADO,
  messageFor,
} from "../domain/errors";
import { crearSucursal, editarSucursal } from "./gestion-sucursales";

jest.mock("../infrastructure/sucursal-gestion-repository", () => ({
  leerSucursalGestionableEnTx: jest.fn(),
  existeSucursalConNombreEnTx: jest.fn(),
  crearSucursalEnTx: jest.fn(),
  actualizarSucursalEnTx: jest.fn(),
  registrarAuditSucursalCreadaEnTx: jest.fn(),
  registrarAuditSucursalActualizadaEnTx: jest.fn(),
}));

import * as repo from "../infrastructure/sucursal-gestion-repository";

const m = {
  leer: repo.leerSucursalGestionableEnTx as jest.Mock,
  existe: repo.existeSucursalConNombreEnTx as jest.Mock,
  crear: repo.crearSucursalEnTx as jest.Mock,
  actualizar: repo.actualizarSucursalEnTx as jest.Mock,
  auditCrear: repo.registrarAuditSucursalCreadaEnTx as jest.Mock,
  auditActualizar: repo.registrarAuditSucursalActualizadaEnTx as jest.Mock,
};

const ctx: TenantCtx = { empresaId: 1, sucursalId: 5, usuarioId: 10, esAdmin: true };
const tx = {} as unknown as PrismaTx;

const SUCURSAL = {
  id: 7,
  nombre: "Norte",
  direccion: "Calle 1",
  telefono: "8095550000",
  activa: true,
  version: 3,
};

beforeEach(() => {
  jest.resetAllMocks();
  m.existe.mockResolvedValue(false);
  m.leer.mockResolvedValue(SUCURSAL);
});

describe("crearSucursal", () => {
  const input = { nombre: "  Sur ", direccion: " Calle 2 ", telefono: " 8295550000 " };

  it("creates with trimmed values, one CREAR audit and the new branch as data", async () => {
    const creada = { ...SUCURSAL, id: 8, nombre: "Sur", version: 1 };
    m.crear.mockResolvedValue({ tipo: "CREADA", sucursal: creada });

    const result = await crearSucursal(tx, ctx, input);

    expect(result).toEqual({ ok: true, data: creada });
    expect(m.existe).toHaveBeenCalledWith(tx, ctx.empresaId, "Sur", null);
    expect(m.crear).toHaveBeenCalledWith(tx, ctx, {
      nombre: "Sur",
      direccion: "Calle 2",
      telefono: "8295550000",
    });
    expect(m.auditCrear).toHaveBeenCalledTimes(1);
    expect(m.auditCrear).toHaveBeenCalledWith(tx, ctx, creada);
  });

  it("a name that already exists (any branch, inactive included) is refused: no insert, no audit", async () => {
    m.existe.mockResolvedValue(true);

    const result = await crearSucursal(tx, ctx, input);

    expect(result).toEqual({
      ok: false,
      code: TEN_SUCURSAL_NOMBRE_DUPLICADO,
      message: messageFor(TEN_SUCURSAL_NOMBRE_DUPLICADO),
    });
    expect(m.crear).not.toHaveBeenCalled();
    expect(m.auditCrear).not.toHaveBeenCalled();
  });

  it("a unique violation at insert time (concurrent create) maps to the same typed error, no audit", async () => {
    m.crear.mockResolvedValue({ tipo: "NOMBRE_DUPLICADO" });

    const result = await crearSucursal(tx, ctx, input);

    expect(result).toMatchObject({ ok: false, code: TEN_SUCURSAL_NOMBRE_DUPLICADO });
    expect(m.auditCrear).not.toHaveBeenCalled();
  });

  it("an insert refused by RLS maps to TEN_OPS_NO_AUTORIZADO, no audit", async () => {
    m.crear.mockResolvedValue({ tipo: "DENEGADA" });

    const result = await crearSucursal(tx, ctx, input);

    expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
    expect(m.auditCrear).not.toHaveBeenCalled();
  });

  it("the empresa comes from the session ctx", async () => {
    m.crear.mockResolvedValue({ tipo: "CREADA", sucursal: SUCURSAL });
    await crearSucursal(tx, { ...ctx, empresaId: 99 }, input);
    expect(m.existe).toHaveBeenCalledWith(tx, 99, "Sur", null);
    expect(m.crear.mock.calls[0]?.[1]).toMatchObject({ empresaId: 99 });
  });
});

describe("editarSucursal", () => {
  const base = {
    sucursalId: 7,
    nombre: "Norte",
    direccion: "Calle 1",
    telefono: "8095550000",
    versionEsperada: 3,
  };

  it("unknown or foreign branch => TEN_SUCURSAL_NO_VALIDA and nothing is written", async () => {
    m.leer.mockResolvedValue(null);

    const result = await editarSucursal(tx, ctx, base);

    expect(result).toEqual({
      ok: false,
      code: TEN_SUCURSAL_NO_VALIDA,
      message: messageFor(TEN_SUCURSAL_NO_VALIDA),
    });
    expect(m.leer).toHaveBeenCalledWith(tx, ctx.empresaId, 7);
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.auditActualizar).not.toHaveBeenCalled();
  });

  it("stale version conflicts BEFORE the no-op detection", async () => {
    const result = await editarSucursal(tx, ctx, { ...base, versionEsperada: 2 });

    expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.auditActualizar).not.toHaveBeenCalled();
  });

  it("identical values (after trim) = success no-op: no write, no version bump, no audit", async () => {
    const result = await editarSucursal(tx, ctx, { ...base, nombre: "  Norte " });

    expect(result).toEqual({ ok: true, data: { ...SUCURSAL, cambio: false } });
    expect(m.existe).not.toHaveBeenCalled();
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.auditActualizar).not.toHaveBeenCalled();
  });

  it("a real change: verified UPDATE with only the changed fields, version+1, ONE ACTUALIZAR audit with before/after", async () => {
    m.actualizar.mockResolvedValue({ tipo: "APLICADA", version: 4 });

    const result = await editarSucursal(tx, ctx, { ...base, telefono: "8295551111" });

    expect(result).toEqual({
      ok: true,
      data: { ...SUCURSAL, telefono: "8295551111", version: 4, cambio: true },
    });
    expect(m.existe).not.toHaveBeenCalled();
    expect(m.actualizar).toHaveBeenCalledWith(tx, ctx.empresaId, 7, 3, {
      telefono: "8295551111",
    });
    expect(m.auditActualizar).toHaveBeenCalledTimes(1);
    expect(m.auditActualizar).toHaveBeenCalledWith(
      tx,
      ctx,
      7,
      { telefono: "8095550000" },
      { telefono: "8295551111" },
    );
  });

  it("renaming to a name held by ANOTHER branch (probe excludes itself) is refused", async () => {
    m.existe.mockResolvedValue(true);

    const result = await editarSucursal(tx, ctx, { ...base, nombre: " Sur " });

    expect(result).toMatchObject({ ok: false, code: TEN_SUCURSAL_NOMBRE_DUPLICADO });
    expect(m.existe).toHaveBeenCalledWith(tx, ctx.empresaId, "Sur", 7);
    expect(m.actualizar).not.toHaveBeenCalled();
    expect(m.auditActualizar).not.toHaveBeenCalled();
  });

  it("renaming to its own name with another case is allowed without a duplicate probe", async () => {
    m.actualizar.mockResolvedValue({ tipo: "APLICADA", version: 4 });

    const result = await editarSucursal(tx, ctx, { ...base, nombre: "NORTE" });

    expect(result).toMatchObject({ ok: true, data: { nombre: "NORTE", cambio: true } });
    expect(m.existe).not.toHaveBeenCalled();
  });

  it("a unique violation at update time maps to the duplicate error, no audit", async () => {
    m.actualizar.mockResolvedValue({ tipo: "NOMBRE_DUPLICADO" });

    const result = await editarSucursal(tx, ctx, { ...base, nombre: "Sur" });

    expect(result).toMatchObject({ ok: false, code: TEN_SUCURSAL_NOMBRE_DUPLICADO });
    expect(m.auditActualizar).not.toHaveBeenCalled();
  });

  it("0 rows because a concurrent writer bumped the version => TEN_CONCURRENCIA_CONFLICTO, no audit", async () => {
    m.actualizar.mockResolvedValue({ tipo: "SIN_FILAS" });
    m.leer
      .mockResolvedValueOnce(SUCURSAL)
      .mockResolvedValueOnce({ ...SUCURSAL, version: 4 });

    const result = await editarSucursal(tx, ctx, { ...base, telefono: "1" });

    expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
    expect(m.auditActualizar).not.toHaveBeenCalled();
  });

  it("0 rows with the version unchanged (RLS filtered the row) => TEN_OPS_NO_AUTORIZADO, no audit", async () => {
    m.actualizar.mockResolvedValue({ tipo: "SIN_FILAS" });

    const result = await editarSucursal(tx, ctx, { ...base, telefono: "1" });

    expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
    expect(m.auditActualizar).not.toHaveBeenCalled();
  });

  it("an UPDATE refused by RLS with an error maps to TEN_OPS_NO_AUTORIZADO", async () => {
    m.actualizar.mockResolvedValue({ tipo: "DENEGADA" });

    const result = await editarSucursal(tx, ctx, { ...base, telefono: "1" });

    expect(result).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
    expect(m.auditActualizar).not.toHaveBeenCalled();
  });
});
