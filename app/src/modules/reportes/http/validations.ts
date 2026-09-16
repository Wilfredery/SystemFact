/**
 * Reportes HTTP input validation (Zod) + transport error codes.
 *
 * Zod owns the TRANSPORT contract only — the SHAPE a report consultation arrives in (a
 * `YYYY-MM-DD` SD date, a positive-integer page/sucursalId, a page size with a MINIMUM of
 * 1). It is NEVER the authorization authority and it does NOT re-implement the domain's
 * business rules: the `pageSize` clamp to 100, the `desde > hasta` rejection and the
 * preset resolution all live in `domain/reporte-filtro.ts` (`normalizarFiltro`) and surface
 * the stable `REPORTE_VALIDACION`. Role gating happens server-side inside
 * `withTenantTransaction` (DB-2). Mirrors `auditoria/http/validations.ts` exactly so the
 * whole read surface shares ONE transport contract.
 *
 * `pageSize` accepts only a MINIMUM (≥ 1) on purpose: a size of 500 is NOT a transport
 * error — the domain clamps it to 100 and serves the page (DB-5), so rejecting it here
 * would contradict the spec. The clamp lives downstream, never here.
 */

import { z } from "zod";

/** Stable transport codes (NOT part of the reportes business catalog). */
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
const zFechaSD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida");

/** Positive-integer locator id (sucursal / page), when provided. */
const zIdPositivo = z.number().int().positive();

/**
 * The report consultation filter payload (the shared contract every slice B–E report reuses
 * from PR 1). Every facet optional/nullable so the URL/client form can omit what the user
 * did not set; the parsed shape is structurally compatible with `ReporteFiltroEntrada`.
 */
export const zReporteFiltroInput = z.object({
  desde: zFechaSD.nullish(),
  hasta: zFechaSD.nullish(),
  preset: z.string().nullish(),
  sucursalId: zIdPositivo.nullish(),
  page: z.number().int().min(1).nullish(),
  pageSize: z.number().int().min(1).nullish(),
});
export type ReporteFiltroInput = z.infer<typeof zReporteFiltroInput>;

/** The dashboard takes no filter — it always reflects the current SD period. */
export const zDashboardInput = z.object({}).nullish();
