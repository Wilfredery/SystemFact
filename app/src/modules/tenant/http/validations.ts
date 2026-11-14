/**
 * Tenant HTTP input validation (Zod) + transport error codes.
 * Mirrors the auditoria/devolucion convention: a `"use server"` file can only
 * export async functions, so constants/types/messages live here — Zod owns the
 * TRANSPORT contract only (the payload SHAPE), never authorization.
 */

import { z } from "@/lib/zod";

/** Stable transport codes (NOT part of the tenant business catalog). */
export const VALIDATION_ERROR = "VALIDATION_ERROR";
export const SESION_INVALIDA = "SESION_INVALIDA";

const MENSAJES_TRANSPORTE: Record<string, string> = {
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
};

export function mensajeTransporte(code: string): string {
  return MENSAJES_TRANSPORTE[code] ?? "Error";
}

const zCambiarSucursalInput = z.object({
  sucursalId: z.number().int().positive(),
});

export type CambiarSucursalInput = z.infer<typeof zCambiarSucursalInput>;

// ─── Administración (screens plan Step 7, S4) ────────────────────────────────

/**
 * Tri-state `activo` filter. It intentionally does NOT use `z.coerce.boolean()`:
 * that coerces the string "false" to `true` (any non-empty string is truthy), so
 * a URL/query-string `?activo=false` would silently list only ACTIVE users. Both
 * the literal boolean (client island) and the two query-string spellings are
 * accepted, and anything else is rejected at the boundary.
 */
const zActivoQuery = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((valor) => valor === true || valor === "true")
  .optional();

/**
 * Directory query (S4). `page`/`pageSize` are only bounded by TYPE here: the
 * `[1, 100]` clamp and the default 25 belong to the shared pagination helpers
 * (`shared/domain/pagination`) and are applied by the use case, so there is one
 * copy of the list rule in the codebase. `buscar` is a transport bound only —
 * the case-insensitive contains lives in the repository.
 */
const zListarUsuariosQuery = z.object({
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
  buscar: z.string().trim().min(1).max(100).optional(),
  activo: zActivoQuery,
});

export type ListarUsuariosQuery = z.infer<typeof zListarUsuariosQuery>;

// ─── Administración writes (Step 7b, S4/S5/S6) ───────────────────────────────

/** Postgres int4 ceiling: a larger id/version is a transport error, never a DB overflow. */
const INT4_MAX = 2_147_483_647;
const zIdPositivo = z.number().int().positive().max(INT4_MAX);

/** Safety bound on the role list: far above the real catalog, below abuse. */
const MAX_ROLES_POR_USUARIO = 50;

/**
 * Strict on purpose: unknown keys are rejected, ids and the expected version
 * are real positive integers (never coerced from strings) and `rolIds` is a
 * non-empty, duplicate-free list. Whether each id is an ACTIVE catalog role is
 * business (TEN_ROL_NO_VALIDO, the use case), not transport.
 */
const zCambiarRolesUsuarioInput = z
  .object({
    usuarioId: zIdPositivo,
    rolIds: z
      .array(zIdPositivo)
      .min(1)
      .max(MAX_ROLES_POR_USUARIO)
      .refine((ids) => new Set(ids).size === ids.length),
    versionEsperada: zIdPositivo,
  })
  .strict();

const zCambiarEstadoUsuarioInput = z
  .object({
    usuarioId: zIdPositivo,
    activo: z.boolean(),
    versionEsperada: zIdPositivo,
  })
  .strict();

export type CambiarRolesUsuarioInput = z.infer<typeof zCambiarRolesUsuarioInput>;
export type CambiarEstadoUsuarioInput = z.infer<typeof zCambiarEstadoUsuarioInput>;

export {
  zCambiarEstadoUsuarioInput,
  zCambiarRolesUsuarioInput,
  zCambiarSucursalInput,
  zListarUsuariosQuery,
};
