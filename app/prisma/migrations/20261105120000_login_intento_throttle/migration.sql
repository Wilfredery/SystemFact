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
-- WHY RLS + A DENY-ALL RESTRICTIVE POLICY ON A TABLE ONLY THE APP WRITES:
--   `pnpm rls:verify` fails CI when any table has RLS disabled OR zero policies,
--   and that guard earns its keep — it is how `_prisma_migrations` was caught.
--   The deny-all policy means PostgREST roles (`anon`, `authenticated`) can
--   neither read nor write this table even if a grant were added by mistake,
--   so the counter cannot be spammed or harvested through the data API. Prisma
--   connects as the table owner, which bypasses RLS because FORCE is
--   deliberately NOT set — the same posture, and the same reasoning, as
--   `20261104230000_prisma_migrations_enable_rls`.
--
-- REVERSA: DROP TABLE public."LOGIN_INTENTO";
--   Nothing irreplaceable is lost: a dropped counter only forgets one window of
--   failed attempts, and the throttle rebuilds its state from the next failures.

CREATE TABLE public."LOGIN_INTENTO" (
    "id" SERIAL NOT NULL,
    "ip" VARCHAR(45) NOT NULL,
    "nombreUsuarioNormalizado" VARCHAR(255) NOT NULL,
    "creadoEn" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "LOGIN_INTENTO_pkey" PRIMARY KEY ("id")
);

-- The throttle's only query shape: count one (ip, username) pair inside a
-- window, then delete that pair's rows on a successful sign-in.
CREATE INDEX "LOGIN_INTENTO_ip_nombreUsuarioNormalizado_creadoEn_idx"
    ON public."LOGIN_INTENTO" ("ip", "nombreUsuarioNormalizado", "creadoEn");

ALTER TABLE public."LOGIN_INTENTO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "login_intento_deny_all" ON public."LOGIN_INTENTO";

CREATE POLICY "login_intento_deny_all"
  ON public."LOGIN_INTENTO"
  AS RESTRICTIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);
