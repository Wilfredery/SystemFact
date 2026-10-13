# Pending Follow-ups Ledger

Source of truth for follow-ups tracked outside active SDD cycles (AGENTS.md-conformant: archived
reports only document; this ledger keeps them actionable). Each item references its origin.

Approved working order (2026-10-13 owner decision): item 1 first, items 2–3 deferred.

## Pending

1. **E2E board re-pin** — Playwright must re-pin the cobros board navigation to the server-page
   walk (per-bucket nav replaced by page nav in PR #114). Noted in the PR #114 body and the
   2026-10-13 archive-report. → IN PROGRESS 2026-10-13.
   Origin: openspec/changes/archive/2026-10-13-optimizacion-baseline/archive-report.md (follow-up 2).

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

## Historical

- Release tags v0.14.8–v0.14.12 + GitHub Releases — DONE 2026-10-12 (manual protocol).
  Origin: archive-report 2026-10-13 (follow-up 1).
- Prod redeploy dpl_FSaEs2CEbHcY7kb25vNaC9NcB1P7 (v0.14.12) — DONE, smoke verified.
