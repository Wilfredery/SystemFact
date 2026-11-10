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

export { zCambiarSucursalInput, zListarUsuariosQuery };
