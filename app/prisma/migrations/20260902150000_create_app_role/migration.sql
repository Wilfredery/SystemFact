-- ============================================================
-- Migration: create_app_role
-- Date: 2026-09-02
-- Updated: 2026-09-02 — password set OUT-OF-BAND (security)
--
-- Crea el rol dedicado systemfact_app con NO BYPASSRLS, para que
-- las queries de la app respeten las RLS policies (ADR-019).
--
-- Esta migration es IDEMPOTENTE: puede aplicarse múltiples veces
-- sin error (CREATE ROLE gated por IF NOT EXISTS, GRANTs son
-- idempotentes por naturaleza).
--
-- IMPORTANTE — Password NO se setea aquí:
--   Esta migration crea el rol SIN password. El password debe setearse
--   out-of-band (nunca en el repo):
--     - Local dev: ver SETUP-LOCAL.md sección "Roles y permisos"
--     - Supabase prod: secrets manager del equipo de operaciones
--   Si tu BD local quedó con el password legacy hardcoded de versiones
--   anteriores, rotalo:
--     ALTER ROLE systemfact_app WITH PASSWORD '<nuevo>';
--   y actualiza DATABASE_URL en .env. NO commitees el nuevo password.
--
-- Historia:
--   - En Supabase, este rol fue creado vía Supabase MCP apply_migration
--     (no como archivo Prisma) antes de que existiera esta migration.
--   - Localmente, fue creado vía psql directo durante el setup inicial.
--   - Esta migration unifica ambos caminos y permite `migrate reset`
--     sin perder el rol.
--
-- El bypass de postgres role se maneja en 20260902140000_disable_rls_bypass.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'systemfact_app') THEN
    CREATE ROLE systemfact_app WITH LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

GRANT CONNECT ON DATABASE postgres TO systemfact_app;
GRANT USAGE ON SCHEMA public TO systemfact_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO systemfact_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO systemfact_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO systemfact_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO systemfact_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO systemfact_app;