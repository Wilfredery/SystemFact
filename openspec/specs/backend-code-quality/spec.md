# Delta for Backend Code Quality

## Purpose

Contract for the behavior-preserving SonarQube cleanup of the backend (change `backend-quality-polish`): quality-gate thresholds, refactor preservation rules, per-stage acceptance gates, and documented out-of-scope items. No feature behavior is defined here; existing capability specs remain authoritative for domain semantics.

## ADDED Requirements

### Requirement: Quality-Gate Thresholds Contract (R-QC-01)

The backend MUST keep the SonarQube quality gate at: BLOCKER = 0; CRITICAL = 0 — every function in production `app/src` has cognitive complexity (S3776) ≤ 15; global duplication density < 3%; quality-gate ratings security, reliability, and maintainability (SQALE) all = A. Thresholds MUST be verifiable via Sonar API measures.

#### Scenario: Post-stage scan passes the gate

- GIVEN the Sonar lab is re-scanned after each stage ends
- WHEN gate measures are queried via the Sonar API
- THEN BLOCKER = 0, CRITICAL = 0, duplication < 3%, and all ratings are A
- TEST: manual (Sonar API measures)

#### Scenario: Complexity ceiling enforced per function

- GIVEN any refactored production function in `app/src`
- WHEN Sonar analyzes it
- THEN its cognitive complexity is ≤ 15 (zero S3776 findings)
- TEST: manual (Sonar issue list)

### Requirement: Behavior Preservation for Refactored Functions (R-QC-02)

All 9 S3776 refactors MUST be behavior-preserving: undefined-vs-null field-patch semantics in cliente/producto updates MUST stay distinguished (explicit `!== undefined` on nullable fields); the R-V15 throw-after-consume ordering in `confirmar-venta`/`crear-devolucion` MUST remain unchanged; authorization MUST stay in server-side actions (the reportes page registry is dispatch-only); RLS/`withTenantTransaction` tenant patterns MUST remain untouched.

#### Scenario: Null clearing vs undefined skip preserved on cliente/producto edit

- GIVEN an update input with `identificacionFiscal = null` (clear) and another field `undefined` (skip)
- WHEN the refactored use case runs
- THEN null clears the field, undefined leaves it unchanged, and the audit diff reflects exactly those semantics
- TEST: unit (existing golden assertions stay green)

#### Scenario: Consume-then-fail ordering unchanged

- GIVEN a sale confirmation or return that fails after NCF consumption
- WHEN the refactored use case runs
- THEN the R-V15 ordering and rollback effects are identical to pre-refactor behavior
- TEST: integration (4 confirmar + 3 devolucion suites)

#### Scenario: Reportes page dispatch does not authorize

- GIVEN the registry maps `REPORTE_ID → {consultar, Panel}` with single dispatch
- WHEN a report is requested without server-side authorization
- THEN the underlying action still rejects it (authorization remains in actions, DB-2)
- TEST: integration (DB-2 authorization tests)

### Requirement: Per-Stage Acceptance Gates (R-QC-03)

Every PR slice MUST keep the jest unit suite (baseline 911 tests; may grow) and jest integration suite (baseline 195 tests) green, and `pnpm exec tsc --noEmit` and `pnpm lint` clean (including the `server-action-must-wrap-tenant` rule). Sonar re-scans MUST show a decreasing issue count per stage; duplication MUST be < 3% after stage 5b; `pnpm audit --prod` MUST report zero vulnerabilities after stage 4; `prisma validate` and `prisma generate` MUST pass.

#### Scenario: Green gate per PR slice

- GIVEN any stage's PR slice
- WHEN CI runs
- THEN unit + integration tests, tsc, and lint all pass
- TEST: CI

#### Scenario: Dependency stage closes advisories

- GIVEN stage 4 bumps Prisma to newest 7.x with `pnpm.overrides` applied
- WHEN `pnpm audit --prod`, `prisma validate`, and `prisma generate` run
- THEN zero vulnerabilities are reported and both Prisma commands succeed
- TEST: CI

### Requirement: Stage 2 Probe Relocation (R-QC-04)

The S2187 BLOCKER MUST be resolved by moving the tsx probe to `app/scripts/withTenantTransaction.probe.ts` (outside `sonar.sources`) and updating `jest.config.js` exclusions. The `.itest.ts` rename MUST NOT be used (it would re-enter Sonar scope). Existing GUC behavior verifications (`withTenantTransaction-options.test.ts` + integration suites) MUST remain unchanged.

#### Scenario: BLOCKER cleared by relocation

- GIVEN the probe lives in `app/scripts/` with imports on `@/modules/...`
- WHEN Sonar re-scans
- THEN S2187 is absent from sources and no new probe-attributed smells appear
- TEST: manual (Sonar issue list)

### Requirement: Prohibited Refactor Shortcuts (R-QC-05)

The refactor MUST NOT introduce: `'??'` rewrites of the cliente/producto nullable-field ternaries (undefined ≠ null), unification of the `inventario-repository.ts` batch skeletons (fiscal risk), or any change to fiscal calculations (ITBIS, NCF sequences, retentions).

#### Scenario: Dedup fix stays scoped

- GIVEN stage 5b deduplicates the ownership-guard and audit helpers
- WHEN the PR is reviewed and tested
- THEN batch skeletons remain separate, no fiscal logic is touched, and integration suites stay green
- TEST: integration + code review

### Requirement: Documented Out-of-Scope Items (R-QC-06)

The change MUST record accepted exclusions: S1874 (absent from the v0.11.4 scan — stale launch context, no work) and thin-adapter duplication in `producto`/`inventario` `http/actions.ts` (by design; the < 3% global gate is the floor, not zero).

#### Scenario: Accepted duplication does not block the gate

- GIVEN adapter duplication remains after all stages
- WHEN the global duplication measure is computed
- THEN total duplication is still < 3% and no remediation item is opened for the adapters
- TEST: manual (Sonar measures)
