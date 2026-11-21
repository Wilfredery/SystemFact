# Multi-company model: company code (`EMPRESA.codigo`) + `<CODIGO>-<usuario>` usernames

Status: **DECIDED, IN IMPLEMENTATION on branch `feat/empresa-codigo`** (owner approved the plan 2026-11-21). Mandatory work. Local ADR: `docs/12-decisiones_de_arquitectura.md` ADR-021 (`docs/` is git-ignored; this file is the tracked copy of the decision).

## Specs

- S1 Shared database with row-level security now (ADR-019). A separate database per company is NOT built; it is reconsidered only when a trigger appears: a contract/regulation demanding physical isolation, a company whose load degrades the others, or a company needing independent backup/restore or region.
- S2 Companies are created ONLY by an operator procedure (a documented script), never from the app. The Empresas tab stays read-only: no "+ Nueva empresa", no company switching (a session is bound to one company; "Cambiar sucursal" only moves between branches of that company). Deactivation uses the tenant kill switch (`EMPRESA.activa`, enforced since v0.42.2 at login, per request and by the DB trigger).
- S3 The operator script creates: the company and its code, its first branch, the roles, the tax settings (ITBIS, retenciones), the company's OWN NCF ranges (never copied from another company) and the first administrator.
- S4 `EMPRESA.codigo` is MANDATORY: 3 to 6 characters `A-Z0-9`, unique, assigned at creation, immutable and never reused (even after deactivation). Input case-insensitive, stored upper-case. Enforced in the database: `NOT NULL`, `UNIQUE`, `CHECK` on the format, and a trigger rejecting changes. Migration in its own commit, with a backfill for the existing company (id 5).
- S5 `nombreUsuario` = `<CODIGO>-<usuario>` (example `SOL-jperez`); global uniqueness kept. The prefix must equal the company's code: validated in the app AND enforced by a DB trigger on `USUARIO`. The part after the hyphen follows the existing username validation. The synthetic Supabase email stays derived from the full name (ADR-014).
- S6 Existing users are test users: they are renamed or recreated with the prefix when the rule lands, TOGETHER with the CI/production-lane secrets that hold their names (e2e fixture, prod smoke, prod demo).
- S7 High risk (migration + auth): independent `gentle-ai-verify` before merge; applying the migration to production needs the owner's explicit approval; real-Postgres integration tests; full jest suite before push.
- S8 Login throttle, audit rows and the login error catalog keep working with prefixed names (no enumeration regression).

## Contract (owner decisions + audit, 2026-11-21; every slice follows it exactly)

- C1 Company code: `^[A-Z0-9]{3,6}$`, column `EMPRESA.codigo varchar(6)` NOT NULL, UNIQUE, CHECK on the regex; immutable by trigger `empresa_codigo_immutable` (BEFORE UPDATE, raises SQLSTATE 42501 when changed, NO `app.is_bootstrap` bypass: a wrong code is fixed only by a reviewed migration). Backfill in the migration: id 5 => `DEMO`; any other existing row => `'E' || lpad(id, 2, '0')` (E01..E99; the verifier found that plain `'E' || id` gives 2 chars for ids 1-9 and breaks the CHECK) (satisfies the regex; only matters for local/CI databases).
- C2 Canonical username: `<CODIGO>-<resto>`; `<CODIGO>` upper-case; `<resto>` matches `^[a-z0-9][a-z0-9._-]{0,56}$` (lower-case); total length <= 64. The first hyphen is the separator (the code has no hyphen, `resto` may).
- C3 DB: trigger `usuario_nombre_prefijo_guard` on `"USUARIO"` BEFORE INSERT OR UPDATE OF "nombreUsuario", "empresaId": the name must equal `(codigo of NEW.empresaId) || '-' || resto` with C2 format; an unreadable/absent empresa row rejects (fail closed). It must NOT fire for other column updates (login binds `authUserId` on legacy rows; legacy names stay usable until renamed). Coexists with `usuario_login_flow_column_guard` (which already freezes `nombreUsuario`), RLS and `empresa_activa_guard`.
- C4 App: pure module `app/src/modules/auth/domain/nombre-usuario.ts`: `CODIGO_EMPRESA_REGEX`, `normalizarNombreUsuarioLogin(input)` (trim; if the part before the first hyphen is 3-6 alphanumerics and the rest is non-empty => `UPPER(prefix)-lower(rest)`; otherwise return the trimmed input unchanged), `validarNombreUsuarioNuevo(codigo, nombreUsuario)` returning a typed result (used by the provisioning script and any future creation path). Login stays LENIENT: it only normalizes and never returns a format error (no enumeration oracle); the throttle key is computed from the normalized name; the synthetic email is built from the normalized name. Login placeholder/hint shows the shape (e.g. `CODIGO-usuario`).
- C5 Rollout order (the parent runs it, owner-approved 2026-11-21): (1) migration applied to production, (2) in ONE transaction rename the production test users (`admin`->`DEMO-admin`, `prod-smoke`->`DEMO-prod-smoke`, `demo-operador`->`DEMO-demo-operador`) AND their Supabase Auth emails/identities, (3) update only the `*_USER` GitHub secrets (passwords stay), (4) deploy the app, (5) prod smoke + demo lane. Show the exact SQL to the owner before running it.
- C6 CI/local fixtures use company code `E2E` and users `E2E-automation`, `E2E-operador`, `E2E-despachador`, `E2E-gestion-objetivo`; integration fixture companies get unique generated codes.

