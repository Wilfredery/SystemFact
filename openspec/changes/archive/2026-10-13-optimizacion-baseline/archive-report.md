# Archive Report: `optimizacion-baseline`

**Change**: `optimizacion-baseline` — server-side pagination & deduplication cycle
**Archived**: 2026-10-13
**Base at open**: master `73e56f7` (v0.14.7) · **Master at close**: `5b29219` (v0.14.12)
**Artifacts store**: hybrid (openspec files mirrored in Engram until close)
**Status**: CLOSED / SHIPPED (all 5 PR slices merged via squash; release tags pending manual protocol)

## Why this cycle

The owner-directed audit baseline run (post run-3 remediation, obs #1067) found 0 CRITICALs, 2 HIGH
transport defects (unbounded payloads: CxC board client-side pagination; reportes in-memory slicing)
and 5 MEDIUM duplications (inventory ownership-guard N+1; 12× audit-append copies; duplicated
pagination helpers; per-render `producto.listed` audit rows; ConfiguracionEmpresa active-window
predicate re-encoded in 4 modules). This change capped interactive payloads at the database,
consolidated duplicated write/read seams, and resolved the M4 product decision (obs #1069, #1072).

## Slice ledger (all merged, every commit CI gate green)

| PR | Merge sha | Version | Content | Owner-approved |
|----|-----------|---------|---------|----------------|
| #113 | `a780df7` | 0.14.8 (PATCH) | M1 batched ownership guard (R-INV-B1) + shared pagination contract (R-QC-07) + board absorb | in ACPI: budget |
| #114 | `89ebb5b` | 0.14.9 (MINOR) | H1 CxC board server-side pagination (R-C9) + AU-4 auditoria absorb + `pagina<T>` D7 absorb | size:exception |
| #115 | `1377961` | 0.14.10 (MINOR) | H2 reportes data-layer cuts: aging (FIN-6), rentabilidad (REN-4), estadoFacturas (OP-6) | size:exception |
| #116 | `23266f4` | 0.14.11 (PATCH) | M2 audit-writer consolidation 12→1 (AU-1, net-negative −53L) + M4 `producto.listed` dedupe (REQ-PROD-010) | size:exception |
| #117 | `5b29219` | 0.14.12 (PATCH) | M5 ConfiguracionEmpresa active-window reader seam (R-QC-08 / R-C4) — 7 sites → 1 | size:exception |

size:exception approximations: ~1,256 / ~1,284 / ~1,100 / ~584 lines, each dominated by design-mandated
pinned tests (order-page walks, dedupe windows, ADR-017 grep-diff guards, isolation pins, parity tables). No test
dropped or compressed; authored production diffs were ~230 / ~450 / ~430 / ~160 / ~156 lines.

## Spec sync at archive

The native `gentle-ai sdd-archive-compose` command is not shipped by the installed gentle-ai binary
(4.1.1, latest release as of 2026-10-12; code/issues search upstream: 0 hits — recorded in obs #1077).
Per the skill's contract NO manual model Read/Edit merge was performed. Instead, this repo ships a
deterministic local reimplementation used for this one cycle, subject to CI rules
(`app/tools/scripts/sdd-archive-compose.ps1`) which:
- replaces `## MODIFIED Requirements` blocks by exact requirement id (exit 1 if the id is missing in canonical),
- appends `## ADDED Requirements` blocks (exit 1 if the id already exists in canonical),
- writes atomically (compose-tmp + Move-Item) with UTF-8 no-BOM and performs a structural readback:

| Domain | Token verified after merge (in `openspec/specs/<domain>/spec.md`) |
|--------| ------------------------------------------------------------------ |
| producto | "one-minute sliding window" (REQ-PROD-010 replaced, throttle semantics) |
| auditoria | `registrarEventoAuditoriaEnTx` (AU-1 consolidated wording) |
| backend-code-quality | `shared/domain/pagination.ts` (R-QC-07) |
| cobros | R-C9 board server-side pagination requirement |
| inventario | R-INV-B1 batched ownership guard |
| reportes-financieros | FIN-6 |
| reportes-operacionales | ordering preserved from the pre-slice sort (OP-6) |
| reportes-rentabilidad | REN-4 |
| venta-config | R-C4 single canonical reader |

All 9 domains composed with exit=0, byte checks `bytes[0] != 0xEF` passed, and no requirement was
dropped in any canonical file (15 requirements in producto before and after; block counts unchanged).

## Metrics before → after (the cycle's changed behavior)

| Metric | Baseline (obs #1067) | After merge (5b29219) |
|--------|---------------------|------------------------|
| prisma outside infrastructure | 0 | 0 |
| Duplicated pagination helpers | 5 copies (`normalizarPageSize`, `calcularOffset`, `calcularTotalPages`, `pagina<T>` ×2, `paginar<T>`) | ONE shared contract consumed everywhere |
| Non-canonical audit append sites | 12 | 0 (single `registrarEventoAuditoriaEnTx`) |
| Active ConfiguracionEmpresa predicate implementations | 7 re-encoded across 4 modules | 1 seam |
| CxC board transfer | full VIGENTE set to browser | ≤100 rows per server action page + total/metadata |
| Interactive reportes payloads | full set + in-memory slice | ≤100 rows per SQL page (LIMIT/OFFSET, ordering pinned) |
| `producto.listed` audit rows | 1 per page render, infinite growth | ≤1 per actor per minute, `{count}` of the window-opening read; no retro-merge |
| Tests at close | — | 128 suites / 1226 unit + 51/238 integration (Postgres 16 RLS) |

## Verification model (no separate verify-report phase)

The change opted for CONTINUOUS per-slice verification instead of one trailing verify-report phase:
each apply slice ran the full local battery (`prisma validate`, strict `tsc --noEmit`, `lint` 0
errors, unit + integration with Postgres 16/RLS) and each merged PR re-ran the full GitHub CI gate
(Conventional Commits, Lint/types/schema, Unit, Integration Postgres+RLS, Production build, E2E
preflight; E2E smoke skipped by the secrets contract). PR #116's first CI gate failed on two TS
errors in new tests and was fixed by the orchestrator before merge (verified green after force-push
`f066972`). This is recorded here instead of a verify-report — verification was continuous, not deferred.

## Open follow-ups (NOT pending tasks in this change; tracked outside the SDD cycle)

1. **Release tags**: v0.14.8–v0.14.12 (`a780df7`, `89ebb5b`, `1377961`, `23266f4`, `5b29219`) + GitHub
   Releases pending — manual versioning protocol (AGENTS.md 2026-09-15).
2. **E2E board re-pin**: Playwright must re-pin the cobros board navigation to the server-page walk
   (per-bucket nav replaced by page nav). Noted in the PR #114 body; carry to the E2E owner.
3. **ADR-017 keyset re-check trigger** (D1): if any tenant's VIGENTE set approaches tens of thousands
   of rows under OFFSET paging, re-open D1 — the STOP condition is pinned in design risks, not
   implemented as a monitor.
4. **reported upstream tooling gap**: `sdd-archive-compose` is declared by skill v2.0 but is not
   shipped by gentle-ai 4.1.1. The repo's local script in `app/tools/scripts/` documents this and the
   deviation from the skill's letter; the owner declined an upstream GitHub report for this cycle.

## Deviations / decisions ledger (highest-authority-first)

- M4 (REQ-PROD-010) was resolved as IN-SCOPE during spec (Owner Decision Record in proposal.md):
  `producto.listed` keeps the LEER distinction but throttles to 1 row per actor + minute window with
  a combined count of the page that opens the window (append-only preserved, count cannot be merged
  into prior rows; documentable race = 1 extra row per parallel same-actor listing, accepted).
- PR #114: `consultarSaldoCxcEnTx` etc. kept byte-identical by adding outward paged functions
  (`consultarSaldoCxcTableroEnTx`, `contarSaldoCxcEnTx`, `consultarSaldoCxcPaginado`,
  `consultarEstadoDeCuentaAction`) — the optional-page-tail letter of tasks 2.3 was unsatisfiable
  with its own invariant, resolved the outward-function way (PR body + apply-progress #1075).
- PR #115: rentabilidad keeps the summary grouped read un-paged (risk #7 — SQL SUM would re-encode
  per-row rounding and break EXP-2); estadoFacturas's added ORDER BY is the ENUM declaration order
  (stronger behavioral pin than the design's "alphabetical" wording); aging SQL mirrors the
  `diasVencido` SD-tz computation with `AT TIME ZONE 'America/Santo_Domingo'::date` + `dbPlazo` bind.
- PR #116: `registrarProductoListadoEnTx` gained an optional `ahora?: Date` 5th param (tested
  determinism, callers default it); site-4 private `registrarAuditoriaStockEnTx` exported solely for
  the pin test; the DB `AUDITORIA_INMUTABLE` trigger (pre-existing) rejects UPDATEs thrown loudly —
  a stronger guarantee than the RLS-only wording in AU-1.
- PR #117: the seam compares tz ABSOLUTE instants; SD resolution stays at callers (behavior unchanged
  beats the R-QC-08 SD-calendar wording, risk #7 & #8 accounted in the design).

## Session artifacts

- Engram: proposal #1068, spec #1070 (corrected wording at close), design #1071 (validator PASS),
  tasks #1073, apply-progress #1075 (PR1–PR5 merged, rev 6), decisions #1069/#1072,
  archive-attempt #1077, session summary #1078.
- Filesystem: this folder is `openspec/changes/archive/2026-10-13-optimizacion-baseline/` —
  proposal.md, design.md, tasks.md, specs/ (9 deltas) preserve byte-identical copies as merged.
- `openspec/specs/` now holds the merged canonical specs (source of truth going forward).
