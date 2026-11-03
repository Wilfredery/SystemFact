-- ============================================================
-- Provisioning: local integration DATABASE ownership (RLS-safe)
-- Date: 2026-11-03 (local Postgres 16 -> 17.6 engine parity)
--
-- PURPOSE
--   `provision-integration-roles.sql` fixes cluster-level ROLES and GRANTS.
--   This script fixes DB-level OWNERSHIP, which is the other half the local Jest
--   harness silently depends on:
--
--     - `app/.env.integration` points DIRECT_URL at `it_migrator`;
--     - `truncateAll()` (src/integration/setup/fixtures.ts) runs
--       `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` through that client, and
--       TRUNCATE requires table ownership or an explicit TRUNCATE grant (the
--       role provisioning grants SELECT/INSERT/UPDATE/DELETE, NOT TRUNCATE);
--     - `20260902140000_disable_rls_bypass` executes
--       `ALTER ROLE postgres NOBYPASSRLS`, which only a superuser may run.
--
--   Those two constraints are what force this order: migrate as `postgres`
--   (superuser), then hand object ownership to `it_migrator`.
--
--   CI does NOT need this file: the workflow writes `.env.integration` with
--   DIRECT_URL = the superuser, so tables stay owned by postgres there and
--   TRUNCATE works as the owner.
--
--   Why this file exists at all: recreating the Docker volume breaks the local
--   harness with `permission denied for table FACTURA` (SQLSTATE 42501). That
--   was rediscovered by hand on 2026-11-03 during the 16 -> 17.6 move; it should
--   not have to be rediscovered a third time.
--
-- HOW TO RUN (fresh volume, from the repo root)
--   1. docker exec -i sf-postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--        -c "CREATE DATABASE systemfact_test OWNER it_migrator"
--   2. cd app && DIRECT_URL="<superuser URL to systemfact_test>" \
--        DATABASE_URL="<same>" pnpm exec prisma migrate deploy
--   3. docker exec -i sf-postgres psql -U postgres -d systemfact_test \
--        -v ON_ERROR_STOP=1 < app/tools/scripts/provision-integration-roles.sql
--   4. docker exec -i sf-postgres psql -U postgres -d systemfact_test \
--        -v ON_ERROR_STOP=1 -f - < app/tools/scripts/provision-integration-db.sql
--      (the `-f -` keeps psql reading this file's `\gexec` from stdin)
--
-- Idempotent: ALTER ... OWNER TO an already-correct object is a no-op, so this
-- is safe to re-run after any volume recreate, restore or migrate deploy.
-- ============================================================

-- `REASSIGN OWNED BY postgres TO it_migrator` is deliberately NOT used: it
-- aborts with "cannot reassign ownership of objects owned by role postgres
-- because they are required by the database system" (the plpgsql extension is
-- owned by postgres and cannot move). Generate exact ALTERs for the objects the
-- harness actually touches instead.
select format('ALTER TABLE %I.%I OWNER TO it_migrator', schemaname, tablename)
  from pg_tables
 where schemaname = 'public'
union all
select format('ALTER SEQUENCE %I.%I OWNER TO it_migrator', schemaname, sequencename)
  from pg_sequences
 where schemaname = 'public'
union all
select format('ALTER FUNCTION %s OWNER TO it_migrator', p.oid::regprocedure)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
\gexec
