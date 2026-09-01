import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import {
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_USUARIO_INACTIVO,
  messageFor,
  type AuthErrorCode,
} from "@/modules/auth/domain/errors";

/**
 * Synthetic email derived from `nombreUsuario` (ADR-014).
 * Supabase Auth maps each SystemFact user to one internal email.
 */
export const SYNTHETIC_EMAIL_SUFFIX = "@users.systemfact.internal";

export function buildSyntheticEmail(nombreUsuario: string): string {
  return `${nombreUsuario}${SYNTHETIC_EMAIL_SUFFIX}`;
}

export type AuthResult =
  | { ok: true }
  | { ok: false; code: AuthErrorCode; message: string };

/**
 * Authenticates a user with `nombreUsuario` + password.
 *
 * Implements ADR-014: internally authenticates against Supabase Auth using the
 * synthetic email `<nombreUsuario>@users.systemfact.internal`.
 *
 * Error messages are deliberately generic to avoid user enumeration.
 *
 * Deliberately framework agnostic: receives the session-aware Supabase client
 * (carrying the request cookies) from the http layer.
 */
export async function loginWithCredenciales(
  supabase: SupabaseClient,
  nombreUsuario: string,
  password: string,
): Promise<AuthResult> {
  // 1. Attempt the Supabase Auth login with the synthetic email FIRST,
  //    so the failure path is uniform regardless of whether the email
  //    exists (no user enumeration).
  const {
    data: { session },
    error,
  } = await supabase.auth.signInWithPassword({
    email: buildSyntheticEmail(nombreUsuario),
    password,
  });

  if (error !== null || session === null) {
    return {
      ok: false,
      code: AUTH_CREDENCIALES_INVALIDAS,
      message: messageFor(AUTH_CREDENCIALES_INVALIDAS),
    };
  }

  // 2. Authorize the mapped USUARIO row: must exist and be active.
  //    The synthetic email fails closed if no Supabase user matches, so a
  //    missing or inactive USUARIO row maps to the same generic error.
  const usuario = await prisma.usuario.findUnique({
    where: { nombreUsuario },
    select: { id: true, activo: true, nombre: true },
  });

  if (usuario === null || !usuario.activo) {
    // Sign out the orphaned session so a disabled user cannot stay logged in.
    await supabase.auth.signOut();
    return {
      ok: false,
      code: AUTH_USUARIO_INACTIVO,
      message: messageFor(AUTH_USUARIO_INACTIVO),
    };
  }

  return { ok: true };
}

/**
 * Closes the Supabase Auth session for the current request.
 */
export async function logout(supabase: SupabaseClient): Promise<void> {
  await supabase.auth.signOut();
}

export interface CurrentUserContext {
  nombre: string;
  nombreUsuario: string;
  empresa: { id: number; nombreComercial: string } | null;
  sucursal: { id: number; nombre: string } | null;
}

/**
 * Resolves the authenticated user's context from the Supabase session,
 * enriching it with their USUARIO row (empresa + sucursal).
 *
 * Returns null when there is no valid session or no matching USUARIO row.
 */
export async function getCurrentUser(
  supabase: SupabaseClient,
): Promise<CurrentUserContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return null;
  }

  // The synthetic email encodes the nombreUsuario (ADR-014).
  const email = user.email ?? "";
  if (!email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) {
    return null;
  }
  const nombreUsuario = email.slice(0, -SYNTHETIC_EMAIL_SUFFIX.length);

  const usuario = await prisma.usuario.findUnique({
    where: { nombreUsuario },
    select: {
      nombre: true,
      nombreUsuario: true,
      activo: true,
      empresa: { select: { id: true, nombreComercial: true } },
      sucursal: { select: { id: true, nombre: true } },
    },
  });

  if (usuario === null || !usuario.activo) {
    return null;
  }

  return {
    nombre: usuario.nombre,
    nombreUsuario: usuario.nombreUsuario,
    empresa: usuario.empresa,
    sucursal: usuario.sucursal,
  };
}
