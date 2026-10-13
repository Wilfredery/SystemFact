# Proposal: optimizacion-baseline — server-side pagination & deduplication cycle

Baseline source: Engram `sdd/optimizacion-baseline/audit` (observation 1067, "Audit baseline optimization (post run-3)") — 0 CRITICOS; 2 HIGH; 5 MEDIUM. Spot-checks confirmed: `saldo-cxc.repository.ts` VIGENTE-only canonical aggregate; `cxc-aging.ts:153` client-side `slice(offset, offset + filtro.pageSize)`; `inventario-repository.ts` per-row `findFirst` guards.

## Intent

A read-only audit of the modular monolith (~32.2k LOC in modules) found two HIGH scalability defects — the CxC board transfers the full VIGENTE invoice set and paginates client-side, and three reportes use cases fetch everything then slice in JS — plus five MEDIUM duplications (N+1 inventario guard, 12× duplicated audit writer, duplicated pagination helpers, per-render audit rows in product listing, ConfiguracionEmpresa active-window predicate re-encoded in 4 modules). Baseline metrics: 0 prisma calls outside `infrastructure`, 13 `findMany` sites (9 paginated), 0 unused deps, 0 `git mv` rename candidates. Each unbounded page grows linearly with tenant data volume; each duplication grows future maintenance cost. This change caps the interactive payloads at the DB and consolidates the duplicated logic, without touching fiscal export or locking semantics.

## Scope

### In Scope

1. **H1 — CxC board server-side pagination**: `saldo-cxc.repository.ts` (L46–93) gains LIMIT/OFFSET (or keyset) while the ADR-017 derivation SQL stays **byte-identical**; `CxcBoardScreen.tsx` and cobros `ui/board.ts` consume server pages instead of the full set.
2. **H2 — Reportes server-side pagination (interactive pages only)**: `domain/cxc-aging.ts:152–155`, `domain/operacional.ts:177–178`, `domain/rentabilidad.ts:97–105` move the page cut to the SQL layer (LIMIT/OFFSET) for interactive screens.
3. **M1 — Fix ownership-guard N+1 in inventory**: `inventario-repository.ts:177–182` — replace per-product `findFirst` guard with a single batched ownership-safe query.
4. **M2 — Consolidate audit append writer**: 12 duplicated call sites converge on the canonical `registrarEventoAuditoriaEnTx` (`auditoria/infrastructure/registrar-evento.repository.ts:41–68`). Net LOC negative.
5. **M3 — Shared pagination helper**: one `shared/domain/pagination.ts` replacing `auditoria/domain/auditoria.ts:137–234`, `reportes/domain/reporte-filtro.ts:91–301`, `financiero.ts`/`operacional.ts` `pagina<T>`, `cobros/ui/board.ts` `paginar<T>`.
6. **M5 — Shared ConfiguracionEmpresa active-window reader**: one config-reader seam replacing the re-encoded predicate in 4 modules.

### Out of Scope

- **DGII TXT exports** (`reportes-export`, `reportes-fiscales`): remain unbounded by fiscal design — never paginated.
- **Inventory FOR UPDATE loop reshaping** (`inventario-repository.ts` single-row locking loops): deliberate serialization; any WHERE-IN FOR UPDATE variant changes locking semantics and is a separate change with its own tests.
- **M4 — audit row per product-listing page render** (`listar-productos.ts:50` → `registrarProductoListadoEnTx`): owner decision RESOLVED (2026-10-12) — `producto.listed` is throttled to one aggregated row per actor + 1-minute window (REQ-PROD-010-B delta). IN SCOPE, implemented in PR4 alongside M2.
- FOR UPDATE single-statement lock variant: deferred with the inventory locking work.
- Any `git mv` renames: naming is clean; renames happen only as a consequence of M2/M3 consolidation (code edits).

## Capabilities

> Contract with sdd-spec. Existing capability names researched in `openspec/specs/` (cobros, cobros-derived-balance, reportes-financieros, reportes-operacionales, reportes-rentabilidad, inventario, auditoria, venta-config, backend-code-quality all exist and are used below).

### New Capabilities

None — every affected area already has a capability spec.

### Modified Capabilities

