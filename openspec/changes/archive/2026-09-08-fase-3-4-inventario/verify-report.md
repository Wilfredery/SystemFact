```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:5dfc5199f836e6abf5c412a79e7e39c48ee43c11d7c5914fc484cdb2c946e722
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 4/4
scenarios: 9/9
test_command: npx jest --silent
test_exit_code: 0
test_output_hash: sha256:c578e6ac49191c6ac12b2a56834319fd59f62e79e8e93889927ef012266cb11c
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verify Report — fase-3-4-inventario (Inventory Core 3.4a)

## Verdict: PASS_WITH_WARNINGS

The implementation matches the proposal, spec, design and tasks. All requirements
are functionally satisfied and every executable gate is green. Three scenarios
(concurrent adjustments, atomic rollback, cross-tenant access) are correct in the
code but are only exercised by repository-mocked tests, not against a live Postgres
test database. This is a coverage warning, not a defect; no failing check exists.

## Execution evidence (independent, this session)

| Gate | Command | Exit | Output SHA-256 |
|------|---------|------|----------------|
| Inventario suite | `npx jest src/modules/inventario` | 0 | 9CDFB0DD8AFA6B580927B159179691C5475C59B633EA610E3CE494914E8C70C2 |
| Full suite | `npx jest` | 0 | C578E6AC49191C6AC12B2A56834319FD59F62E79E8E93889927EF012266CB11C |
| Type-check (build) | `npx tsc --noEmit` | 0 | E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855 |
| Lint | `npx eslint` | 0 | E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855 |

- Inventario: 5 suites / 35 tests passed. Full suite: 28 suites / 237 tests passed (no regressions).
- tsc: no type errors (generated Prisma client present at `app/src/generated/prisma`).
- eslint: clean, including the project-local `systemfact/server-action-must-wrap-tenant` rule
  applied to `src/**/actions.ts` (the inventario adapter holds no direct `prisma.*` access — all
  DB work runs inside `withTenantTransaction` callbacks, and session resolution is auth, not tenant DB).

## Requirement → evidence mapping

### Requirement 1 — Branch-scoped paginated stock listing (4/4 rows) — PASS
- Pagination guard (limit 1–100, page ≥ 1) in `application/listar-inventario.ts`; stable
  ordering `producto.codigo asc, id asc` in `inventario-repository.ts`.
- `stockMinimo` KPI via `classifyStockKpi` (normal / bajo_stock / agotado, "below OR equal" per spec).
- Scenario "Paginated listing with KPI": `listar-inventario.test.ts` asserts 25 rows / total 30 + mixed KPI. PASS.
- Scenario "Invalid pagination": tests assert page 0 → `PAGINA_INVALIDA`, limit 101 →
  `LIMITE_PAGINACION_INVALIDO`, repository never called (no DB write). PASS.

### Requirement 2 — Authorized manual adjustment — PASS
- Roles gated to `["Administrador","Operador"]` by `tieneRolPermitidoEnTx` (user resolved by id + empresaId).
- Mandatory `motivo` validated first (`validateMotivo`); before/after snapshot returned; `costoPromedio` untouched.
- Scenario "Positive manual adjustment": `ajustar-inventario.test.ts` verifies before/after + manual source. PASS.
- Scenario "Missing reason or unauthorized role": motivo test (no mutation) + `actions.test.ts` NO_AUTORIZADO. PASS.

### Requirement 3 — Non-negative atomic stock and immutable movement — PASS (inspection-backed)
- `ajustarStockEnTx`: product-ownership check → upsert row → `SELECT ... FOR UPDATE` (serialize) →
  non-negative guard (`nueva.isNegative()` → `STOCK_INSUFICIENTE`, nothing written) → update + append
  `AJUSTE` movement + audit row, all inside the single caller `PrismaTx` → atomic commit/rollback.
- Movement is append-only: repository uses `movimientoInventario.create` only (no update/delete);
  row preserves tipo, motivo, cantidadAnterior, cantidadMovida, cantidadNueva, usuarioId, fecha.
- Scenario "Insufficient stock": use-case maps repo rejection to `STOCK_INSUFICIENTE` (mocked repo). PASS.
- Scenario "Concurrent adjustments": logic present (`FOR UPDATE` under ReadCommitted); NOT proven by an
  executable DB race test. → WARNING (see below).
- Scenario "Atomic rollback": relies on `withTenantTransaction` rollback (correct); NOT proven by an
  executable failure-injection test. → WARNING (see below).

### Requirement 4 — Tenant isolation and typed future seams — PASS (inspection-backed)
- Tenant anchor `where: { sucursalId, sucursal: { empresaId } }` on every Inventario read/write;
  movements scoped implicitly via `inventarioId`; defense-in-depth with RLS GUCs from the wrapper.
- Typed seams `InventoryEntryPort`/`InventoryExitPort` + reserved `INVENTORY_SOURCE`
  (manual/purchase/sale/return) with no 3.4a callers; seam objects type-check in `inventario.test.ts`.
- Scenario "Cross-tenant access": `productoExisteEnEmpresa` blocks a foreign productoId → `INVENTARIO_NO_ENCONTRADO`
  (mocked-repo test only; no live cross-tenant row). → WARNING (see below).
- Scenario "Schema and cost boundary": grep confirms no `costoPromedio` read/write, no `Compra`/`TipoReposicion`
  references, no migration/schema changes; seams type-check. PASS.

## Review findings on requested focus areas
- Tenant isolation via Sucursal: CORRECT — no `Inventario.empresaId` column exists; module filters through
  `sucursal.empresaId` + current `sucursalId`, matching the frozen schema and the documented tenant convention.
- stockMinimo KPI: CORRECT and tested (three tiers; boundary and exact-decimal cases).
- Motivo mandatory: CORRECT — rejected at domain (`validateMotivo`) and DTO (`zod` `min(1).trim()`), before any DB call.
- Immutable movements: CORRECT — create-only path; no update/delete anywhere in the module.
- Atomicity / concurrency / non-negative: CORRECT in code (row lock + verified guard + single tx); coverage warning on live DB.
- Roles: CORRECT — Administrador + Operador, resolved id+empresa scoped (cross-tenant id collision cannot authorize).
- Future seams: CORRECT — minimal typed interfaces, reserved source vocabulary, no speculative callers (YAGNI).
- Boundary untouched: CONFIRMED — `costoPromedio`, purchase flows and Prisma migrations/schema unchanged
  (`git status app/prisma` empty; tracked diff vs `master` empty; module only adds files).
- Money/quantity typing: quantities cross the boundary as Decimal(12,3)-compatible strings via `decimal.js`;
  no float used for quantities. Consistent with AGENTS.md.

## Risks / warnings (non-blocking)
1. **Coverage gap — DB-backed safety tests missing.** tasks 5.3–5.5 implement "integration" tests that mock
   the repository, so the module's most security-critical behaviors (row-locked serialization, real non-negative
   rejection against committed state, atomic rollback on movement-insert failure, and an actual cross-tenant
   `productoId`/`inventarioId` probe) are validated by code inspection and mocked error-mapping, not against a live
   Prisma test database. The proposal explicitly promised "tenant-leak integration tests" and the design promised
   "race tests"; those are not present as executable DB tests. Given multi-tenancy is the #1 risk and stock/NCF
   contention is must-resolve-in-transaction per AGENTS.md, recommend adding a DB-backed suite before 3.4b depends
   on this core. This does not block 3.4a correctness.
2. **Concurrency under ReadCommitted + `FOR UPDATE`.** Serialization on the exact row is achieved, but a second
   concurrent writer will block then re-read the authoritative quantity after the first commits, so the second
   adjustment applies against the latest value (no lost update). Behaviorally correct; re-affirm once a live race test exists.
3. **Error-catalog scope.** `errors.ts` adds `SESION_INVALIDA` and `VALIDATION_ERROR` beyond the seven codes named
   in task 1.1, mirroring the producto/categoria adapters (documented in-file). Informational, not a spec conflict.
4. **Design Open Question still open** (UI consumer for KPI labels) — out of 3.4a backend scope; no action required.

## Review workload (against authorized budget)
- New production module code: 722 lines (7 files) across domain/application/infrastructure/http.
- New test code: 663 lines (5 files). Module total (.ts): 1,385 lines.
- New openspec artifacts (design/spec/tasks): 251 lines. Total new on-disk: ~1,636 lines.
- Under the authorized 1,700-line ceiling; single cohesive PR is appropriate (tasks: size-exception, no chaining).

## Definition of Done assessment
(1) Requirements + acceptance criteria: met. (2) Business rules: met. (3) Tests per priority: PARTIAL —
unit/mocked-integration green; DB-backed tenant-leak + concurrency/atomicity tests not yet present (warning 1).
(4) Documented: met (in-code contracts + design). (5) Reviewed: pending (this is independent verification).

## Next
Ready for archive of the 3.4a code as spec-conformant, with warning 1 tracked: recommend a follow-up DB-backed
tenant-leak/concurrency test before or alongside 3.4b purchase integration. Not a code-fix requirement for 3.4a.
