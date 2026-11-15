import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import type { TenantCtx } from "../domain/tenant";
import {
  TEN_AUTO_PROTECCION,
  TEN_CONCURRENCIA_CONFLICTO,
  TEN_OPS_NO_AUTORIZADO,
  TEN_ROL_NO_VALIDO,
  TEN_SUCURSAL_NO_VALIDA,
  TEN_ULTIMO_ADMINISTRADOR,
  TEN_USUARIO_NO_ENCONTRADO,
  TEN_USUARIO_SUCURSAL_INACTIVA,
  messageFor,
} from "../domain/errors";
import {
  cambiarEstadoUsuario,
  cambiarRolesUsuario,
  moverUsuarioDeSucursal,
} from "./gestion-usuarios";

jest.mock("../infrastructure/usuario-gestion-repository", () => ({
  bloquearUsuarioYAdministradoresEnTx: jest.fn(),
  leerUsuarioGestionableEnTx: jest.fn(),
  contarAdministradoresActivosEnTx: jest.fn(),
  leerRolesActivosPorIdEnTx: jest.fn(),
  aplicarCambioUsuarioEnTx: jest.fn(),
  reemplazarRolesEnTx: jest.fn(),
  registrarAuditUsuarioEnTx: jest.fn(),
  leerUsuarioParaMoverEnTx: jest.fn(),
  bloquearUsuarioYAdministradoresDeSucursalesEnTx: jest.fn(),
  contarAdministradoresActivosDeSucursalEnTx: jest.fn(),
  moverUsuarioASucursalEnTx: jest.fn(),
}));
jest.mock("../infrastructure/repo-sucursal", () => ({
  leerSucursalActivaEnTx: jest.fn(),
  leerSucursalEstadoEnTx: jest.fn(),
  leerSucursalActivaConBloqueoEnTx: jest.fn(),
  liberarSucursalActivaEnTx: jest.fn(),
  activarSucursalEnTx: jest.fn(),
}));

import * as repo from "../infrastructure/usuario-gestion-repository";
import * as repoSucursal from "../infrastructure/repo-sucursal";

