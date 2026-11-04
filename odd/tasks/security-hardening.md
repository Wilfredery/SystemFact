# security-hardening — docs/22 execution + tracked status

Objective: execute the docs/22 security hardening plan (local-only plan of record) and keep a **tracked** status surface for it, because `docs/` is gitignored by design and the repo is PUBLIC: decisions and status ship, exploit detail stays local.
Branch: `feature/security-t0-durability` (T0 slice) then `feature/security-t7-password-policy` (T7 code half) · Delivery: one PR per slice.

## Specs

Sourced verbatim from `docs/22-security-hardening-plan.md` (T0/T7, owner-approved 2026-11-03) and the owner's ratified order (L1/L2).

- **S1 (T0 backup)** — "**External scheduled backup** — logical `pg_dump` of `DIRECT_URL` to off-platform storage (the project has no automatic backups), plus a documented restore command." Acceptance: "Backup job exists and produces a restorable artifact (not merely a file that looks right)."
- **S2 (T0 rehearsal)** — "**Restore rehearsal performed once, timed and recorded here.**" Acceptance: "A restore into a scratch database was performed and timed, with the result written in this file."
- **S3 (T0 label)** — "**Non-production label** in `README`/`.env.example` comment and in this plan, so no tenant is ever onboarded onto a plan whose failure mode is "paused for a week, unrecoverable if the volume is lost"."
- **S4 (T0 trigger)** — "Revisit the tier decision **before the first real invoice is issued** (Pro = no pausing + 7-day automatic backups + leaked-password screening). Record the revisit trigger here, not in someone's memory."
- **S5 (tracked surface)** — the approved middle path for docs/22: a tracked tracker with decisions + status and **no exploit detail**, instead of publishing the security inventory of a PUBLIC repo.
- **S6 (T7 code half)** — "The login action must handle that as its own typed outcome and prompt a change; it must not collapse into `AUTH_CREDENCIALES_INVALIDAS` (that would tell a legitimate user their credentials are wrong) nor leak a provider error to the client." Decided: min 12 chars, no forced 30-day rotation, passphrases/password managers allowed, no mandatory character classes. No HIBP screening while the project is on the free plan.

## Status (docs/22 program)

| Item | State | Evidence |
|------|-------|----------|
| T0 plan tier | DECIDED 2026-11-03, Option B: free plan, explicitly non-production | this doc, `docs/22` |
| T0a external backup | this slice | `app/tools/scripts/backup-cloud-db.ps1`, `app/BACKUP-RESTORE.md` |
| T0b Postgres parity 16 → 17.6 | DONE 2026-11-03 | v0.17.2, 212 rows / 26 tables identical |
| T1 stage 1 headers | DONE 2026-11-03 | v0.18.1, verified in production |
| T1 stage 2 CSP nonce | open | belongs in `app/src/proxy.ts`, report-only first |
| T2 supply chain | DONE | v0.18.5, audit 37 → 0, 12 action refs SHA-pinned |
| T3 login brute force | decided (app-side soft throttle), not built | `docs/22` T3 |
| T4 admin password reset | open, highest value | needs product decisions (reset delivery) |
| T5 RLS coverage guard | DONE | v0.18.6, found `_prisma_migrations` RLS off |
| T6 session/cookie config | open | `httpOnly:false` is intentional, do not force |
| T7 password policy | decided; **code half DONE** (v0.18.8) | `AUTH_PASSWORD_POLICY` + `weak_password` mapping, RED→GREEN |
| T8 admin MFA | gated on T4 | — |

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| T1 backup script + runbook | S1 | inline | done | `3e1d637` |
| T2 restore rehearsal recorded | S2 | inline | done | `3e1d637` (evidence in this doc + `docs/22` + `app/BACKUP-RESTORE.md`) |
| T3 non-production label | S3 | inline | done (README + plan); `app/.env.example` pending owner approval | `e4deb85` |
| T4 revisit trigger recorded | S4 | inline | done | `e4deb85` |
| T5 docs/22 T0 closure entry | S1-S4 | inline | done | local-only (`docs/` is gitignored) |
| T6 tracker committed | S5 | inline | done | `15fa827` |
| T7 `WeakPasswordError` typed outcome | S6 | inline | done | `82e986a` (+ bump `3c1a3d9`) |

Routing note: every task is a single-module change well under a subagent start cost (one script, one runbook, four one-line doc edits, one error branch in the login action), so the Writer rule does not fire; work is inline.

## Log

- L1 (2026-11-04): "Aight, so do u prefer to continue with T7 or go with T0 or add the docs/22 to the repo, cause u told me its going to be better for u, what do u think its the better optional, organice, practical, professional, safe and security."
- L2 (2026-11-04): "I like the order u propused me, go ahead." — authorizes the proposed order: (1) T0 durability, (2) this tracked tracker, (3) T7 code half after the owner-side dashboard setting.
- L3 (2026-11-04): "Remember that u have engram check the context too" — Engram checked; it corrected two claims from the previous session: T0 is **not** an open decision (Option B decided 2026-11-03) and the previously promised `odd/tasks/security-hardening.md` **never existed**. This file is that tracker, actually created.
- L4 (2026-11-04): docs/22 is **not** published. Reasons recorded: `docs/` is gitignored by design + documented as "Never commit this file"; the repo is PUBLIC and the plan is an inventory of unmitigated controls with `file:line` pointers. Agent access does not require git — the plan is read from disk.
- L5 (2026-11-04): T0 delivered in three commits (`3e1d637` script + runbook, `e4deb85` label + dump guard, `15fa827` this tracker). The pipeline was proven end to end against the local engine, not merely written: probe OK, 26/26 tables verified, artifact 0.16 MB in 2.6 s with a matching SHA-256 sidecar, restore into `sf_restore_probe` in **5.6 s** yielding **26/26 tables and 452 rows with an identical per-table count diff**, scratch database dropped. The cloud artifact itself is still one owner command (hidden password): no cloud credential exists on disk by design. The `app/.env.example` comment is the one T0 piece not written — the agent edit guard blocks `.env.*` paths without explicit approval.
- L6 (2026-11-04): T7 code half delivered on `feature/security-t7-password-policy` (stacked on the T0 branch), `82e986a` + bump `3c1a3d9` → **0.18.8**. Test-first with an observed RED (the sign-in collapsed into `AUTH_CREDENCIALES_INVALIDAS`) before the mapping existed. The mapping reads GoTrue's stable `weak_password` code only; the provider message is never surfaced and the user-facing copy names no policy number, because the minimum length is Supabase configuration and not an app constant. Failure posture unchanged: no tenant read, no write, no audit row. Gate: tsc 0 · jest **141/141 suites, 1321/1321 tests** · lint 0 errors (17 pre-existing warnings, none in the changed files). **Still owner-side:** the dashboard setting itself (Authentication → Providers → Email → minimum length 12) — until it is applied, no account produces `weak_password`, so the branch is dormant rather than wrong.
