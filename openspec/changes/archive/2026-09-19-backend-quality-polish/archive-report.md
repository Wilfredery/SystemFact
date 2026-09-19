# Archive Report: backend-quality-polish — Backend Code Quality Polish

**Status**: CLOSED
**Archived**: 2026-09-19
**Artifact store**: hybrid (openspec filesystem + engram topic)

## Executive Summary

Behavior-preserving SonarQube cleanup of the SystemFact backend: eliminated the 1 BLOCKER (S2187 probe relocation) and all 11 CRITICALs (9× S3776 cognitive complexity, 2× S3735), reduced issues from 63→28, duplication from 3.7%→1.0%, and technical-debt ratio from 457→129 minutes. All quality-gate ratings remain A/A/A. Delivered across 13 PRs (#58–#70), tags v0.11.5–v0.11.16, with a pass-2 stage (1f) that cleared the ≤15 complexity ceiling on 5 stubborn functions. Zero behavior change verified by golden/null-semantics tests and fiscal-diff-empty evidence.

## Delivery Chain

| PR | Slice | Tag | Scope |
|----|-------|-----|-------|
| #58 | 1a | v0.11.5 | S3776 producto+cliente: table-driven patch + audit-diff extraction |
| #59 | 1b | v0.11.5 | S3776 proveedor+preparar-lineas: decompose preparar-lineas + proveedor patch |
| #60 | 1c | v0.11.6 | S3776 normalizers: pure filter/accion normalizers |
| #61 | 1d | v0.11.6 | S3776 reportes page: REPORTE_ID registry dispatch |
| #62 | 1e | v0.11.7 | S3776 confirmar+devolucion: pre-consume extraction, void closes |
| #63 | 1f pass-2 | v0.11.8 | Pass-2 splits to clear S3776 ceiling (5 functions ≤15) |
| #64 | 2 | v0.11.9 | S2187 BLOCKER: relocate WTT probe outside sonar sources |
| #65 | 3 | v0.11.10 | Honest integration coverage: merge unit+integration lcov for sonar |
| #66 | 4 | v0.11.11 | Dependencies: prisma 7.x bump + transitive advisory overrides |
| #67 | 5a | v0.11.12 | Frontend mechanicals: readonly props, Intl monto format |
| #68 | 5a cont. | v0.11.13 | Frontend mechanicals continued |
| #69 | 5a final | v0.11.15 | Frontend mechanicals final (5a.3 scan deferred to stage-close) |
| #70 | 5b | v0.11.16 | Backend batch + dedup: sql fragments + guard/audit dedup |

All squash-merged to master. Version bump in PR #70 commit body.

## Verification Evidence (Final State)

| Metric | Baseline (v0.11.4) | Final (v0.11.16) |
|--------|---------------------|-------------------|
| BLOCKER | 1 | 0 |
| CRITICAL | 11 | 0 |
| S3776 >15 | 9 functions | 0 |
| Total issues | 63 | 28 |
| Duplication density | 3.7% | 1.0% |
| Technical debt | 457 min | 129 min |
| Ratings (S/R/M) | A/A/A | A/A/A |
| Unit tests | 911 | 945 |
| Unit suites | 104 | 108 |
| Integration tests | 195 | 195 |
| `pnpm audit --prod` | 6 advisories | 0 |
| `prisma validate` | ✅ | ✅ |
| `pnpm lint` | clean | clean (0 errors, 2 unused-eslint-disable warnings) |

Final Sonar scan: `ca94ca5a` (#854). Coverage: 36.5% merged unit+integration.

## Specs Synced to Main

The delta spec `openspec/changes/backend-quality-polish/specs/backend-code-quality/spec.md` was a NEW full spec (not a delta with ADDED/MODIFIED/REMOVED sections). Copied byte-identical (verified with `diff -r`) to the canonical location.

| Domain | Action | Requirements |
|--------|--------|-------------|
| backend-code-quality | Created | R-QC-01 through R-QC-06 (6 requirements, 10 scenarios) |

Source of truth updated: `openspec/specs/backend-code-quality/spec.md`

## Archive Contents

- proposal.md ✅
- design.md ✅
- tasks.md ✅ (see stale-checkbox reconciliation below)
- verify-report.md ✅
- specs/backend-code-quality/spec.md ✅

## Stale-Checkbox Reconciliation

tasks.md Phase 6 tasks (6.1–6.3) remain `- [ ]`. These are process/merge documentation tasks, not implementation tasks:

- **6.1** "Full walk: 911+ unit + 195+ integration green; lint; prisma validate; audit --prod zero" → **DONE** per verify-report: 945/108 unit exit 0, 195 integration green, tsc/lint/audit/prisma exit 0 (re-run this session at origin/master tree 20aa089).
- **6.2** "Final Sonar re-scan: 0 BLOCKER, 0 CRITICAL, all S3776 <15, dup <3%, ratings A" → **DONE** per orchestrator launch prompt (final-state authority): 0 BLOCKER/0 CRITICAL/0 S3776, dup 1.0%, ratings A/A/A, scan `ca94ca5a`.
- **6.3** "PR merge order 1a→1e, 2, 3, 4, 5a, 5b: user squash-merges each PR" → **DONE**: all PRs #58–#70 squash-merged; final tag v0.11.16.

Reconciliation reason: Phase 6 tasks document the verify+merge process; the verify-report itself and the orchestrator's final-state confirmation fulfill them. No implementation work remains. Orchestrator explicitly approved archive.

## Process Corrections (Lessons for Future Changes)

1. **Stage-1 pass-2 (1f)**: After slices 1a–1e, the stage-close Sonar analysis still reported 5 functions above the S3776 ≤15 gate. A second extraction pass (pass-2) was needed. **Lesson**: plan for a potential pass-2 in S3776-heavy changes; the first pass may not clear all functions if nested complexity exceeds the ceiling in ways not visible until the full scan.

2. **Validator-waiver persistence**: `gentle-ai sdd-verify-validate` was retired in gentle-ai 3.3.0 while sdd-verify SKILL v3.0 still gated persistence on it. The verify agent correctly held bytes unpersisted; the orchestrator persisted them on explicit waiver. **Lesson**: keep skill validation contracts in sync with tool availability; a retired command can block the entire pipeline.

## Accepted Leftovers (documented, none spec-blocking)

1. `venta/application/venta-service.ts:287` `motivo` ternary (S6606-family) — out of 5b fixed repo scope; touches return-motivo semantics; 0 CRITICAL/BLOCKER at final scan.
2. `venta/http/actions.ts:73` + `devolucion/http/actions.ts:60` `warnings && warnings.length > 0` (S6582) — adapter return-shape decision; non-blocking smells.
3. tasks.md stale launch-context corrections (reportes page path without `(app)` prefix; S3358 "×4" → actual 2; design probe path) — ground-truth corrections documented in tasks.md notes.
4. melha Guardian pre-commit hang → `GGA_SKIP=1` workaround documented; zero repo impact.
5. `sonar.cpd.exclusions` applied server-side (Option A, user-chosen) — repo-PR-free tuning; residual 28 issues are MINOR/MAJOR only.

## SDD Lessons for Future Changes

1. **Plan for pass-2 in complexity refactors**: S3776 cognitive complexity is not always reducible in one pass when functions have interleaved async reads. Budget a follow-up pass in the task plan.
2. **Probe relocation needs script+exclusion coordination**: Moving a test out of Sonar scope requires coordinated changes to `jest.config.js`, `package.json` scripts, and import paths — all in one atomic commit.
3. **pnpm.overrides location shifted**: pnpm 11+ reads overrides from `app/pnpm-workspace.yaml`, not `app/package.json`. Design docs should note the mechanism may differ by pnpm version.
4. **Validator tooling can retire mid-pipeline**: Keep skill validation contracts in sync with tool versions; a retired command blocks persistence until explicitly waived.
5. **Sonar cpd.exclusions should be codified**: Server-side lab config is not reproducible from a fresh scan. Future changes should codify exclusions in `sonar-project.properties` or a documented scan script.

## Final-State Facts (per Final-State Authority hierarchy)

1. **tasks.md**: All implementation tasks (1a.1–5b.3) complete. Phase 6 process tasks (6.1–6.3) reconciled — verified by verify-report and orchestrator final-state confirmation. No unchecked implementation tasks remain.
2. **Orchestrator launch prompt**: master 20aa089 v0.11.16; 0 BLOCKER/0 CRITICAL/0 S3776, dup 1.0%, ratings A/A/A; 945 unit + 195 integration green; audit --prod 0; issues 63→28; debt 457→129 min.
3. **verify-report.md** (intermediate snapshot): PASS verdict, 10/10 scenarios compliant, all gates met. Final numbers above match orchestrator confirmation.
4. **apply-progress.md**: Per-slice completion snapshots. Historical — final numbers supersede per-slice counts.

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