## Rollout SQL (C5) - verified against production read-only on 2026-11-21

Production state at that date: `USUARIO` 4 `admin` (bound), 5 `e2e-automation` (NOT bound, no Auth user: dormant), 6 `prod-smoke`, 7 `demo-operador`, all `empresaId` 5. `auth.users` has admin, prod-smoke, demo-operador. NOTE: the `admin` identity has `provider_id = 'email'` (the other two use their user id), so the identity update matches by `user_id` ONLY. `auth.identities.email` is generated from `identity_data`, so only `identity_data` is updated. Run order: (1) apply migration `20261122100000_empresa_codigo`, (2) this SQL, (3) update the `PROD_USER` and `DEMO_USER` secrets (passwords unchanged), (4) deploy, (5) prod smoke + demo lane. Every statement is guarded: a wrong row count raises and the whole DO block rolls back, so nobody is half-renamed.

```sql
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('app.is_bootstrap', 'true', true);

  -- USUARIO (4 rows; the prefix trigger validates each new name against EMPRESA.codigo = DEMO)
  UPDATE "USUARIO" SET "nombreUsuario" = 'DEMO-admin'          WHERE id = 4 AND "nombreUsuario" = 'admin'          AND "empresaId" = 5;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'USUARIO 4 not renamed (%)', n; END IF;
  UPDATE "USUARIO" SET "nombreUsuario" = 'DEMO-e2e-automation' WHERE id = 5 AND "nombreUsuario" = 'e2e-automation' AND "empresaId" = 5;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'USUARIO 5 not renamed (%)', n; END IF;
  UPDATE "USUARIO" SET "nombreUsuario" = 'DEMO-prod-smoke'     WHERE id = 6 AND "nombreUsuario" = 'prod-smoke'     AND "empresaId" = 5;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'USUARIO 6 not renamed (%)', n; END IF;
  UPDATE "USUARIO" SET "nombreUsuario" = 'DEMO-demo-operador'  WHERE id = 7 AND "nombreUsuario" = 'demo-operador'  AND "empresaId" = 5;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'USUARIO 7 not renamed (%)', n; END IF;

  -- Supabase Auth emails (3 users; user 5 has no Auth account)
  UPDATE auth.users SET email = 'demo-admin@users.systemfact.internal'
   WHERE id = 'd7f46b41-6bd3-4b73-acce-30d4418a269c' AND email = 'admin@users.systemfact.internal';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'auth.users admin not renamed (%)', n; END IF;
  UPDATE auth.users SET email = 'demo-prod-smoke@users.systemfact.internal'
   WHERE id = '1be13c6a-8186-4099-9164-10436d56c130' AND email = 'prod-smoke@users.systemfact.internal';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'auth.users prod-smoke not renamed (%)', n; END IF;
  UPDATE auth.users SET email = 'demo-demo-operador@users.systemfact.internal'
   WHERE id = '9c2dacdd-4039-4ea3-ad08-756547f80694' AND email = 'demo-operador@users.systemfact.internal';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'auth.users demo-operador not renamed (%)', n; END IF;

  -- Identities (match user_id + provider only; provider_id is NOT touched)
  UPDATE auth.identities SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb('demo-admin@users.systemfact.internal'::text))
   WHERE user_id = 'd7f46b41-6bd3-4b73-acce-30d4418a269c' AND provider = 'email';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'identity admin not updated (%)', n; END IF;
  UPDATE auth.identities SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb('demo-prod-smoke@users.systemfact.internal'::text))
   WHERE user_id = '1be13c6a-8186-4099-9164-10436d56c130' AND provider = 'email';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'identity prod-smoke not updated (%)', n; END IF;
  UPDATE auth.identities SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb('demo-demo-operador@users.systemfact.internal'::text))
   WHERE user_id = '9c2dacdd-4039-4ea3-ad08-756547f80694' AND provider = 'email';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'identity demo-operador not updated (%)', n; END IF;
END $$;
```

