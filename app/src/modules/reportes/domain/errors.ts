/**
 * Reportes error catalog — stable codes versioned with the domain (19-directivas §9).
 *
 * Pure TypeScript. No imports from Next.js, React, Prisma, or Supabase. This is the
 * single source of truth for every report/dashboard error code; the HTTP adapters and
 * use cases never inline a code (AGENTS.md "Errors").
 *
 * Follows the auditoria/cobros catalog shape exactly: exported string constants, a
 * discriminated `ReporteErrorCode` union derived from them, a `messageFor` lookup
 * returning the Spanish user-facing copy, and a `ReporteDomainError` carrying the
 * stable code so the pure domain / infrastructure boundary can signal a known
 * violation that the application layer converts back to a typed result.
 *
 * The report surface is READ-ONLY by construction (DB-6): these are the only codes a
 * consultation can ever emit. Prisma/DB errors NEVER cross the action boundary — they
 * are not catalog entries (AGENTS.md "Never expose stack traces or internal Prisma
 * errors to the client").
 */

// --- Stable code catalog ---

/** The caller's role is not permitted for this report/dashboard read (DB-2). No rows read. */
export const REPORTE_NO_AUTORIZADO = "REPORTE_NO_AUTORIZADO";

/** The requested filter/pagination payload is invalid (DB-5) — rejected before any query. */
export const REPORTE_VALIDACION = "REPORTE_VALIDACION";

export type ReporteErrorCode =
  | typeof REPORTE_NO_AUTORIZADO
  | typeof REPORTE_VALIDACION;

/** Ordered catalog — a test asserts every code yields a stable message. */
export const REPORTES_ERROR_CODES: readonly ReporteErrorCode[] = [
  REPORTE_NO_AUTORIZADO,
  REPORTE_VALIDACION,
];

const MESSAGES: Readonly<Record<ReporteErrorCode, string>> = {
  [REPORTE_NO_AUTORIZADO]:
    "No tiene permisos para consultar este reporte",
  [REPORTE_VALIDACION]:
    "El filtro del reporte no es válido; revise los valores ingresados",
};

export function messageFor(code: ReporteErrorCode): string {
  return MESSAGES[code];
}

/**
 * Known domain violation raised by the pure domain / infrastructure boundary (e.g. an
 * unparseable SD date, a `desde > hasta` range, or an out-of-range locator id). The
 * application layer catches it and returns a typed result; anything that is NOT a
 * `ReporteDomainError` is a defect and propagates. `details` carries only minimal,
 * locatable context (the offending field name), never a stack trace or a raw DB error.
 */
export class ReporteDomainError extends Error {
  readonly code: ReporteErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ReporteErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.name = "ReporteDomainError";
    this.code = code;
    this.details = details;
  }
}
