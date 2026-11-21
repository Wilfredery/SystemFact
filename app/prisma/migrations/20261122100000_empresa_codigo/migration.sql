-- ============================================================
-- Migration: empresa_codigo
-- odd/tasks/multi-company-codigo.md T1 (S4, S5; contract C1, C2, C3).
--
-- WHY:
--   Every company gets a mandatory, immutable code, and every USUARIO name is
--   `<CODIGO>-<resto>` (global uniqueness of "nombreUsuario" is kept). The rules
--   live in the database, not only in the app:
--
--   C1 "EMPRESA"."codigo" varchar(6) NOT NULL, UNIQUE, CHECK ^[A-Z0-9]{3,6}$.
--      Backfill: id 5 => 'DEMO'; any other existing row => 'E' || lpad(id, 2, '0') (E01..E99,
--      3-4 chars, always valid for the CHECK; ids above 99 only exist outside production
--      and would need a manual code before this migration).
--      Trigger empresa_codigo_immutable (BEFORE UPDATE) raises SQLSTATE 42501
--      when the code changes. There is NO app.is_bootstrap bypass: a wrong code
--      is fixed only by a reviewed migration (which drops/recreates the trigger).
--      "Never reused": codes are not freed because companies are never deleted
--      (AGENTS.md: master entities are deactivated, not deleted).
--
--   C3 Trigger usuario_nombre_prefijo_guard on "USUARIO", BEFORE INSERT OR
--      UPDATE OF "nombreUsuario", "empresaId": the name must equal
--      (codigo of NEW."empresaId") || '-' || resto, with resto matching
--      ^[a-z0-9][a-z0-9._-]{0,56}$ (so the total is <= 64 chars: 6 + 1 + 57 at most).
--      An absent or unreadable EMPRESA row rejects (fail closed). Column-scoped on
--      purpose: login binds "authUserId" on legacy rows and must keep working, so
--      an UPDATE that does not name "nombreUsuario" or "empresaId" in its SET list
--      never fires it (legacy names stay usable until renamed).
--
--   SECURITY INVOKER (default), deliberately NOT DEFINER: the guard reads the
--   session's own EMPRESA row through policy `empresa_select` (pinned empresa or
--   bootstrap). A session that cannot read that row (e.g. a tenant session
--   inserting a user for ANOTHER empresa) is rejected, which is the fail-closed
--   behaviour we want and what RLS would reject anyway. DEFINER would widen reads
--   of EMPRESA for no gain. The table is schema-qualified (public."EMPRESA").
--
-- INTERACTIONS CHECKED:
--   - usuario_login_flow_column_guard (20261114130000) already freezes
--     "nombreUsuario"/"empresaId" under the login flow; triggers fire in name
--     order (usuario_login_flow_column_guard before usuario_nombre_prefijo_guard),
--     so the login-flow refusal message is unchanged. No change to its frozen list
--     (this migration adds no USUARIO column).
--   - RLS policies on USUARIO/EMPRESA are untouched. FORCE RLS on EMPRESA means a
--     non-superuser table owner is also filtered: the backfill therefore declares
--     app.is_bootstrap for this transaction only (set_config is_local = true),
--     and SET NOT NULL fails the migration loudly if any row stayed NULL.
--   - empresa_activa_guard (20261121200000) only looks at "activa": unaffected.
--   - systemfact_app needs no new GRANT (column and triggers, no new table).
--   - Existing USUARIO rows are NOT touched or validated; legacy names stay.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS, backfill only WHERE "codigo" IS NULL,
--   DROP CONSTRAINT/TRIGGER IF EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS,
--   CREATE OR REPLACE FUNCTION, SET NOT NULL (no-op when already set).
-- Prisma shape: varchar(6) + unique index "EMPRESA_codigo_key" == schema.prisma
--   `codigo String @unique @db.VarChar(6)`.
-- NOT applied to production by the agent: the owner approves that separately
--   (odd/tasks/multi-company-codigo.md C5 rollout order).
--
-- ROLLBACK (manual; run as the table owner):
--   DROP TRIGGER IF EXISTS usuario_nombre_prefijo_guard ON "USUARIO";
--   DROP FUNCTION IF EXISTS usuario_nombre_prefijo_guard();
--   DROP TRIGGER IF EXISTS empresa_codigo_immutable ON "EMPRESA";
--   DROP FUNCTION IF EXISTS empresa_codigo_immutable();
--   ALTER TABLE "EMPRESA" DROP CONSTRAINT IF EXISTS "EMPRESA_codigo_formato_check";
--   DROP INDEX IF EXISTS "EMPRESA_codigo_key";
--   ALTER TABLE "EMPRESA" DROP COLUMN IF EXISTS "codigo";
--   (also remove this row from "_prisma_migrations" if it was recorded)
-- ============================================================

