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
// The stored password no longer satisfies the CURRENT password policy (docs/22 T7:
// minimum length raised to 12). GoTrue refuses that sign-in with error code
// `weak_password`. It gets its own code because the two conditions are not the same
// fact: AUTH_CREDENCIALES_INVALIDAS says "what you typed is wrong", while this one
// says "what you typed may be right, but it is no longer acceptable" and hands the
// user a next step (update it / ask the administrator) instead of a dead end.
export const AUTH_PASSWORD_POLICY = "AUTH_PASSWORD_POLICY";
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
// The app-side login throttle (docs/22 T3, ADR-020) refused this attempt because that
// (ip, username) pair already failed too often inside the window. It is deliberately
// NOT `AUTH_CREDENCIALES_INVALIDAS`: the credentials were not evaluated at all, so
// saying "invalid credentials" would be a false statement about the user's input, and
// the user would keep retrying a password that may well be correct. Own code, own next
// step ("wait, then try again"). The delay always expires — there is no lockout state.
export const AUTH_INTENTOS_EXCEDIDOS = "AUTH_INTENTOS_EXCEDIDOS";
// Supabase Auth itself answered 429 (or the send/recovery bucket is exhausted). Because
// the login runs from a Server Action, that bucket is keyed on the SERVER's IP, so this
// condition is app-wide and says nothing about the person typing (docs/22 T3, verified
// 2026-11-03). Mapping it to `AUTH_CREDENCIALES_INVALIDAS` would tell every user their
// password is wrong during a provider-wide lockout — the exact falsehood T7 rejected for
// `weak_password`. Never surfaces the provider text or a raw 429 to the client.
export const AUTH_AUTENTICACION_NO_DISPONIBLE = "AUTH_AUTENTICACION_NO_DISPONIBLE";

export const AUTH_ERROR_CODES = [
  AUTH_CAMPOS_REQUERIDOS,
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_USUARIO_INACTIVO,
  AUTH_PASSWORD_POLICY,
  AUTH_ENLACE_CONFLICTO,
  AUTH_ENLACE_DUPLICADO,
  AUTH_ENLACE_NO_RESUELTO,
  AUTH_INTENTOS_EXCEDIDOS,
  AUTH_AUTENTICACION_NO_DISPONIBLE,
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorCode, string>> = {
  [AUTH_CAMPOS_REQUERIDOS]: "Debes indicar tu usuario y contraseña.",
  // Board 01 binding copy (auth-login-restyle, LOG-02-A): EXACTLY this string,
  // single error surface, no per-cause variants. Silence-about-cause semantics
  // unchanged: it neither confirms a user exists nor leaks the inactive/
  // enlace distinction (LOG-02-B).
  [AUTH_CREDENCIALES_INVALIDAS]: "Credenciales inválidas",
  [AUTH_USUARIO_INACTIVO]: "Tu usuario está inactivo. Contacta al administrador.",
  // No policy number in the copy on purpose: the minimum length is Supabase project
  // configuration, not an app constant, so quoting it here would drift the day the
  // dashboard changes and would document the policy to an unauthenticated caller.
  // "Update it" is honest: no self-service reset exists yet (T4), hence the
  // administrator path.
  [AUTH_PASSWORD_POLICY]:
    "Tu contraseña ya no cumple la política de seguridad vigente. Debes actualizarla: contacta al administrador.",
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
  // No count, no window and no remaining time in the copy: those are policy
  // parameters, and quoting them to an unauthenticated caller publishes the throttling
  // thresholds for free. "Unos minutos" is true for every value the policy can produce.
  [AUTH_INTENTOS_EXCEDIDOS]:
    "Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.",
  // Honest about the CAUSE without blaming the person: during a provider-wide 429 every
  // user sees this, and none of them has a wrong password.
  [AUTH_AUTENTICACION_NO_DISPONIBLE]:
    "El servicio de autenticación no está disponible en este momento. Intenta de nuevo en unos minutos.",
};

export function messageFor(code: AuthErrorCode): string {
  return AUTH_ERROR_MESSAGES[code];
}
