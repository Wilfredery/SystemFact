# Proposal: Fase 4 — Compra Core (draft → PENDIENTE, no inventory)

## Intent
Suppliers exist but purchases cannot be recorded. Ship compra-core: create/edit purchase drafts with lines, mixed-rate ITBIS totals, and ISR/ITBIS retentions; confirm `BORRADOR→PENDIENTE`; cancel pre-receipt; paginated list/detail. Receipt (3.4b) and payments stay behind typed seams.

## Scope
### In Scope
- `src/modules/compra/` (4 layers on the proveedor/inventario template): pure domain (totals, per-line ITBIS 18/16/0 frozen per line, retention calculators), application use cases (typed results), infrastructure (`…EnTx` repos), thin `http/actions.ts` (admin-only, `withTenantTransaction`).
- Use cases: create/edit BORRADOR (+lines), confirm `BORRADOR→PENDIENTE`, cancel (BORRADOR/PENDIENTE) with mandatory motivo + audit rows in-transaction, paginated list (25/100), detail.
- Retention rates from `ConfiguracionEmpresa` (`RET_ISR_15/2`, `RET_ITBIS_100/30`); missing keys BLOCK confirmation with stable business error.
- `correlativoInterno` auto `CMP-000001…` per empresa, generated inside the confirm transaction (see Approach).
- `tipoNcf`/`ncf` optional text; cancelled purchase keeps its `@@unique([empresaId, ncf])` slot.
- 3.4b seams documented only: `InventoryEntryPort`, `INVENTORY_SOURCE.PURCHASE`, `MovimientoInventario.compraId`, `Producto.costoPromedio`.
- Tests: domain unit (mixed rates × formal/informal × física/jurídica), use-case unit (mocked tx), real-DB integration incl. guarded-transition concurrency.

### Out of Scope
- Receipt/stock (`PENDIENTE→RECIBIDA`, inventory entry, `costoPromedio`, cancel-after-receipt reversal) → 3.4b.
- `PagoProveedor`, `RECIBIDA→PAGADA`, CxP → payments sub-phase.
- B11 NCF engine → Fase 5.
- Box→unit conversion; purchase discounts (schema has none); migrations (none needed).

## Capabilities
### New Capabilities
- `compra`: purchase documents lifecycle (draft, confirm, cancel pre-receipt), fiscal totals/retentions, correlativo generation, admin-only access, audit.

### Modified Capabilities
- `proveedor`: no requirement change; deactivation guard `tieneComprasNoCanceladas` gains first integration coverage (test-only).

## Approach
Draft-first (exploration Approach 1). Domain math is pure TS + decimal-as-string. Idempotency without a `version` column: all state transitions are single guarded `UPDATE Compra SET estado=... WHERE id=... AND estado=<expected> AND empresaId=...` (affected-rows check; pattern proven in `concurrency.integration.test.ts`). PENDIENTE is immutable → cancel & recreate. `correlativoInterno` (no UK, no version): derive inside the confirm transaction via a per-empresa counter with `UPDATE ... SET n = n + 1 WHERE empresaId = ... RETURNING n` (atomic, serialized) — format `CMP-%06d`. No NCF engine involved.

## Affected Areas
| Area | Impact |
|------|--------|
| `app/src/modules/compra/**` | New (domain/application/infrastructure/http) |
| `app/src/integration/setup/fixtures.ts` | Modified (proveedor + compra seeds) |
| `app/prisma/schema.prisma` | None (verified) |
| `app/src/modules/inventario/domain/inventario.ts` | None (seam already reserved) |
| UI `app/src/app/**` compras screens | New (admin-only) |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Retention/total composition error (fiscal) | Med | Domain tests over rate × supplier matrix; `total` = gross, payable derived only |
| Correlativo duplication under concurrency | Low | Atomic `UPDATE ... RETURNING` counter in-transaction + integration test |
| `PENDIENTE` vs `CONFIRMADA` vocabulary leak | Low | Centralized enum usage, domain tests |
| Config keys never seeded → all confirms blocked | Med | Stable error code + docs; acceptance test for blocked path |

## Rollback Plan
Single feature branch, no migrations → revert merge/PR. `compra` is a self-contained module; no existing capability behavior changes. Remove UI routes + module directory; DB rows (BORRADOR/PENDIENTE compras, audit) are additive and removable via admin cleanup if needed.

## Dependencies
- Existing: `tenant` (`withTenantTransaction`), `proveedor` module, `ConfiguracionEmpresa` table, audit helper, ESLint tenant rule.
- Config seeding for retention keys is an operational prerequisite (UI may come later; block-error path is the contract).

## Success Criteria
- [ ] Admin creates/edits draft, confirms to PENDIENTE, cancels pre-receipt with motivo; RECIBIDA/PAGADA unreachable from use cases.
- [ ] Totals + retentions correct on mixed 18/16/0 lines across formal/informal × física/jurídica matrix (domain tests green).
- [ ] Missing retention config blocks confirm with stable business error code.
- [ ] Correlativo unique per empresa under concurrent confirms (integration test).
- [ ] All actions admin-only, tenant-wrapped (ESLint rule passes), audited; lists paginated.
- [ ] No Prisma migration shipped.

## Review Workload Forecast
- Est. changed lines: ~900–1,200 (module + tests + fixtures + UI screens) → exceeds the 400-line single-PR review budget.
- Recommendation: chained PRs — (1) domain + tests, (2) application/infrastructure + integration, (3) actions/UI. Skill `chained-pr` at implementation/PR phase.
- Decision needed: none — all 7 pre-proposal decisions are confirmed and respected here.
