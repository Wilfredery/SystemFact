-- ============================================================
-- Migration: usuario_writes_admin_only
-- Step 7b (odd/tasks/administracion-writes.md, S2): role-aware writes on
-- "USUARIO" and "USUARIO_ROL".
--
-- WHY:
--   `usuario_modify` (20260902120000_enable_rls) and `usuariorol_isolation`
--   (20260925120000_fix_usuariorol_login_flow) are FOR ALL with tenant+branch
--   scope and NO role check, so ANY authenticated session of the branch
--   (Operador, Despachador) could rewrite users and role assignments if the
--   application guard were ever bypassed. `app.current_es_admin` is already set
--   by withTenantTransaction but no policy read it. This migration makes the
--   database the second, independent wall: writes require es_admin = 'true'.
--
-- WHAT:
--   Each FOR ALL policy is replaced by
--     - a SELECT policy with EXACTLY the previous USING (USUARIO keeps its
--       existing `usuario_select` untouched; USUARIO_ROL gets
--       `usuariorol_select` = the old USING, login-flow/bootstrap included).
--       No SELECT is widened.
--     - separate INSERT / UPDATE / DELETE policies: same tenant+branch scope
--       AND es_admin = 'true', OR app.is_bootstrap = 'true' (seed/provisioning).
--
--   LOGIN-FLOW EXCEPTION (USUARIO UPDATE only, deliberately minimal):
--   `enlazarAuthSub` (auth/infrastructure/auth-identity.ts) binds the Auth `sub`
--   lazily at first login. It runs with app.is_login_flow = 'true', the empresa
--   GUC pinned to the one resolved company, and NO es_admin (the user is not
--   authenticated into a tenant yet). So the UPDATE policy has an explicit
--   branch for exactly that case: is_login_flow = 'true' AND empresa pinned AND
--   the row currently unbound ("authUserId" IS NULL, USING) AND the new row is
--   bound ("authUserId" IS NOT NULL, WITH CHECK). It cannot unbind, re-bind a
--   bound row, or move a row to another empresa. USUARIO_ROL has NO login-flow
--   write branch (the login flow only reads it). INSERT/DELETE on USUARIO have
--   none either.
--
--   ROL writes stay bootstrap-only (untouched). Audit stays append-only
--   (untouched). FORCE ROW LEVEL SECURITY stays as it is. No service-role key.
--
-- IDEMPOTENT: DROP POLICY IF EXISTS ... then CREATE.
--
-- ROLLBACK (restores the previous FOR ALL policies):
--   DROP POLICY IF EXISTS usuario_insert ON "USUARIO";
--   DROP POLICY IF EXISTS usuario_update ON "USUARIO";
--   DROP POLICY IF EXISTS usuario_delete ON "USUARIO";
--   CREATE POLICY usuario_modify ON "USUARIO" FOR ALL
--     USING (
--       COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
--       AND (
--         COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
--         OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
--       )
--       OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
--     )
--     WITH CHECK (
--       COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
--       AND (
--         COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
--         OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
--       )
--       OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
--     );
--   DROP POLICY IF EXISTS usuariorol_select ON "USUARIO_ROL";
--   DROP POLICY IF EXISTS usuariorol_insert ON "USUARIO_ROL";
--   DROP POLICY IF EXISTS usuariorol_update ON "USUARIO_ROL";
--   DROP POLICY IF EXISTS usuariorol_delete ON "USUARIO_ROL";
--   then re-run the CREATE POLICY usuariorol_isolation statement of
--   20260925120000_fix_usuariorol_login_flow/migration.sql.
-- ============================================================

-- ─── USUARIO ───────────────────────────────────────────────────────────
-- usuario_select is NOT touched (same USING as today).
DROP POLICY IF EXISTS usuario_modify ON "USUARIO";
DROP POLICY IF EXISTS usuario_insert ON "USUARIO";
DROP POLICY IF EXISTS usuario_update ON "USUARIO";
DROP POLICY IF EXISTS usuario_delete ON "USUARIO";

CREATE POLICY usuario_insert ON "USUARIO"
  FOR INSERT
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

CREATE POLICY usuario_update ON "USUARIO"
  FOR UPDATE
  USING (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
    -- Login flow: only the lazy bind of an UNBOUND row inside the pinned empresa.
    OR (
      COALESCE(NULLIF(current_setting('app.is_login_flow', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
      AND "authUserId" IS NULL
    )
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
    OR (
      COALESCE(NULLIF(current_setting('app.is_login_flow', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
      AND "authUserId" IS NOT NULL
    )
  );

CREATE POLICY usuario_delete ON "USUARIO"
  FOR DELETE
  USING (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = "empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR "sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

-- ─── USUARIO_ROL ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS usuariorol_isolation ON "USUARIO_ROL";
DROP POLICY IF EXISTS usuariorol_select ON "USUARIO_ROL";
DROP POLICY IF EXISTS usuariorol_insert ON "USUARIO_ROL";
DROP POLICY IF EXISTS usuariorol_update ON "USUARIO_ROL";
DROP POLICY IF EXISTS usuariorol_delete ON "USUARIO_ROL";

-- Exactly the previous USING (login-flow and bootstrap exceptions included).
CREATE POLICY usuariorol_select ON "USUARIO_ROL"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "USUARIO" u
      WHERE u.id = "USUARIO_ROL"."usuarioId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = u."empresaId"
      AND (
        COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
        OR u."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_login_flow', true), ''), '') = 'true'
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

CREATE POLICY usuariorol_insert ON "USUARIO_ROL"
  FOR INSERT
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND EXISTS (
        SELECT 1 FROM "USUARIO" u
        WHERE u.id = "USUARIO_ROL"."usuarioId"
        AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = u."empresaId"
        AND (
          COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
          OR u."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
        )
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

CREATE POLICY usuariorol_update ON "USUARIO_ROL"
  FOR UPDATE
  USING (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND EXISTS (
        SELECT 1 FROM "USUARIO" u
        WHERE u.id = "USUARIO_ROL"."usuarioId"
        AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = u."empresaId"
        AND (
          COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
          OR u."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
        )
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  )
  WITH CHECK (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND EXISTS (
        SELECT 1 FROM "USUARIO" u
        WHERE u.id = "USUARIO_ROL"."usuarioId"
        AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = u."empresaId"
        AND (
          COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
          OR u."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
        )
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );

CREATE POLICY usuariorol_delete ON "USUARIO_ROL"
  FOR DELETE
  USING (
    (
      COALESCE(NULLIF(current_setting('app.current_es_admin', true), ''), '') = 'true'
      AND EXISTS (
        SELECT 1 FROM "USUARIO" u
        WHERE u.id = "USUARIO_ROL"."usuarioId"
        AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = u."empresaId"
        AND (
          COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '') = ''
          OR u."sucursalId" = COALESCE(NULLIF(current_setting('app.current_sucursal_id', true), ''), '0')::int
        )
      )
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );
