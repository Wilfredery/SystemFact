-- ============================================================
-- Migration: create_app_role
-- Date: 2026-09-02
--
-- Crea el rol dedicado systemfact_app con NO BYPASSRLS, para que
-- las queries de la app respeten las RLS policies (ADR-019).
--
-- Esta migration es IDEMPOTENTE: puede aplicarse múltiples veces
-- sin error (CREATE ROLE gated por IF NOT EXISTS, GRANTs son
-- idempotentes por naturaleza).
--
-- Historia:
--   - En Supabase, este rol fue creado vía Supabase MCP apply_migration
--     (no como archivo Prisma) antes de que existiera esta migration.
--   - Localmente, fue creado vía psql directo durante el setup inicial.
--   - Esta migration unifica ambos caminos y permite `migrate reset`
--     sin perder el rol.
--
-- IMPORTANTE: si RLS ya estaba activo en la BD (via migraciones previas),
-- el GRANT funciona como está. Si no, esta migration no agrega RLS.
-- El bypass de postgres role se maneja en 20260902140000_disable_rls_bypass.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'systemfact_app') THEN
    CREATE ROLE systemfact_app WITH LOGIN PASSWORD 'SF_App_2026' NOSUPERUSER NOBYPASSRLS;
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