const m = {
  bloquear: repo.bloquearUsuarioYAdministradoresEnTx as jest.Mock,
  leer: repo.leerUsuarioGestionableEnTx as jest.Mock,
  contar: repo.contarAdministradoresActivosEnTx as jest.Mock,
  roles: repo.leerRolesActivosPorIdEnTx as jest.Mock,
  aplicar: repo.aplicarCambioUsuarioEnTx as jest.Mock,
  reemplazar: repo.reemplazarRolesEnTx as jest.Mock,
  audit: repo.registrarAuditUsuarioEnTx as jest.Mock,
  leerMover: repo.leerUsuarioParaMoverEnTx as jest.Mock,
  bloquearSucursales: repo.bloquearUsuarioYAdministradoresDeSucursalesEnTx as jest.Mock,
  contarOrigen: repo.contarAdministradoresActivosDeSucursalEnTx as jest.Mock,
  mover: repo.moverUsuarioASucursalEnTx as jest.Mock,
  destino: repoSucursal.leerSucursalActivaConBloqueoEnTx as jest.Mock,
  destinoVisible: repoSucursal.leerSucursalActivaEnTx as jest.Mock,
  sucursalEstado: repoSucursal.leerSucursalEstadoEnTx as jest.Mock,
  liberar: repoSucursal.liberarSucursalActivaEnTx as jest.Mock,
  activar: repoSucursal.activarSucursalEnTx as jest.Mock,
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

  describe("activating a user (L8: the user's branch must be active)", () => {
    const activar = { usuarioId: 20, activo: true, versionEsperada: 3 };
    const enSucursal = (sucursalId: number, activo = false) => ({
      id: 20,
      sucursalId,
      activo,
      version: 3,
      roles: [OPER],
    });

    beforeEach(() => {
      usarObjetivo(objetivo({ activo: false }));
      m.leerMover.mockResolvedValue(enSucursal(5));
      m.destino.mockResolvedValue({ id: 5 });
    });

    it("reactivating a user of an ACTIVE branch is allowed and audited; the branch is share-locked BEFORE the user rows", async () => {
      const result = await cambiarEstadoUsuario(tx, ctx, activar, GRUPO);
      expect(result).toMatchObject({ ok: true, data: { cambio: true } });
      expect(m.audit).toHaveBeenCalledWith(tx, ctx, 20, { activo: false }, { activo: true });
      expect(m.destino).toHaveBeenCalledWith(tx, 1, 5);
      expect(m.destino.mock.invocationCallOrder[0]).toBeLessThan(
        m.bloquear.mock.invocationCallOrder[0],
      );
    });

    it("the branch is the TARGET USER's, not the session's", async () => {
      m.leerMover.mockResolvedValue(enSucursal(7));
      m.destino.mockResolvedValue({ id: 7 });
      await cambiarEstadoUsuario(tx, ctx, activar, GRUPO);
      expect(m.destino).toHaveBeenCalledWith(tx, 1, 7);
    });

    it("inactive branch => TEN_USUARIO_SUCURSAL_INACTIVA, nothing written", async () => {
      m.destino.mockResolvedValue(null);
      m.sucursalEstado.mockResolvedValue({ id: 5, activa: false });
      expect(await cambiarEstadoUsuario(tx, ctx, activar, GRUPO)).toEqual({
        ok: false,
        code: TEN_USUARIO_SUCURSAL_INACTIVA,
        message: messageFor(TEN_USUARIO_SUCURSAL_INACTIVA),
      });
      expect(messageFor(TEN_USUARIO_SUCURSAL_INACTIVA)).toMatch(/sucursal activa/);
      sinEscrituras();
    });

    it("branch not visible (foreign / unknown) => TEN_SUCURSAL_NO_VALIDA, nothing written", async () => {
      m.destino.mockResolvedValue(null);
      m.sucursalEstado.mockResolvedValue(null);
      expect(await cambiarEstadoUsuario(tx, ctx, activar, GRUPO)).toMatchObject({
        ok: false,
        code: TEN_SUCURSAL_NO_VALIDA,
      });
      sinEscrituras();
    });

    it("empty locked read but the branch reads active (lock not held) => conflict, nothing written", async () => {
      m.destino.mockResolvedValue(null);
      m.sucursalEstado.mockResolvedValue({ id: 5, activa: true });
      expect(await cambiarEstadoUsuario(tx, ctx, activar, GRUPO)).toMatchObject({
        ok: false,
        code: TEN_CONCURRENCIA_CONFLICTO,
      });
      sinEscrituras();
    });

    it("the user moved to another branch between the probe and the lock => conflict, nothing written", async () => {
      m.leerMover
        .mockResolvedValueOnce(enSucursal(5))
        .mockResolvedValueOnce(enSucursal(6));
      expect(await cambiarEstadoUsuario(tx, ctx, activar, GRUPO)).toMatchObject({
        ok: false,
        code: TEN_CONCURRENCIA_CONFLICTO,
      });
      sinEscrituras();
    });

    it("an inactive branch does not mask the actor / not-found / version refusals", async () => {
      m.destino.mockResolvedValue(null);
      m.sucursalEstado.mockResolvedValue({ id: 5, activa: false });
      usarObjetivo(null);
      expect(await cambiarEstadoUsuario(tx, ctx, activar, GRUPO)).toMatchObject({
        code: TEN_USUARIO_NO_ENCONTRADO,
      });
      usarObjetivo(objetivo({ activo: false }));
      expect(
        await cambiarEstadoUsuario(tx, ctx, { ...activar, versionEsperada: 1 }, GRUPO),
      ).toMatchObject({ code: TEN_CONCURRENCIA_CONFLICTO });
    });

    it("unknown target on the probe => no branch lock, TEN_USUARIO_NO_ENCONTRADO", async () => {
      m.leerMover.mockResolvedValue(null);
      usarObjetivo(null);
      expect(await cambiarEstadoUsuario(tx, ctx, activar, GRUPO)).toMatchObject({
        ok: false,
        code: TEN_USUARIO_NO_ENCONTRADO,
      });
      expect(m.destino).not.toHaveBeenCalled();
    });

    it("an already-active user (no-op) reads no branch at all", async () => {
      m.leerMover.mockResolvedValue(enSucursal(5, true));
      usarObjetivo(objetivo({ activo: true }));
      const result = await cambiarEstadoUsuario(tx, ctx, activar, GRUPO);
      expect(result).toEqual({ ok: true, data: { usuarioId: 20, version: 3, cambio: false } });
      expect(m.destino).not.toHaveBeenCalled();
      expect(m.sucursalEstado).not.toHaveBeenCalled();
      sinEscrituras();
    });

    it("deactivating never reads a branch (an inactive one included)", async () => {
      usarObjetivo(objetivo({ activo: true }));
      const result = await cambiarEstadoUsuario(tx, ctx, { ...activar, activo: false }, GRUPO);
      expect(result).toMatchObject({ ok: true, data: { cambio: true } });
      expect(m.leerMover).not.toHaveBeenCalled();
      expect(m.destino).not.toHaveBeenCalled();
      expect(m.sucursalEstado).not.toHaveBeenCalled();
    });
  });
});

