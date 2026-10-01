/**
 * Session-identity resolution for Supabase Auth (ADR-014 / audit finding v2r-01).
 *
 * The single place where a Supabase session is turned into a `USUARIO` row.
 * Every per-request path in the app funnels through here.
 *
 * WHY THIS MODULE EXISTS (the vulnerability being closed):
 *   Identity used to be resolved by decoding `nombreUsuario` back OUT of the
 *   synthetic email in the JWT and looking `USUARIO` up by it. ADR-014 makes
 *   email a NON-credential, and an Auth admin can change a user's email, so
 *   that binding is not tamper-resistant: whoever controls the email attribute
 *   controls which `USUARIO` row — and therefore which `empresa` — a request
 *   resolves to. The Auth `sub` is immutable and was never read.
 *
 * THE RULE THIS MODULE ENFORCES:
 *   - PER-REQUEST resolution reads `USUARIO.authUserId` by `sub`. Never email.
 *   - The synthetic email is only ever BUILT (`buildSyntheticEmail`), never
 *     parsed. The old decoder was deleted along with this change: `nombreUsuario`
 *     is not recovered from an email anywhere in the codebase.
 *   - `buscarUsuarioPorNombreUsuario` is the login-flow bootstrap. It receives an
 *     ALREADY-VALIDATED `nombreUsuario` straight from the login form and looks
 *     the row up by that value — it does no decoding and no parsing. It runs
 *     only AFTER `signInWithPassword` has verified the credentials, so the
 *     binding it discovers cannot be steered by an email attribute.
 */

import { Prisma } from "@/generated/prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { setLoginFlow } from "@/modules/tenant/infrastructure/login-flow";
import { normalizarAuthSub } from "@/modules/auth/domain/auth-sub";
import {
  AUTH_ENLACE_CONFLICTO,
  AUTH_ENLACE_DUPLICADO,
  AUTH_ENLACE_NO_RESUELTO,
  messageFor,
  type AuthErrorCode,
} from "@/modules/auth/domain/errors";

/**
 * Result of the lazy `authUserId` binding. `ok: false` always carries a stable
 * catalog code + user-safe message, never a raw Prisma error (AGENTS.md
 * "Explicit errors"; the DB unique violation is translated, never leaked).
 */
export type EnlaceAuthResult =
  | { ok: true }
  | { ok: false; code: AuthErrorCode; message: string };

/**
 * Reads the immutable Auth identifier off the current session.
 *
 * Returns null — never throws — when there is no session, no user, or the `sub`
 * claim is missing/blank/malformed. `getUser()` (not `getSession()`) is what
 * validates the JWT against Auth rather than trusting cookie contents.
 */
export async function resolverAuthSubDeSesion(
  supabase: SupabaseClient,
): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) return null;
  return normalizarAuthSub(user.id);
}

/**
 * THE per-request identity lookup: `USUARIO` by the immutable Auth `sub`.
 *
 * `findFirst` (not `findUnique`) on purpose: the uniqueness guard is a PARTIAL
 * index created by hand in migration `20260930120000_usuario_auth_user_id`,
 * which Prisma cannot model, so it is not exposed as a `@unique` field. The
 * partial index still serves this query, and it is a single-row lookup by
 * construction (the index admits at most one row per non-NULL `sub`).
 *
 * The caller supplies its own explicit `select`, so no path over-fetches
 * `passwordHash` and the tenant paths keep only the columns they need.
 *
 * Returns null when the row is not linked yet (`authUserId IS NULL`) or when the
 * link does not exist at all.
 */
export async function buscarUsuarioPorAuthSub<TSelect extends Prisma.UsuarioSelect>(
  authSub: string,
  select: TSelect,
): Promise<Prisma.UsuarioGetPayload<{ select: TSelect }> | null> {
  return prisma.$transaction(async (tx) => {
    // ADR-019 / R1.B: the caller has no TenantCtx yet (that is what it is about
    // to resolve), so `usuario_select` is unlocked with the login-flow flag.
    await setLoginFlow(tx);
    return tx.usuario.findFirst({ where: { authUserId: authSub }, select });
  });
}

