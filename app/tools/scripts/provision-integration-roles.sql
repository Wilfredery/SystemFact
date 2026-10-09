-- ============================================================
-- Provisioning: local integration-database roles (RLS-safe)
-- Date: 2026-10-09
--
-- PURPOSE
--   Reprovisions, from scratch and IDEMPOTENTLY, everything the
--   integration-test harness needs at the ROLE level. This exists
--   because the local Docker harness (container `sf-postgres`, port
--   5433) keeps its roles OUT-of-band: if the container or the volume
--   is ever recreated, the roles and the privilege the concurrency
--   "race parking" protocol depends on silently vanish.
--
--   The race-parking poller (pg_stat_activity usage in
--   confirmar-venta / venta-lifecycle / compra-concurrency /
--   devolucion-concurrency integration suites) reads
--   wait_event_type/wait_event of OTHER connections. Without the
--   pg_read_all_stats role membership Postgres hides those columns
--   from non-superusers (`query` renders as `<insufficient
--   privilege>`), the poller never counts the parked waiters, and
--   every concurrency suite times out with
--   "Race parking failed: fewer than two transactions are waiting".
--   CI passes because the pollers there also connect as the SAME role
--   they seeded the racers with (same-user rows keep wait columns
--   visible); the grant below makes LOCAL behave the same way
--   regardless of which role was used to seed the racers.
--
-- HOW TO RUN (once per container/volume recreate, from the repo root)
--   docker exec -i sf-postgres psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < app/tools/scripts/provision-integration-roles.sql
--   Safe against any database; only grants at the cluster/role level are
--   DB-scoped, everything else is global.
--
-- STILL OUT-OF-BAND by design (secrets/config, never in the repo):
--   - CREATE DATABASE systemfact_test (CI creates it; locally created once).
--   - Role passwords:
--       ALTER ROLE systemfact_app WITH PASSWORD '<local-app-pass>';
--       ALTER ROLE it_migrator   WITH PASSWORD '<local-migrator-pass>';
--     then update app/.env / app/.env.integration accordingly.
--
-- Idempotent: safe to re-run any number of times.
-- ============================================================

-- 1. Roles (parity with migration 20260902150000_create_app_role).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'systemfact_app') THEN
    CREATE ROLE systemfact_app WITH LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'it_migrator') THEN
    CREATE ROLE it_migrator WITH LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- 2. Race-parking visibility (the reason this script exists).
GRANT pg_read_all_stats TO systemfact_app, it_migrator;

-- 3. DDL grants (mirror of create_app_role, re-applied here so a fresh
--    container does not depend on `prisma migrate deploy` having run first).
GRANT CONNECT ON DATABASE postgres TO systemfact_app, it_migrator;
GRANT USAGE ON SCHEMA public TO systemfact_app, it_migrator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO systemfact_app, it_migrator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO systemfact_app, it_migrator;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  TO systemfact_app, it_migrator;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO systemfact_app, it_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO systemfact_app, it_migrator;

-- 4. Self-verifying summary (raises a NOTICE, never throws).
DO $$
DECLARE
  missing_roles text[];
  missing_stats text[];
  non_connect   text[];
  any_issue     boolean;
BEGIN
  SELECT array_agg(rol)
    INTO missing_roles
    FROM unnest(ARRAY['systemfact_app', 'it_migrator']::text[]) AS rol
   WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol);

  SELECT array_agg(rol)
    INTO missing_stats
    FROM unnest(ARRAY['systemfact_app', 'it_migrator']::text[]) AS rol
   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol)
     AND NOT pg_has_role(rol, 'pg_read_all_stats', 'member');

  SELECT array_agg(rol)
    INTO non_connect
    FROM unnest(ARRAY['systemfact_app', 'it_migrator']::text[]) AS rol
   WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol)
     AND EXISTS (SELECT 1 FROM pg_database WHERE datname = 'systemfact_test')
     AND NOT has_database_privilege(rol, 'systemfact_test', 'CONNECT');

  any_issue := missing_roles IS NOT NULL
            OR missing_stats IS NOT NULL
            OR non_connect  IS NOT NULL;

  RAISE NOTICE 'provision-integration-roles: missing_roles=% missing_pg_read_all_stats=% missing_connect_on_systemfact_test=%',
    COALESCE(missing_roles, ARRAY[]::text[]),
    COALESCE(missing_stats, ARRAY[]::text[]),
    COALESCE(non_connect,  ARRAY[]::text[]);

  IF any_issue THEN
    RAISE WARNING 'provision-integration-roles: verification FAILED (details above) — rerun this script and inspect.';
  ELSE
    RAISE NOTICE 'OK - local integration harness roles provisioned and verified.';
  END IF;
END $$;
