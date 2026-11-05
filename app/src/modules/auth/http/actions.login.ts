"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import {
  loginWithCredenciales,
  logout,
  getCurrentUser,
  type CurrentUserContext,
} from "@/modules/auth/infrastructure/auth-service";
import {
  AUTH_CAMPOS_REQUERIDOS,
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_INTENTOS_EXCEDIDOS,
  messageFor,
} from "@/modules/auth/domain/errors";
import { normalizarIp } from "@/modules/auth/domain/login-throttle";
import {
  registrarExitoDeLogin,
  registrarFalloDeLogin,
  verificarThrottleLogin,
} from "@/modules/auth/application/verificar-throttle-login";
import { almacenIntentosPrisma } from "@/modules/auth/infrastructure/login-attempt-repository";

/**
 * Server Actions for authentication (thin adapters).
 *
 * Business logic lives in `src/modules/auth/infrastructure/auth-service.ts`.
 */

export interface LoginResult {
  error: string | null;
}

const loginInputSchema = z.object({
  nombreUsuario: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(255),
});

/**
 * Logs a user in using `nombreUsuario` + password (ADR-014).
 * On success the landing is decided HERE per design D2 — the proxy stays
 * byte-identical: a multi-branch ADMIN (`esAdmin && activeBranchCount > 1`)
 * goes to `/selector-empresa-sucursal`; everyone else (non-admin fast path
 * 17 §5, single-branch admin) goes to `/dashboard`, unchanged.
 * On failure returns a generic error.
 *
 * Signature follows `useActionState` (previous state, then the form data),
 * which drives the client-side pending/error state on the login form.
 */
// Auth actions operate on Supabase Auth, not tenant data; tenant wrapper not required.
// `LOGIN_INTENTO` (the throttle counter) is the documented non-tenant exception —
// ADR-020 and docs/22 T3: login runs before a TenantCtx can exist, and the row holds
// no tenant data.
export async function login(
  _prevState: LoginResult,
  formData: FormData,
): Promise<LoginResult> {
  const parsed = loginInputSchema.safeParse({
    nombreUsuario: formData.get("nombreUsuario") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    return { error: messageFor(AUTH_CAMPOS_REQUERIDOS) };
  }
  const { nombreUsuario, password } = parsed.data;

  // Brute-force throttle (docs/22 T3, ADR-020), checked BEFORE the provider call so a
  // delayed pair costs no Auth request at all. The counter is keyed by
  // `(ip, nombreUsuario)`, never by IP alone: Supabase's own limits key on the SERVER's
  // IP here (this is a Server Action), so a per-IP counter would let one attacker
  // throttle every user. A refusal here is NOT recorded as a failed attempt — the delay
  // has to expire, and counting refusals would make it self-sustaining.
  const cabeceras = await headers();
  const ip = normalizarIp(cabeceras.get("x-forwarded-for") ?? cabeceras.get("x-real-ip"));
  const ahora = Date.now();
  const throttle = await verificarThrottleLogin(nombreUsuario, ip, ahora, almacenIntentosPrisma);
  if (!throttle.permitido) {
    return { error: messageFor(AUTH_INTENTOS_EXCEDIDOS) };
  }

  const supabase = await createClient();
  const result = await loginWithCredenciales(supabase, nombreUsuario, password);

  if (!result.ok) {
    // Only a rejected PASSWORD counts as a failed attempt. `AUTH_USUARIO_INACTIVO`, the
    // identity-link failures and `AUTH_PASSWORD_POLICY` are reached with credentials
    // that Auth already accepted, so counting them would let anyone who knows a valid
    // password lock that account out. `AUTH_AUTENTICACION_NO_DISPONIBLE` is a provider
    // outage: nobody guessed anything.
    if (result.code === AUTH_CREDENCIALES_INVALIDAS) {
      await registrarFalloDeLogin(nombreUsuario, ip, Date.now(), almacenIntentosPrisma);
    }
    return { error: result.message };
  }

  // Honest typos must not follow the user into their next session (S6).
  await registrarExitoDeLogin(nombreUsuario, ip, almacenIntentosPrisma);

  redirect(
    result.esAdmin && result.activeBranchCount > 1
      ? "/selector-empresa-sucursal"
      : "/dashboard",
  );
}

/**
 * Closes the current session and redirects to the login page.
 */
