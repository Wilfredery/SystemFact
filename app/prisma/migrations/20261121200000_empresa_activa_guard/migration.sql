-- ============================================================
-- Migration: empresa_activa_guard
-- odd/tasks/empresa-activa-enforcement.md (S3).
--
-- WHY:
--   "EMPRESA"."activa" is the tenant kill switch: the application refuses login
--   and per-request sessions for an inactive empresa. Policy `empresa_modify`
--   (20260902120000_enable_rls) lets ANY session pinned to the empresa UPDATE its
--   own row, and RLS cannot restrict COLUMNS, so a tenant session (even a
--   non-admin) could flip "activa" and switch the tenant on or off. This BEFORE
--   UPDATE trigger makes "activa" changeable ONLY in bootstrap mode
--   (app.is_bootstrap = 'true', i.e. operator tooling). Every other column stays
--   updatable under the existing policy. INSERT and DELETE are unchanged.
--
--   An UPDATE that leaves "activa" as it was (including one that rewrites the
--   same value) is allowed. An unset / empty app.is_bootstrap counts as NOT
--   bootstrap (fail closed). SECURITY INVOKER (default).
--
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS.
-- NOT applied to production by the agent: the owner approves that separately.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS empresa_activa_guard ON "EMPRESA";
--   DROP FUNCTION IF EXISTS empresa_activa_guard();
-- ============================================================

CREATE OR REPLACE FUNCTION empresa_activa_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."activa" IS DISTINCT FROM OLD."activa"
     AND COALESCE(current_setting('app.is_bootstrap', true), '') <> 'true'
  THEN
    RAISE EXCEPTION 'EMPRESA.activa may only be changed in bootstrap mode'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS empresa_activa_guard ON "EMPRESA";
CREATE TRIGGER empresa_activa_guard
  BEFORE UPDATE ON "EMPRESA"
  FOR EACH ROW
  EXECUTE FUNCTION empresa_activa_guard();