- `cobros`: board listing gains a server-pagination requirement (page/offset, ordering newest emission first preserved, page-size caps 25 default / 100 max per AGENTS.md). The derived-balance formula requirement is NOT changing — it MUST remain byte-identical; only the serving strategy changes. Cross-check with `cobros-derived-balance` (no delta there).
- `reportes-financieros`: interactive financiero report paging moves from in-memory `pagina<T>` to LIMIT/OFFSET at the data layer; pagination contract per page-size caps.
- `reportes-operacionales`: same server-side paging change for `operacional.ts` (and `cxc-aging.ts` if it belongs to the operacional family — spec phase decided placement).
- `reportes-rentabilidad`: same server-side paging change for `rentabilidad.ts`.
- `inventario`: ownership guard is server-batched, not per-product N+1; guard semantics (deny-by-default, tenant+branch pin) unchanged.
- `auditoria`: single canonical append writer; auditoria pagination helper absorbed into the shared module.
- `backend-code-quality`: shared pagination helper contract (`shared/domain/pagination.ts`) and shared ConfiguracionEmpresa active-window reader seam — no duplicated re-encoding across modules.
- `venta-config`: active-window predicate has ONE canonical reader; other modules consume it (read-only seam, no behavior change).

## Approach

Five chained PR slices, each an autonomous work unit ≤~350 target lines, honoring the version-bump-per-PR policy in AGENTS.md (`app/package.json` + `.release-please-manifest.json` + `app/CHANGELOG.md` bumped inside each PR; UTF-8 no-BOM writes only):

| PR | Content | Est. size | Why this order |
|----|---------|-----------|----------------|
| 1 | M1 (batched inventory ownership guard) + M3 (shared pagination helper migrated first in `cobros/ui/board.ts` + one reportes caller) | ~85–125L | Pure refactors/root cause isolation; establishes `shared/domain/pagination.ts` before H1/H2 need it |
| 2 | H1 CxC board server pagination on top of the shared helper | ~120–180L | Highest user-facing risk; needs PR 1's helper |
| 3 | H2 reportes LIMIT/OFFSET (`cxc-aging`, `operacional`, `rentabilidad`) on the shared helper | ~150–250L | Depends on PR 1's helper + PR 2's proven LIMIT/OFFSET pattern |
| 4 | M2 audit-writer consolidation (12 sites → canonical fn) | ~150–250L net-negative | No runtime behavior change; safe after pagination work stops touching audit-adjacent code |
| 5 | M5 shared ConfiguracionEmpresa active-window reader | ~100–150L | Last because it touches 4 modules' read seams after everything else has settled |

