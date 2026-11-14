/**
 * Administración Server Action unit tests (all collaborators mocked).
 *
 * Proves the thin-adapter contract without a DB: validation, session
 * resolution, the named-role gate (S3) enforced SERVER-SIDE with no use-case
 * call on denial, deny-by-default permission probing, and faithful pass-through
 * of the existing `listarSucursalesDeEmpresa` use case. Mocking keeps the
 * generated Prisma client out of this suite.
 */

import {
  consultarConfiguracionAction,
  listarSucursalesDeEmpresaAction,
  listarUsuariosAction,
  obtenerPermisosAdministracionAction,
} from "./actions.administracion";
import { ROLES_VER_ADMINISTRACION } from "./shared";
import { listarUsuarios } from "../application/listar-usuarios";
import { consultarConfiguracion } from "../application/consultar-configuracion";
import { consultarRolesCatalogo } from "../application/consultar-roles-catalogo";
import { listarSucursalesDeEmpresa } from "../application/listarSucursalesDeEmpresa";
import { tieneRolPermitidoEnTx } from "../infrastructure/usuario-repository";
import { createClient } from "@/lib/supabase/client";
import {
  getCurrentTenantContext,
  getCurrentTenantHeader,
} from "@/modules/tenant/infrastructure/tenant-runtime";

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
jest.mock("../application/listar-usuarios", () => ({ listarUsuarios: jest.fn() }));
jest.mock("../application/consultar-roles-catalogo", () => ({
  consultarRolesCatalogo: jest.fn(),
}));
jest.mock("../application/consultar-configuracion", () => ({
  consultarConfiguracion: jest.fn(),
}));
jest.mock("../application/listarSucursalesDeEmpresa", () => ({
  listarSucursalesDeEmpresa: jest.fn(),
}));
jest.mock("../infrastructure/usuario-repository", () => ({
  tieneRolPermitidoEnTx: jest.fn(),
}));

const ctx = { empresaId: 1, sucursalId: 1, usuarioId: 1, esAdmin: false };
const headerCtx = {
  ...ctx,
  empresaNombre: "SystemFact Demo",
  sucursalNombre: "Matriz",
};

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockResolvedValue({});
  (getCurrentTenantContext as jest.Mock).mockResolvedValue(ctx);
  (getCurrentTenantHeader as jest.Mock).mockResolvedValue(headerCtx);
  (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(false);
  (consultarRolesCatalogo as jest.Mock).mockResolvedValue({ ok: true, data: [] });
});

describe("ROLES_VER_ADMINISTRACION (S3)", () => {
  it("is the read-only build's single view group: Administrador", () => {
    expect(ROLES_VER_ADMINISTRACION).toEqual(["Administrador"]);
  });
});

describe("listarUsuariosAction", () => {
  it("rejects invalid input before touching the session", async () => {
    const result = await listarUsuariosAction({ activo: "sí" });

    expect(result).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.any(String) },
    });
    expect(getCurrentTenantHeader).not.toHaveBeenCalled();
  });

  it("rejects when the session is missing", async () => {
    (getCurrentTenantHeader as jest.Mock).mockResolvedValue(null);

    const result = await listarUsuariosAction({});

    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
  });

  it("denies a NON-admin server-side with NO use-case call (S3 deny-by-default)", async () => {
    const result = await listarUsuariosAction({});

    expect(result.ok === false && result.error.code).toBe("TEN_OPS_NO_AUTORIZADO");
    expect(tieneRolPermitidoEnTx).toHaveBeenCalledWith(
      expect.anything(),
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_ADMINISTRACION,
    );
    expect(listarUsuarios).not.toHaveBeenCalled();
    expect(consultarRolesCatalogo).not.toHaveBeenCalled();
  });

  it("returns rows carrying the empresa name from the session header seam", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarUsuarios as jest.Mock).mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: 7,
            nombreUsuario: "maria",
            nombre: "María Pérez",
            activo: true,
            version: 3,
            sucursalNombre: "Matriz",
            roles: ["Administrador"],
            rolIds: [1],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    });
    (consultarRolesCatalogo as jest.Mock).mockResolvedValue({
      ok: true,
      data: [
        { id: 1, nombre: "Administrador" },
        { id: 2, nombre: "Operador" },
      ],
    });

    const result = await listarUsuariosAction({ buscar: "maria" });

    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            id: 7,
            nombreUsuario: "maria",
            nombre: "María Pérez",
            activo: true,
            version: 3,
            sucursalNombre: "Matriz",
            empresaNombre: "SystemFact Demo",
            roles: ["Administrador"],
            rolIds: [1],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        rolesCatalogo: [
          { id: 1, nombre: "Administrador" },
          { id: 2, nombre: "Operador" },
        ],
      },
    });
  });

  it("forwards the parsed query to the use case", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (listarUsuarios as jest.Mock).mockResolvedValue({
      ok: true,
      data: { items: [], total: 0, page: 2, pageSize: 50 },
    });

    await listarUsuariosAction({ page: "2", pageSize: "50", activo: "false" });

    expect(listarUsuarios).toHaveBeenCalledWith(expect.anything(), headerCtx, {
      page: 2,
      pageSize: 50,
      activo: false,
    });
  });
});

