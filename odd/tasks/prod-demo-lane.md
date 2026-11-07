# prod-demo-lane — the local E2E checks, run against production, writing only into the demo company

Objective: prove, on the deployed system (Vercel + Supabase + backend + frontend), that the same flows
the local E2E suite proves (cash sale, credit sale + payment, return with B04, the authenticated pages
under the enforced CSP) also work in production, by writing demo data into the demo company only.
Branch: `feature/prod-demo-lane` · Delivery: one PR (version bump included, `.github/workflows/**` changes).

Status: **specs recorded 2026-11-07, nothing built, nothing run against production.**

## Specs (owner decisions, 2026-11-07 — quoted verbatim, do not paraphrase)

- **S1** — owner: "Get the same test as u focus local same in production, I give u the permison to create demo examples just to make sure the production(backend, frontend, supabase and vercel works well)."
- **S2** — owner chose "Separate demo company (recommended)" for where demo sales are created, then answered the follow-up "Production has one company: "SistemaFact Demo" (id 5, RNC 131000002). Is that company just test/demo data, or will it become your real company?" with "**It is only test/demo data**". → company 5 **is** the demo company: demo writes are allowed there and **nowhere else**. If company 5 ever becomes a real company, this lane must be retired first (see S8).
- **S3 (relation to the existing smoke)** — `odd/tasks/prod-smoke.md` S2 ("it must never write: no sale confirmation, no NCF consumption, no void") and the `HARD RULE — NO FISCAL WRITES` header of `app/e2e-prod/session-smoke.spec.ts` stay **unchanged and true for that lane**. The demo lane is a **separate** one: its own workflow, its own GitHub environment (`prod-demo`, not `prod-smoke`), its own identity, `workflow_dispatch` only, never in `ci-gate`, never scheduled. Do not merge the two (R1-workflow-env-conflation).
- **S4 (isolation is structural, not just a check)** — the lane logs in with a **demo identity bound to company 5 only**; RLS and server-side authorization mean it cannot read or write another empresa. Before any write the spec also asserts the empresa name shown in the UI equals the expected demo name from the environment, and aborts otherwise. No hardcoded ids: everything is derived at runtime.
- **S5 (no credential leak, same policy as the smoke)** — traces, screenshots and videos stay **off** (`playwright.prod.config.ts` explains why: the repo is public and a trace can capture a password). No credentials, tokens or cookie values in logs or messages.
- **S6 (bounded fiscal numbering)** — fiscal documents are never deleted (`Cancelada` vs `Anulada`), so every run consumes invoice numbers for good. Measured 2026-11-07 (read-only aggregates, company 5): B01 `secuenciaActual` 12 of 1-100, B02 117 of 101-200, B04 207 of 201-300, all valid only until **2026-12-31**; the app warns at 90% and blocks when exhausted or expired. The lane must be run deliberately (dispatch only), and each run's consumption must be stated in its report.
- **S7 (least privilege)** — the demo identity gets the **smallest role** that can run the flows. Worker must determine it from the role matrix in code and report it; the owner provisions the user (passwords stay operator-side, `app/USER-PROVISIONING.md`, T4 withdrawn). Restocking uses an `AJUSTE` movement through the app, never a direct update.
- **S8 (retirement)** — before this company is ever used for real invoices, the owner retires the lane (delete the `prod-demo` environment secrets and ban or deactivate the demo user: master entities are never deleted, `activo=false`).
- **S9 (agent boundary)** — the agent writes code and docs; it does **not** touch production data to prepare the lane. The first production run happens only by workflow dispatch, after the owner has provisioned the demo user and the environment secrets.

## Production state measured by the agent (read-only SELECT aggregates through the Supabase tool, 2026-11-07, no names or personal data)

1 empresa (id 5, `facturaAutomatica` true) · 1 sucursal · 1 producto · 2 clientes · 3 usuarios (2 Administrador, 1 Operador) · 29 ventas / 29 facturas · NCF ranges as in S6.

## Tasks

| ID | S# | Route | Status | Commit |
|----|----|-------|--------|--------|
| T1 minimum role per flow (read the role matrix) + provisioning instructions for the demo user (owner step) | S4, S7, S9 | worker | pending | |
| T2 make the sales / cobros / devolucion / authenticated-pages specs production-capable: env-driven base URL and credentials, ids and names derived at runtime, empresa-name guard before any write | S1, S4 | worker | pending | |
| T3 separate lane: `playwright.prod-demo.config.ts`, `.github/workflows/prod-demo.yml` (dispatch only, environment `prod-demo`, traces/screenshots off, fails on skips like the other lanes) | S3, S5 | worker | pending | |
| T4 docs: README of the lane, note in `odd/tasks/prod-smoke.md` pointing here (S2 there unchanged), `app/USER-PROVISIONING.md` demo-user section | S3, S7, S8 | worker | pending | |
| T5 bump, review, PR, CI, merge | — | parent | pending | |
| T6 owner: create the demo user + `prod-demo` environment secrets | S7, S9 | owner | pending | |
| T7 first dispatch against production, report counts and the invoice numbers consumed | S1, S6 | parent | pending | |

## Log

- L1 (2026-11-07): owner, verbatim: "1. Get the same test as u focus local same in production, I give u the permison to create demo examples just to make sure the production(backend, frontend, supabase and vercel works well)." Safeguard proposed by the agent and accepted: writes only into a demo company; the owner then answered that company 5 is "only test/demo data". The agent mapped the seed, provisioning and isolation facts with a read-only explorer and measured the production state with read-only aggregates (see above); no production data was written.
