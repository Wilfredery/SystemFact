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

/** A DGII fixed-width field was fed a value wider than the declared column (amount, NCF/RNC or
 * code) — fail loud instead of silently widening/truncating the fiscal record. */
export const REPORTE_DGII_ANCHO_EXCEDIDO = "REPORTE_DGII_ANCHO_EXCEDIDO";

/** The DGII header `AAAAMM` period is malformed (not 6 digits or month not in 1..12) — a bad
 * period desyncs the header line and the filename with no error otherwise. */
export const REPORTE_DGII_PERIODO_INVALIDO = "REPORTE_DGII_PERIODO_INVALIDO";

/** A DGII amount is not a finite number (NaN/Infinity from a ratio over a zero base) or carries
 * more than 2 decimals — emitting it would cross-foot a wrong total that looks valid. */
export const REPORTE_DGII_MONTO_INVALIDO = "REPORTE_DGII_MONTO_INVALIDO";

/** The 606/607 header `codigoInformacion` is not the frozen `"606"`/`"607"` label — a mislabelled
 * file fails at DGII with nothing pointing back. */
export const REPORTE_DGII_CODIGO_INVALIDO = "REPORTE_DGII_CODIGO_INVALIDO";

export type ReporteErrorCode =
  | typeof REPORTE_NO_AUTORIZADO
  | typeof REPORTE_VALIDACION
  | typeof REPORTE_DGII_ANCHO_EXCEDIDO
  | typeof REPORTE_DGII_PERIODO_INVALIDO
  | typeof REPORTE_DGII_MONTO_INVALIDO
  | typeof REPORTE_DGII_CODIGO_INVALIDO;

/** Ordered catalog — a test asserts every code yields a stable message. */
export const REPORTES_ERROR_CODES: readonly ReporteErrorCode[] = [
  REPORTE_NO_AUTORIZADO,
  REPORTE_VALIDACION,
  REPORTE_DGII_ANCHO_EXCEDIDO,
  REPORTE_DGII_PERIODO_INVALIDO,
  REPORTE_DGII_MONTO_INVALIDO,
  REPORTE_DGII_CODIGO_INVALIDO,
];

const MESSAGES: Readonly<Record<ReporteErrorCode, string>> = {
  [REPORTE_NO_AUTORIZADO]:
    "No tiene permisos para consultar este reporte",
  [REPORTE_VALIDACION]:
    "El filtro del reporte no es válido; revise los valores ingresados",
  [REPORTE_DGII_ANCHO_EXCEDIDO]:
    "Un valor del archivo DGII excede el ancho fijo de su campo; revise los datos de origen",
  [REPORTE_DGII_PERIODO_INVALIDO]:
    "El período del archivo DGII no es válido; debe usar AAAAMM con mes entre 01 y 12",
  [REPORTE_DGII_MONTO_INVALIDO]:
    "Un monto del archivo DGII no es un número finito o tiene más de 2 decimales; revise los datos de origen",
  [REPORTE_DGII_CODIGO_INVALIDO]:
    "El código de comprobante del encabezado DGII no es 606 ni 607",
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
