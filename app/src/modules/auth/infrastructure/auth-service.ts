import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { setLoginFlow } from "@/modules/tenant/infrastructure/tenant-runtime";
import type { PrismaTx } from "@/modules/tenant/infrastructure/withTenantTransaction";
import { registrarEventoAuditoriaEnTx } from "@/modules/auditoria/application/auditoria-write-port";
import {
  AUTH_CREDENCIALES_INVALIDAS,
  AUTH_USUARIO_INACTIVO,
  messageFor,
  type AuthErrorCode,
} from "@/modules/auth/domain/errors";
import {
  buildSyntheticEmail,
  decodeNombreUsuario,
} from "@/modules/auth/domain/synthetic-email";

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
    await registrarEventoAuditoriaEnTx(tx as PrismaTx, anchor, {
      accion,
      entidad: "Sesion",
      idEntidad: String(anchor.usuarioId),
      sucursalId: null,
    });
  });
}

/**
 * Resolves the `{ id, empresaId }` of the USUARIO behind the current Supabase
 * session (login-flow lookup). Returns null when there is no valid session or no
 * active mapped user — so an unattributable logout writes NO audit row.
 */
async function resolverUsuarioDeSesion(
  supabase: SupabaseClient,
): Promise<{ readonly id: number; readonly empresaId: number } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return null;

  const email = user.email ?? "";
  let nombreUsuario: string;
  try {
    nombreUsuario = decodeNombreUsuario(email);
  } catch {
    return null;
  }

  const usuario = await prisma.$transaction(async (tx) => {
    await setLoginFlow(tx);
    return tx.usuario.findUnique({
      where: { nombreUsuario },
      select: { id: true, empresaId: true, activo: true },
    });
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
  //
  //    NOTA (ADR-019 / R1.B): cuando RLS esté activo, este findUnique se
  //    ejecuta SIN contexto de tenant todavía. Se activa la flag
  //    `app.is_login_flow` para que la policy de USUARIO lo permita
  //    (resuelve el problema gallina-huevo del path de auth).
  const usuario = await prisma.$transaction(async (tx) => {
    await setLoginFlow(tx);
    return tx.usuario.findUnique({
      where: { nombreUsuario },
      select: { id: true, activo: true, nombre: true, empresaId: true },
    });
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

  // REQ-AUTH-AUD-001: a FULLY successful login (session established AND the mapped
  // USUARIO validated active) appends exactly one LOGIN audit row. The failed-
  // credentials and inactive-user rejections returned above, so a rejected login
  // writes nothing (no unauthenticated noise, no enumeration side-channel in the log).
  await registrarAuditoriaSesion("LOGIN", {
    empresaId: usuario.empresaId,
    usuarioId: usuario.id,
  });

  return { ok: true };
}

/**
 * Closes the Supabase Auth session for the current request and appends one LOGOUT
 * audit row (REQ-AUTH-AUD-001). The acting identity is resolved from the still-
 * present session (the synthetic email is in the JWT) before sign-out, the session
 * is then closed, and the row is written against the pre-resolved ids. An
 * unattributable logout (no active mapped user) writes nothing.
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
  let nombreUsuario: string;
  try {
    nombreUsuario = decodeNombreUsuario(email);
  } catch {
    return null;
  }

  // NOTA (ADR-019 / R1.B): cuando RLS esté activo, este findUnique se ejecuta
  // sin contexto de tenant (el TenantCtx es lo que estamos resolviendo).
  // Se activa `app.is_login_flow` para que la policy de USUARIO lo permita.
  const usuario = await prisma.$transaction(async (tx) => {
    await setLoginFlow(tx);
    return tx.usuario.findUnique({
      where: { nombreUsuario },
      select: {
        nombre: true,
        nombreUsuario: true,
        activo: true,
        empresa: { select: { id: true, nombreComercial: true } },
        sucursal: { select: { id: true, nombre: true } },
      },
    });
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
