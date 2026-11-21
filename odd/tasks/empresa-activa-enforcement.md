# Enforce Empresa.activa (tenant kill switch)

Branch `fix/empresa-activa-enforcement` · target v0.42.2 · SECURITY (high risk items 1 migration, 2 auth). Found by the board 08 audit.

## Specs

- S1 Per request: `buscarUsuarioPorAuthSub` (`modules/auth/infrastructure/auth-identity.ts`) returns `null` (no session, fail closed) when the user's empresa is inactive OR the EMPRESA row cannot be read. The check runs inside the SAME transaction after `app.current_empresa_id` is pinned (EMPRESA is RLS-protected), as one primary-key lookup of `EMPRESA.activa`; it never trusts a caller-supplied select. `getCurrentTenantContext` and `getCurrentTenantHeader` inherit it (verify, do not duplicate).
- S2 Login: after the credentials are verified and the USUARIO row is found, an inactive empresa refuses the login with a NEW stable code `AUTH_EMPRESA_INACTIVA` (catalog in `modules/auth/domain/errors.ts`, user message in Spanish, e.g. "La empresa está inactiva. Contacte al administrador del servicio."), signs the Supabase session out, and does NOT count as a throttle attempt (`cuentaComoIntento: false`), exactly like `AUTH_USUARIO_INACTIVO`. The empresa lookup reuses ONE shared helper in `auth-identity.ts` (pin `app.current_empresa_id` from the user's empresaId, read `activa`); no second implementation.
- S3 Migration (its OWN commit, hand-written SQL under `app/prisma/migrations/<timestamp>_empresa_activa_guard/`): a `BEFORE UPDATE` trigger on `"EMPRESA"` that raises an exception when `NEW.activa IS DISTINCT FROM OLD.activa` unless `current_setting('app.is_bootstrap', true) = 'true'`; other columns stay updatable by the existing policy; DELETE/INSERT unchanged. The migration must be re-runnable safely (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS`). A commented rollback (`DROP TRIGGER ...; DROP FUNCTION ...`) sits at the end of the file. The migration is NOT applied to production by the agent.
- S4 Tests: (a) unit: `auth-service` login with an inactive empresa => refusal `AUTH_EMPRESA_INACTIVA`, `signOut` called, `cuentaComoIntento:false`, no `enlazarAuthSub`; with an active empresa behavior is byte-identical to today; (b) unit: `auth-identity` per-request null for inactive/unreadable empresa, and the existing exact-query-shape tests updated for the new lookup; (c) real-DB integration (`app/src/integration/`): inactive empresa => `buscarUsuarioPorAuthSub` null and login path refused; active => resolves; a tenant session `UPDATE "EMPRESA" SET activa=false` raises and leaves the row unchanged, a bootstrap session may change it, and a tenant `UPDATE ... SET "nombreComercial"` still works; (d) errors catalog test updated; (e) login UI shows the catalog message for the new code (check `actions.login.ts` mapping and its test).
- S5 No existing flow changes for an active empresa (production has one empresa, id 5, `activa=true`, verified read-only on 2026-11-21).
- S6 Version bump 0.42.2 (`app/package.json`, `.release-please-manifest.json`, `app/CHANGELOG.md`: bytes, no BOM, preserve each file's line endings).

## Tasks

- T1 (S1,S2,S4a,S4b,S4d,S4e) app-level enforcement + unit tests
- T2 (S3,S4c) migration (own commit) + integration tests
- T3 independent `gentle-ai-verify` (high risk items 1 and 2), then (S6) bump, PR, CI, merge, deploy, smoke, tag+release. Applying the migration to production waits for the owner's explicit approval.

## Log

- L1: "Hold on, do a check, recheck, audit and evaluation pls just to make sure and process with recommendations, pls"
- L2: Audit (explorer + parent recheck of auth-identity.ts, auth-service.ts:293, RLS migration 20260902120000): `Empresa.activa` NOT ENFORCED: login, per-request context and RLS ignore it; no app code can change it (only SQL/seed); `empresa_modify` is FOR ALL on the own row with no column guard, so a tenant session could flip its own flag. Production data: one empresa (id 5), activa=true.
