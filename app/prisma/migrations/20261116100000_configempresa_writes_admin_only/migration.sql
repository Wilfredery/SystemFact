-- ============================================================
-- Migration: configempresa_writes_admin_only
-- Feature itbis-tasas-edit (odd/tasks/itbis-tasas-edit.md, S4): admin-only
-- writes on "CONFIGURACION_EMPRESA".
--
-- WHY:
--   `configempresa_isolation` (20260902120000_enable_rls, lines ~237-249) is
--   FOR ALL with an empresa-only USING/WITH CHECK and NO role check, so ANY
--   authenticated session of the empresa (Operador, Despachador) could create,
--   rewrite or delete configuration rows if the application guard were ever
--   bypassed. From the ITBIS rate-list feature the table carries a fiscal
--   parameter (TASA_ITBIS), and the new Administracion edit screen makes
--   writing it an Administrador feature. The database becomes the second,
--   independent wall: writes require es_admin = 'true'.
--
-- WHAT:
--   `configempresa_isolation` is replaced by
--     - `configempresa_select`: EXACTLY the previous USING (no read widened).
--     - `configempresa_insert` / `configempresa_update`: es_admin = 'true'
--       AND the row belongs to the session empresa (WITH CHECK / USING+CHECK),
--       OR app.is_bootstrap = 'true' (seed/provisioning).
--     - `configempresa_delete`: bootstrap only. Configuration rows are master
--       history (the rate editor closes windows and opens new rows; nothing
--       deletes a row through the application).
--   No GRANT change (systemfact_app already has the privileges; RLS is the
--   only wall). FORCE ROW LEVEL SECURITY stays as it is. No column or index
--   change: "version" (optimistic locking, 20260901192519) and the unique
--   (empresaId, clave, vigenciaInicio) already exist.
--
-- IDEMPOTENT: DROP POLICY IF EXISTS ... then CREATE. Additive in effect: the
-- previous application code NEVER writes "CONFIGURACION_EMPRESA" (writes were
-- seed migrations and the bypassing `postgres` role only), so it keeps
-- working against the migrated database.
--
-- ROLLBACK (restores the previous FOR ALL policy):
--   DROP POLICY IF EXISTS configempresa_select ON "CONFIGURACION_EMPRESA";
--   DROP POLICY IF EXISTS configempresa_insert ON "CONFIGURACION_EMPRESA";
--   DROP POLICY IF EXISTS configempresa_update ON "CONFIGURACION_EMPRESA";
--   DROP POLICY IF EXISTS configempresa_delete ON "CONFIGURACION_EMPRESA";
--   CREATE POLICY configempresa_isolation ON "CONFIGURACION_EMPRESA"
--     FOR ALL
--     USING (
--       COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
--     )
--     WITH CHECK (
--       COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
--     );
-- ============================================================

DROP POLICY IF EXISTS configempresa_isolation ON "CONFIGURACION_EMPRESA";
DROP POLICY IF EXISTS configempresa_select ON "CONFIGURACION_EMPRESA";
DROP POLICY IF EXISTS configempresa_insert ON "CONFIGURACION_EMPRESA";
DROP POLICY IF EXISTS configempresa_update ON "CONFIGURACION_EMPRESA";
DROP POLICY IF EXISTS configempresa_delete ON "CONFIGURACION_EMPRESA";

-- Exactly the previous USING (no bootstrap exception in the original policy;
-- reads stay empresa-scoped only).
CREATE POLICY configempresa_select ON "CONFIGURACION_EMPRESA"
  FOR SELECT
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
  );

CREATE POLICY configempresa_insert ON "CONFIGURACION_EMPRESA"
  FOR INSERT
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

CREATE POLICY configempresa_update ON "CONFIGURACION_EMPRESA"
  FOR UPDATE
  USING (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

-- Nobody deletes a configuration row through the application.
CREATE POLICY configempresa_delete ON "CONFIGURACION_EMPRESA"
  FOR DELETE
  USING (
    COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );
