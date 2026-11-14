/**
 * User-management Server Action unit tests (all collaborators mocked).
 * Proves the thin-adapter contract: validation before the session, the named
 * role gate (S3) BEFORE any use case on the server, deny-by-default, and typed
 * results forwarded without Prisma errors or stack traces.
 */

import { cambiarEstadoUsuarioAction, cambiarRolesUsuarioAction } from "./actions.usuarios";
import { ROLES_GESTION_USUARIOS } from "./shared";
import { cambiarEstadoUsuario, cambiarRolesUsuario } from "../application/gestion-usuarios";
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
jest.mock("../application/gestion-usuarios", () => ({
  cambiarRolesUsuario: jest.fn(),
  cambiarEstadoUsuario: jest.fn(),
}));
jest.mock("../infrastructure/usuario-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

const ctx = { empresaId: 1, sucursalId: 5, usuarioId: 10, esAdmin: true };
const rolesInput = { usuarioId: 20, rolIds: [1, 2], versionEsperada: 3 };
const estadoInput = { usuarioId: 20, activo: false, versionEsperada: 3 };
const exito = { ok: true, data: { usuarioId: 20, version: 4, cambio: true } };

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(ctx);
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
  (cambiarRolesUsuario as jest.Mock).mockResolvedValue(exito);
  (cambiarEstadoUsuario as jest.Mock).mockResolvedValue(exito);
});

describe("ROLES_GESTION_USUARIOS (S3)", () => {
  it("is the single write group: Administrador", () => {
    expect(ROLES_GESTION_USUARIOS).toEqual(["Administrador"]);
  });
});

describe.each([
  ["cambiarRolesUsuarioAction", cambiarRolesUsuarioAction, cambiarRolesUsuario, rolesInput],
  ["cambiarEstadoUsuarioAction", cambiarEstadoUsuarioAction, cambiarEstadoUsuario, estadoInput],
] as const)("%s", (_nombre, action, useCase, input) => {
  it("rejects invalid input before touching the session", async () => {
    const result = await action({ ...input, usuarioId: -1 });
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

  it.each(["Operador", "Despachador"])(
    "%s (role group not satisfied) => TEN_OPS_NO_AUTORIZADO and NO use case call",
    async () => {
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
        ROLES_GESTION_USUARIOS,
      );
      expect(useCase).not.toHaveBeenCalled();
    },
  );

  it("delegates to the use case with the ctx, the parsed input and the role group", async () => {
    const result = await action(input);
    expect(result).toEqual({ ok: true, data: { usuarioId: 20, version: 4, cambio: true } });
    expect(useCase).toHaveBeenCalledWith(expect.anything(), ctx, input, ROLES_GESTION_USUARIOS);
  });

  it("forwards a business error with its stable code and message", async () => {
    (useCase as jest.Mock).mockResolvedValue({
      ok: false,
      code: "TEN_ULTIMO_ADMINISTRADOR",
      message: "msg",
    });
    expect(await action(input)).toEqual({
      ok: false,
      error: { code: "TEN_ULTIMO_ADMINISTRADOR", message: "msg" },
    });
  });
});
