/**
 * Auditoria error catalog — stable codes versioned with the domain (19-directivas §9).
 *
 * Pure TypeScript. No imports from Next.js, React, Prisma, or Supabase. This is the
 * single source of truth for audit-consultation error codes; the HTTP adapters and use
 * cases never inline a code (AGENTS.md "Errors").
 *
 * Follows the `cobros` catalog shape exactly (see `cobros/domain/errors.ts`): exported
 * string constants, a discriminated `AuditoriaErrorCode` union derived from them, a
 * `messageFor` lookup returning the Spanish user-facing copy, and an `AuditoriaDomainError`
 * carrying the stable code for the infrastructure/application layer to signal a known
 * violation that the boundary converts back to a typed result.
 *
 * The consultation surface is read-only (AC-5); these are the only two codes it can
 * ever emit. Prisma/DB errors NEVER cross the action boundary — they are not catalog
 * entries (AGENTS.md "Never expose stack traces or internal Prisma errors").
 */

// --- Stable code catalog ---

/** Admin-only access gate failed server-side (AC-1). No rows were read. */
export const AUDITORIA_NO_AUTORIZADO = "AUDITORIA_NO_AUTORIZADO";

/** The requested filter/pagination payload is transport-invalid (AC-2/AC-3). */
export const AUDITORIA_VALIDACION = "AUDITORIA_VALIDACION";

export type AuditoriaErrorCode =
  | typeof AUDITORIA_NO_AUTORIZADO
  | typeof AUDITORIA_VALIDACION;

/** Ordered catalog — tests assert every code yields a stable message. */
export const AUDITORIA_ERROR_CODES: readonly AuditoriaErrorCode[] = [
  AUDITORIA_NO_AUTORIZADO,
  AUDITORIA_VALIDACION,
];

const MESSAGES: Readonly<Record<AuditoriaErrorCode, string>> = {
  [AUDITORIA_NO_AUTORIZADO]:
    "No tiene permisos para consultar el registro de auditoría",
  [AUDITORIA_VALIDACION]:
    "El filtro de auditoría no es válido; revise los valores ingresados",
};

export function messageFor(code: AuditoriaErrorCode): string {
  return MESSAGES[code];
}

/**
 * Known domain violation raised by the pure domain/infrastructure boundary (e.g. the
 * SD date-range strings failing to parse, or an unknown `accion` value). The application
 * layer catches it and returns a typed result; anything that is NOT an `AuditoriaDomainError`
 * is a defect and propagates. `details` carries only minimal, locatable context (the offending
 * field name), never a stack trace or a raw Prisma error.
 */
export class AuditoriaDomainError extends Error {
  readonly code: AuditoriaErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AuditoriaErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.name = "AuditoriaDomainError";
    this.code = code;
    this.details = details;
  }
}
