# Pending Follow-ups Ledger

Source of truth for follow-ups tracked outside active SDD cycles (AGENTS.md-conformant: archived
reports only document; this ledger keeps them actionable). Each item references its origin.

Approved working order (2026-10-13 owner decision): item 1 first, items 2–3 deferred.

## Pending

(none — item 1 completed; see Historical)

## Deferred (explicit owner decision 2026-10-13: not worth doing now)

2. **ADR-017 keyset re-check trigger (D1)** — NOT a task: a conditional trigger. If any tenant's
   VIGENTE set approaches tens of thousands of rows under OFFSET paging, re-open D1 (STOP condition
   pinned in design risks, not implemented as a monitor). Revisit only when production row counts
   approach the threshold.
   Origin: archive-report 2026-10-13 (follow-up 3).

3. **Native `gentle-ai sdd-archive-compose` formal archive** — archive for 2026-10-13 was closed
   with the local deterministic script `app/tools/scripts/sdd-archive-compose.ps1`; the native
   command is unshipped in any gentle-ai release (4.1.1 latest as of 2026-10-12). Re-run the formal
   native archive only when a future gentle-ai release ships the SDD suite (cost-policy decision:
   the owner declined an upstream report this cycle).
   Origin: archive-report 2026-10-13 (follow-up 4).

4. **App-shell credential walkthrough (admin vs non-admin)** — DONE 2026-10-14 via the dedicated
   `e2e-automation` robot principal (`pnpm seed:e2e-automation`, credential in gitignored
   `app/.env.e2e.local`; password never printed/committed). Playwright `e2e/selector-sucursal.spec.ts`
   3/3 GREEN live (SEL-SLOT-05-A admin-only trigger navigates, SEL-RENDER-02-A empresa
   static/unique, SEL-NAV-06-B idempotent no-op → /dashboard with a live header).
   **Bonus the walkthrough was built to find:** it surfaced a REAL defect — the session
   resolver's relation selects (`empresa`/`sucursal`) returned NULL under `empresa_select`
   RLS (no login-flow exception) and crashed `(app)` header rendering; fixed in
   `buscarUsuarioPorAuthSub` (2-phase resolution pinning `app.current_empresa_id` inside
   the resolving tx; auth+tenant suites updated for the documented 2-call contract).
   Trigger: E2E credentials available in the Playwright MCP environment.
   Origin: ui-foundation apply-progress (slice E verification gap, 2026-10-13).

## Historical

- E2E board re-pin — DONE 2026-10-13: squash-merged PR #119 (commit e1abe11), tag v0.14.13 +
  GitHub Release published. Origin: 2026-10-13 archive-report (follow-up 2).
- Release tags v0.14.8–v0.14.12 + GitHub Releases — DONE 2026-10-12 (manual protocol).
  Origin: archive-report 2026-10-13 (follow-up 1).
- Prod redeploy dpl_FSaEs2CEbHcY7kb25vNaC9NcB1P7 (v0.14.12) — DONE, smoke verified.
