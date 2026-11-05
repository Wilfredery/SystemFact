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
  AUTH_INTENTOS_EXCEDIDOS,
  messageFor,
} from "@/modules/auth/domain/errors";
import { normalizarIp } from "@/modules/auth/domain/login-throttle";
import {
  descartarIntentoDeLogin,
  intentarAccesoDeLogin,
  registrarExitoDeLogin,
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
  // A SINGLE-VALUE platform header first: `x-forwarded-for` is a list the client can prepend
  // to, and with more than one appending proxy its last hop is another proxy's address shared
  // by everyone (review finding R4-001). `x-real-ip` is set by the platform as one value.
  const ip = normalizarIp(cabeceras.get("x-real-ip") ?? cabeceras.get("x-forwarded-for"));
  const ahora = Date.now();
  // One call, one decision: the counter checks AND records this attempt inside a single
  // locked transaction (finding R4-002). Two statements — read, then insert — left the gap
  // between them as a window in which a concurrent burst all read the same count and all
  // proceeded, which is precisely the shape of a brute-force attempt.
  const intento = await intentarAccesoDeLogin(nombreUsuario, ip, ahora, almacenIntentosPrisma);
  if (!intento.permitido) {
    return { error: messageFor(AUTH_INTENTOS_EXCEDIDOS) };
  }
  const intentoId = intento.intentoId;

  const supabase = await createClient();
  let result: Awaited<ReturnType<typeof loginWithCredenciales>>;
  try {
    result = await loginWithCredenciales(supabase, nombreUsuario, password);
  } catch (error) {
    // The attempt is already committed, so a THROW between here and the verdict would leave a
    // row counted forever as a wrong password the user never typed (R4-003). Undo it and let
    // the failure surface.
    await descartarIntentoDeLogin(intentoId, almacenIntentosPrisma);
    throw error;
  }

  if (!result.ok) {
    // The attempt row was already written BEFORE the provider call (see below), so here
    // we only decide whether it survives. It survives exactly one case: a rejected
    // PASSWORD, which is the only refusal that is a guess at the credential.
    // `AUTH_USUARIO_INACTIVO`, the identity-link failures, `AUTH_PASSWORD_POLICY` and
    // `AUTH_AUTENTICACION_NO_DISPONIBLE` are all reached with credentials Auth already
    // accepted (or not evaluated at all), so counting them would let anyone who knows a
    // valid password — or anyone at all during a provider outage — lock an account out.
    if (result.cuentaComoIntento) {
      // Keep the attempt: the provider rejected the password, which is the only refusal that is a
      // guess at the credential. The decision comes from the service, not from the code — several
      // refusals share `AUTH_CREDENCIALES_INVALIDAS` for message purposes while having nothing to
      // do with the password (review findings R3-catchall and F3).
    } else {
      await descartarIntentoDeLogin(intentoId, almacenIntentosPrisma);
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
