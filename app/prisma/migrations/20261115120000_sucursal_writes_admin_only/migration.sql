-- ============================================================
-- Migration: sucursal_writes_admin_only
-- Slice B (odd/tasks/administracion-sucursales-crear-editar.md, S2): admin-only
-- writes on "SUCURSAL", optimistic-lock column and unique branch name.
--
-- WHY:
--   `sucursal_isolation` (20260902120000_enable_rls) is FOR ALL with an
--   empresa-only USING/WITH CHECK and NO role check, so ANY authenticated
--   session of the empresa (Operador, Despachador) could create, rewrite or
--   delete branches if the application guard were ever bypassed. Creating and
--   editing branches is now an Administrador feature, so the database becomes
--   the second, independent wall: writes require es_admin = 'true'.
--
-- WHAT:
--   1. `sucursal_isolation` is replaced by
--        - `sucursal_select`: EXACTLY the previous USING (no read widened).
--        - `sucursal_insert` / `sucursal_update`: es_admin = 'true' AND the
--          row belongs to the session empresa (USING and WITH CHECK), OR
--          app.is_bootstrap = 'true' (seed/provisioning).
--        - `sucursal_delete`: bootstrap only. Branches are master entities with
--          history (every document table references "sucursalId" with
--          Restrict): nobody deletes one through the application.
--      No GRANT change (systemfact_app already has the privileges; RLS is the
--      only wall). FORCE ROW LEVEL SECURITY stays as it is.
--   2. "SUCURSAL"."version" INTEGER NOT NULL DEFAULT 1 (optimistic locking,
--      Directiva section 10; the other concurrently edited masters have it).
--   3. Functional UNIQUE index on ("empresaId", lower(btrim("nombre"))): a
--      branch name is unique per empresa, trimmed and case-insensitive, counting
--      inactive branches. Prisma cannot express it, so it lives only here
--      (schema.prisma carries a comment next to the model).
--
-- IDEMPOTENT: DROP POLICY IF EXISTS ... then CREATE; ADD COLUMN IF NOT EXISTS;
-- CREATE UNIQUE INDEX IF NOT EXISTS. Additive: the previous application code
-- never writes "SUCURSAL", so it keeps working against the migrated database.
--
-- ROLLBACK (restores the previous FOR ALL policy, drops index and column):
--   DROP INDEX IF EXISTS "SUCURSAL_empresaId_nombre_lower_key";
--   ALTER TABLE "SUCURSAL" DROP COLUMN IF EXISTS "version";
--   DROP POLICY IF EXISTS sucursal_select ON "SUCURSAL";
--   DROP POLICY IF EXISTS sucursal_insert ON "SUCURSAL";
--   DROP POLICY IF EXISTS sucursal_update ON "SUCURSAL";
--   DROP POLICY IF EXISTS sucursal_delete ON "SUCURSAL";
--   CREATE POLICY sucursal_isolation ON "SUCURSAL"
--     FOR ALL
--     USING (
--       COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
--       OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
--     )
--     WITH CHECK (
--       COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
--       OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
--     );
-- ============================================================

DROP POLICY IF EXISTS sucursal_isolation ON "SUCURSAL";
DROP POLICY IF EXISTS sucursal_select ON "SUCURSAL";
DROP POLICY IF EXISTS sucursal_insert ON "SUCURSAL";
DROP POLICY IF EXISTS sucursal_update ON "SUCURSAL";
DROP POLICY IF EXISTS sucursal_delete ON "SUCURSAL";

-- Exactly the previous USING (bootstrap exception included).
CREATE POLICY sucursal_select ON "SUCURSAL"
  FOR SELECT
  USING (
    COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

CREATE POLICY sucursal_insert ON "SUCURSAL"
  FOR INSERT
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

CREATE POLICY sucursal_update ON "SUCURSAL"
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

-- Nobody deletes a branch through the application.
CREATE POLICY sucursal_delete ON "SUCURSAL"
  FOR DELETE
  USING (
    COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

ALTER TABLE "SUCURSAL" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS "SUCURSAL_empresaId_nombre_lower_key"
  ON "SUCURSAL" ("empresaId", lower(btrim("nombre")));
