-- Fixes usuariorol_isolation to honor the documented is_login_flow exception pair
-- (20260902120000_enable_rls header lines 18-20: USUARIO + USUARIO_ROL auth findUnique).
DROP POLICY IF EXISTS usuariorol_isolation ON "USUARIO_ROL";
CREATE POLICY usuariorol_isolation ON "USUARIO_ROL"
  FOR ALL
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
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "USUARIO" u
      WHERE u.id = "USUARIO_ROL"."usuarioId"
      AND COALESCE(NULLIF(current_setting('app.current_empresa_id', true), ''), '0')::int = u."empresaId"
    )
    OR COALESCE(NULLIF(current_setting('app.is_bootstrap', true), ''), '') = 'true'
  );
