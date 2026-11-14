/**
 * Caja HTTP input validation (Zod) + transport error codes (S6).
 *
 * Zod owns the TRANSPORT contract only, and for this module that contract is EMPTY: the close is a
 * single report for TODAY in America/Santo_Domingo (S1/S6 — the wireframe has no date selector), so
 * there is no date, no page and no filter to accept.
 *
 * The schema is therefore STRICT rather than permissive: an unknown key (`fecha`, `fechaSD`,
 * `retro`, `desde`, `page`, `sucursalId`, `empresaId`, …) is a validation FAILURE, never a silently
 * dropped field. That is what makes "no retroactive date parameter anywhere" and "the scope comes
 * from the tenant context" true at the boundary instead of by convention.
 *
 * Paging is deliberately absent: both boards are single-day aggregates (one row per method, four
 * KPIs), not lists — a `page` would be a knob with nothing to page.
 *
 * The two codes below are the HTTP/transport rejections (bad session + malformed payload); the
 * authorization refusal is the domain catalog's `CAJA_NO_AUTORIZADO`, so the whole Caja error
 * surface stays inside one versioned catalog.
 */

import { z } from "@/lib/zod";

/** Stable transport codes (not part of the domain business catalog). */
export const VALIDATION_ERROR = "VALIDATION_ERROR";
export const SESION_INVALIDA = "SESION_INVALIDA";

const MENSAJES_TRANSPORTE: Record<string, string> = {
  [VALIDATION_ERROR]: "Datos de entrada inválidos",
  [SESION_INVALIDA]: "Sesión no válida o expirada",
};

export function mensajeTransporte(code: string): string {
  return MENSAJES_TRANSPORTE[code] ?? "Error";
}

/** The read payload: empty by design (today-only, tenant scope from the session). */
export const zConsultarCajaInput = z.strictObject({});
export type ConsultarCajaInputDto = z.infer<typeof zConsultarCajaInput>;
