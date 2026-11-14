import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_AUTO_PROTECCION,
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_ROL_NO_VALIDO,
  TEN_ULTIMO_ADMINISTRADOR,
  TEN_USUARIO_NO_ENCONTRADO,
  messageFor,
} from "../domain/errors";
import { cambiarEstadoUsuario, cambiarRolesUsuario } from "./gestion-usuarios";

jest.mock("../infrastructure/usuario-gestion-repository", () => ({
  bloquearUsuarioYAdministradoresEnTx: jest.fn(),
  leerUsuarioGestionableEnTx: jest.fn(),
  contarAdministradoresActivosEnTx: jest.fn(),
  leerRolesActivosPorIdEnTx: jest.fn(),
  aplicarCambioUsuarioEnTx: jest.fn(),
  reemplazarRolesEnTx: jest.fn(),
  registrarAuditUsuarioEnTx: jest.fn(),
}));

import * as repo from "../infrastructure/usuario-gestion-repository";

const m = {
  bloquear: repo.bloquearUsuarioYAdministradoresEnTx as jest.Mock,
  leer: repo.leerUsuarioGestionableEnTx as jest.Mock,
  contar: repo.contarAdministradoresActivosEnTx as jest.Mock,
  roles: repo.leerRolesActivosPorIdEnTx as jest.Mock,
  aplicar: repo.aplicarCambioUsuarioEnTx as jest.Mock,
  reemplazar: repo.reemplazarRolesEnTx as jest.Mock,
  audit: repo.registrarAuditUsuarioEnTx as jest.Mock,
};

const ctx: TenantCtx = { empresaId: 1, sucursalId: 5, usuarioId: 10, esAdmin: true };
const tx = {} as unknown as PrismaTx;
const GRUPO = ["Administrador"];
const ADMIN = { id: 1, nombre: "Administrador" };
const OPER = { id: 2, nombre: "Operador" };

function objetivo(over: Partial<{ id: number; activo: boolean; version: number; roles: unknown[] }> = {}) {
  return { id: 20, activo: true, version: 3, roles: [OPER], ...over };
}

const ACTOR = { id: 10, activo: true, version: 9, roles: [ADMIN] };

/** Target served for its id; the acting administrator (ctx.usuarioId) for theirs. */
function usarObjetivo(o: ReturnType<typeof objetivo> | null): void {
  m.leer.mockImplementation(async (_tx: unknown, _e: number, id: number) => {
    if (o !== null && id === o.id) return o;
    return id === ACTOR.id ? ACTOR : null;
  });
}

function sinEscrituras(): void {
  expect(m.aplicar).not.toHaveBeenCalled();
  expect(m.reemplazar).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.resetAllMocks();
  usarObjetivo(objetivo());
  m.contar.mockResolvedValue(2);
  m.roles.mockImplementation(async (_tx: unknown, ids: number[]) =>
    [ADMIN, OPER].filter((rol) => ids.includes(rol.id)),
  );
  m.aplicar.mockResolvedValue({ aplicado: true, version: 4 });
});

describe("cambiarRolesUsuario", () => {
  const input = { usuarioId: 20, rolIds: [1, 2], versionEsperada: 3 };

  it("locks first, then replaces roles, bumps the version and audits ONCE with before/after", async () => {
    const result = await cambiarRolesUsuario(tx, ctx, input, GRUPO);

    expect(result).toEqual({ ok: true, data: { usuarioId: 20, version: 4, cambio: true } });
    expect(m.bloquear).toHaveBeenCalledWith(tx, ctx, 20, GRUPO);
    expect(m.bloquear.mock.invocationCallOrder[0]).toBeLessThan(m.leer.mock.invocationCallOrder[0]);
    expect(m.aplicar).toHaveBeenCalledWith(tx, 1, 20, 3, {});
    expect(m.reemplazar).toHaveBeenCalledWith(tx, 20, [1, 2]);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledWith(
      tx,
      ctx,
      20,
      { roles: ["Operador"] },
      { roles: ["Administrador", "Operador"] },
    );
  });

  it("unknown / foreign / other-branch target => TEN_USUARIO_NO_ENCONTRADO, no write", async () => {
    usarObjetivo(null);
    expect(await cambiarRolesUsuario(tx, ctx, input, GRUPO)).toEqual({
      ok: false,
      code: TEN_USUARIO_NO_ENCONTRADO,
      message: messageFor(TEN_USUARIO_NO_ENCONTRADO),
    });
    sinEscrituras();
  });

  it("stale version => TEN_CONCURRENCIA_CONFLICTO, no write", async () => {
    const result = await cambiarRolesUsuario(tx, ctx, { ...input, versionEsperada: 2 }, GRUPO);
    expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
    sinEscrituras();
  });

  it("stale version with an already-satisfied target set STILL conflicts (strict rule)", async () => {
    usarObjetivo(objetivo({ roles: [ADMIN, OPER] }));
    const result = await cambiarRolesUsuario(tx, ctx, { ...input, versionEsperada: 1 }, GRUPO);
    expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
    sinEscrituras();
  });

  it("the verified UPDATE matching 0 rows (lost race) => conflict, roles untouched, no audit", async () => {
    m.aplicar.mockResolvedValue({ aplicado: false, version: 3 });
    const result = await cambiarRolesUsuario(tx, ctx, input, GRUPO);
    expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
    expect(m.reemplazar).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", []],
    ["duplicate", [2, 2]],
    ["unknown/inactive id", [1, 99]],
  ])("%s role list => TEN_ROL_NO_VALIDO, no write", async (_n, rolIds) => {
    const result = await cambiarRolesUsuario(tx, ctx, { ...input, rolIds }, GRUPO);
    expect(result).toMatchObject({ ok: false, code: TEN_ROL_NO_VALIDO });
    sinEscrituras();
  });

  it("same set => ok no-op: version unchanged, no write, no audit (S4 idempotent)", async () => {
    const result = await cambiarRolesUsuario(tx, ctx, { ...input, rolIds: [2] }, GRUPO);
    expect(result).toEqual({ ok: true, data: { usuarioId: 20, version: 3, cambio: false } });
    sinEscrituras();
  });

  it("self-demotion => TEN_AUTO_PROTECCION, no write", async () => {
    usarObjetivo(objetivo({ id: 10, roles: [ADMIN] }));
    const result = await cambiarRolesUsuario(
      tx,
      ctx,
      { usuarioId: 10, rolIds: [2], versionEsperada: 3 },
      GRUPO,
    );
    expect(result).toMatchObject({ ok: false, code: TEN_AUTO_PROTECCION });
    sinEscrituras();
  });

  it("last active Administrador => TEN_ULTIMO_ADMINISTRADOR, no write", async () => {
    usarObjetivo(objetivo({ roles: [ADMIN] }));
    m.contar.mockResolvedValue(1);
    const result = await cambiarRolesUsuario(tx, ctx, { ...input, rolIds: [2] }, GRUPO);
    expect(result).toMatchObject({ ok: false, code: TEN_ULTIMO_ADMINISTRADOR });
    sinEscrituras();
  });
});

