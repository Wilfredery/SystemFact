/**
 * Auditoria HTTP input validation (Zod) + transport error codes (Slice D, task 4.1).
 *
 * Zod owns the TRANSPORT contract only — the SHAPE of a consultation request: a
 * positive-integer locator id, an optional `YYYY-MM-DD` date string, a positive
 * integer page. It is NEVER the authorization authority and it does NOT re-implement
 * the domain's business rules: an unknown `accion`, a malformed SD date or the
 * `pageSize` clamp all stay in `domain/auditoria.ts` (`normalizarFiltro`), surfacing
 * the stable `AUDITORIA_VALIDACION`. Role gating happens server-side inside
 * `withTenantTransaction` (AC-1). This mirrors the cobros/devolucion convention
 * exactly so the whole surface shares one transport contract.
 *
 * `page`/`pageSize` accept only a minimum (≥ 1) on purpose: a size of 500 is NOT a
 * transport error — the domain clamps it down to 100 and serves the page (AC-2), so
 * rejecting it here would contradict the spec. The clamp lives downstream, never here.
 */

import { z } from "zod";

/** Stable transport codes (NOT part of the audit business catalog). */
export const VALIDATION_ERROR = "VALIDATION_ERROR";
export const SESION_INVALIDA = "SESION_INVALIDA";

const MENSAJES_TRANSPORTE: Record<string, string> = {
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
};

export function mensajeTransporte(code: string): string {
  return MENSAJES_TRANSPORTE[code] ?? "Error";
}

/** A bare SD calendar date `YYYY-MM-DD`; the domain validates it is a real day. */
const zFechaSD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida");

/** Positive-integer locator id (usuario / sucursal), when provided. */
const zIdPositivo = z.number().int().positive();

/**
 * The consultation filter payload. Every facet is optional and nullable so the client
 * form / URL can simply omit what the admin did not set. The parsed shape is
 * structurally compatible with the domain's `AuditoriaFiltroEntrada`, so it is handed
 * straight to the use case without re-mapping.
 */
export const zConsultarAuditoriaInput = z.object({
  accion: z.string().nullish(),
  usuarioId: zIdPositivo.nullish(),
  sucursalId: zIdPositivo.nullish(),
  desde: zFechaSD.nullish(),
  hasta: zFechaSD.nullish(),
  texto: z.string().nullish(),
  page: z.number().int().min(1).nullish(),
  pageSize: z.number().int().min(1).nullish(),
});
export type ConsultarAuditoriaInput = z.infer<typeof zConsultarAuditoriaInput>;
