# Inventario Specification

## Purpose

Provide branch-scoped stock visibility and auditable manual corrections for
3.4a, while preserving typed seams for future purchase and sale integrations.

## Requirements

### Requirement: Branch-scoped paginated stock listing

The system MUST list inventory for the authenticated user's `empresaId` and
`sucursalId`, with a default page size of 25 and a maximum of 100. Each item
MUST expose current quantity and a typed `stockMinimo` KPI indicating whether
stock is below or equal to the configured minimum. The listing MUST use stable
ordering and return typed pagination metadata.

#### Scenario: Paginated listing with KPI

- GIVEN 30 inventory rows in the user's branch and valid minimum-stock values
- WHEN an authorized user requests page 1 with the default limit
- THEN 25 rows and total 30 are returned
- AND each row contains a deterministic `stockMinimo` indicator

#### Scenario: Invalid pagination

- GIVEN a request with page 0 or limit 101
- WHEN the stock listing is invoked
- THEN a stable validation error is returned and no database write occurs

### Requirement: Authorized manual adjustment

The system MUST allow only `Administrador` and `Operador` users to adjust stock
for products in their current branch. An adjustment MUST include a non-empty
`motivo`, a valid signed quantity, and typed before/after quantities. The
operation MUST NOT update `costoPromedio`.

#### Scenario: Positive manual adjustment

- GIVEN an authorized operator, an existing product, and a non-empty motivo
- WHEN the operator applies a positive adjustment
- THEN branch stock increases by the requested quantity
- AND the result includes before and after quantities

#### Scenario: Missing reason or unauthorized role

- GIVEN an empty motivo or a user without either permitted role
- WHEN an adjustment is requested
- THEN a stable validation or authorization error is returned
- AND neither stock nor movement history changes

### Requirement: Non-negative atomic stock and immutable movement

The system MUST reject any adjustment that would make stock negative. Stock
mutation and append-only `MovimientoInventario` creation MUST commit atomically
inside the tenant transaction and serialize concurrent changes for the same
branch/product. Movement rows MUST preserve type, reason, before quantity, after
quantity, actor, and branch context and MUST NOT be updated or deleted.

#### Scenario: Insufficient stock

- GIVEN stock quantity 3 and a negative adjustment of 4
- WHEN the adjustment is attempted
- THEN a stable insufficient-stock error is returned
- AND stock and movements remain unchanged

#### Scenario: Concurrent adjustments

- GIVEN two valid concurrent adjustments for the same branch/product
- WHEN both transactions commit
- THEN both effects are serialized against the latest quantity
- AND no committed quantity is negative or lost

#### Scenario: Atomic rollback

- GIVEN movement persistence fails after stock validation
- WHEN the transaction aborts
- THEN neither the stock update nor movement row is persisted

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
### Requirement: Purchase receipt entry implementing InventoryEntryPort

The module MUST expose `registrarEntradaCompra` as the implemented `applyEntry` port. For each line, inside the caller's tenant transaction: verify product ownership by the tenant, upsert and lock the branch inventory row with `SELECT ... FOR UPDATE`, add the positive quantity, append exactly one `MovimientoInventario` of type `ENTRADA_COMPRA` carrying `compraId` with before/after quantities, and append audit. Entries MUST target only the session-authorized branch (no RLS GUC clearing in v1, except the read-only company-wide cost-aggregate `app.current_sucursal_id` transaction-local narrowing ratified for 3.4b â€” see design; entry writes remain branch-bound); all writes MUST roll back atomically on any line failure.

#### Scenario: Entry for unseen product

- GIVEN a valid purchase line for a product with no inventory row yet
- WHEN the entry runs
- THEN a branch row is created and one `ENTRADA_COMPRA` movement with `compraId` is appended

#### Scenario: Mid-line failure rolls back

- GIVEN a later line fails
- WHEN the transaction aborts
- THEN no stock, movement, or cost change persists for any line

#### Scenario: Cross-tenant line rejected

- GIVEN a `productoId` belonging to another empresa
- WHEN the entry attempts it
- THEN a typed not-found/forbidden error returns and no row changes

### Requirement: Company-wide weighted-average cost on receipt

On each receipt the module MUST update `PRODUCTO.costoPromedio` (company-wide, `Decimal(12,2)`) to `(stockTotalEmpresa Ã— CP + cantRecibida Ã— costoUnitarioSinITBIS) / (stockTotalEmpresa + cantRecibida)`, where the denominator is stock across ALL branches and the cost basis EXCLUDES ITBIS. Math MUST use Decimal with half-up rounding to 2 dp, serialized by a `SELECT ... FOR UPDATE` row lock on `PRODUCTO` inside the transaction. Manual adjustments MUST NOT touch `costoPromedio`.

#### Scenario: Mixed ITBIS lines

- GIVEN received lines at 18%, 16%, and 0% with ITBIS-exclusive unit costs
- WHEN the cost recomputes
- THEN the new average equals the confirmed formula result and no grossed-up (ITBIS-included) amount enters it

#### Scenario: Denominator spans branches

- GIVEN stock 10 at branch A and 40 at branch B, a receipt of 50 units at 100.00 at A with current CP 80.00
- WHEN the cost updates
- THEN the pre-receipt company stock used is 50 (not branch A's 10), yielding CP = 90.00 ((50Ã—80 + 50Ã—100)/100); a single-branch-or-denominator computation is a defect

#### Scenario: Concurrent receipts serialize

- GIVEN two parallel receipts of the same product
- WHEN both commit
- THEN the row lock serializes updates and the final cost equals sequential application (no lost update)

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

