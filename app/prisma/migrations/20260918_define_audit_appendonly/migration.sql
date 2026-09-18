-- Auditing hardening (docs/21 hardening rows H5, per 2026-09-18 DB completeness audit):
-- MOVIMIENTO_AUDITORIA is append-only (AGENTS.md / docs/18). Until now the
-- guarantee rested ONLY on the absence of UPDATE/DELETE RLS policies in
-- 20260902120000_enable_rls (denied by default after FORCE), which silently
-- no-ops (0 affected rows) instead of raising an error. A statement-level
-- trigger fires even when the statement matches zero rows and turns any
-- audit mutation attempt into an explicit AUDITORIA_INMUTABLE error,
-- independent of any future RLS policy change or owner bypass attempt.
-- Prisma does not diff SQL triggers (schema.prisma stays trigger-free on
-- purpose); this migration is idempotent via DROP ... IF EXISTS.

CREATE OR REPLACE FUNCTION systemfact_audit_readonly()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AUDITORIA_INMUTABLE: MOVIMIENTO_AUDITORIA is append-only (op=%)', TG_OP
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS movimientoauditoria_appendonly ON "MOVIMIENTO_AUDITORIA";

CREATE TRIGGER movimientoauditoria_appendonly
  BEFORE UPDATE OR DELETE ON "MOVIMIENTO_AUDITORIA"
  FOR EACH STATEMENT
  EXECUTE FUNCTION systemfact_audit_readonly();
