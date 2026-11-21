# Multi-company model: company code (`EMPRESA.codigo`) + `<CODIGO>-<usuario>` usernames

Status: **DECIDED, NOT IMPLEMENTED. Mandatory pending work** (owner, 2026-11-21). Local ADR: `docs/12-decisiones_de_arquitectura.md` ADR-021 (`docs/` is git-ignored; this file is the tracked copy of the decision).

## Specs

- S1 Shared database with row-level security now (ADR-019). A separate database per company is NOT built; it is reconsidered only when a trigger appears: a contract/regulation demanding physical isolation, a company whose load degrades the others, or a company needing independent backup/restore or region.
- S2 Companies are created ONLY by an operator procedure (a documented script), never from the app. The Empresas tab stays read-only: no "+ Nueva empresa", no company switching (a session is bound to one company; "Cambiar sucursal" only moves between branches of that company). Deactivation uses the tenant kill switch (`EMPRESA.activa`, enforced since v0.42.2 at login, per request and by the DB trigger).
- S3 The operator script creates: the company and its code, its first branch, the roles, the tax settings (ITBIS, retenciones), the company's OWN NCF ranges (never copied from another company) and the first administrator.
- S4 `EMPRESA.codigo` is MANDATORY: 3 to 6 characters `A-Z0-9`, unique, assigned at creation, immutable and never reused (even after deactivation). Input case-insensitive, stored upper-case. Enforced in the database: `NOT NULL`, `UNIQUE`, `CHECK` on the format, and a trigger rejecting changes. Migration in its own commit, with a backfill for the existing company (id 5).
- S5 `nombreUsuario` = `<CODIGO>-<usuario>` (example `SOL-jperez`); global uniqueness kept. The prefix must equal the company's code: validated in the app AND enforced by a DB trigger on `USUARIO`. The part after the hyphen follows the existing username validation. The synthetic Supabase email stays derived from the full name (ADR-014).
- S6 Existing users are test users: they are renamed or recreated with the prefix when the rule lands, TOGETHER with the CI/production-lane secrets that hold their names (e2e fixture, prod smoke, prod demo).
- S7 High risk (migration + auth): independent `gentle-ai-verify` before merge; applying the migration to production needs the owner's explicit approval; real-Postgres integration tests; full jest suite before push.
- S8 Login throttle, audit rows and the login error catalog keep working with prefixed names (no enumeration regression).

## Tasks

- [ ] T1 migration `EMPRESA.codigo` (+ backfill id 5, constraints, immutability trigger) and `USUARIO` prefix trigger: own commit (S4, S5)
- [ ] T2 app: username validation, login normalization (case-insensitive prefix), user creation paths, error codes (S5, S8)
- [ ] T3 operator provisioning script + runbook (S2, S3)
- [ ] T4 rename/recreate test users and update the CI / prod secrets (S6)
- [ ] T5 independent verification, PR(s), CI, owner-approved production migration, deploy, smoke, demo lane, tag+release (S7)

## Log

- L1: "Oh, about the multi-company ADR, as I told you, this project is focus to serve companies, companies that has branches, for now they will use the same database but each companies has they own database, you know? So yes, serve many companis, each with its own data."
- L2: "Sorry for the misunderstanding what I tried to ment was this: "- Now: all companies share one database, and each company's data is kept separate by the security rules we already have (row-level security). That is what the app does today." . I think the best option its to Keep global uniqueness and prefix the name with a company code."
- L3: "The company code, format and username shape thats an awesome idea thats will be easier to identifie each user in the database if something happens in the future... About the existing users, dont worry those users are to check if the project works good haha. Exactly about the #4 its better if we're able to create that to be more security for each company. About the new codigo colum on the company record pls keep in pending cause is Mandatory to do it cause we're going to foced the logic to be safer."
- L4: Context found while auditing: login finds the user with `findUnique({ nombreUsuario })` (globally unique), so two companies cannot share a username today; the board 08 audit also found `Empresa.activa` unenforced (fixed in v0.42.2).
