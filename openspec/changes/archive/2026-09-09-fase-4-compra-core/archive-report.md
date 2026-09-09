## Archive Report: fase-4-compra-core (Compra Core — Fase 4)

**Date**: 2026-09-09
**Change**: fase-4-compra-core
**Status**: ARCHIVED
**Mode**: hybrid (openspec filesystem + engram)
**Branch**: feat/fase-4-compra-core

### Final State at Close

| Metric | Value |
|--------|-------|
| Tasks | 23/23 implementation + 2/2 post-verify remediation (25 total) |
| Requirements | 8/8 pass |
| Scenarios | 13/13 pass |
| Unit tests (`pnpm test`) | 36 suites / 302 tests — exit 0 |
| Integration tests (`pnpm test:integration`) | 11 suites / 25 tests — exit 0 (real DB `systemfact_test`, Docker `sf-postgres` :5433) |
| Lint (`pnpm lint`) | pass (0 errors, incl. `server-action-must-wrap-tenant`) |
| Type-check (`npx tsc --noEmit`) | pass (0 errors) |
| Migrations | None |
| Verify verdict | pass_with_warnings → warnings CLOSED (W-1, W-2) |
| Delivery | Single PR, maintainer-approved `size:exception` (~1,900 authored lines) |
| PR status | Not yet opened (orchestrator handles after archive) |

### Engram Observations Read (traceability)

- #667 — sdd/fase-4-compra-core/tasks
- #668 — sdd/fase-4-compra-core/apply-progress
- #671 — sdd/fase-4-compra-core/verify-report
- #672 — Fixed W-1/W-2 coverage gaps compra-core

### Commits on Branch

| SHA | Description |
|-----|-------------|
| 2249bea | SDD artifacts (exploration, proposal, spec, design, tasks) |
| 2e7c607 | Domain: errors, guards, calculators + unit tests |
| b6b0b0c | Application use cases + infrastructure repositories |
| 01c75bb | HTTP adapters (validations + Server Actions) |
| 734429c | Integration tests + fixtures |
| d45e97e | README and seam documentation |
| a7ef298 | Verify remediation: W-1 cross-branch correlativo test, W-2 real-DB non-admin rejection test |

### Task Completion Gate

- Filesystem `tasks.md`: 25/25 checked [x] (23 implementation + W-1, W-2 post-verify)
- Engram observation #667 (tasks): matches filesystem
- apply-progress #668 confirms all 23/23 done with evidence
- Verify-report #671 confirms 23/23 at verification time; W-1/W-2 remediation in commit a7ef298 closes both warnings

### Verify Warnings — Resolution

| ID | Warning | Resolution | Evidence |
|----|---------|------------|----------|
| W-1 | Cross-branch CMP correlativo not integration-tested | Closed in commit `a7ef298` — `compra-correlativo-cross-branch.integration.test.ts` exercises two branches (A1/A2) of one empresa confirming concurrently → unique sequential CMP correlativos, each compra keeps its own sucursalId | `pnpm test:integration` exit 0, 11 suites / 25 tests |
| W-2 | Non-admin rejection proven only via mocked unit test | Closed in commit `a7ef298` — `compra-non-admin.integration.test.ts` exercises Operador-role usuario hitting real `tieneRolPermitidoEnTx` guard inside `withTenantTransaction` → `NO_AUTORIZADO`, no compra row created | Same integration run |

No CRITICAL issues were ever found. Both warnings were coverage-depth gaps (not correctness defects), now resolved.

### Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| compra | Created | 8 requirements, 13 scenarios (delta = full spec, no pre-existing main spec) |

### Archive Contents

- proposal.md ✅
- specs/compra/spec.md ✅
- design.md ✅
- tasks.md ✅ (25/25 tasks complete)
- verify-report.md ✅
- exploration.md ✅
- archive-report.md ✅ (this file)

### Source of Truth Updated

- `openspec/specs/compra/spec.md` — new canonical capability spec, byte-identical copy verified (SHA-256 `F160AD1D07A020AD8A2DB373739BD21606E4C501BB10A0C4DD532723166FCA69`)

### Implementation Decisions (embedded in design, confirmed at close)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Internal correlativo | Lock `EMPRESA` row (`SELECT ... FOR UPDATE`), compute `MAX(CAST(SUBSTRING(correlativoInterno FROM '\\d+$') AS bigint)) + 1`, format `CMP-%06d` | Schema has no counter table; empresa row is existing durable serialization anchor; `NcfSecuencia` is fiscal and must remain separate |
| Transition idempotency | Single guarded `UPDATE Compra ... WHERE id, empresaId, estado=expected` + affected-rows check | Matches frozen schema; no version column; losers receive typed conflict |
| Retention config | Read active `ConfiguracionEmpresa` keys (`RET_ISR_15/2`, `RET_ITBIS_100/30`) inside confirm tx; missing applicable key → `CONFIG_RETENCION_FALTANTE` | First-ever config read path must honor tenant configuration; no legal-default fallback |
| Sucursal GUC clear/restore | Clear `app.current_sucursal_id` then restore under `EMPRESA` row lock, all via `set_config(..., true)` (is_local=TRUE) | A failure between clear and restore aborts the transaction, discarding local GUCs; pooled-connection reuse cannot leak the cleared value |
| RET_* validity | Compared against absolute instant (`new Date()`) | `date-fns-tz` not a dependency; SDT day-granularity intentionally deferred |

### Implementation Realities (documented at close)

- `DETALLE_COMPRA` has no `empresaId` column; `reemplazarLineasEnTx` anchors by `compraId` AFTER the guarded header update (id+empresaId+BORRADOR); enforced by `detallecompra_isolation` RLS policy
- Gross total asserted (`236.00` on 2×100 @18%); payable never stored (no column); retenciones stored, payable = total − retenciones computed on display only
- NCF optional text only; `NFC_DUPLICADO` via `(empresaId, ncf)` unique; B11 engine deferred
- 3.4b seams preserved: `InventoryEntryPort`, `INVENTORY_SOURCE.PURCHASE`, `MovimientoInventario.compraId`, `Producto.costoPromedio` untouched; `RECIBIDA`/`PAGADA` unreachable from use cases

### Review Workload

- Production module: ~450 lines (domain/application/infrastructure/http)
- Tests: ~450 lines (unit + integration)
- Fixtures/docs: ~80 lines
- Total authored: ~1,900 lines (maintainer-approved `size:exception`)

### SDD Cycle Complete

The change has been fully planned, designed, specified, implemented, verified, and archived.
Ready for the next change: PR creation by orchestrator, then 3.4b receipt/payment integration (consuming `InventoryEntryPort`, `INVENTORY_SOURCE.PURCHASE`, `MovimientoInventario.compraId` seams).
