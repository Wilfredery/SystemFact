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

4. **App-shell credential walkthrough (admin vs non-admin)** — DEFERRED: verify in a real
   browser session that "Cambiar sucursal" renders server-side only for Administrador and
   `/login` stays chromeless. Blocked on live E2E credentials (E2E_USER unset in this
   environment, `.env` intentionally unreadable); logic is statically verified in
   `app/src/shared/ui/app-shell/shell.tsx` (server branch, never CSS-hidden). Real security
   role is server-side (existing role checks + restrictive RLS); walkthrough is UX
   confirmation only. Trigger: E2E credentials available in the Playwright MCP environment.
   Origin: ui-foundation apply-progress (slice E verification gap, 2026-10-13).

## Historical

- E2E board re-pin — DONE 2026-10-13: squash-merged PR #119 (commit e1abe11), tag v0.14.13 +
  GitHub Release published. Origin: 2026-10-13 archive-report (follow-up 2).
- Release tags v0.14.8–v0.14.12 + GitHub Releases — DONE 2026-10-12 (manual protocol).
  Origin: archive-report 2026-10-13 (follow-up 1).
- Prod redeploy dpl_FSaEs2CEbHcY7kb25vNaC9NcB1P7 (v0.14.12) — DONE, smoke verified.
