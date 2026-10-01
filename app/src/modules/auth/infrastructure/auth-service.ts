/**
 * Auth use cases: sign in, sign out, and resolve the current session's context.
 *
 * This module owns THREE decisions that matter for security, and each is
 * documented at its own definition because the reasoning is the contract:
 *
 *   1. WHICH ROW A SESSION RESOLVES TO — identity comes from the immutable Auth
 *      `sub` (ADR-014), never from the synthetic email, which an Auth admin can
 *      rewrite. Resolution itself lives in `./auth-identity`; this module orders
 *      the calls.
 *   2. WHAT THE CALLER SEES ON FAILURE — the error codes are deliberately NOT
 *      uniform. See the enumeration analysis on `loginWithCredenciales`.
 *   3. WHETHER AN ATTEMPT IS AUDITED — a completed session transition writes
 *      exactly one row to `MOVIMIENTO_AUDITORIA` (REQ-AUTH-AUD-001); a rejected
 *      attempt writes none, because there is no attributable actor.
 *
 * Data access is MOSTLY delegated to `./auth-identity`; this file orchestrates.
 * The one exception is the session-transition audit write (`registrarAuditoriaSesion`),
 * which necessarily opens its OWN `prisma.$transaction` because no `TenantCtx` exists
 * yet on the login/logout path — `withTenantTransaction` is unavailable there. See its
 * docblock for why the audit write cannot simply move down a layer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
// Leaf module on purpose, not the `tenant-runtime` barrel: `tenant-runtime`
// imports `auth-identity`, which imports this file's collaborators. Importing
// the leaf at every call site makes the cycle-avoidance explicit where the
// dependency actually is instead of relying on the re-export.
import { setLoginFlow } from "@/modules/tenant/infrastructure/login-flow";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
import {
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_USUARIO_INACTIVO,
  messageFor,
  type AuthErrorCode,
} from "@/modules/auth/domain/errors";
import { buildSyntheticEmail } from "@/modules/auth/domain/synthetic-email";
import { normalizarAuthSub } from "@/modules/auth/domain/auth-sub";
import {
  buscarUsuarioPorAuthSub,
  buscarUsuarioPorNombreUsuario,
  enlazarAuthSub,
  resolverAuthSubDeSesion,
} from "@/modules/auth/infrastructure/auth-identity";

export type AuthResult =
  | { ok: true }
  | { ok: false; code: AuthErrorCode; message: string };

/**
 * Appends a LOGIN or LOGOUT audit row on the STANDALONE (pre-`TenantCtx`) path
 * (REQ-AUTH-AUD-001, design.md "Login/logout context").
 *
 * `withTenantTransaction` cannot run before a `TenantCtx` exists, so this opens
 * its OWN direct `prisma.$transaction`: activate the `app.is_login_flow`
 * exception, pin `app.current_empresa_id` to the SINGLE resolved company of the
 * authenticating user, then append the row through the auditoria write port with
 * `sucursalId` null (a company-wide session action). The empresa GUC is pinned to
 * exactly this one company and never widened, so the login-flow RLS exception is
 * not exploited to reach other tenants (the `audit_insert` policy's
 * `WITH CHECK empresa GUC = empresaId` is the DB-level backstop).
 *
 * A failure propagates (design.md: "failure propagates rather than silently
 * losing security evidence") — the caller surfaces it; we never swallow it.
 *
 * Exported so the real-DB integration harness can exercise the exact standalone
 * mechanism the login/logout paths use (the Supabase credential round-trip itself
 * is remote and cannot run in an integration test).
 */