-- The immutability trigger must not exist while the column is (re)filled.
DROP TRIGGER IF EXISTS empresa_codigo_immutable ON "EMPRESA";

ALTER TABLE "EMPRESA" ADD COLUMN IF NOT EXISTS "codigo" VARCHAR(6);

-- Backfill (transaction-local bootstrap so FORCE RLS cannot hide rows from a
-- non-superuser owner), then restore the setting.
SELECT set_config('app.is_bootstrap', 'true', true);

UPDATE "EMPRESA"
   SET "codigo" = CASE WHEN "id" = 5 THEN 'DEMO' ELSE 'E' || lpad("id"::text, 2, '0') END
 WHERE "codigo" IS NULL;

SELECT set_config('app.is_bootstrap', '', true);

-- Format first (validates every backfilled row), then uniqueness, then NOT NULL.
ALTER TABLE "EMPRESA" DROP CONSTRAINT IF EXISTS "EMPRESA_codigo_formato_check";
ALTER TABLE "EMPRESA"
  ADD CONSTRAINT "EMPRESA_codigo_formato_check" CHECK ("codigo" ~ '^[A-Z0-9]{3,6}$');

CREATE UNIQUE INDEX IF NOT EXISTS "EMPRESA_codigo_key" ON "EMPRESA"("codigo");

ALTER TABLE "EMPRESA" ALTER COLUMN "codigo" SET NOT NULL;

-- C1: immutable code, no bypass.
CREATE OR REPLACE FUNCTION empresa_codigo_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."codigo" IS DISTINCT FROM OLD."codigo" THEN
    RAISE EXCEPTION 'EMPRESA.codigo is immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER empresa_codigo_immutable
  BEFORE UPDATE ON "EMPRESA"
  FOR EACH ROW
  EXECUTE FUNCTION empresa_codigo_immutable();

-- C2/C3: username prefix must be the company code.
CREATE OR REPLACE FUNCTION usuario_nombre_prefijo_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_codigo text;
  v_prefijo text;
  v_resto text;
BEGIN
  -- Unreadable (RLS) or absent empresa row => v_codigo stays NULL => reject.
  SELECT e."codigo" INTO v_codigo FROM public."EMPRESA" e WHERE e."id" = NEW."empresaId";

  IF v_codigo IS NULL OR NEW."nombreUsuario" IS NULL THEN
    RAISE EXCEPTION 'USUARIO.nombreUsuario must be <CODIGO>-<usuario>: empresa code not readable'
      USING ERRCODE = '42501';
  END IF;

  v_prefijo := v_codigo || '-';
  IF left(NEW."nombreUsuario", length(v_prefijo)) IS DISTINCT FROM v_prefijo THEN
    RAISE EXCEPTION 'USUARIO.nombreUsuario must start with the empresa code and a hyphen'
      USING ERRCODE = '23514';
  END IF;

  v_resto := substr(NEW."nombreUsuario", length(v_prefijo) + 1);
  IF v_resto !~ '^[a-z0-9][a-z0-9._-]{0,56}$' THEN
    RAISE EXCEPTION 'USUARIO.nombreUsuario has an invalid part after the empresa code'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usuario_nombre_prefijo_guard ON "USUARIO";
CREATE TRIGGER usuario_nombre_prefijo_guard
  BEFORE INSERT OR UPDATE OF "nombreUsuario", "empresaId" ON "USUARIO"
  FOR EACH ROW
  EXECUTE FUNCTION usuario_nombre_prefijo_guard();