describe("obtenerPermisosAdministracionAction", () => {
  it("answers false for a non-admin (deny by default)", async () => {
    const result = await obtenerPermisosAdministracionAction();

    expect(result).toEqual({ ok: true, data: { puedeVer: false } });
  });

  it("answers true for an admin", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);

    const result = await obtenerPermisosAdministracionAction();

    expect(result).toEqual({ ok: true, data: { puedeVer: true } });
  });

  it("fails closed with SESION_INVALIDA when there is no session", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await obtenerPermisosAdministracionAction();

    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
  });
});

describe("listarSucursalesDeEmpresaAction", () => {
  it("delegates to the existing use case and returns its branches", async () => {
    (listarSucursalesDeEmpresa as jest.Mock).mockResolvedValue({
      ok: true,
      sucursales: [{ id: 10, nombre: "Matriz" }],
    });

    const result = await listarSucursalesDeEmpresaAction();

    expect(result).toEqual({ ok: true, data: [{ id: 10, nombre: "Matriz" }] });
    expect(listarSucursalesDeEmpresa).toHaveBeenCalledWith(ctx, {});
  });

  it("forwards the use case's admin-only denial (TEN_OPS_NO_AUTORIZADO)", async () => {
    (listarSucursalesDeEmpresa as jest.Mock).mockResolvedValue({
      ok: false,
      code: "TEN_OPS_NO_AUTORIZADO",
      message: "No tienes permiso para esta operación.",
    });

    const result = await listarSucursalesDeEmpresaAction();

    expect(result).toEqual({
      ok: false,
      error: {
        code: "TEN_OPS_NO_AUTORIZADO",
        message: "No tienes permiso para esta operación.",
      },
    });
  });

  it("fails closed with SESION_INVALIDA when there is no session", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await listarSucursalesDeEmpresaAction();

    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
  });
});

describe("consultarConfiguracionAction", () => {
  it("denies a NON-admin server-side with NO use-case call", async () => {
    const result = await consultarConfiguracionAction();

    expect(result.ok === false && result.error.code).toBe("TEN_OPS_NO_AUTORIZADO");
    expect(consultarConfiguracion).not.toHaveBeenCalled();
  });

  it("returns the read-only configuration for an admin", async () => {
    (tieneRolPermitidoEnTx as jest.Mock).mockResolvedValue(true);
    (consultarConfiguracion as jest.Mock).mockResolvedValue({
      ok: true,
      data: { retenciones: null, ncf: [] },
    });

    const result = await consultarConfiguracionAction();

    expect(result).toEqual({ ok: true, data: { retenciones: null, ncf: [] } });
    expect(consultarConfiguracion).toHaveBeenCalledWith({}, ctx.empresaId);
  });

  it("fails closed with SESION_INVALIDA when there is no session", async () => {
    (getCurrentTenantContext as jest.Mock).mockResolvedValue(null);

    const result = await consultarConfiguracionAction();

    expect(result.ok === false && result.error.code).toBe("SESION_INVALIDA");
  });
});
