# Archive Report: fase-3-4b-compra-inventario

**Change**: fase-3-4b-compra-inventario
**Archived**: 2026-09-09
**Branch**: `feat/fase-3-4b-compra-recepcion`
**Mode**: hybrid (openspec + engram)

---

## Final State Summary

| Aspect | Status | Evidence |
|--------|--------|----------|
| Verification verdict | PASS WITH WARNINGS | Per launch prompt: all findings W-1/S-1/S-2 CLOSED post-verify |
| Unit tests | 339/339 (39 suites) | Per launch prompt final-state facts |
| Integration tests | 44/44 (14 suites) on sf-postgres:5433 | Per launch prompt final-state facts |
| Lint | 0 problems | Per launch prompt final-state facts |
| TSC errors | 0 program-wide (S-2 killed pre-existing baseline) | Per launch prompt final-state facts |
| Unchecked tasks | 0 | tasks.md: all 11 implementation + 2 verification tasks checked |

## Verification Metrics

Per launch prompt final-state facts (outranking intermediate snapshots):

- **Unit**: 339/339 pass, 39 suites
- **Integration**: 44/44 pass, 14 suites (real DB sf-postgres:5433)
- **Lint**: 0 problems
- **TSC**: 0 errors program-wide (S-2 remediation killed the pre-existing baseline error)

### Findings Closure (post-verify remediation)

| Finding | Status | Evidence |
|---------|--------|----------|
| W-1 (docs) | CLOSED | Commit 9369062 |
| S-1 (test gap) | CLOSED | Commit eed192b |
| S-2 (tsc baseline error) | CLOSED | Commit 210af59; tsc now 0 errors program-wide |

### Verify-Report Note

The verify-report.md header's `evidence_revision` (=1c74fe...) and `build_command` describe the PRE-remediation verify-time state BY DESIGN (historical admission record). The appended "Findings closed" section carries the current state f66660e.... This split is preserved — the header was not rewritten.

### S-1 Tripwire

Same-tenant other-branch receive currently short-circuits at RLS to `COMPRA_NO_ENCONTRADA`. The new eed192b test asserts `COMPRA_SUCURSAL_INVALIDA` if a future RLS change widens cross-branch compra visibility — a tripwire, not a current defect.

---

## What Was Delivered

### Core Capability
- `registrarEntradaCompra` (inventario port realization) — per-line purchase entry with branch-scoped stock write, movement creation, and company-wide weighted-average cost update
- `recibirCompra` use case (compra receive wiring) — guarded receive transition PENDIENTE→RECIBIDA, delegated stock entry to inventario, idempotent under retry/concurrency
- `RECIBIDA` state added to `EstadoCompra` enum
- Exhaustive 5-state mapper replacing unsafe `as EstadoCompraCore` casts
- `RET_*` idempotent seed script for production retention config keys

### Architecture Decisions
- Two-tier failure model: compra domain errors vs inventario bridge codes
- Batch `registrarEntradaCompra` (all lines in one call) vs per-line: documented as faithful to spec (full receipt only)
- Company-wide `costoPromedio` denominator spans all branches (SELECT FOR UPDATE on PRODUCTO)
- Transaction-local RLS narrowing ratified for cost-aggregate read; entry writes remain branch-bound

### Data Flow
```
recibirCompra → guarded UPDATE (PENDIENTE→RECIBIDA, affected-rows check)
              → registrarEntradaCompra (per-line)
                  → branch inventory upsert + FOR UPDATE lock
                  → positive quantity add
                  → MovimientoInventario ENTRADA_COMPRA
                  → company-wide costoPromedio recalc
              → audit
              → result { id, estado: "RECIBIDA" }
```

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| compra | Updated | 3 ADDED (receipt transition, idempotent receipt, exhaustive mapper), 1 MODIFIED (3.4b seams now partially opened) |
| inventario | Updated | 2 ADDED (purchase entry port, weighted-average cost), 1 MODIFIED (tenant isolation + cost boundary) |
| retencion-config-seeding | Created | 2 ADDED (production seed, missing config blocks confirm/receipt) |

### Canonical Specs Updated
- `openspec/specs/compra/spec.md` — composed via `sdd-archive-compose` with LF-normalized delta
- `openspec/specs/inventario/spec.md` — composed via `sdd-archive-compose` with LF-normalized delta
- `openspec/specs/retencion-config-seeding/spec.md` — new canonical spec created from delta (full spec, no existing canonical)

---

## Archive Contents

- `proposal.md` ✅
- `design.md` ✅
- `exploration.md` ✅
- `specs/` ✅ (compra, inventario, retencion-config-seeding)
- `tasks.md` ✅ (13/13 tasks complete)
- `verify-report.md` ✅

---

## Branch & PR References

| Item | Reference |
|------|-----------|
| Feature branch | `feat/fase-3-4b-compra-recepcion` |
| PR-1 (inventario entry + cost + RET seed) | #11 — merged to main |
| PR-2 (compra receive wiring) | pending push after archive on this branch |
| Issue #10 | tracked in PR-1 |

---

## Decisions Made

1. **Batch receive**: `registrarEntradaCompra` receives all lines in one call (not per-line). Faithful to spec requirement for full receipt only.
2. **Two-tier failure model**: Compra domain returns typed business errors; inventario failures mapped to bridge codes (`INVENTARIO_ENTRADA_RECHAZADA`).
3. **RLS narrowing**: Transaction-local `app.current_sucursal_id` narrowing ratified for the company-wide cost-aggregate read in `registrarEntradaCompra`. Entry writes remain branch-bound.
4. **No Prisma migration needed**: `RECIBIDA`, `ENTRADA_COMPRA`, `compraId` already existed from PR-1 schema.
5. **tsc baseline elimination**: S-2 found and killed a pre-existing unrelated tsc error (`compra-non-admin.integration.test.ts:87`), achieving 0 errors program-wide.

---

## Deferred Follow-ups (not lost)

1. **Cancel-of-RECIBIDA reversal**: SALIDA_CANCELACION_COMPRA movement + cost re-adjustment (future change)
2. **Partial per-line receipts**: Seam reserved but not implemented (spec says full receipt only)
3. **B11 NCF engine**: Fase 5 scope
4. **Read-path wid improvement**: Possible future enhancement to make `COMPRA_SUCURSAL_INVALIDA` DB-reachable instead of RLS short-circuit

---

## Engram Observations Read

- apply-progress: id 688
- Ratifications: ids 692, 694
- verify-report: id 696
- Artifact topic keys: `sdd/fase-3-4b-compra-inventario/*`

---

## Archive Readiness Confirmation

- [x] All implementation tasks checked (`[x]`) in tasks.md
- [x] No CRITICAL issues in verification
- [x] Delta specs synced to canonical specs via native composition
- [x] New canonical spec created for retencion-config-seeding
- [x] Change folder moved to archive with date prefix
- [x] Byte-identity verified via MD5 hash comparison (8/8 files match)
- [x] Archive report written