describe("moverUsuarioDeSucursal", () => {
  const input = { usuarioId: 20, sucursalDestinoId: 6, versionEsperada: 3 };
  // The target sits in branch 7 (the session branch is 5, the destination 6).
  const enSucursal7 = (over: Record<string, unknown> = {}) => ({
    id: 20,
    sucursalId: 7,
    activo: true,
    version: 3,
    roles: [OPER],
    ...over,
  });

  beforeEach(() => {
    m.destino.mockResolvedValue({ id: 6 });
    m.leerMover.mockResolvedValue(enSucursal7());
    m.leer.mockResolvedValue(ACTOR);
    m.contarOrigen.mockResolvedValue(2);
    m.mover.mockResolvedValue({ aplicado: true, version: 4 });
  });

  it("widens, locks (source + destination), writes, RESTORES the session branch, THEN audits once", async () => {
    const result = await moverUsuarioDeSucursal(tx, ctx, input, GRUPO);

    expect(result).toEqual({ ok: true, data: { usuarioId: 20, version: 4, cambio: true } });
    expect(m.bloquearSucursales).toHaveBeenCalledWith(tx, 1, 20, [7, 6], GRUPO);
    expect(m.contarOrigen).toHaveBeenCalledWith(tx, 1, 7, GRUPO);
    expect(m.mover).toHaveBeenCalledWith(tx, 1, 20, 3, 6);
    expect(m.activar).toHaveBeenCalledWith(tx, 5);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledWith(tx, ctx, 20, { sucursalId: 7 }, { sucursalId: 6 });
    const orden = (f: jest.Mock) => f.mock.invocationCallOrder[0];
    expect(orden(m.liberar)).toBeLessThan(orden(m.bloquearSucursales));
    expect(orden(m.bloquearSucursales)).toBeLessThan(orden(m.mover));
    expect(orden(m.mover)).toBeLessThan(orden(m.activar));
    expect(orden(m.activar)).toBeLessThan(orden(m.audit));
  });

  it.each([
    [
      "foreign / inactive / unknown destination",
      () => {
        m.destino.mockResolvedValue(null);
        m.destinoVisible.mockResolvedValue(null);
      },
    ],
  ])("%s => TEN_SUCURSAL_NO_VALIDA, nothing widened or written", async (_n, preparar) => {
    preparar();
    const result = await moverUsuarioDeSucursal(tx, ctx, input, GRUPO);
    expect(result).toEqual({
      ok: false,
      code: TEN_SUCURSAL_NO_VALIDA,
      message: messageFor(TEN_SUCURSAL_NO_VALIDA),
    });
    expect(m.liberar).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("a locked read that comes back empty for a branch the caller CAN see (RLS withheld the row lock: not an admin) => TEN_OPS_NO_AUTORIZADO", async () => {
    m.destino.mockResolvedValue(null);
    m.destinoVisible.mockResolvedValue({ id: 6 });
    const result = await moverUsuarioDeSucursal(tx, ctx, input, GRUPO);
    expect(result).toEqual({
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
      message: messageFor(TEN_OPS_NO_AUTORIZADO),
    });
    expect(m.liberar).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("unknown / foreign user => TEN_USUARIO_NO_ENCONTRADO, branch restored, nothing written", async () => {
    m.leerMover.mockResolvedValue(null);
    expect(await moverUsuarioDeSucursal(tx, ctx, input, GRUPO)).toMatchObject({
      ok: false,
      code: TEN_USUARIO_NO_ENCONTRADO,
    });
    expect(m.activar).toHaveBeenCalledWith(tx, 5);
    expect(m.mover).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("an actor who is no longer an active Administrador => TEN_OPS_NO_AUTORIZADO", async () => {
    m.leer.mockResolvedValue({ ...ACTOR, activo: false });
    expect(await moverUsuarioDeSucursal(tx, ctx, input, GRUPO)).toMatchObject({
      ok: false,
      code: TEN_OPS_NO_AUTORIZADO,
    });
    expect(m.mover).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("stale version => TEN_CONCURRENCIA_CONFLICTO, nothing written", async () => {
    expect(
      await moverUsuarioDeSucursal(tx, ctx, { ...input, versionEsperada: 2 }, GRUPO),
    ).toMatchObject({ ok: false, code: TEN_CONCURRENCIA_CONFLICTO });
    expect(m.mover).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("the target changed branch between the probe and the lock => TEN_CONCURRENCIA_CONFLICTO", async () => {
    m.leerMover
      .mockResolvedValueOnce(enSucursal7())
      .mockResolvedValueOnce(enSucursal7({ sucursalId: 8 }));
    expect(await moverUsuarioDeSucursal(tx, ctx, input, GRUPO)).toMatchObject({
      ok: false,
      code: TEN_CONCURRENCIA_CONFLICTO,
    });
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("self-move => TEN_AUTO_PROTECCION", async () => {
    m.leerMover.mockResolvedValue(enSucursal7({ id: 10 }));
    expect(
      await moverUsuarioDeSucursal(tx, ctx, { ...input, usuarioId: 10 }, GRUPO),
    ).toMatchObject({ ok: false, code: TEN_AUTO_PROTECCION });
    expect(m.mover).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("the last active Administrador of the SOURCE branch => TEN_ULTIMO_ADMINISTRADOR", async () => {
    m.leerMover.mockResolvedValue(enSucursal7({ roles: [ADMIN] }));
    m.contarOrigen.mockResolvedValue(1);
    expect(await moverUsuarioDeSucursal(tx, ctx, input, GRUPO)).toMatchObject({
      ok: false,
      code: TEN_ULTIMO_ADMINISTRADOR,
    });
    expect(m.mover).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("same branch => ok cambio=false: no write, no version bump, NO audit", async () => {
    m.leerMover.mockResolvedValue(enSucursal7({ sucursalId: 6 }));
    expect(await moverUsuarioDeSucursal(tx, ctx, input, GRUPO)).toEqual({
      ok: true,
      data: { usuarioId: 20, version: 3, cambio: false },
    });
    expect(m.mover).not.toHaveBeenCalled();
    sinEscrituras();
  });

  it("a lost race on the verified UPDATE => TEN_CONCURRENCIA_CONFLICTO and NO audit", async () => {
    m.mover.mockResolvedValue({ aplicado: false, version: 3 });
    expect(await moverUsuarioDeSucursal(tx, ctx, input, GRUPO)).toMatchObject({
      ok: false,
      code: TEN_CONCURRENCIA_CONFLICTO,
    });
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.activar).toHaveBeenCalledWith(tx, 5);
  });

  it("restores the session branch even when a repository call throws", async () => {
    m.mover.mockRejectedValue(new Error("db down"));
    await expect(moverUsuarioDeSucursal(tx, ctx, input, GRUPO)).rejects.toThrow("db down");
    expect(m.activar).toHaveBeenCalledWith(tx, 5);
    expect(m.audit).not.toHaveBeenCalled();
  });
});
