-- ============================================================
-- Migration: usuario_login_flow_column_guard
-- Step 7b (odd/tasks/administracion-writes.md, T1b / S2 hardening).
--
-- WHY:
--   Policy `usuario_update` (20261114120000_usuario_writes_admin_only) lets the
--   login flow UPDATE an unbound "USUARIO" row when the empresa is pinned and
--   "authUserId" goes NULL -> NOT NULL. RLS cannot restrict COLUMNS, so one such
--   UPDATE could also change "passwordHash", "activo", "sucursalId", etc.
--   (native review findings R1/R3). This BEFORE UPDATE trigger closes that gap:
--   under app.is_login_flow = 'true' (and neither es_admin nor is_bootstrap)
--   every column except "authUserId" and the Prisma bookkeeping "updatedAt"
--   (@updatedAt, written by `enlazarAuthSub`'s updateMany) must be IDENTICAL.
--   "version" is NOT exempt: enlazarAuthSub does not touch it.
--
--   Admin and bootstrap writes are unaffected. SECURITY INVOKER (default).
--
-- MAINTENANCE: columns are listed EXPLICITLY on purpose. A column added to
--   "USUARIO" MUST be added to the guard below, otherwise it is unguarded; the
--   integration test usuario-login-flow-columns.integration.test.ts fails when
--   the table and the function drift apart.
--
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS usuario_login_flow_column_guard ON "USUARIO";
--   DROP FUNCTION IF EXISTS usuario_login_flow_column_guard();
-- ============================================================

CREATE OR REPLACE FUNCTION usuario_login_flow_column_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(current_setting('app.is_login_flow', true), '') = 'true'
     AND NOT (
       COALESCE(current_setting('app.current_es_admin', true), '') = 'true'
       OR COALESCE(current_setting('app.is_bootstrap', true), '') = 'true'
     )
  THEN
    -- Allowed to change: "authUserId", "updatedAt". Everything else must match.
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."empresaId" IS DISTINCT FROM OLD."empresaId"
       OR NEW."sucursalId" IS DISTINCT FROM OLD."sucursalId"
       OR NEW."nombre" IS DISTINCT FROM OLD."nombre"
       OR NEW."nombreUsuario" IS DISTINCT FROM OLD."nombreUsuario"
       OR NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash"
       OR NEW."email" IS DISTINCT FROM OLD."email"
       OR NEW."activo" IS DISTINCT FROM OLD."activo"
       OR NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
      RAISE EXCEPTION 'login flow may only change USUARIO.authUserId'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usuario_login_flow_column_guard ON "USUARIO";
CREATE TRIGGER usuario_login_flow_column_guard
  BEFORE UPDATE ON "USUARIO"
  FOR EACH ROW
  EXECUTE FUNCTION usuario_login_flow_column_guard();
