-- LOGIN_INTENTO — ops table for the app-side login brute-force throttle
-- (docs/22 T3, Option B, decided 2026-11-03 and re-confirmed by the owner 2026-11-05).
--
-- Date: 2026-11-05.
-- Decision: ADR-020 (`docs/12-decisiones_de_arquitectura.md`) + docs/22 §T3.
-- Tracking: `odd/tasks/login-brute-force.md` (S5, S6, S7).
--
-- WHY A NON-TENANT TABLE IN A TENANT-FIRST DATABASE:
--   The login Server Action runs BEFORE a session exists, so there is no
--   `empresaId` to scope by, and `withTenantTransaction` cannot be entered (it
--   requires a `TenantCtx`, and login resolves the user by `nombreUsuario`
--   precisely because no tenant context is available yet). The row holds no
--   tenant data at all: an IP, a normalized username, and a timestamp, swept
--   once the window closes. It is a counter, not a record of people.
--
-- WHY RLS HERE IS A PERMISSIVE POLICY FOR THE APP ROLE, NOT A DENY-ALL:
--   The runtime connects as `systemfact_app`, which is NOSUPERUSER NOBYPASSRLS and does NOT own
--   this table (migrations run as the superuser; `tools/scripts/verify-rls.ts` asserts the app
--   role must not own tables). RLS therefore really does apply to the app.
--   A RESTRICTIVE `USING (false)` is ANDed with every permissive policy, so it denies EVERY
--   role, `systemfact_app` included — the first version of this migration did exactly that and
--   the throttle was inert: reads returned zero rows and inserts raised an RLS violation that
--   the fail-open path swallowed. The deny-all posture of `_prisma_migrations` is NOT a
--   precedent here, because the application never queries that table.
--   `anon`/`authenticated` are denied by default: with RLS enabled and no permissive policy
--   matching them, they match nothing. That is the deny-all we want, without a lever that also
--   denies the app.
--
-- REVERSA: DROP TABLE public."LOGIN_INTENTO";
--   Nothing irreplaceable is lost: a dropped counter only forgets one window of
--   failed attempts, and the throttle rebuilds its state from the next failures.

CREATE TABLE "LOGIN_INTENTO" (
    "id" SERIAL NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "nombreUsuarioNormalizado" VARCHAR(255) NOT NULL,
    "creadoEn" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LOGIN_INTENTO_pkey" PRIMARY KEY ("id")
);

-- The throttle's only query shape: count one (ip, username) pair inside a
-- window, then delete that pair's rows on a successful sign-in.
CREATE INDEX "LOGIN_INTENTO_ip_nombreUsuarioNormalizado_creadoEn_idx"
    ON "LOGIN_INTENTO"("ip", "nombreUsuarioNormalizado", "creadoEn");

-- The sweep's predicate is on `creadoEn` ALONE. A compound index cannot serve a query that
-- does not constrain its leading columns, so without this one every login attempt ran an
-- unindexed delete over a growing table — work an attacker could force at will by
-- submitting unique usernames.
CREATE INDEX "LOGIN_INTENTO_creadoEn_idx" ON "LOGIN_INTENTO"("creadoEn");

ALTER TABLE public."LOGIN_INTENTO" ENABLE ROW LEVEL SECURITY;

-- One PERMISSIVE policy, scoped to the runtime role. `anon`/`authenticated` match no policy
-- and are therefore denied without needing a restrictive denominator (see the header).
CREATE POLICY "login_intento_app_role"
  ON public."LOGIN_INTENTO"
  AS PERMISSIVE
  FOR ALL
  TO systemfact_app
  USING (true)
  WITH CHECK (true);
