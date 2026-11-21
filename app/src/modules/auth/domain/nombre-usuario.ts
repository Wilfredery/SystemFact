/**
 * Auth domain — canonical username `<CODIGO>-<resto>` (multi-company contract C2/C4).
 *
 * Pure TypeScript. No imports from Next.js, React, Prisma, or Supabase.
 *
 * Canonical form: `<CODIGO>` upper-case (the company code, `EMPRESA.codigo`) + `-` +
 * `<resto>` lower-case. The FIRST hyphen is the separator: the code never contains a
 * hyphen, the rest may. The synthetic Supabase email is derived from the FULL canonical
 * name (ADR-014), in `synthetic-email.ts`, never here.
 *
 * Two deliberately different behaviours live in this module:
 *   - `normalizarNombreUsuarioLogin` is LENIENT. It only canonicalises what the user
 *     typed and NEVER reports a format problem: a login that said "that is not a valid
 *     username shape" would be an enumeration oracle. Anything that does not look like
 *     `<code>-<rest>` goes through (trimmed) and fails like any unknown user.
 *   - `validarNombreUsuarioNuevo` is STRICT and fails closed. It is for creation paths
 *     (the operator provisioning script, any future user-creation use case).
 *
 * Case mapping is ASCII-only on purpose: `String.prototype.toLowerCase` is
 * Unicode-aware (the Kelvin sign U+212A lower-cases to ASCII "k"), which would let a
 * non-ASCII spelling alias a different account.
 */

import {
  AUTH_CODIGO_EMPRESA_INVALIDO,
  AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO,
  AUTH_NOMBRE_USUARIO_LARGO,
  AUTH_NOMBRE_USUARIO_PREFIJO_INVALIDO,
  messageFor,
  type AuthErrorCode,
} from "@/modules/auth/domain/errors";

/** Company code: 3 to 6 characters `A-Z0-9` (C1). */
export const CODIGO_EMPRESA_REGEX = /^[A-Z0-9]{3,6}$/;

/** The part after the first hyphen (C2): lower-case, starts alphanumeric, max 57 chars. */
export const RESTO_NOMBRE_USUARIO_REGEX = /^[a-z0-9][a-z0-9._-]{0,56}$/;

/** Maximum total length of `nombreUsuario` (C2). */
export const NOMBRE_USUARIO_MAX = 64;

// Same shape as the code, but case-insensitive: what a person may type at login.
const PREFIJO_LOGIN_REGEX = /^[A-Za-z0-9]{3,6}$/;

function aMayusculasAscii(s: string): string {
  return s.replace(/[a-z]/g, (c) => c.toUpperCase());
}

function aMinusculasAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * Canonicalises the username typed at login. Total and lenient: never throws, never
 * rejects. Trims; when the part before the first hyphen is 3-6 ASCII alphanumerics and
 * the rest is non-empty, returns `UPPER(prefix)-lower(rest)`; otherwise returns the
 * trimmed input unchanged (so a legacy unprefixed name such as `admin` keeps working).
 */
export function normalizarNombreUsuarioLogin(input: string): string {
  const recortado = input.trim();
  const guion = recortado.indexOf("-");
  if (guion === -1) {
    return recortado;
  }
  const prefijo = recortado.slice(0, guion);
  const resto = recortado.slice(guion + 1);
  if (resto.length === 0 || !PREFIJO_LOGIN_REGEX.test(prefijo)) {
    return recortado;
  }
  return `${aMayusculasAscii(prefijo)}-${aMinusculasAscii(resto)}`;
}

export type ValidacionNombreUsuarioNuevo =
  | { readonly ok: true; readonly nombreUsuario: string }
  | { readonly ok: false; readonly code: AuthErrorCode; readonly message: string };

function rechazo(code: AuthErrorCode): ValidacionNombreUsuarioNuevo {
  return { ok: false, code, message: messageFor(code) };
}

/**
 * Strict check of a NEW username against its company code. The name must already be in
 * canonical form (no trimming, no case folding: normalise with the login helper first if
 * the input comes from a person). Order of checks: the code itself, total length, prefix
 * equals `codigo`, then the format of the rest.
 */
export function validarNombreUsuarioNuevo(
  codigo: string,
  nombreUsuario: string,
): ValidacionNombreUsuarioNuevo {
  if (!CODIGO_EMPRESA_REGEX.test(codigo)) {
    return rechazo(AUTH_CODIGO_EMPRESA_INVALIDO);
  }
  if (nombreUsuario.length > NOMBRE_USUARIO_MAX) {
    return rechazo(AUTH_NOMBRE_USUARIO_LARGO);
  }
  const prefijoEsperado = `${codigo}-`;
  if (!nombreUsuario.startsWith(prefijoEsperado)) {
    return rechazo(AUTH_NOMBRE_USUARIO_PREFIJO_INVALIDO);
  }
  if (!RESTO_NOMBRE_USUARIO_REGEX.test(nombreUsuario.slice(prefijoEsperado.length))) {
    return rechazo(AUTH_NOMBRE_USUARIO_FORMATO_INVALIDO);
  }
  return { ok: true, nombreUsuario };
}