/**
 * LOGIN-FLOW BOOTSTRAP ONLY — the one place a row is located by `nombreUsuario`.
 * Callers MUST have already verified the credentials via `signInWithPassword`;
 * this merely finds the row to bind.
 *
 * Exported (the login use case lives in `auth-service.ts`) but deliberately NOT
 * used by any per-request path: there is no email-based lookup on the request
 * path. `auth-service.loginWithCredenciales` takes `nombreUsuario` as an
 * already-validated argument, so no session email is decoded here at all.
 */
export async function buscarUsuarioPorNombreUsuario<TSelect extends Prisma.UsuarioSelect>(
  nombreUsuario: string,
  select: TSelect,
): Promise<Prisma.UsuarioGetPayload<{ select: TSelect }> | null> {
  return prisma.$transaction(async (tx) => {
    await setLoginFlow(tx);
    return tx.usuario.findUnique({ where: { nombreUsuario }, select });
  });
}

/**
 * Binds the Auth `sub` onto the `USUARIO` row, once, on the first successful
 * login after the column existed.
 *
 * IDEMPOTENT: re-login with the same `sub` returns `{ ok: true }` without
 * rewriting the column.
 *
 * REFUSES every way the link can fail, never overwriting:
 *   - the row already holds a DIFFERENT `sub` → `AUTH_ENLACE_CONFLICTO`. This
 *     means the Auth user was deleted and recreated with the same email; only an
 *     admin may decide whether to re-point the link.
 *   - a DIFFERENT row already holds this `sub` → the partial unique index
 *     rejects the write (Prisma `P2002`) → `AUTH_ENLACE_DUPLICADO`.
 *   - the row cannot be resolved inside the anchor's company → no sub to compare
 *     against, so nothing is bound → `AUTH_ENLACE_NO_RESUELTO`.
 *
 * RLS NOTE (load-bearing): `usuario_select` honors `app.is_login_flow`, but
 * `usuario_modify` deliberately does NOT, so this UPDATE pins
 * `app.current_empresa_id` to the one resolved company first — the same
 * defense-in-depth shape `registrarAuditoriaSesion` uses. The empresa GUC is
 * pinned to exactly this one company and never widened.
 *
 * TENANT SCOPE (load-bearing): pinning the GUC makes this transaction
 * context-aware, so EVERY statement below also filters `empresaId` explicitly
 * (AGENTS.md: a context-aware query without that filter is a critical bug). The
 * GUC is what RLS enforces; the explicit `empresaId` is what makes the
 * application's own scope legible in the query and survives the day RLS is
 * disabled. Both come from the same `anchor`, so a mismatch is not expressible.
 * A row whose `empresaId` disagrees with the anchor therefore reads as absent
 * and binds nothing — it fails closed as `AUTH_ENLACE_NO_RESUELTO` rather than
 * binding across tenants. That code is deliberately tenant-blind (it never says
 * the row exists elsewhere), so honouring the isolation leaks nothing to the
 * caller while still giving support an honest cause instead of the
 * "access was recreated" story.
 *
 * The write is a compare-and-swap (`WHERE "authUserId" IS NULL`), so two
 * concurrent first logins cannot both bind: the loser reads `count === 0` and
 * falls through to the classification below.
 *
 * `updatedAt` moves on a real bind (Prisma `@updatedAt`); `version` is NOT
 * bumped, because this is a system-owned identity column rather than a
 * user-initiated edit and must not collide with optimistic-locking counters.
 *
 * FORWARD CONSTRAINT (`USUARIO.version`). `version` is this project's
 * optimistic-locking column, and Fase 1.2 CRUD Usuarios will do read-modify-write on
 * the SAME table. A concurrent admin edit that loaded `authUserId: null` before this
 * bind will NOT detect the change — precisely because this write does not bump
 * `version` — so on a full-field update it would try to write the column straight back
 * to `NULL`, silently re-opening the hole this change closes.
 *
 * ENFORCED BY THE DATABASE, NOT ONLY BY CONVENTION: migration
 * `20260930130000_usuario_auth_user_id_no_null` installs the BEFORE UPDATE trigger
 * `trg_usuario_auth_user_id_no_null`, which raises `AUTH_USER_ID_UNBIND` whenever a
 * bound `authUserId` would be written back to `NULL`. So the invariant holds even if a
 * future full-field update ignores every rule in this docblock.
 *
 * The convention remains as DEFENCE IN DEPTH, not as the control: Fase 1.2 admin
 * writes must still never include `authUserId` in their update payload. Omitting it
 * fails as a normal application-level error, where including it now aborts the
 * statement with a raw DB error — correct, but a worse experience and a worse log
 * line than a typed refusal.
 */
