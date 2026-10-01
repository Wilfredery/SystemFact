/**
 * Auth domain — error codes and messages.
 *
 * Pure TypeScript. No imports from Next.js, React, Prisma, or Supabase.
 * This is the single source of truth for auth error codes (19-directivas
 * §9). Messages are user-facing Spanish; codes are stable and versioned
 * alongside the domain.
 *
 * The catalog is intentionally small at Fase 1.1. As Fase 1.2 (CRUD
 * Usuarios) and beyond land, add new codes here — never inline them in
 * adapters or components.
 */

export const AUTH_CAMPOS_REQUERIDOS = "AUTH_CAMPOS_REQUERIDOS";
export const AUTH_CREDENCIALES_INVALIDAS = "AUTH_CREDENCIALES_INVALIDAS";
export const AUTH_USUARIO_INACTIVO = "AUTH_USUARIO_INACTIVO";
// Identity-link failures at the lazy `authUserId` binding (audit v2r-01). All are
// admin-actionable and none leaks the conflicting row: the messages below reveal that
// a link could not be established, never WHO holds it or in which empresa.
export const AUTH_ENLACE_CONFLICTO = "AUTH_ENLACE_CONFLICTO";
export const AUTH_ENLACE_DUPLICADO = "AUTH_ENLACE_DUPLICADO";
// WHY A SINGLE CODE FOR "THE ROW DID NOT RESOLVE" RATHER THAN ONE PER CAUSE:
//   `enlazarAuthSub` cannot tell a row that does not exist from a row that lives in
//   another empresa — the `empresaId` filter (and RLS) make both simply invisible, and
//   that indistinguishability IS the cross-tenant defense. Splitting them would mean
//   inventing a distinction the system cannot make, and would hand support two codes
//   for one observable condition. The one condition that IS distinguishable at this
//   layer — the row holds a different `sub` — keeps `AUTH_ENLACE_CONFLICTO`.
export const AUTH_ENLACE_NO_RESUELTO = "AUTH_ENLACE_NO_RESUELTO";

export const AUTH_ERROR_CODES = [
  AUTH_CAMPOS_REQUERIDOS,
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_USUARIO_INACTIVO,
  AUTH_ENLACE_CONFLICTO,
  AUTH_ENLACE_DUPLICADO,
  AUTH_ENLACE_NO_RESUELTO,
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorCode, string>> = {
  [AUTH_CAMPOS_REQUERIDOS]: "Debes indicar tu usuario y contraseña.",
  [AUTH_CREDENCIALES_INVALIDAS]:
    "Credenciales inválidas o usuario bloqueado.",
  [AUTH_USUARIO_INACTIVO]: "Tu usuario está inactivo. Contacta al administrador.",
  // The Auth user was deleted and recreated with the same synthetic email, so
  // the row already points at a `sub` that no longer exists. Refused, never
  // overwritten: an admin must decide whether to re-point the link.
  [AUTH_ENLACE_CONFLICTO]:
    "Tu acceso fue recreado en el sistema de autenticación. Contacta al administrador.",
  // This `sub` is already bound to a different USUARIO row. The DB partial
  // unique index rejected the write; surfaced here as a stable code instead of
  // a raw P2002 / 500.
  [AUTH_ENLACE_DUPLICADO]:
    "Esta cuenta de acceso ya está vinculada a otro usuario. Contacta al administrador.",
  // The `USUARIO` row for this account could not be resolved inside the caller's own
  // company scope — it does not exist, or it is not visible there. TENANT-BLIND on
  // purpose: the text never says the row exists elsewhere, never names another
  // empresa, and never distinguishes "absent" from "elsewhere" (those two are
  // indistinguishable by construction — that is the cross-tenant defense doing its
  // job). Telling support the truth without telling a caller anything new is the
  // point: reporting this as "your access was recreated" sent triage after the wrong
  // cause for an entire missing-row case.
  [AUTH_ENLACE_NO_RESUELTO]:
    "No pudimos localizar tu usuario vinculado a esta empresa. Contacta al administrador.",
};

export function messageFor(code: AuthErrorCode): string {
  return AUTH_ERROR_MESSAGES[code];
}
