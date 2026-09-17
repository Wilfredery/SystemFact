/**
 * Reportes domain — Santo-Domingo date seam, REUSED (not re-derived).
 *
 * The SD↔UTC conversion is ALREADY ratified in `auditoria/domain/zona-horaria.ts`
 * (`fechaSDaUTC`, `rangoFechasAUTC`): it discovers the zone offset through the standard
 * `Intl.DateTimeFormat` API rather than hardcoding UTC-4, satisfying AGENTS.md
 * "conversions via a dedicated library / no manual hour arithmetic". The proposal names
 * this seam as the one reportes must build on (design "Domain converts SD dates through
 * the existing `Intl` seam"). We therefore import the audited math and do NOTHING here
 * but ADAPT its error code to the reportes catalog: a malformed SD boundary that the
 * auditoria seam surfaces as `AUDITORIA_VALIDACION` becomes a `REPORTE_VALIDACION` so
 * the reportes boundary never leaks a foreign module's code (AGENTS.md "single error-code
 * catalog per surface"). This is a thin adapter over reused pure logic — no duplicated
 * timezone math, and auditoria itself is untouched.
 */

import {
  fechaSDaUTC as fechaSDaUTCAuditoria,
  rangoFechasAUTC as rangoFechasAUTCAuditoria,
} from "@/modules/auditoria/domain/zona-horaria";
import { AuditoriaDomainError } from "@/modules/auditoria/domain/errors";
import { REPORTE_VALIDACION, ReporteDomainError } from "./errors";

/**
 * Convert an `America/Santo_Domingo` calendar date (`YYYY-MM-DD`) to the UTC instant that
 * starts (`"inicio"`) or ends (`"fin"`) that SD day. A malformed or non-existent calendar
 * date fails loud as `REPORTE_VALIDACION` (the auditoria seam's `AUDITORIA_VALIDACION`
 * mapped into the reportes catalog).
 */
export function fechaSDaUTC(fechaSD: string, boundary: "inicio" | "fin"): Date {
  try {
    return fechaSDaUTCAuditoria(fechaSD, boundary);
  } catch (e) {
    if (e instanceof AuditoriaDomainError) {
      throw new ReporteDomainError(REPORTE_VALIDACION, {
        campo: boundary,
        fechaSD,
      });
    }
    throw e;
  }
}

/**
 * Map an optional SD date range (`YYYY-MM-DD` at each end) to UTC `Date` bounds, leaving
 * each bound `undefined` when the caller omitted it. Delegates to the reused auditoria
 * conversion (which rejects a malformed non-empty date) and maps the failure code.
 */
export function rangoFechasAUTC(rango: {
  readonly desde?: string;
  readonly hasta?: string;
}): { desde?: Date; hasta?: Date } {
  try {
    return rangoFechasAUTCAuditoria(rango);
  } catch (e) {
    if (e instanceof AuditoriaDomainError) {
      throw new ReporteDomainError(REPORTE_VALIDACION, { campo: "rango" });
    }
    throw e;
  }
}

/** Re-exported so reportes callers depend on THIS seam, never reach into auditoria. */
export { fechaEnSD } from "@/modules/ncf/domain/ncf-rules";
