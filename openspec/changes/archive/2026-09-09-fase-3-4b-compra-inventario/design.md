# Design: Purchase Receipt and Inventory Integration

## Technical Approach

Implement Approach B: `compra` owns the receipt transition and orchestrates; `inventario` owns stock, movement, and average-cost invariants. The HTTP adapter opens one `withTenantTransaction`; no nested transaction or direct Compra-to-Inventario infrastructure call is allowed. Full receipt, session-branch only, company-wide weighted cost, and no RECIBIDA cancellation reversal are fixed scope.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Cross-module port | Extend the Compra domain port with purchase id and ITBIS-exclusive unit cost; `inventario/application/registrar-entrada-compra.ts` realizes it using the caller’s `PrismaTx`. | Compra importing Inventario infrastructure; HTTP orchestration | Keeps stock invariants in Inventario with application-to-application dependency over published domain types. |
| Port shape | `InventoryEntryPort.applyEntry(input)` is a single-line operation; `recibirCompra` invokes it for every persisted line. | A new batch port | Matches the frozen seam and preserves reusable sale/return entry boundaries; the surrounding transaction supplies atomicity. |
| Error bridge | Add stable Compra code `INVENTARIO_ENTRADA_RECHAZADA`; map known Inventario domain failures to it without exposing Inventario codes/details. Keep `CompraErrorCode` and messages as the public catalog. | Re-exporting Inventario codes | Prevents module-internal error coupling and keeps HTTP contracts versioned by Compra. |
| Cost concurrency | Lock each affected `PRODUCTO` row with `SELECT ... FOR UPDATE`, in ascending product-id order, before calculating/updating cost. Use company-wide stock and Decimal half-up arithmetic. | `version`-only optimistic checks; branch denominator | The row lock serializes competing receipts and the schema stores one company-wide cost. |
| State mapping | Add `RECIBIDA` and use an exhaustive DB-enum mapper with a `switch` whose default calls an `assertNever`/typed runtime failure. | `as EstadoCompraCore` | Every five persisted states remains explicit and unknown values fail loudly. |

## Data Flow

`recibirCompraAction` → Zod `{ id: positive int }` → admin guard → one `withTenantTransaction` → load tenant purchase including `sucursalId` → reject branch mismatch/state → guarded `UPDATE ... WHERE empresaId AND estado=PENDIENTE` → for each line, `registrarEntradaCompra` (ownership check, branch upsert + `FOR UPDATE`, positive stock update, `ENTRADA_COMPRA` with `compraId`) → product lock and weighted cost update → Compra audit → commit.

The guarded update is uncommitted. Any failure rolls back state, stock/movement/cost writes, and audit; it never converts the purchase to `CANCELADA`. A zero affected-row result returns `CONCURRENCIA_CONFLICTO` and performs no inventory call.

Cost uses `(stockTotalEmpresa × currentCP + receivedQuantity × unitCostWithoutITBIS) / (stockTotalEmpresa + receivedQuantity)`, rounded to two decimals. Product locks are acquired deterministically; duplicate product lines are accumulated for one cost update while retaining one movement per line.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/compra/domain/compra.ts` | Modify | Add RECIBIDA, receipt transition, and exact entry-port input/result types. |
| `app/src/modules/compra/domain/errors.ts` | Modify | Add receipt/inventory bridge code and message. |
| `app/src/modules/compra/application/recibir-compra.ts` | Create | Branch/state guards, guarded update, port orchestration, typed mapping, audit result. |
| `app/src/modules/compra/infrastructure/compra-repository.ts` | Modify | Select branch, exhaustive state mapper, guarded receive update. |
| `app/src/modules/compra/http/{actions,validations}.ts` | Modify | Admin-only thin receive action and Zod id shape. |
| `app/src/modules/inventario/application/registrar-entrada-compra.ts` | Create | Port realization and Inventario-to-Compra error translation boundary. |
| `app/src/modules/inventario/infrastructure/inventario-repository.ts` | Modify | Locked purchase-entry stock/movement and company-wide cost persistence. |
| `app/tools/scripts/seed-retencion-config.ts`, `app/package.json`, `app/SETUP-LOCAL.md` | Create/Modify | Idempotent production seed command and documented run path. |
| `app/src/integration/setup/fixtures.ts` | Modify | No retention values changed; add only receipt-specific fixture helpers if tests require them. |

## Interfaces / Contracts

```ts
interface InventoryEntryInput {
  branchId: number; purchaseId: number; productId: number;
  quantity: string; unitCostWithoutItbis: string;
  reason: string; source: "purchase";
}
interface InventoryEntryPort {
  applyEntry(input: InventoryEntryInput): Promise<InventoryMovementResult>;
}
```

`recibirCompra` returns `CompraResult<{ id: number; estado: "RECIBIDA"; ... }>`; Inventario failures map to the stable Compra bridge code. The seed updates or creates one active row per `(empresaId, clave)`, with `vigenciaInicio <= now <= vigenciaFin`, and is safe to rerun.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | RECIBIDA transition/mapper, error bridge, weighted Decimal formula | Pure domain tests; unknown-state test. |
| Integration | Atomic receive, retry race, branch/tenant rejection, movement linkage, all-branch denominator, product-lock serialization, validity-window blocking, idempotent seed | Real DB harness with RLS and parallel transactions. |
| E2E | Admin receive and non-admin/invalid input rejection | Server Action boundary tests; no UI scope added. |

## Threat Matrix

All rows are **N/A**: this adds a Server Action but no URL routing, shell, subprocess, VCS/PR automation, or executable-file classification boundary. No threat-matrix RED tests apply.

## Ratified decision: all-branch cost aggregate READ GUC narrowing

The company-wide weighted-average cost denominator requires stock across ALL branches, but `INVENTARIO` RLS binds reads to `app.current_sucursal_id`. A schema/RLS migration to widen reads was rejected (enums already ship; a migration would expand blast radius and violate the "no new migration" constraint). Ratified compromise (user, memory #692): the all-branch cost-aggregate **READ** transaction-locally narrows `app.current_sucursal_id` via `set_config(..., is_local => true)` — the `app.current_empresa_id` GUC is NEVER touched, so cross-tenant isolation (R6) is still enforced — and the session branch value is restored before any entry write. Entry writes therefore remain bound to the session branch, and the inventario spec's "no RLS GUC clearing in v1" carries this single read-only exception (spec updated accordingly). Tradeoff: a transaction-local read widening is a narrower, auditable exception vs. the rejected permanent policy change; it follows the W-1 cross-branch correlativo precedent from PR #9. If the aggregate query fails (GUC restore error), the transaction aborts and the whole receipt rolls back — there is no silent branch-local fallback.

## Migration / Rollout

No migration required; `RECIBIDA`, `ENTRADA_COMPRA`, and `compraId` already exist. Seed retention configuration before enabling production confirmation/receipt. Tasks should forecast high risk against the 400-line budget: use chained PRs—(1) Inventario entry/cost plus seed, (2) Compra receive wiring and HTTP/tests.

## Open Questions

None; product and scope decisions are resolved by the proposal and delta specs.
