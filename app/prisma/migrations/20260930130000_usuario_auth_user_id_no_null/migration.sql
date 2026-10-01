-- ============================================================
-- Migration: usuario_auth_user_id_no_null
-- Audit remediation finding v2r-01 (ADR-014 binding hardening) -- follow-up to
-- 20260930120000_usuario_auth_user_id
--
-- WHY (the invariant being enforced):
--   `USUARIO."authUserId"` is the system's IDENTITY ANCHOR: it is the one value every
--   per-request path resolves a session by. Once a row holds a value, that value must
--   never return to NULL.
--
--   The only protection until now was a DOCBLOCK on `enlazarAuthSub` ("Fase 1.2 admin
--   writes must never include `authUserId` in their update payload"). A comment is not
--   a control. `authUserId` is a plain nullable column, so a future full-field admin
--   UPDATE (Fase 1.2 CRUD Usuarios does read-modify-write on this very table) that
--   loaded a stale `authUserId: null` writes it straight back to NULL and SILENTLY
--   re-opens the exact hole this migration series closes: the session stops resolving
--   by `sub`, and the per-request path deliberately has NO email fallback to catch it.
--   `USUARIO.version` does not help either, precisely because `enlazarAuthSub` does not
--   bump it.
--
-- WHAT:
--   A BEFORE UPDATE ... FOR EACH ROW trigger on "USUARIO" that raises when a bound
--   `authUserId` would be un-bound (OLD IS NOT NULL AND NEW IS NULL).
--
-- SCOPE -- deliberately narrow, so no existing write path is blocked:
--   - NULL -> <sub>   stays legal. That is the lazy first-login binding `enlazarAuthSub`
--                      performs, and it is the ONLY write to this column in the app.
--   - <subA> -> <subB> is left alone. Re-pointing stays governed by the existing partial
--                      unique index plus the application-level compare-and-swap, so this
--                      trigger adds no new policy to reason about.
--   - NULL -> NULL and updates that omit the column are unaffected.
--
-- FOR EACH ROW, not FOR EACH STATEMENT (unlike the append-only audit trigger in
-- 20260918_define_audit_appendonly): the check needs OLD and NEW, and an UPDATE that
-- matches zero rows has no binding to un-bind, so it must NOT raise.
--
-- The message is operator-facing, not user-facing: the application translates failures
-- into catalog codes and never surfaces raw error text (AGENTS.md "Errors"). Anyone
-- reaching this exception is looking at a write that should not have been attempted,
-- so it names the row and points at the cause.
--
-- Prisma does not diff SQL triggers (schema.prisma stays trigger-free on purpose, as in
-- 20260918_define_audit_appendonly); this migration is idempotent via
-- CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_usuario_auth_user_id_no_null ON "USUARIO";
--   DROP FUNCTION IF EXISTS systemfact_usuario_auth_user_id_no_null();
-- ============================================================

CREATE OR REPLACE FUNCTION systemfact_usuario_auth_user_id_no_null()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."authUserId" IS NOT NULL AND NEW."authUserId" IS NULL THEN
    RAISE EXCEPTION 'AUTH_USER_ID_UNBIND: refusing to NULL "USUARIO"."authUserId" (id=%, usuario=%): the Auth sub binding is the identity anchor (audit v2r-01). Re-point the link explicitly, never clear it.',
      OLD.id, OLD."nombreUsuario"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_usuario_auth_user_id_no_null ON "USUARIO";

CREATE TRIGGER trg_usuario_auth_user_id_no_null
  BEFORE UPDATE ON "USUARIO"
  FOR EACH ROW
  EXECUTE FUNCTION systemfact_usuario_auth_user_id_no_null();

COMMENT ON FUNCTION systemfact_usuario_auth_user_id_no_null() IS
  'BEFORE UPDATE guard (audit v2r-01): raises AUTH_USER_ID_UNBIND when a bound USUARIO.authUserId would be written back to NULL. The binding is the identity anchor; silently clearing it re-opens the email-tamper vulnerability class that 20260930120000_usuario_auth_user_id closed. NULL -> <sub> remains legal (lazy first-login binding).';
