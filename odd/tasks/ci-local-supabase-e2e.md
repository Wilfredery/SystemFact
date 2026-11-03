# ci-local-supabase-e2e — the E2E lane runs on a local Supabase stack, zero secrets

Objective: close issue #138 option C. The Playwright lane boots its own Supabase
stack (`supabase start`), provisions the DB and the auth user inside the runner,
and proves 12 executed / 0 skipped with **zero repository secrets**. Only then do
the `e2e` GitHub Environment and its four secrets get deleted.
Branch: `ci/local-supabase-e2e` · Delivery: single PR + release 0.17.7.

## Specs

- S1 (owner, 2026-11-03, verbatim): "the E2E lane must show 12 executed / 0 skipped with zero repository secrets before the e2e environment and its four secrets are deleted — that's the test capable of failing."
- S2 (owner, 2026-11-03, verbatim): "a green job that silently skips reads as coverage it doesn't have — that's what cost two releases today."
- S3 (issue #138, "3. Decide the isolation level", option C, verbatim): "**C. Local Supabase stack in CI** (`supabase start`; auth + DB ephemeral)" — cost: "+1–2 min per run; `SETUP-LOCAL.md`'s "auth is remote" assumption changes for CI only" — recommendation: "**C** as the end state. Option C is the only one where this issue closes permanently rather than being managed." Buy: "**no real credential in CI at all**".
- S4 (issue #138 acceptance, verbatim): "CI still reports 12 executed / 0 skipped after the rotation." and "A decision is recorded on A/B/C for the isolation level."

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| T1 commit `supabase/config.toml` trimmed for CI (Prisma owns the schema, unused services off) | S3 | inline | done — only postgres/kong/gotrue/postgrest boot; `db.seed` off | `b95f495` |
| T2 `.github/ci/provision-local-e2e.sh` + proven from a clean stack locally (12 passed) | S3 | inline | done — wiped stack (`stop --no-backup`) → `start` (32s) → provision → `12 passed` → guard `OK: 12 test(s) ejecutados, 0 salteados` | `b95f495` |
| T3 rework the `e2e` job: no preflight, no `environment:`, no service container, no secrets | S1,S2 | inline | done — job always runs; `e2e-gate`/`environment`/secrets/service gone; JSON reporter + skip guard kept | `40aa7a3` |
| T4 `app/SETUP-LOCAL.md`: CI recipe + local reproduction | S3 | inline | done — three-command recipe + local facts table; AGENTS.md, fixture, playwright.config.ts, skip guard updated | `40aa7a3` |
| T5 version 0.17.7 + CHANGELOG, PR, CI run proves 12/0 with zero secrets | S1 | inline | in progress — bump + gates (tsc 0, lint 0 errors, commits OK) done, PR pending | |
| T6 after owner merge + green master CI: delete the `e2e` environment + its 4 secrets (explicit owner go), tag/release 0.17.7, record the A/B/C decision on #138 | S1,S4 | inline | pending | |

## Log

- L1 (2026-11-03, owner, verbatim): "Continue working, this was the last thing u told me: - ⏳ #138: local stack proven, CI rework pending (recipe saved) - ⏳ Ten advisory findings from #136 / Two things I'd flag for the fresh context: the E2E lane must show 12 executed / 0 skipped with zero repository secrets before the e2e environment and its four secrets are deleted — that's the test capable of failing. And the one line that matters most in the summary: a green job that silently skips reads as coverage it doesn't have — that's what cost two releases today."
- L2 (2026-11-03): branch base fixed (`ci/local-supabase-e2e` from `origin/master` @ `d6546e2`; the old `ci/environment-scoped-secrets` tip was pre-merge content already squashed).
- L3 (2026-11-03): local facts verified against the running stack before writing anything — `postgres@54322` is not superuser and already NOBYPASSRLS; `supabase_admin:postgres` is; `systemfact_app` exists with no usable password.
- L4 (2026-11-03): `supabase/config.toml` trimmed and proven — a wiped stack boots only 4 containers in 32s. Provisioning from scratch: migrations as `supabase_admin` all applied, fixture loaded, seeds + `config:verify` OK, GoTrue user created, password grant verified. Then `Running 12 tests` → `12 passed` → guard `OK: 12 test(s) ejecutados, 0 salteados.` T1+T2 committed `b95f495`.
- L5 (2026-11-03): CI wiring committed `40aa7a3`. Removed `e2e-gate`, `environment: e2e`, the four secret references and the postgres service; the job now always runs and fails when the stack or a test fails. Local gates: `tsc --noEmit` 0, `pnpm lint` 0 errors (17 pre-existing warnings), `lint:commits` 2/2 OK. `gga` could not run (provider free-usage limit; `GGA_SKIP=1` escape hatch used, same as `a98dfe3`).