Each slice: clear start defined by baseline file:line refs, clear finish verified by tests, autonomous verification (existing Jest suites + new tests where behavior is observable), independent git revert for rollback. Order only imposes soft dependency (PR 2/3 on PR 1); each PR can be reviewed and green on its own. ADR-017 derivation verified byte-identical via grep-diff of the canonical SQL block between baseline and final tree.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/cobros/infrastructure/saldo-cxc.repository.ts` | Modified | H1 LIMIT/OFFSET on VIGENTE set; ADR-017 SQL byte-identical |
| `app/src/modules/cobros/http/` + `cobros/ui/board.ts` + board screen | Modified | H1 serve/consume server pages |
| `app/src/modules/reportes/domain/cxc-aging.ts` | Modified | H2 slice at DB |
| `app/src/modules/reportes/domain/operacional.ts` | Modified | H2 slice at DB |
| `app/src/modules/reportes/domain/rentabilidad.ts` | Modified | H2 slice at DB |
| `app/src/modules/inventario/infrastructure/inventario-repository.ts` | Modified | M1 batched ownership guard |
| `app/src/modules/auditoria/infrastructure/registrar-evento.repository.ts` | Modified (canonical) + 12 call sites | M2 dedup |
| `app/src/modules/auditoria/domain/auditoria.ts` | Modified | M3 helper absorbed |
| `app/src/modules/reportes/domain/reporte-filtro.ts` | Modified | M3 helper absorbed |
| `app/src/modules/reportes/domain/financiero.ts` | Modified | M3 `pagina<T>` absorbed |
| `app/src/shared/domain/pagination.ts` | New | M3 single helper |
| ConfiguracionEmpresa readers (4 modules; exact set listed by audit refs) | Modified | M5 shared active-window reader |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| H1 pagination breaks ADR-017 derived-balance math | Low | Export the canonical aggregate as a byte-identical block; grep-diff check in tests + review; integration test compares derived totals old vs new query plan |
| H2 report page ordering changes (LIMIT/OFFSET vs in-memory sort) | Low | Preserve the exact ORDER BY used by the current sort before slicing; domain unit tests pin ordering |
| M2 consolidation touches audit semantics (append-only contract) | Low | Pure mechanical consolidation to already-canonical fn; no UPDATE/DELETE path; audited content byte-identical test |
| PR slicing dropping a duplicated helper use case | Low | Grep-count duplicated helpers must reach the delta target (duplicated helpers → 0 for M3 scope) |
| M4 ambiguity | — | RESOLVED: listed event throttled per obs-1070 wording (window row, no retro-merge); implemented in PR4 |

## Owner Decision Record (RESOLVED — M4 / REQ-PROD-010, decided 2026-10-12 by the owner via the orchestrator)

**REQ-PROD-010**: listing events stay auditable but throttled — one `producto.listed` row per actor per one-minute sliding window, payload `{ count: total }` for the read that opens the window; reads inside an open window append nothing and are never retro-merged (append-only forbids mutation). Resolver: owner delegated to technical criterion; rationale saved in Engram `sdd/optimizacion-baseline/decision-m4`. Implemented in PR4.

## Rollback Plan

Per slice: each PR is a single coherent work unit with its own version bump, so `git revert <merge-commit>` restores the previous behavior without collateral (no schema migrations in this change; no data backfill). Slices have no shared DB state, so reverting PR 3 does not invalidate PR 1 deliverables. If a slice being applied is hotfixed: re-deploy from the previous tagged release (tags exist per-PR under the release convention). The byte-identical ADR-017/inventarios locking guarantees mean fiscal behavior is preserved even mid-rollout (slices 1–5 individually observable on production without en bloc rollback).

## Dependencies

- RESOLVED: REQ-PROD-010 owner decision (2026-10-12) — M4 throttled-window semantics in scope via PR4 (see Owner Decision Record).
- CI green per PR (ESLint, strict typecheck, `prisma validate`, unit + integration tests on Postgres 16 with RLS, production build, Conventional Commits guard — AGENTS.md CI contract).
- Release convention: each PR carries its own version bump (feat → MINOR, fix/refactor → PATCH pre-1.0). M-series PRs are `refactor` → PATCH bumps.

## Success Criteria

- [ ] Interactive CxC board and the three reportes use cases use server-side paging; no unbounded fetch feeding interactive screens in the audit-file:line set.
- [ ] ADR-017 derivation SQL byte-identical: grep-diff of the canonical aggregate block shows no character diff between baseline commit and merge result.
- [ ] Baseline metric deltas: `findMany` without take count shrinks toward `findMany` with explicit take within interactive paths (pages capped 25 default / 100 max — AGENTS.md); duplicated pagination helpers count = 0 (single `shared/domain/pagination.ts`); audit writer call sites non-canonical count = 0.
- [ ] M2 slice does not grow net LOC (demonstrated by diffstat: deletions ≥ additions).
- [ ] M1: no per-product `findFirst` guard loop in `inventario-repository.ts` listing path; ownership semantics identical (integration test passes unchanged).
- [ ] M5: exactly one canonical active-window predicate implementation; 4 call sites consume it; unit test renders the predicate from the seam.
- [ ] All five PRs individually merge green under the CI gate and carry their own version-bump commits.
- [ ] DGII TXT exports remain unbounded (no pagination introduced in `reportes-export`/`reportes-fiscales` paths).
- [ ] Inventory lock loops unchanged (verification: no diff to FOR UPDATE transaction blocks in `inventario-repository.ts`).
- [ ] M4 implemented per resolved semantics: up to one `producto.listed` row per actor+minute window; no mutation path on audit rows.
- [ ] ConfiguracionEmpresa predicate has exactly one implementation; other modules import it.

## Key Learnings

1. Spot-checks confirmed every audited file:line reference cited by the baseline before the proposal cited them.
2. The ADR-017 byte-identical constraint is the load-bearing safety net for all pagination work in this cycle.
3. Capability names must come from existing openspec/specs folders so spec and archive phases discover them consistently.

<!-- Engram mirror: topic_key sdd/optimizacion-baseline/proposal -->
