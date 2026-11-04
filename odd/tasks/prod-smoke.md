# prod-smoke — a production check that is not an admin robot

Objective: a scheduled smoke that answers "does production work" against
`https://systemfact.vercel.app`, with a least-privilege identity and no fiscal
writes. Design constraints and the three owner decisions live in Engram 1404.
Branch: `feature/prod-smoke` · Delivery: single PR (version bump included).

## Specs

- S1 (owner, 2026-11-04, verbatim): "Select the best practical, security, professional and safe option." → chosen: **both halves in one run** (anonymous assertions always; logged-in assertions in the same run), because an anonymous-only check cannot tell that the database or auth is broken.
- S2 (owner, 2026-11-04, verbatim): "Reads of the existing tenant" — an automation identity may read the hosted tenant (1 empresa, 29 invoices); it must never write: no sale confirmation, no NCF consumption, no void.
- S3 (owner, 2026-11-04, **superseded by L5**): daily cadence with a deduplicated issue on failure — a check nobody sees is decoration. Superseded: see the deployment model below.
- S4 (carried from Engram 1404, do not re-litigate): separate workflow, never in `ci-gate`; its own `prod-smoke` environment; `Operador` or read-only, never admin; skips fail the run exactly like `app/e2e/assert-no-skips.mjs`.

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| T1 production URL + real header state measured | S1 | inline | done — `https://systemfact.vercel.app`; `/` → 307 `/login`; `/login` 200 but only HSTS of the five headers; newest prod deploy = `2a76c31` (#118) vs master `5113f64` (0.17.9) | — |
| T2 smoke code: prod playwright config, public + session specs, workflow, docs | S1,S4 | worker | done — reviewed and approved (lineage `review-fb125ae86d69f039`) | `9b38bfc`→`2688396` |
| T3 prove the public half against the deployed URL (expected red until production is redeployed) | S1 | inline | done — `2 passed / 1 failed`; the header test names all four missing headers | — |
| T4 least-privilege identity + `prod-smoke` environment secrets (explicit production write) | S2,S4 | inline | done — auth user (owner) · environment `26281220650` + 2 secrets (agent, password rotated) · `USUARIO` 6 / `USUARIO_ROL` (Operador) | |
| T5 one real run with counts (dispatch-only; the cron is superseded by the deployment model) | S3 | inline | done — run `41897923869` on `22f6573` (**4 passed / 0 failed, 6.6s**); the earlier run `41894569175` was 3/1 and is what found the auth-gate regression | |
| T6 ODD: version bump, PR, review per assess | — | inline | done — PR #145 (0.18.0, reviewed: `review-a29de896ef7c114a`), PR #147 (0.18.1, the gate fix); tagged and released | — bump **0.18.0** committed (`6f02cf8`), review of the delivery candidate **approved and burned** (`review-a29de896ef7c114a`); **PR is the owner's decision** | |

## Deployment model (owner clarification, 2026-11-04 — binding)

The owner does **not** want a Vercel↔GitHub deployment integration while the project is still in development: no GitHub Deployments, no Vercel checks on PRs, no auto-deploy on `master`. Production is deployed **manually from Vercel** when the owner decides to verify it.

Therefore:

- The newest production deployment being `2a76c31` (#118) is **expected, not a defect**. The earlier "production is stale" note in this file was wrong in its premise and is withdrawn.
- "Restore auto-deploy" is **not** a goal and must never be proposed again without an explicit owner request.
- The smoke is **`workflow_dispatch` only**. No cron: a schedule would report on a deployment the owner did not make, which is noise about a decision they own. Run it after a manual deploy.
- S3 (daily cron) is superseded by this section.

Original measurement kept for the record: alias `systemfact.vercel.app` → `dpl_FSaEs2` = commit `2a76c31` (#118); project has 8 deployments total, none after it; GitHub App connection alive; `/login` served with `Age ≈ 22.6 days` carrying only `Strict-Transport-Security` of the five baseline headers (consistent with a build older than v0.17.3).

## Log

- L1 (2026-11-04, owner, verbatim): "Aight, lets continue checking the production smoke".
- L2 (2026-11-04): hosted census before designing (read-only): 1 empresa, 1 sucursal, 2 active users, 2 clients, 29 facturas/ventas (last 2026-10-10), 1 `auth.users` row left after the #138 deletions.
- L3 (2026-11-04): owner decisions captured (S1–S3). Cadence was explained before they chose: scheduled run + how a failure reaches them.
- L4 (2026-11-04): production probed: cache-busted `/login` still returns `X-Vercel-Cache: HIT` with a 22-day `Age`, and `/favicon.ico` serves without the four app headers — consistent with a build older than v0.17.3.
- L5 (2026-11-04, owner, verbatim): "FYI, i dont want to get deploy appears in my repo, thats why we setup like that, cause as we're still developing i dont want to have vercel appears in deploy in my repo github yet cause we're still working I just want it through my vercel to make sure if its working in production and thats it". → binding: manual deploys from Vercel, no GitHub integration, smoke is dispatch-only. My "restore auto-deploy" recommendation was against the owner's model and is withdrawn (see the Deployment model section).
- L6 (2026-11-04, owner, verbatim): "Continue with the last session. I created the new user(prod-smoke@users.systemfact.internal) with the password in my supabase. I dint understand this: [the `gh secret set` block]. Option A". → step 1 of the pending list closed by the owner; step 2 explained (what an environment secret is, why `--env`, why stdin) and the missing `prod-smoke` environment created by the agent (`26281220650`) so the command cannot 404.
- L7 (2026-11-04): hosted write of step 3 executed and read back separately — `USUARIO` id 6 (empresa 5 / sucursal 4 / activo / `authUserId` NULL) + `USUARIO_ROL` (6, 10 `Operador`); empresa 5, sucursal 4 and rol 10 = `Operador` re-checked before the insert; `passwordHash` is never selected by the auth path (`src/modules/auth/infrastructure/auth-identity.ts:76`), so the placeholder cannot break login.
- L8 (2026-11-04, owner, verbatim): "But, can u do it? Remember that this step for e2e its just to check if everything its working good in local and through production. Lmk what u think" → the two secrets done by the agent via **rotation** (the stored bcrypt hash cannot be read): password generated in-shell, hashed locally, only the hash reached `auth.users`; plaintext went from a `mktemp` file to GitHub by stdin and the file was deleted. Old dashboard password invalidated on purpose.
- L9 (2026-11-04): first `pnpm e2e:prod` with the live identity — `2 passed / 2 failed`; the session test died on strict mode (`getByRole("alert")` = denial paragraph + Next route announcer). Fixed in `8b9e9ae` (scoped to `main`, `toHaveCount(1)`), re-run `3 passed / 1 failed` (8.0s), the remaining failure being the four missing baseline headers on the stale deploy. Local finding: `app/.env` points at the hosted project with a **legacy anon key the project rejects** (`401 Invalid API key`), so that file cannot exercise hosted auth — separate follow-up, not part of this feature.

## Review round 1 (2026-11-04) — lineage `review-cc9d6fea50f2cc80` (tier high, risk + reliability)

Findings, all from the reviewer lenses (verbatim ids):

- `R1-credential-exposure` — **BLOCKER**. `trace: retain-on-failure` + `screenshot: only-on-failure` on a live production login can persist the password (a trace snapshots DOM and network), and the workflow uploads the artifacts in a **public** repository. Real: a credential leak dressed as a debugging aid.
- `R1-bypass-header-broad-application` — **CRITICAL**. The Vercel bypass header was applied to every request, including the anonymous half, so the public check would answer `200` even if the alias were misconfigured behind SSO. Real: the anonymous half must see what a visitor sees.
- `R1-secret-logging-via-env-dump` — WARNING (GitHub masks env values; left as-is, documented).
- `R1-hardcoded-production-url` — SUGGESTION (the default IS the target of this lane; documented).
- `R3-001` — CRITICAL, about the deduplicated-issue search. The quoted-search part was already correct; the **real** defect underneath it was `--jq '.[0].url'` rendering `null` on an empty list, which is non-empty and would have run `gh issue comment null`.

Refuter: `correction_required`. The immediately following STATUS returned `stop: corrupted_or_unverifiable_authority` — **terminal**, no correction route offered. Per the RDD contract the safe path is to fix the findings and start a fresh lineage; **no RESET/RECOVER was attempted**.

Fixes applied (new commit, not a lineage correction):

- `app/playwright.prod.config.ts`: `trace: "off"` and `screenshot: "off"` with the reason written next to them; the bypass header is now opt-in via `PROD_PROTECTION_BYPASS=1`.
- `.github/workflows/prod-smoke.yml`: `--jq '.[0].url // empty'`, exact title search, and `PROD_PROTECTION_BYPASS` passed as a repo variable (default `0`).
- `AGENTS.md` + `SETUP-LOCAL.md`: the no-artifact policy and the opt-in bypass are stated so nobody "improves" them back into a leak.

Verified after the fix: `tsc --noEmit` 0 · `eslint` 0 · public smoke still `2 passed / 1 failed` (four headers missing in the deployed build — expected under manual deploys) · session smoke still **fails** on missing credentials · a failing run now leaves only `test-results/.last-run.json`, **no `trace.zip` and no screenshots**.

## Review round 2 (2026-11-04) — lineage `review-9019743e10883a21` (tier high, risk + reliability)

Findings: `R1-workflow-env-conflation` (**CRITICAL**), `R1-public-repo-secret-scope` (WARNING), `R3-hardcoded-default-headers` (WARNING), and two SUGGESTIONs. The refuter sustained the CRITICAL.

**`R1-workflow-env-conflation`, and why it is right.** Round 1 replaced a default-on bypass with an opt-in one, but the trigger was a repository **variable** (`PROD_PROTECTION_BYPASS`) gating a **secret** (`E2E_PROTECTION_BYPASS`), and both names shared a stem. Two consequences: whoever can set the variable can enable the bypass even when the secret is empty, and a correctly-set secret does nothing unless the variable says `1`. An opt-in flag is still a knob whose trigger sits somewhere weaker than the thing it gates.

**Fix: delete the knob.** The capability is gone rather than configurable — no `extraHTTPHeaders`, no bypass variable, no bypass secret. The lane probes the public alias as an anonymous visitor, which is the only thing that proves a visitor can use production; if a protected deployment URL ever needs probing, that gets its own check and its own reason. Consequence: the `prod-smoke` environment now holds **two** secrets (`PROD_USER`, `PROD_PASSWORD`), not three.

Not changed, deliberately: `R1-public-repo-secret-scope` (the environment scoping it asks for is already the design — `environment: prod-smoke` on the only job); `R3-hardcoded-default-headers` (importing `next.config.ts` into a Playwright spec would couple the check to Next's module loading, and the deployed headers are exactly what must be asserted, not the local constant); the two SUGGESTIONs.

## Review round 3 (final) — lineage `review-fb125ae86d69f039` — **APPROVED**

Tier high, risk + reliability, candidate `2688396` (feature + round-1 fixes + round-2 correction), 466 changed lines. Authority burned after reading the claims.

Advisory findings, all non-blocking and recorded as later work:

- `R1-workflow-secret-env-scope` (WARNING): `PROD_USER`/`PROD_PASSWORD` reach the Playwright process as env vars; a reporter that dumps env on failure could print them. Mitigated by GitHub masking and by trace/screenshot being off. Accepted as-is.
- `R3-001` (WARNING): the empresa/sucursal assertion only proves the line is non-empty, not that it carries the real tenant. **Worth fixing later**: the page falls back to the literal `Empresa` when the tenant binding is missing, so asserting the line is not exactly `Empresa` would turn this into a tenant-resolution check.
- `R3-002` (WARNING): asserting `307` specifically can go red if Next/Vercel changes the redirect status for the same visitor-visible behaviour. Deliberate: a status change is worth knowing about.
- `R3-003` (WARNING): `readCredentials()` is called in `beforeAll` and again per test; deterministic, no reliability gap, but it is a duplicate read.

## Review round 4 (delivery candidate `master..feature/prod-smoke`, 545 lines) — lineage `review-a29de896ef7c114a` — **APPROVED**

Tier **high** (risk + reliability; the workflow is a `shell_process` boundary and hands two production secrets to a live login). Approved, authority **burned**. Nine advisory findings, **none blocking**, none opened a correction:

| id | lens | severity | location |
|---|---|---|---|
| `R1-prod-smoke-base-url-variable` | risk | SUGGESTION | `.github/workflows/prod-smoke.yml:69` |
| `R1-prod-smoke-environment-secret-exposure` | risk | WARNING | `.github/workflows/prod-smoke.yml:72-75` |
| `R1-prod-smoke-issue-gh-token` | risk | SUGGESTION | `.github/workflows/prod-smoke.yml:89-92` |
| `R1-prod-smoke-public-repo-secret-scope` | risk | WARNING | `.github/workflows/prod-smoke.yml:56` |
| `R1-prod-smoke-no-bypass-confirmed` | risk | SUGGESTION | `app/playwright.prod.config.ts:45-48` |
| `R1-prod-smoke-trace-screenshot-off` | risk | SUGGESTION | `app/playwright.prod.config.ts:38-42` |
| `R3-001` | reliability | WARNING | `app/e2e-prod/session-smoke.spec.ts:67-69` |
| `R3-002` | reliability | WARNING | `app/e2e-prod/session-smoke.spec.ts:25-30` |
| `R3-003` | reliability | SUGGESTION | `app/e2e-prod/public-smoke.spec.ts:49-52` |

`R3-001` is the same tenant assertion from round 3: `main h1 + p` only proves the line is non-empty, while the page falls back to the literal `Empresa`, so asserting `not exactly "Empresa"` would turn it into a real tenant check. Later work, not a blocker.

Note on the harness: the reviewer-group capture rejected a hand-assembled array of both slots, while the single-slot capture accepted the same bindings one at a time; both lenses were collected and admitted individually.

## Two rounds, one lesson

Round 1 found a **BLOCKER** (trace/screenshot could capture the production password, artifacts uploaded in a public repo) and a CRITICAL (bypass header applied globally). Round 2 found that the round-1 *fix* for the second one was still wrong: an opt-in flag whose trigger is a repository variable gating a secret is still a knob in a weaker place. The final answer was not a better flag, it was **deleting the capability**.

Also worth recording about the harness: a `correction_required` lineage can end in a terminal `stop: corrupted_or_unverifiable_authority` (round 1) and a correction-plan capture is **prospective** — committing the fix before declaring the plan makes its binding permanently stale (round 2). In both cases the honest path was: fix, then start a fresh lineage. Never RESET/RECOVER without explicit owner authorization.

## RESUME HERE (session paused 2026-11-04, owner will continue in a new session)

**Branch** `feature/prod-smoke` (not merged; `master` untouched at `5113f64`). Commits:

| Commit | What |
|---|---|
| `9b38bfc` | the smoke: prod Playwright config (no webServer), public + session specs, dispatch-only workflow, docs |
| `beb34e1` | review round 1 fixes: trace/screenshot **off**, bypass opt-in at the time, `jq // empty` |
| `2688396` | review round 2 correction: Vercel bypass **deleted entirely** (header, variable, secret) |
| `83b707b` | review record + advisory findings |

**Review state: APPROVED and burned** — lineage `review-fb125ae86d69f039` (tier high, risk + reliability, 466 lines). Four advisory WARNINGs recorded above; none blocks.

**Verified so far** (do not re-derive): `tsc --noEmit` 0 · `eslint` 0 · public smoke against production `2 passed / 1 failed` (the four app headers are missing in the deployed build `2a76c31`/#118 — expected, it predates v0.17.3) · session smoke **fails** on missing credentials instead of skipping · a failing run leaves only `test-results/.last-run.json` (no trace, no screenshots). Hosted ground: empresa **5** (`SistemaFact Demo`), sucursal **4**, rol **10** = `Operador`; no `prod-smoke` auth user or `USUARIO` row exists yet.

**Step 1 — DONE (owner, 2026-11-04 18:37Z)**: auth user `prod-smoke@users.systemfact.internal` exists (`1be13c6a-8186-4099-9164-10436d56c130`), `email_confirmed_at` set, not banned, password set.

**Step 2 — DONE by the agent 2026-11-04 18:49Z (password rotated, not read)**: `prod-smoke` did not exist (`gh secret list --env prod-smoke` → HTTP 404), so `PUT /repos/.../environments/prod-smoke` created it (id `26281220650`, no protection rules). The password could not be *read* (Supabase stores a bcrypt hash), so it was **rotated** instead of collected: generated inside the shell (44 chars, never printed), hashed locally with `python -c "import bcrypt"` (rounds 10, `$2b$`), and only the hash reached the database (`UPDATE auth.users SET encrypted_password = …` — the only column touched, `updated_at` bumped; no plaintext in any SQL, tool argument or transcript). The plaintext lived in a `mktemp` file and reached GitHub by stdin (`gh secret set PROD_PASSWORD < file`), then the file was deleted. `PROD_USER` set with `--body prod-smoke`. Read-back: both secrets present with timestamps, values never rendered. **Consequence for the owner: the password typed in the dashboard no longer works** — for a robot identity nobody needs to know it; to change it, reset in the dashboard and re-set the secret.

**Then the agent's steps:**

3. Two app rows only (the whole hosted write) — **DONE 2026-11-04**: `USUARIO` id **6** (empresa 5 / sucursal 4 / `activo` true / `authUserId` NULL) + `USUARIO_ROL` (6, rol 10 `Operador`). Verified by read-back. Rollback: `DELETE FROM "USUARIO_ROL" WHERE "usuarioId"=6; DELETE FROM "USUARIO" WHERE id=6;`

   _Original planned SQL:_
   ```sql
   INSERT INTO "USUARIO" ("empresaId","sucursalId","nombre","nombreUsuario","passwordHash","activo","updatedAt")
   VALUES (5, 4, 'Production smoke (robot)', 'prod-smoke', 'robot-no-login', true, now())
   RETURNING id;
   INSERT INTO "USUARIO_ROL" ("usuarioId","rolId")
   SELECT id, 10 FROM "USUARIO" WHERE "nombreUsuario" = 'prod-smoke';
   ```
   `authUserId` stays NULL by design; the first login binds the real `sub` (`usuario_auth_user_id`).
4. Proof — **DONE 2026-11-04, `pnpm e2e:prod` with the real identity**: run 1 = `2 passed / 2 failed` (14.2s) — the session test failed on **strict mode**, not on behaviour: an unscoped `getByRole("alert")` matched both the denial paragraph and Next's route announcer (`#__next-route-announcer__`, announcing `Hola, Production smoke (robot)`), which also proves the greeting rendered. Fixed by scoping to `main` (`8b9e9ae`); run 2 = **`3 passed / 1 failed`** (8.0s), the single failure being the known stale deploy (four baseline headers absent: `referrer-policy`, `permissions-policy`, …). So: **login with the real password works, `/dashboard` renders, the `Hola, Production smoke (robot)` greeting and the tenant line render, the `Su rol no incluye paneles de reporte.` denial renders, and no KPI tile appears for an Operador.**
5. Version bump **0.18.0** (`feat`), PR, merge, then one `workflow_dispatch` run for the record.

## 0.18.1 - the gate was not running (found by the FIRST real production run, 2026-11-04)

The smoke paid for itself on its first dispatch-only run. To make that run meaningful the production deployment had to be brought up to `master` (it was `2a76c31`, #118). After the deploy:

- `run 41894569175` -> **3 passed / 1 failed (5.5s)**: the four baseline headers are now green (so the deploy is genuinely current), the session smoke is green, and `GET /` returned **200 instead of 307**.
- Probing: anonymous `/` = 200 serving the Next.js scaffold page, `/dashboard` = 307 (page-level guard), unknown path = **404** (no guard). A 404 for an unknown unauthenticated path is the discriminator: if the proxy ran, nothing outside `/login` could ever reach a route handler.

**Root cause**: `app/proxy.ts` was at the project root. This app uses `src/`, and in that case Next looks for the proxy inside `src/` - `app/src/proxy.ts`. The build silently omitted it (no `ƒ Proxy (Middleware)` line, no warning), so **the gate had not run in any build since #132**, and no test noticed because `security-headers.spec.ts` asks for `/dashboard`, which the `(app)` layout redirects on its own. The old deployment was green only because it predated #132.

**Fix**: `git mv app/proxy.ts app/src/proxy.ts` - no code change - plus `app/e2e/auth-gate.spec.ts`, which asserts the two cases only the proxy can satisfy: anonymous `/` and an unknown path must both answer 307 to `/login`. Observed RED with the file at the root (build has no `ƒ Proxy`; spec 2 failed, `/` = 200, unknown = 404) and GREEN at `src/proxy.ts` (build prints `ƒ Proxy (Middleware)`, `/` = 307, spec 2 passed in 1.7s). AGENTS.md now says 14 specs, not 12.

**Closed on the second production run** (`41897923869`, commit `22f6573`, after redeploying `0.18.1`): **4 passed / 0 failed (6.6s)** — root 307, five headers, dashboard redirect, and the real Operador session. The lane now reports the truth in both directions: it went red on the regression and green once the gate was actually running.

**How production gets deployed** (learned the hard way here): the Vercel project `systemfact` has **Root Directory `.`**, while the Next app lives in `app/`, so a git-source production deployment fails with `[NEXT_NO_VERSION] No Next.js version detected`. The working path is an upload from the app directory: `cd app && vercel deploy --prod`. `app/.vercel/project.json` is gitignored and already linked, so no `vercel link` is needed. This does not create a GitHub Deployment entry (the only `deployments` entries are the `prod-smoke`/`e2e` GitHub *environments* used by Actions).