describe("actor re-check under the lock (TOCTOU: demoted/deactivated mid-flight)", () => {
  it.each([
    ["demoted", { ...ACTOR, roles: [OPER] }],
    ["deactivated", { ...ACTOR, activo: false }],
  ])("an actor that is no longer an active Administrador (%s) => TEN_OPS_NO_AUTORIZADO, no write", async (_n, actor) => {
    m.leer.mockImplementation(async (_tx: unknown, _e: number, id: number) =>
      id === ACTOR.id ? actor : objetivo(),
    );
    const roles = await cambiarRolesUsuario(tx, ctx, { usuarioId: 20, rolIds: [1], versionEsperada: 3 }, GRUPO);
    expect(roles).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
    const estado = await cambiarEstadoUsuario(tx, ctx, { usuarioId: 20, activo: false, versionEsperada: 3 }, GRUPO);
    expect(estado).toMatchObject({ ok: false, code: TEN_OPS_NO_AUTORIZADO });
    sinEscrituras();
  });
});

describe("cambiarEstadoUsuario", () => {
  const input = { usuarioId: 20, activo: false, versionEsperada: 3 };

  it("flips activo, bumps version and audits ONCE with before/after estado", async () => {
    const result = await cambiarEstadoUsuario(tx, ctx, input, GRUPO);
    expect(result).toEqual({ ok: true, data: { usuarioId: 20, version: 4, cambio: true } });
    expect(m.aplicar).toHaveBeenCalledWith(tx, 1, 20, 3, { activo: false });
    expect(m.reemplazar).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledWith(tx, ctx, 20, { activo: true }, { activo: false });
  });

  it("unknown target => TEN_USUARIO_NO_ENCONTRADO", async () => {
    usarObjetivo(null);
    expect(await cambiarEstadoUsuario(tx, ctx, input, GRUPO)).toMatchObject({
      ok: false,
      code: TEN_USUARIO_NO_ENCONTRADO,
    });
    sinEscrituras();
  });

  it("stale version => conflict, even when the state is already satisfied", async () => {
    usarObjetivo(objetivo({ activo: false }));
    const result = await cambiarEstadoUsuario(tx, ctx, { ...input, versionEsperada: 1 }, GRUPO);
    expect(result).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
    sinEscrituras();
  });

  it("verified UPDATE matching 0 rows => conflict, no audit", async () => {
    m.aplicar.mockResolvedValue({ aplicado: false, version: 3 });
    expect(await cambiarEstadoUsuario(tx, ctx, input, GRUPO)).toMatchObject({
      ok: false,
      code: TEN_CONCURRENCIA_CONFLICTO,
    });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("same state => ok no-op without version bump or audit (S5 idempotent)", async () => {
    usarObjetivo(objetivo({ activo: false }));
    const result = await cambiarEstadoUsuario(tx, ctx, input, GRUPO);
    expect(result).toEqual({ ok: true, data: { usuarioId: 20, version: 3, cambio: false } });
    sinEscrituras();
  });

  it("self-deactivation => TEN_AUTO_PROTECCION", async () => {
    usarObjetivo(objetivo({ id: 10, roles: [ADMIN] }));
    const result = await cambiarEstadoUsuario(tx, ctx, { ...input, usuarioId: 10 }, GRUPO);
    expect(result).toMatchObject({ ok: false, code: TEN_AUTO_PROTECCION });
    sinEscrituras();
  });

  it("last active Administrador => TEN_ULTIMO_ADMINISTRADOR", async () => {
    usarObjetivo(objetivo({ roles: [ADMIN] }));
    m.contar.mockResolvedValue(1);
    const result = await cambiarEstadoUsuario(tx, ctx, input, GRUPO);
    expect(result).toMatchObject({ ok: false, code: TEN_ULTIMO_ADMINISTRADOR });
    sinEscrituras();
  });

  it("reactivating an inactive user is allowed and audited", async () => {
    usarObjetivo(objetivo({ activo: false }));
    const result = await cambiarEstadoUsuario(tx, ctx, { ...input, activo: true }, GRUPO);
    expect(result).toMatchObject({ ok: true, data: { cambio: true } });
    expect(m.audit).toHaveBeenCalledWith(tx, ctx, 20, { activo: false }, { activo: true });
  });
});
