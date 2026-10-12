-- Prisma internal coverage table `_prisma_migrations` lint hygiene (2026-10-12
-- Supabase advisors run, security lint `rls_enabled_no_policy`, INFO severity).
-- _prisma_migrations is Prisma's own migration-ledger table (created outside the
-- schema.prisma model graph, so `prisma migrate diff` will NOT manage its RLS).
-- 20260902120000_enable_rls left it FORCE RLS with zero policies, which relies on
-- Postgres' implicit deny-by-default: every role EXCEPT the table OWNER and
-- superusers is silently denied. That is secure, but invisible to auditors and
-- flagged forever by the Supabase linter as "enabled but without policies".
--
-- This migration makes the deny EXPLICIT with a RESTRICTIVE deny-all policy:
--   * RESTRICTIVE policies further restrict any other policy that might ever be
--     added, so the guarantee cannot be silently weakened by a later permissive
--     policy mistake;
--   * USING (false) and WITH CHECK (false) deny both reads and writes for every
--     role the policy applies to (PUBLIC);
--   * Prisma migrate deploy and operator maintenance always connect as the
--     table owner / superuser, which bypass RLS as designed (the launcher
--     app/tools/scripts/supabase-prod-migrate.ps1 keeps running migrations from
--     the operator machine, never from cloud builds).
--
-- Behavior for the application is unchanged: the app runs as the non-owner
-- `systemfact_app` role and never selects from this table; the migration-ledger
-- state stays exactly where it was, pinned to explicit statements.

DROP POLICY IF EXISTS "prisma_migrations_deny_all"
  ON public."_prisma_migrations";

CREATE POLICY "prisma_migrations_deny_all"
  ON public."_prisma_migrations"
  AS RESTRICTIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);
