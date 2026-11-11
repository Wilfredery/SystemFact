/**
 * Caja domain — error catalog (S5), versioned with the module (19-directivas §9).
 *
 * ADR-013: pure TypeScript. No imports from Next.js, React, Prisma or Supabase. This is the
 * single source of truth for every Caja error code; adapters and use cases never inline one
 * (AGENTS.md "Errors").
 *
 * Deliberately MINIMAL (AGENTS.md "Strict YAGNI"): the only failure the pure domain can raise
 * today is an SD day that cannot be resolved to a real calendar date, so it is the only code
 * declared. A code that is never thrown is noise, not a contract.
 */

// --- Stable code catalog ---

/** The `America/Santo_Domingo` day of the close could not be resolved (malformed or
 *  non-existent calendar date) — fail loud instead of aggregating a wrong day. */
export const CAJA_VALIDACION = "CAJA_VALIDACION";

export type CajaErrorCode = typeof CAJA_VALIDACION;

/** Ordered catalog — a test asserts every code yields a stable message. */
export const CAJA_ERROR_CODES: readonly CajaErrorCode[] = [CAJA_VALIDACION];

const MESSAGES: Readonly<Record<CajaErrorCode, string>> = {
  [CAJA_VALIDACION]:
    "La fecha del cierre de caja no es válida; revísela e intente de nuevo",
};

/** The stable Spanish user-facing copy for a Caja code (never a raw exception message). */
export function messageFor(code: CajaErrorCode): string {
  return MESSAGES[code];
}

/**
 * Known domain violation raised by the pure domain boundary (an unresolvable SD day). The
 * application layer catches it and returns a typed result; anything that is NOT a
 * `CajaDomainError` is a defect and propagates. `details` carries only minimal, locatable
 * context (the offending field/date), never a stack trace or a raw DB error.
 */
export class CajaDomainError extends Error {
  readonly code: CajaErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: CajaErrorCode, details?: Record<string, unknown>) {
    super(messageFor(code));
    this.name = "CajaDomainError";
    this.code = code;
    this.details = details;
  }
}
