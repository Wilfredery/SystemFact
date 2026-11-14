/**
 * Tenant HTTP shared contract — the Administración screen's Server Action
 * envelope and its ONE named role group (screens plan Step 7, S3).
 *
 * A `"use server"` file may only export async functions, so the envelope types,
 * the role group and the session resolvers live here (compra/proveedor
 * precedent: `http/shared.ts`).
 *
 * Roles: `ROLES_VER_ADMINISTRACION` is the ONLY place the role names of this
 * capability are written. Screens and actions read the group, never a literal
 * role name, so "who may see the directory" is a one-line edit. Operador and
 * Despachador are deliberately OUT of this read-only build (S1/S3): they get the
 * access message, not the data.
 *
 * Error codes are the tenant catalog's (`TEN_*`) plus the transport codes
 * already declared in `./validations` — no new code is introduced for a
 * capability the catalog already describes.
 */

import { createClient } from "@/lib/supabase/client";
import type { TenantHeaderCtx } from "@/modules/tenant/infrastructure/tenant-runtime";
import {
  getCurrentTenantContext,
  getCurrentTenantHeader,
} from "@/modules/tenant/infrastructure/tenant-runtime";
import type { TenantCtx } from "../domain/tenant";
import type { TenantErrorCode } from "../domain/errors";
import { SESION_INVALIDA, VALIDATION_ERROR } from "./validations";
import type { ConfiguracionAdministracion } from "../application/consultar-configuracion";

/** Read-only directory view group (S3): Administrador only. */
export const ROLES_VER_ADMINISTRACION = ["Administrador"];

/**
 * User-management WRITES (Step 7b, S3): who may change roles / activate or
 * deactivate users. The ONLY place a role name is written for this capability;
 * the use cases receive the group as a parameter and the domain never names a
 * role. RLS (`usuario_insert/update/delete`, `usuariorol_*`) is the second,
 * independent wall behind this application guard.
 */
export const ROLES_GESTION_USUARIOS = ["Administrador"];

export type AdministracionErrorCode =
  | TenantErrorCode
  | typeof VALIDATION_ERROR
  | typeof SESION_INVALIDA;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: AdministracionErrorCode; message: string } };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function error(
  code: AdministracionErrorCode,
  message: string,
): ActionResult<never> {
  return { ok: false, error: { code, message } };
}

/** Session tenant context (auth read, before any tenant-DB access). */
export async function resolverCtx(): Promise<TenantCtx | null> {
  const supabase = await createClient();
  return getCurrentTenantContext(supabase);
}

/** Session context PLUS the display names the directory needs (empresa name). */
export async function resolverCtxHeader(): Promise<TenantHeaderCtx | null> {
  const supabase = await createClient();
  return getCurrentTenantHeader(supabase);
}

/** One directory row as the screen consumes it (S2a/S4). */
export interface UsuarioAdministracionDto {
  readonly id: number;
  readonly nombreUsuario: string;
  readonly nombre: string;
  readonly activo: boolean;
  /** Optimistic-lock token the write actions take as `versionEsperada`. */
  readonly version: number;
  readonly sucursalNombre: string;
  /** Session empresa display name (`EMPRESA.nombreComercial`, header seam). */
  readonly empresaNombre: string;
  readonly roles: readonly string[];
  /** The user's role ids (catalog ids), to preselect the role dialog. */
  readonly rolIds: readonly number[];
}

/** One active ROL catalog entry (role checkboxes of the write dialog). */
export interface RolCatalogoDto {
  readonly id: number;
  readonly nombre: string;
}

export interface ListarUsuariosAdministracion {
  readonly items: readonly UsuarioAdministracionDto[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  /** Active ROL catalog (global), alongside the rows it is assigned to. */
  readonly rolesCatalogo: readonly RolCatalogoDto[];
}

/** One branch row: exactly what the existing tenant use case exposes. */
export interface SucursalAdministracionDto {
  readonly id: number;
  readonly nombre: string;
}

/** Configuración tab payload (S2c) — no invented ITBIS family (see infra doc). */
export type ConfiguracionAdministracionDto = ConfiguracionAdministracion;
