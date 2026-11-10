/**
 * Tenant Server Actions — the ADMINISTRACIÓN screen's read-only backend
 * (screens plan Step 7, S3/S4). Thin adapters only (AGENTS.md): parse the
 * payload, resolve the tenant context from the Supabase session, and inside the
 * ONE `withTenantTransaction` check the named role group on the SERVER, then
 * delegate. Zero business logic, zero Prisma here.
 *
 * Everything is additive and READ-ONLY (S1): no user creation, no role or branch
 * assignment, no activate/deactivate, no RLS change. Writes are a later PR.
 *
 * Authorization is the server-side role-group check, never the UI: hiding a
 * button is not security, so each action re-checks even though the screen will
 * also probe `obtenerPermisosAdministracionAction`.
 */

"use server";

import { withTenantTransaction } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { listarUsuarios } from "../application/listar-usuarios";
import { consultarConfiguracion } from "../application/consultar-configuracion";
import { listarSucursalesDeEmpresa } from "../application/listarSucursalesDeEmpresa";
import { tieneRolPermitidoEnTx } from "../infrastructure/usuario-repository";
import { TEN_OPS_NO_AUTORIZADO, messageFor } from "../domain/errors";
import {
  SESION_INVALIDA,
  VALIDATION_ERROR,
  mensajeTransporte,
  zListarUsuariosQuery,
} from "./validations";
import {
  ROLES_VER_ADMINISTRACION,
  error,
  ok,
  resolverCtx,
  resolverCtxHeader,
  type ActionResult,
  type ConfiguracionAdministracionDto,
  type ListarUsuariosAdministracion,
  type SucursalAdministracionDto,
} from "./shared";

const NO_AUTORIZADO_MESSAGE = messageFor(TEN_OPS_NO_AUTORIZADO);

/**
 * One page of the session branch's users (S4). The branch scope is the existing
 * `usuario_select` RLS policy's job (S5) — nothing here widens it. Each row
 * carries the session empresa's display name from the header seam, because the
 * screen shows "Empresa/Sucursal" and the user row only stores ids.
 */
export async function listarUsuariosAction(
  query: unknown,
): Promise<ActionResult<ListarUsuariosAdministracion>> {
  const parsed = zListarUsuariosQuery.safeParse(query ?? {});
  if (!parsed.success) {
    return error(VALIDATION_ERROR, mensajeTransporte(VALIDATION_ERROR));
  }

  const ctx = await resolverCtxHeader();
  if (ctx === null) {
    return error(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_ADMINISTRACION,
    );
    if (!permitido) return error(TEN_OPS_NO_AUTORIZADO, NO_AUTORIZADO_MESSAGE);

    const result = await listarUsuarios(tx, ctx, parsed.data);
    return ok({
      items: result.data.items.map((usuario) => ({
        id: usuario.id,
        nombreUsuario: usuario.nombreUsuario,
        nombre: usuario.nombre,
        activo: usuario.activo,
        sucursalNombre: usuario.sucursalNombre,
        empresaNombre: ctx.empresaNombre,
        roles: usuario.roles,
      })),
      total: result.data.total,
      page: result.data.page,
      pageSize: result.data.pageSize,
    });
  });
}

/**
 * The caller-empresa's active branches, from the EXISTING tenant use case
 * (`listarSucursalesDeEmpresa`, admin-only gate inside): this action adds no
 * second authorization authority, it just exposes the same contract over HTTP.
 * The contract returns active branches only, so there is no per-branch "estado"
 * field to expose — the screen renders them as active.
 */
export async function listarSucursalesDeEmpresaAction(): Promise<
  ActionResult<readonly SucursalAdministracionDto[]>
> {
  const ctx = await resolverCtx();
  if (ctx === null) {
    return error(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const result = await listarSucursalesDeEmpresa(ctx, tx);
    if (!result.ok) return error(result.code, result.message);
    return ok(
      result.sucursales.map((sucursal) => ({
        id: sucursal.id,
        nombre: sucursal.nombre,
      })),
    );
  });
}

/**
 * Whether the caller may see the Administración directory, answered from the
 * named view group so the screen never names a role. It is only a UI question
 * (show the tabs or the access message); every read action re-checks on the
 * server. Deny-by-default: any failure to prove the role answers `false`, and a
 * missing session is a transport error (the page redirects to /login).
 */
export async function obtenerPermisosAdministracionAction(): Promise<
  ActionResult<{ puedeVer: boolean }>
> {
  const ctx = await resolverCtx();
  if (ctx === null) {
    return error(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const puedeVer = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_ADMINISTRACION,
    );
    return ok({ puedeVer });
  });
}

/** The read-only Configuración parameters (S2c), from the existing readers. */
export async function consultarConfiguracionAction(): Promise<
  ActionResult<ConfiguracionAdministracionDto>
> {
  const ctx = await resolverCtx();
  if (ctx === null) {
    return error(SESION_INVALIDA, mensajeTransporte(SESION_INVALIDA));
  }

  return withTenantTransaction(ctx, async (tx) => {
    const permitido = await tieneRolPermitidoEnTx(
      tx,
      ctx.usuarioId,
      ctx.empresaId,
      ROLES_VER_ADMINISTRACION,
    );
    if (!permitido) return error(TEN_OPS_NO_AUTORIZADO, NO_AUTORIZADO_MESSAGE);

    const result = await consultarConfiguracion(tx, ctx.empresaId);
    return ok(result.data);
  });
}