Rollback: the same block with the old and new values swapped (old names `admin`, `e2e-automation`, `prod-smoke`, `demo-operador`; old emails without the `demo-` prefix). It needs the prefix trigger and the immutability trigger to stay as they are: renaming back to an unprefixed name is refused by `usuario_nombre_prefijo_guard`, so a rollback of the rename is done by rolling back the migration first (its ROLLBACK block drops the triggers), then swapping the names.

## Tasks

- [ ] T1 (W1) migration `EMPRESA.codigo` (+ backfill id 5, constraints, immutability trigger) and `USUARIO` prefix trigger: own commit (S4, S5)
- [ ] T2 (W2) app: username validation, login normalization (case-insensitive prefix), user creation paths, error codes (S5, S8)
- [ ] T3 (W3) operator provisioning script + runbook (S2, S3)
- [ ] T4 (W3 files + parent rollout) rename/recreate test users and update the CI / prod secrets (S6)
- [ ] T5 independent verification, PR(s), CI, owner-approved production migration, deploy, smoke, demo lane, tag+release (S7)

## Log

- L1: "Oh, about the multi-company ADR, as I told you, this project is focus to serve companies, companies that has branches, for now they will use the same database but each companies has they own database, you know? So yes, serve many companis, each with its own data."
- L2: "Sorry for the misunderstanding what I tried to ment was this: "- Now: all companies share one database, and each company's data is kept separate by the security rules we already have (row-level security). That is what the app does today." . I think the best option its to Keep global uniqueness and prefix the name with a company code."
- L3: "The company code, format and username shape thats an awesome idea thats will be easier to identifie each user in the database if something happens in the future... About the existing users, dont worry those users are to check if the project works good haha. Exactly about the #4 its better if we're able to create that to be more security for each company. About the new codigo colum on the company record pls keep in pending cause is Mandatory to do it cause we're going to foced the logic to be safer."
- L4: Context found while auditing: login finds the user with `findUnique({ nombreUsuario })` (globally unique), so two companies cannot share a username today; the board 08 audit also found `Empresa.activa` unenforced (fixed in v0.42.2).
- L5: Owner answers (2026-11-21, ask_user_question): company 5 code = DEMO; canonical case = UPPER code + lowercase rest (login normalizes, DB enforces); max length 64; "Yes, with the ordered rollout": the parent may rename the production test users and update the `*_USER` GitHub secrets, showing the exact SQL first.
- L6: Audit (two explorers + parent recheck): no app path creates/renames users (seeds, CI fixtures, manual SQL only); login lookup and DB uniqueness are case-sensitive while Supabase treats the email case-insensitively; every login UPDATEs the USUARIO row (binds authUserId), so the prefix trigger must be column-scoped; renaming a user requires updating the Auth email in lockstep; about 25 integration files create users with free-form names; `E2E_PROTECTION_BYPASS` exists in app/playwright.config.ts (local e2e config) although AGENTS.md says the prod lane has none: out of scope here, raised to the owner.
