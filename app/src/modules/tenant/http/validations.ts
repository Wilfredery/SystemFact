/**
 * Tenant HTTP input validation (Zod) + transport error codes.
 * Mirrors the auditoria/devolucion convention: a `"use server"` file can only
 * export async functions, so constants/types/messages live here — Zod owns the
 * TRANSPORT contract only (the payload SHAPE), never authorization.
 */

import { z } from "zod";

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

export { zCambiarSucursalInput };