export async function registrarAuditoriaSesion(
  accion: "LOGIN" | "LOGOUT",
  anchor: { readonly empresaId: number; readonly usuarioId: number },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await setLoginFlow(tx);
    await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${String(
      anchor.empresaId,
    )}, true)`;
    await registrarEventoAuditoriaEnTx(tx, anchor, {
      accion,
      entidad: "Sesion",
      idEntidad: String(anchor.usuarioId),
      sucursalId: null,
    });
  });
}

/**
 * Resolves the `{ id, empresaId }` of the USUARIO behind the current Supabase
 * session. Returns null when there is no valid session or no active mapped user
 * — so an unattributable logout writes NO audit row.
 *
 * Resolved by the immutable Auth `sub` (`USUARIO.authUserId`), NOT by decoding
 * the synthetic email (audit finding v2r-01): the email is a mutable Auth
 * attribute and therefore not a safe identity anchor. See `auth-identity.ts`.
 */
async function resolverUsuarioDeSesion(
  supabase: SupabaseClient,
): Promise<{ readonly id: number; readonly empresaId: number } | null> {
  const authSub = await resolverAuthSubDeSesion(supabase);
  if (authSub === null) return null;

  const usuario = await buscarUsuarioPorAuthSub(authSub, {
    id: true,
    empresaId: true,
    activo: true,
  });
  if (usuario === null || !usuario.activo) return null;
  return { id: usuario.id, empresaId: usuario.empresaId };
}

/**
 * Authenticates a user with `nombreUsuario` + password.
 *
 * Implements ADR-014: internally authenticates against Supabase Auth using the
 * synthetic email `<nombreUsuario>@users.systemfact.internal`.
 *
 * ON ENUMERATION — the accurate posture (do not "simplify" this into a blanket
 * claim of generic messages; the codes below are NOT uniform):
 *   - Step 1 (`signInWithPassword`) is the ONLY step reachable by a stranger, and
 *     its failure is uniform: one code, `AUTH_CREDENCIALES_INVALIDAS`, whether
 *     the account does not exist or the password is wrong. Supabase itself does
 *     not distinguish those two, so nothing here does either. Nothing is read
 *     from the DB on that path.
 *   - The two remaining codes (`AUTH_USUARIO_INACTIVO`, and the `AUTH_ENLACE_*`
 *     family) are reachable ONLY after Auth has already returned a valid session,
 *     which requires the correct password for an existing `nombreUsuario`. The
 *     caller therefore already knows WHICH account they hold credentials for, so
 *     distinguishing these outcomes discloses nothing they did not already have.
 *     They are actionable support signals ("your account is disabled", "your
 *     access was recreated", "we could not locate your user in this company"),
 *     and collapsing them into the generic code would only strand a legitimate
 *     user with no next step.
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
    data: { session, user },
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
  //    Reached ONLY with verified credentials, so `AUTH_USUARIO_INACTIVO` here is
  //    not an enumeration oracle — see the docblock. It is a distinct code from
  //    the credential failure on purpose: it tells a known holder of valid
  //    credentials why their account is refused, and the session is signed out
  //    immediately so a disabled user cannot stay logged in.
  //
  //    This IS the login-flow bootstrap, and the ONLY place the row is found by
  //    `nombreUsuario`: the credentials are already verified above, and nothing
  //    on the per-request path reads the email (audit finding v2r-01).
  //
  //    NOTA (ADR-019 / R1.B): cuando RLS está activo, este lookup se ejecuta
  //    SIN contexto de tenant todavía. Se activa la flag `app.is_login_flow`
  //    para que la policy de USUARIO lo permita (resuelve el problema
  //    gallina-huevo del path de auth).
  const usuario = await buscarUsuarioPorNombreUsuario(nombreUsuario, {
    id: true,
    activo: true,
    empresaId: true,
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

  // 3. Bind the immutable Auth `sub` onto the row (audit finding v2r-01), so every
  //    later request resolves identity by `sub` instead of the mutable email.
  //    Idempotent, and it refuses BOTH directions of conflict without overwriting
  //    (see `enlazarAuthSub`).
  //
  //    A session that cannot be bound would be permanently unresolvable on the
  //    per-request path, so it is closed and the typed error surfaced instead of
  //    leaving a half-linked session behind. `signInWithPassword` already returned
  //    the verified user, so the `sub` is read from it directly rather than paying
  //    a second `getUser()` round-trip.
  const authSub = normalizarAuthSub(user?.id);
  if (authSub === null) {
    await supabase.auth.signOut();
    // WHY `AUTH_CREDENCIALES_INVALIDAS` and not a dedicated code: Auth DID
    // return a valid session here, so the honest description would be "your
    // account's identity is unusable" — but that is an internal invariant, not a
    // user-actionable condition, and it means the caller would learn something
    // about the server's state that no action of theirs could change. Fail closed
    // to the generic credential error: the session is destroyed and nothing is
    // bound. The message text is deliberately loose ("credenciales inválidas o
    // usuario bloqueado") for exactly this reason.
    return {
      ok: false,
      code: AUTH_CREDENCIALES_INVALIDAS,
      message: messageFor(AUTH_CREDENCIALES_INVALIDAS),
    };
  }

  const enlace = await enlazarAuthSub({
    authSub,
    usuarioId: usuario.id,
    empresaId: usuario.empresaId,
  });
  if (!enlace.ok) {
    await supabase.auth.signOut();
    return { ok: false, code: enlace.code, message: enlace.message };
  }

  // REQ-AUTH-AUD-001: a FULLY successful login (session established, the mapped
  // USUARIO validated active, AND the identity link bound) appends exactly one LOGIN
  // audit row. The failed-credentials, inactive-user and link-conflict rejections
  // returned above, so a rejected login writes nothing (no unauthenticated noise, no
  // enumeration side-channel in the log).
  await registrarAuditoriaSesion("LOGIN", {
    empresaId: usuario.empresaId,
    usuarioId: usuario.id,
  });

  return { ok: true };
}

/**
 * Closes the Supabase Auth session for the current request and appends one LOGOUT
 * audit row (REQ-AUTH-AUD-001). The acting identity is resolved from the still-
 * present session by its immutable Auth `sub` (audit finding v2r-01) before
 * sign-out, the session is then closed, and the row is written against the
 * pre-resolved ids. An unattributable logout (no active mapped user) writes nothing.
 */
export async function logout(supabase: SupabaseClient): Promise<void> {
  const identity = await resolverUsuarioDeSesion(supabase);
  await supabase.auth.signOut();
  if (identity !== null) {
    await registrarAuditoriaSesion("LOGOUT", {
      empresaId: identity.empresaId,
      usuarioId: identity.id,
    });
  }
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
 * Returns null when there is no valid session, when the `sub` claim is unusable,
 * or when the session has not been linked yet (`authUserId IS NULL`) — the
 * accepted one-time re-login after this column was introduced.
 *
 * Identity is resolved by the immutable Auth `sub` (`USUARIO.authUserId`), never
 * by decoding the synthetic email: ADR-014 makes email a non-credential, and an
 * Auth admin can change it, so an email-keyed binding is not tamper-resistant
 * (audit finding v2r-01).
 */
export async function getCurrentUser(
  supabase: SupabaseClient,
): Promise<CurrentUserContext | null> {
  const authSub = await resolverAuthSubDeSesion(supabase);
  if (authSub === null) {
    return null;
  }

  // NOTA (ADR-019 / R1.B): este lookup se ejecuta sin contexto de tenant
  // (el TenantCtx es lo que estamos resolviendo). `buscarUsuarioPorAuthSub`
  // activa `app.is_login_flow` para que la policy de USUARIO lo permita.
  const usuario = await buscarUsuarioPorAuthSub(authSub, {
    nombre: true,
    nombreUsuario: true,
    activo: true,
    empresa: { select: { id: true, nombreComercial: true } },
    sucursal: { select: { id: true, nombre: true } },
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
