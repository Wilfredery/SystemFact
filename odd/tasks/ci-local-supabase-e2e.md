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
| T5 version 0.17.7 + CHANGELOG, PR, CI run proves 12/0 with zero secrets | S1 | inline | done — PR #139; run `41741146334` (sha `41e082d`): `Running 12 tests` → `12 passed` → guard `OK: 12 test(s) ejecutados, 0 salteados`; no `environment:`, no `secrets.*` in the job. Bump commit `41e082d` |
| T5b advisory-finding commit (`bb9b541`) + native review | S1,S2 | inline | review `review-b098bdd03f755403` **approved**, authority burned; 3 informational findings: R3-001 (no action, `?? 0` and the pinned Playwright emits the field), R3-002 refuted (the fixture's re-run guard is present, unchanged, at `e2e-fixture.sql:26-31`), R3-003 refuted empirically (fixture with explicit `activo` applied on a wiped stack, then 12 passed) |
| T6 after owner merge + green master CI: delete the `e2e` environment + its 4 secrets (explicit owner go), tag/release 0.17.7, record the A/B/C decision on #138 | S1,S4 | inline | done — #139 squashed by the owner as `cf8b248`; 4 secrets + environment deleted (verified: `gh secret list --env e2e` empty, `environments total_count: 0`); master run `41742631340` **after** deletion: `Running 12 tests` → `12 passed (36.9s)` → guard `OK: 12 test(s) ejecutados, 0 salteados`; tag + release `v0.17.7`; #138 closed with the A/B/C table |

Status: **closed** — feature complete and verified; the only residual is the hosted `e2e-automation` identity (recorded on #138), which is a separate owner decision.

## Log

- L1 (2026-11-03, owner, verbatim): "Continue working, this was the last thing u told me: - ⏳ #138: local stack proven, CI rework pending (recipe saved) - ⏳ Ten advisory findings from #136 / Two things I'd flag for the fresh context: the E2E lane must show 12 executed / 0 skipped with zero repository secrets before the e2e environment and its four secrets are deleted — that's the test capable of failing. And the one line that matters most in the summary: a green job that silently skips reads as coverage it doesn't have — that's what cost two releases today."
- L2 (2026-11-03): branch base fixed (`ci/local-supabase-e2e` from `origin/master` @ `d6546e2`; the old `ci/environment-scoped-secrets` tip was pre-merge content already squashed).
- L3 (2026-11-03): local facts verified against the running stack before writing anything — `postgres@54322` is not superuser and already NOBYPASSRLS; `supabase_admin:postgres` is; `systemfact_app` exists with no usable password.
- L4 (2026-11-03): `supabase/config.toml` trimmed and proven — a wiped stack boots only 4 containers in 32s. Provisioning from scratch: migrations as `supabase_admin` all applied, fixture loaded, seeds + `config:verify` OK, GoTrue user created, password grant verified. Then `Running 12 tests` → `12 passed` → guard `OK: 12 test(s) ejecutados, 0 salteados.` T1+T2 committed `b95f495`.
- L5 (2026-11-03): CI wiring committed `40aa7a3`; local gates `tsc --noEmit` 0, `pnpm lint` 0 errors (17 pre-existing warnings), `lint:commits` OK; `gga` pre-commit hook blocked on the provider's free-usage limit (not a finding) so `GGA_SKIP=1` was used.
- L6 (2026-11-03): pushed `ci/local-supabase-e2e`, PR **#139**. CI run `41741146334` (sha `41e082d`) — the proof the owner asked for, quoted from the job log, not the conclusion: `All migrations have been successfully applied.` · `==> auth user created (3378c82c-…)` · `Running 12 tests using 1 worker` · `12 passed (23.4s)` · `OK: 12 test(s) ejecutados, 0 salteados.` The `e2e` environment still exists but the job declares no `environment:` and no `secrets.*`, so it could not have fallen back to them.
- L7 (2026-11-03): post-review commit `bb9b541` (advisory findings) re-proven locally on a wiped stack — including the explicit `activo` columns: migrations applied, fixture loaded, auth user created, `12 passed (1.0m)`, guard `OK: 12 test(s) ejecutados, 0 salteados`, `stats: {expected:12, flaky:0, skipped:0, unexpected:0}`.
- L8 (2026-11-03): native review of `bb9b541` (`review-b098bdd03f755403`, tier high — shell process boundary): **approved**, authority burned; 3 informational findings triaged in T5b.
- L9 (2026-11-03): owner squashed #139 (`cf8b248`) and authorized the destructive step ("Delete now and after that do a tag+release"). Four secrets and the environment deleted; master CI `41742631340` green **with them gone** (`12 passed (36.9s)`, guard OK); `v0.17.7` tagged and released (Latest); #138 closed with the A/B/C decision.
- L10 (2026-11-03): remaining advisory findings from #136 — three recovered and closed (fixture `activo`, alerts scoped to `main`, `flaky` in the stats sum); the other seven are unrecoverable (review claims are deleted when the approved lineage is acknowledged) and were not invented.
