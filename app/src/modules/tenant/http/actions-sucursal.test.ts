/**
 * Branch-management Server Action unit tests (all collaborators mocked): the
 * thin-adapter contract — validation before the session, the Administrador-only
 * gate BEFORE any use case, deny-by-default, typed results forwarded.
 */

import { crearSucursalAction, editarSucursalAction } from "./actions.sucursal";
import { ROLES_GESTION_SUCURSALES } from "./shared";
import { crearSucursal, editarSucursal } from "../application/gestion-sucursales";
import { tieneRolPermitidoEnTx } from "../infrastructure/usuario-repository";
import { createClient } from "@/lib/supabase/client";
import { getCurrentTenantContext } from "@/modules/tenant/infrastructure/tenant-runtime";
import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/modules/tenant/infrastructure/tenant-runtime", () => ({
  getCurrentTenantContext: jest.fn(),
  getCurrentTenantHeader: jest.fn(),
}));
jest.mock("@/modules/tenant/infrastructure/withTenantTransaction", () => ({
  withTenantTransaction: jest.fn(
    (_ctx: unknown, fn: (t: unknown) => Promise<unknown>) => fn({}),
  ),
}));
jest.mock("../application/cambiarSucursalActiva", () => ({
  cambiarSucursalActiva: jest.fn(),
}));
jest.mock("../application/gestion-sucursales", () => ({
  crearSucursal: jest.fn(),
  editarSucursal: jest.fn(),
}));
jest.mock("../infrastructure/usuario-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

const ctx = { empresaId: 1, sucursalId: 5, usuarioId: 10, esAdmin: true };
const crearInput = { nombre: "Sur", direccion: "Calle 2", telefono: "8295550000" };
const editarInput = { ...crearInput, sucursalId: 7, versionEsperada: 3 };
const sucursal = { id: 7, ...crearInput, activa: true, version: 4 };

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(ctx);
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
  (crearSucursal as jest.Mock).mockResolvedValue({ ok: true, data: sucursal });
  (editarSucursal as jest.Mock).mockResolvedValue({
    ok: true,
    data: { ...sucursal, cambio: true },
  });
});

describe("ROLES_GESTION_SUCURSALES (S3)", () => {
  it("is the single write group: Administrador", () => {
    expect(ROLES_GESTION_SUCURSALES).toEqual(["Administrador"]);
  });
});

describe.each([
  ["crearSucursalAction", crearSucursalAction, crearSucursal, crearInput],
  ["editarSucursalAction", editarSucursalAction, editarSucursal, editarInput],
] as const)("%s", (_nombre, action, useCase, input) => {
  it.each([
    ["empty name", { nombre: "   " }],
    ["empty address", { direccion: "" }],
    ["empty phone", { telefono: " " }],
    ["name over 255", { nombre: "x".repeat(256) }],
    ["unknown extra key (empresaId)", { empresaId: 2 }],
  ])("rejects invalid input (%s) before touching the session", async (_caso, cambio) => {
    const result = await action({ ...input, ...cambio });
    expect(result).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.any(String) },
    });
    expect(getCurrentTenantContext).not.toHaveBeenCalled();
    expect(useCase).not.toHaveBeenCalled();
  });

  it("rejects a missing session with SESION_INVALIDA and no DB access", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);
    const result = await action(input);
    expect(result).toEqual({
      ok: false,
      error: { code: "SESION_INVALIDA", message: expect.any(String) },
    });
    expect(withTenantTransaction).not.toHaveBeenCalled();
    expect(useCase).not.toHaveBeenCalled();
  });

  it("a caller outside the role group => TEN_OPS_NO_AUTORIZADO and NO use case call", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
    const result = await action(input);
    expect(result).toEqual({
      ok: false,
      error: { code: "TEN_OPS_NO_AUTORIZADO", message: expect.any(String) },
    });
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_GESTION_SUCURSALES,
    );
    expect(useCase).not.toHaveBeenCalled();
  });

  it("trims the text fields and delegates to the use case with ctx", async () => {
    const result = await action({ ...input, nombre: "  Sur  " });
    expect(result.ok).toBe(true);
    expect(useCase).toHaveBeenCalledWith(expect.anything(), ctx, input);
  });

  it("forwards a business error with its stable code and message", async () => {
    (useCase as jest.Mock).mockResolvedValue({
      ok: false,
      code: "TEN_SUCURSAL_NOMBRE_DUPLICADO",
      message: "msg",
    });
    expect(await action(input)).toEqual({
      ok: false,
      error: { code: "TEN_SUCURSAL_NOMBRE_DUPLICADO", message: "msg" },
    });
  });
});

describe("crearSucursalAction / editarSucursalAction results", () => {
  it("create returns the new branch", async () => {
    expect(await crearSucursalAction(crearInput)).toEqual({ ok: true, data: sucursal });
  });

  it("edit returns the branch with the cambio flag", async () => {
    expect(await editarSucursalAction(editarInput)).toEqual({
      ok: true,
      data: { ...sucursal, cambio: true },
    });
  });

  it("edit rejects ids/versions that are not positive integers", async () => {
    for (const cambio of [{ sucursalId: 0 }, { versionEsperada: 1.5 }, { versionEsperada: "3" }]) {
      const result = await editarSucursalAction({ ...editarInput, ...cambio });
      expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    }
    expect(editarSucursal).not.toHaveBeenCalled();
  });
});
