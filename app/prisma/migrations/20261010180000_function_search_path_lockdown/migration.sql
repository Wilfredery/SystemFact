-- ============================================================
-- Migration: function_search_path_lockdown
-- Fixes Supabase security lint 0011 (function_search_path_mutable):      [WARN]
--   public.systemfact_audit_readonly()        (20260918_define_audit_appendonly)
--   public.systemfact_usuario_auth_user_id_no_null() (20260930130000_usuario_auth_user_id_no_null)
--
-- WHY (the attack class):
--   A trigger function without a pinned search_path runs with the search_path of
--   the ROLE invoking it. Any session that can `SET search_path` before firing
--   the trigger (a compromised app role, or the RLS-bound role being steered)
--   can make an UNQUALIFIED object reference inside the function body resolve to
--   a attacker-controlled schema/function instead. These functions never touch a
--   table contextually, but the hardening is to leave NOTHING resolvable.

-- WHAT:
--   Pin BOTH trigger functions to an EMPTY search_path. This is the maximally
--   strict form from the lint remediation guidance: the bodies ONLY compare
--   OLD/NEW row values and RAISE - no object is resolved through unqualified
--   names, so an empty search_path cannot break them, while a future edit that
--   adds one fails loudly instead of silently trusting the ambient path.

-- SCOPE:
--   - Triggers need no change: EXECUTE FUNCTION references are schema-pinned at
--     create time, and the trigger's relation is passed via NEW/OLD context.
--   - Not applied to the other DB PL/pgSQL seams because the linter currently
--     flags only these two (advisory enumerated 2026-10-10). Future trigger
--     functions MUST include a pinned search_path in their definition.

-- IDEMPOTENCY / RE-RUN:
--   Re-running changes nothing: ALTER FUNCTION SET is a no-op identity when the
--   setting already matches, and it does NOT require the triggers to be re-created
--   (the plan handle is unchanged in memory: PostgreSQL reloads the exec plan when
--   the proconf change is noticed, per Postgres docs on proconfig invalidation).

-- ROLLBACK:
--   ALTER FUNCTION public.systemfact_audit_readonly() RESET search_path;
--   ALTER FUNCTION public.systemfact_usuario_auth_user_id_no_null() RESET search_path;
-- ============================================================

ALTER FUNCTION public.systemfact_audit_readonly() SET search_path = '';
ALTER FUNCTION public.systemfact_usuario_auth_user_id_no_null() SET search_path = '';
