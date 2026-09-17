# Archive Report: fase-7b-reportes — Reportes Module (Fase 7, reports half)

**Status**: CLOSED
**Archived**: 2026-09-17
**Artifact store**: openspec (repo-local)

## Executive Summary

Delivered the complete Reportes module for SystemFact: a real KPI dashboard replacing the placeholder, five report families (operational, financial, profitability, fiscal, export) across 35 implementation tasks, and DGII 606/607/608 TXT exporters. All delivered as a 5-PR chained sequence (#48–#52) plus version-bump PR #53, all squash-merged to master.

## Delivery Chain

| PR | Slice | Squash Commit | Scope |
|----|-------|---------------|-------|
| #48 | A | 6342df2 | Dashboard + shared infra (filters, widen, CSV seam, shell) |
| #49 | B | f614690 | Operational reports + CSV live + index migration |
| #50 | C | d4bc011 | CxC aging, CxP, comparativa |
| #51 | D | c173d84 | Rentabilidad por producto |
| #52 | E | 7b05170 | Fiscal reports + DGII TXT exporters |
| #53 | — | 368218c | Version bump (app/package.json + CHANGELOG) |

Merge order: #48 → #49 → #50 → #51 → #52 → #53 (all squash-merged to master).

## Releases Published

v0.6.0 (#46), v0.6.1 (#47), v0.7.0 (#48), v0.8.0 (#49), v0.9.0 (#50), v0.10.0 (#51), v0.11.0 (#52), v0.11.1 (#53 version sync). Human-driven tag protocol per AGENTS.md §CI/CD.

## Verification Evidence

| Metric | Value |
|--------|-------|
| Unit suites | 104 passed |
| Unit tests | 911 passed |
| Reportes integration suites | 5 (on real Postgres 16, sf-postgres, RLS enforced, systemfact_app) |
| Reportes integration tests | 44 (A:8 + B:9 + C:10 + D:7 + E:10) |
| DGII unit tests | 63 pure domain tests |
| DGII integration tests | 10 fiscal integration |
| DGII pre-validation | 6 tests (U1 encoding, U2 byte offsets, U4 Cancelada scope) |
| Identificacion mod-11 | 10 tests |
| Lint | 0 errors (pnpm lint clean) |
| Typecheck | pnpm tsc --noEmit clean |
| Prisma validate | Schema valid |

## CI Fixes Applied During Delivery

1. **Next 16/Turbopack 'use server' contract**: ALL exported Server Actions required `export async function` and no top-level consts — fixed chain-wide via rebase with --onto onto squashed masters.
2. **Stray patch-debris line** at actions.ts:295 (commit-subject fragment) broke lint+build in slice E — fixed in commit "fix(reportes): remove stray patch-debris line at eof of fiscal actions".

Both fixes applied before final merge; final master CI ran green for all PRs.

## Specs Synced to Main

All 6 capability specs are NEW (no pre-existing main specs to merge). Each delta spec was a full spec (no ADDED/MODIFIED/REMOVED sections) and copied byte-identical to `openspec/specs/{domain}/spec.md`.

| Domain | Action | Requirements |
|--------|--------|-------------|
| reportes-dashboard | Created | DB-1 through DB-6 (6 requirements, 8 scenarios) |
| reportes-export | Created | EXP-1 through EXP-5 (5 requirements, 7 scenarios) |
| reportes-financieros | Created | FIN-1 through FIN-5 (5 requirements, 8 scenarios) |
| reportes-fiscales | Created | FIS-1 through FIS-6 (6 requirements, 8 scenarios) |
| reportes-operacionales | Created | OP-1 through OP-6 (6 requirements, 8 scenarios) |
| reportes-rentabilidad | Created | REN-1 through REN-3 (3 requirements, 4 scenarios) |

## Archive Contents

- proposal.md ✅
- design.md ✅
- tasks.md ✅ (35/35 tasks complete, 0 unchecked)
- apply-progress.md ✅
- explore.md ✅
- research.md ✅
- verify-walk.md ✅
- specs/ ✅ (6 domains, each with spec.md)

## Source of Truth Updated

The following specs now reflect the new behavior:
- `openspec/specs/reportes-dashboard/spec.md`
- `openspec/specs/reportes-export/spec.md`
- `openspec/specs/reportes-financieros/spec.md`
- `openspec/specs/reportes-fiscales/spec.md`
- `openspec/specs/reportes-operacionales/spec.md`
- `openspec/specs/reportes-rentabilidad/spec.md`

## Final-State Facts (per Final-State Authority hierarchy)

1. **tasks.md**: 35/35 implementation tasks complete. Zero unchecked `- [ ]` lines.
2. **Orchestrator launch prompt**: 5-PR chain #48–#52 ALL squash-merged to master; CI green; verification evidence (104 suites / 911 unit + 44 integration); releases v0.6.0–v0.11.1 published.
3. **apply-progress.md** (intermediate snapshot): Per-slice completion status, test counts at time of write, workload notes. These are historical snapshots — final numbers above supersede per-slice counts.

## Known Limitations (documented, not defects)

- **EXP-3**: No e2e Playwright coverage for "generation never blocks UI" — server routes exist structurally; only devolucion/confirm-venta/cobros Playwright specs exist.
- **EXP-5**: No e2e deep-link round-trip — partial unit + integration coverage only.
- **FIS-6 U1–U5**: DGII pre-validation U3 (authoritative Tipo-Ingreso table), U5 (current 606 cap), and U2 exact byte offsets remain release-time tool confirmation. All open items are documented config seams (formato.ts widths, TOPE_606_POR_DEFECTO, DB DGII_TIPO_INGRESO_607, CODIFICACION_DGII) — data edits, never logic rewrites. In-panel AvisoPrevalidacion disclaimer present.
- **Rentabilidad cost basis**: Uses current costoPromedio; historical margins not reproducible (documented limitation per REN-3).

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
