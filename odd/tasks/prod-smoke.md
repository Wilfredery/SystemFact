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
| T2 smoke code: prod playwright config, public + session specs, workflow, docs | S1,S4 | worker | pending | |
| T3 prove the public half against the deployed URL (expected red until production is redeployed) | S1 | inline | pending | |
| T4 least-privilege identity + `prod-smoke` environment secrets (explicit production write) | S2,S4 | inline | pending | |
| T5 one real run with counts; enable the cron only after a green run | S3 | inline | pending | |
| T6 ODD: version bump, PR, review per assess | — | inline | pending | |

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
