# Archive Report: fase-5d-devolucion-b04 — Devoluciones (Nota de Crédito B04)

## Change Summary

Credit-note return lifecycle (B04 NC): line-level partial returns against CONFIRMADA sales, cumulative quantity enforcement, conditional inventory reversal (VENDIBLE/DANADO), return-window validation from PLAZO_DEVOLUCION config, and atomic B04 NCF consumption with idempotency gate. Multi-tenancy enforced throughout via `withTenantTransaction` with RLS GUCs.

## Final State (at close, 2026-09-15)

### Verification

- **Verdict**: pass
- **Requirements**: 12/12
- **Scenarios**: 32/32
- **Evidence revision**: sha256:026b3c8140ccb23cfc3c975def890f21b8e8743063ee5a95fcade875744154ca
- **Native validator**: valid:true on current master 83c3b69 (2026-09-15)
- **Fresh run**: lint 0, tsc clean, unit 71 suites/642 tests PASSED (all green), integration 29/112 green, build 7/7 pages

### Delivery

All 4 delivery slices merged:
- PR #26 — Domain + application core + infrastructure + HTTP action + seed + tests (55681b7)
- PR #28, #29 — Reconciliation PRs
- PR #30 — UI return form + E2E happy path (a05accc)
- PR #33 — Cumulative quantity edge cases + concurrency tests (a7eb2be); includes approved R-D5 design deviation: idempotency gate code 605 DEVOLUCION_YA_REGISTRADA, exact-triple retry check, catalog census 24
- PR #36 — README as barrel deviation (approved YAGNI interpretation)
- PR #38 — Reconciliation PR
- PR #39 — release-please root-cause fix (83c3b69)

### Tags Published

- v0.4.0 (e740b3f)
- v0.4.1

### Task Completion

18/18 tasks complete — all `[x]` in persisted `tasks.md`.

### Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| devolucion | Created | New canonical spec (7 requirements: R-D1 through R-D7) |
| inventario | Updated | 1 added (registrarDevolucion), 1 modified (R-S5: return seam implemented) |
| ncf-engine | Updated | 1 modified (R-N6: B04 range added to seed) |
| venta | Updated | 1 added (R-V13-add: 4 return error codes), 1 modified (R-V13: catalog 19→23 codes) |

### Design Deviations (approved)

- **R-D5 idempotency gate**: Implemented as exact-triple retry check with `DEVOLUCION_YA_REGISTRADA` (code 605) instead of the original spec's in-transaction duplicate detection. Approved in PR #33 review.
- **4.1 barrel exports**: No module in this repo uses a barrel (`index.ts`); `devolucion` was the only module missing `README.md`. Created module map per repo convention + YAGNI instead of introducing a one-off barrel.

## Archive Contents

- `proposal.md` ✅
- `design.md` ✅
- `exploration.md` ✅
- `specs/` ✅ (devolucion, inventario, ncf-engine, venta)
- `tasks.md` ✅ (18/18 complete)
- `verify-report.md` ✅

## Canonical Specs Updated

The following specs now reflect the new behavior:
- `openspec/specs/devolucion/spec.md` (new)
- `openspec/specs/inventario/spec.md` (registrarDevolucion added, R-S5 modified)
- `openspec/specs/ncf-engine/spec.md` (R-N6 modified: B04 seed)
- `openspec/specs/venta/spec.md` (R-V13-add added, R-V13 modified: 23 codes)

## Engram Observation IDs

Archive report saved to Engram: see topic `sdd/fase-5d-devolucion-b04/archive-report`.

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