export async function enlazarAuthSub(anchor: {
  readonly authSub: string;
  readonly usuarioId: number;
  readonly empresaId: number;
}): Promise<EnlaceAuthResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      await setLoginFlow(tx);
      await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${String(
        anchor.empresaId,
      )}, true)`;

      const actual = await tx.usuario.findUnique({
        where: { id: anchor.usuarioId, empresaId: anchor.empresaId },
        select: { authUserId: true },
      });

      // Already linked to THIS sub → idempotent success, no write.
      if (actual?.authUserId === anchor.authSub) return { ok: true };

      // Linked to a different sub → refuse, do not overwrite.
      if (actual !== null && actual.authUserId !== null) {
        return conflicto();
      }

      const escritos = await tx.usuario.updateMany({
        where: { id: anchor.usuarioId, empresaId: anchor.empresaId, authUserId: null },
        data: { authUserId: anchor.authSub },
      });
      if (escritos.count === 1) return { ok: true };

      // count === 0: either a concurrent transaction linked it first, or the row
      // is not the anchor's company. Both are classified by re-reading the row
      // under the SAME empresa scope — a row outside the anchor's company stays
      // invisible here and therefore can never resolve to a success.
      const trasCarrera = await tx.usuario.findUnique({
        where: { id: anchor.usuarioId, empresaId: anchor.empresaId },
        select: { authUserId: true },
      });
      if (trasCarrera?.authUserId === anchor.authSub) return { ok: true };
      // Unresolvable: the row does not exist, or it is not the anchor's company, or
      // it is still unlinked after losing the CAS. NOT a "different sub" conflict —
      // nothing was found to conflict with. Reporting the conflict code here is what
      // told support "your access was recreated" for a plain missing row.
      if (trasCarrera === null || trasCarrera.authUserId === null) {
        return noResuelto();
      }
      // A sub is there and it is not ours: the row really is bound to another
      // identity (including when a concurrent login won the race with a different
      // sub). That is the genuine conflict, so it keeps `AUTH_ENLACE_CONFLICTO`.
      return conflicto();
    });
  } catch (err) {
    // The partial unique index rejected the sub: another USUARIO row already
    // holds it. Translated to a stable code — never a raw 500 / P2002 string.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        ok: false,
        code: AUTH_ENLACE_DUPLICADO,
        message: messageFor(AUTH_ENLACE_DUPLICADO),
      };
    }
    throw err;
  }
}

function conflicto(): EnlaceAuthResult {
  return {
    ok: false,
    code: AUTH_ENLACE_CONFLICTO,
    message: messageFor(AUTH_ENLACE_CONFLICTO),
  };
}

function noResuelto(): EnlaceAuthResult {
  return {
    ok: false,
    code: AUTH_ENLACE_NO_RESUELTO,
    message: messageFor(AUTH_ENLACE_NO_RESUELTO),
  };
}