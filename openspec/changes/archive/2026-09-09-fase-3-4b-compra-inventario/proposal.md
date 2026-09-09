# Proposal: Purchase Receipt Wiring (Compra → Inventario)

## Intent

A confirmed compra is currently stuck at `PENDIENTE`: no stock enters, `costoPromedio` never updates, and `RECIBIDA` is unreachable by design (3.4a/4-core froze the seams). This change implements the reserved `InventoryEntryPort` so that receiving a compra atomically enters stock at the branch, appends an `ENTRADA_COMPRA` movement with `compraId`, and updates the company-wide weighted average cost — plus ships the production retention-config seeding that currently blocks real tenants on `CONFIG_RETENCION_FALTANTE`.

## Scope

### In Scope
- compra domain: add `RECIBIDA` to `ESTADO_COMPRA`; `transicionarRecibir` (`PENDIENTE → RECIBIDA` only); replace the unsafe `as EstadoCompraCore` cast with an explicit type-safe mapper; retire the seam comment block.
- inventario: implement `applyEntry` as exposed use case `registrarEntradaCompra` — per-line ownership guard, upsert + `FOR UPDATE` on branch inventory row, `MovimientoInventario { ENTRADA_COMPRA, compraId }`, audit, and `PRODUCTO.costoPromedio` update under product row lock.
- compra application/http: `recibirCompra` use case orchestrating state guard (`updateMany` idempotency) + inventory entries in ONE `withTenantTransaction` (nesting throws `NestedTenantTransactionError`); `recibirCompraAction` thin adapter (zod + ctx + Administrador).
- Weighted-average cost: `nuevoCP = (stockTotalEmpresa × CP + cantRecibida × costoUnitarioSinITBIS) / (stockTotalEmpresa + cantRecibida)`; denominator = stock across ALL branches; Decimal, half-up 2 dp; row-locked.
- Prerequisite: production seed script for `RET_ISR_15/2`, `RET_ITBIS_100/30` (+ SETUP doc).
- Domain/integration tests: cost math with mixed ITBIS rates, state transitions, idempotent retry, stock/movement assertions.

### Out of Scope
- Cancel-of-`RECIBIDA` reversal (`SALIDA_CANCELACION_COMPRA` + cost re-adjustment) — deferred to a follow-up change.
- Partial per-line receipts (no received-quantity column; full receipt only; seam reserved for later).
- Cross-branch receipt: entries go ONLY to the session user's branch (`ctx.sucursalId`); mismatch ⇒ typed business error. No RLS GUC-clear path in v1.
- `PAGADA` state / payments.

## Capabilities

### New Capabilities
- `retencion-config-seeding`: reproducible production seeding of retention config keys (`RET_ISR_*`, `RET_ITBIS_*`) so real tenants can confirm/receipt.

### Modified Capabilities
- `compra`: receipt transition allowed (`PENDIENTE → RECIBIDA`), Admin-only; seams-preserved requirement updated to permit the receipt path (payments still frozen).
- `inventario`: `InventoryEntryPort` is now implemented — purchase entries update stock, movements, and company-wide `costoPromedio` (previously MUST-NOT-touch).

## Approach

Approach B (from exploration): inventario owns ALL stock+cost invariants behind its implemented port; compra application orchestrates both modules inside a single tenant transaction; cross-module dependency is application → application over domain-published types (tenant precedent). Prisma enums already contain `RECIBIDA`/`ENTRADA_COMPRA`/`compraId` — **no DB migration**.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/compra/domain/compra.ts` | Modified | `RECIBIDA`, transition, state mapper |
| `app/src/modules/compra/application/recibir-compra.ts` | New | Orchestrating use case |
| `app/src/modules/inventario/application/` + `infrastructure/` | New | `registrarEntradaCompra` + entry repository path |
| `app/src/modules/compra/http/` | New | `recibirCompraAction` |
| `tools/scripts` (seed) + `docs/SETUP-LOCAL` | New | Retention config seeding |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Wrong cost formula poisons margins | Med | Explicit confirmed decision (above) + domain unit tests, mixed 18/16/0 |
| State mapper misses `RECIBIDA` | Med | Exhaustive switch, fail-loud tests |
| Concurrent `costoPromedio` updates | Med | `SELECT ... FOR UPDATE` on PRODUCTO in-tx |
| Retry double-enters stock | Med | Guarded `updateMany estado=PENDIENTE` first; retry ⇒ conflict, zero effects |
| Config seed blocked in some envs | Low | Script idempotent; fixtures unchanged |

## Rollback Plan

No migration; revert the code commits (feature branch `feature/fase-3-4b-compra-inventario`, revert PR). Re-run receipt on a compra in `RECIBIDA` is a no-op guard conflict; `RECIBIDA` rows created before rollback must be manually reset (expected — none exist until rollout).

## Dependencies

- Merge order: inventario entry path first, then compra wiring (see forecast). Seed script independent.

## Success Criteria

- [ ] Receiving a compra enters stock only at session branch, movement `ENTRADA_COMPRA`+`compraId`, cost updated exactly once
- [ ] Retry/cancelled transaction leaves zero side effects (idempotent)
- [ ] `RECIBIDA` mapped explicitly; no `as EstadoCompraCore` cast remains
- [ ] Fresh tenant with seeded `RET_*` keys can confirm and receipt
- [ ] Domain tests pass with no DB; integration tests cover sale-path invariants

## Review Workload Forecast

Cross-module change, likely >400 lines → tasks phase should forecast chained PRs: PR-1 inventario entry + cost + seeding, PR-2 compra wiring + http + E2E.
