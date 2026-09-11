# Delta for inventario

## ADDED Requirements

### Requirement: Confirmed-sale exit batch (registrarSalidasVenta)

The module MUST expose `registrarSalidasVenta` as the implemented sale-exit port, callable only inside the caller's (confirm) tenant transaction. For each line, in deterministic ascending-`productoId` lock order: verify product ownership by the tenant, upsert and lock the branch `INVENTARIO` row with `SELECT ... FOR UPDATE`, hard-block (throw — never partial-apply) when available `<` requested (no negative stock, ever), debit the quantity, append exactly one `MovimientoInventario` of type `SALIDA_VENTA` carrying `ventaId` with before/after quantities and branch/actor context, and audit. Any rejection MUST throw a typed error (`STOCK_INSUFICIENTE_BLOQUEO` context: productoId, available, requested) so the ENTIRE batch — including already-processed lines — rolls back atomically with the caller's sale flip and NCF consumption. Manual-adjustment rules and `costoPromedio` semantics are unchanged (exits never touch average cost).

#### Scenario: Batch debit with movements

- GIVEN a confirmed sale of 2 products with sufficient branch stock
- WHEN `registrarSalidasVenta` runs
- THEN each branch row is debited once and exactly two `SALIDA_VENTA` movements with `ventaId` and correct before/after quantities append
- TEST: integration

#### Scenario: Mid-batch shortage rolls back whole batch

- GIVEN line 2 of a 3-line batch exceeds availability
- WHEN the batch throws
- THEN no stock change and no movement persist for ANY line
- TEST: integration

#### Scenario: Concurrent exits serialize

- GIVEN stock 10 at one branch and two parallel 6-unit confirm batches
- WHEN both commit
- THEN exactly one succeeds; the loser blocks with `STOCK_INSUFICIENTE_BLOQUEO`; committed stock is never negative
- TEST: integration (row-lock fixture, mirrors entry-path three-phase precedent)

### Requirement: Cancellation reposition batch

The module MUST expose a reposition primitive for confirmed-sale cancellation: per line, same lock/serialization order, credit branch stock, append exactly one `MovimientoInventario` of type `REPOSICION_CANCELACION` carrying `ventaId`, before/after quantities, and a non-empty reason; MUST NOT touch `costoPromedio` and MUST roll back atomically with the cancel transaction.

#### Scenario: Reposition restores exact quantity

- GIVEN a confirmed sale that debited 5 units at the session branch
- WHEN the reposition batch runs during cancellation
- THEN stock returns to the pre-sale value via one `REPOSICION_CANCELACION` movement and average cost is unchanged
- TEST: integration

## MODIFIED Requirements

### Requirement: Tenant isolation and typed future seams

All reads and writes MUST be constrained by the authenticated tenant and branch, including movement history. The module exposes typed entry and exit interfaces for purchase, sale, return, and transfer callers; the purchase entry seam is implemented via `registrarEntradasCompra`/`registrarEntradaCompra` and MUST update `costoPromedio`; the sale exit seam is now implemented via `registrarSalidasVenta` plus the cancellation reposition batch (replenish only — never average cost); return/transfer callers and `TipoReposicion` flows MUST remain unimplemented. The seams MUST return typed success/error results.
(Previously: the sale exit seam was declared-only; only the purchase entry seam was implemented.)

#### Scenario: Cross-tenant access

- GIVEN an inventory or movement identifier belonging to another tenant
- WHEN a caller requests it or attempts an adjustment
- THEN the result is not-found or forbidden without disclosure
- AND no row is changed
- TEST: integration

#### Scenario: Schema and cost boundary updated

- GIVEN the 5c sale-exit path is applied
- WHEN the change is reviewed
- THEN no Prisma migration exists (enum values `SALIDA_VENTA`/`REPOSICION_CANCELACION` already ship in ERD v4.7)
- AND the manual adjustment path still never mutates `costoPromedio` while purchase entry always does and sale exit/reposition never does
- AND future return/transfer callers can type-check against the remaining published seams
- TEST: integration
