# Delta for inventario (fase-3-4b-compra-inventario)

## ADDED Requirements

### Requirement: Purchase receipt entry implementing InventoryEntryPort

The module MUST expose `registrarEntradaCompra` as the implemented `applyEntry` port. For each line, inside the caller's tenant transaction: verify product ownership by the tenant, upsert and lock the branch inventory row with `SELECT ... FOR UPDATE`, add the positive quantity, append exactly one `MovimientoInventario` of type `ENTRADA_COMPRA` carrying `compraId` with before/after quantities, and append audit. Entries MUST target only the session-authorized branch (no RLS GUC clearing in v1, except the read-only company-wide cost-aggregate `app.current_sucursal_id` transaction-local narrowing ratified for 3.4b — see design; entry writes remain branch-bound); all writes MUST roll back atomically on any line failure.

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

On each receipt the module MUST update `PRODUCTO.costoPromedio` (company-wide, `Decimal(12,2)`) to `(stockTotalEmpresa × CP + cantRecibida × costoUnitarioSinITBIS) / (stockTotalEmpresa + cantRecibida)`, where the denominator is stock across ALL branches and the cost basis EXCLUDES ITBIS. Math MUST use Decimal with half-up rounding to 2 dp, serialized by a `SELECT ... FOR UPDATE` row lock on `PRODUCTO` inside the transaction. Manual adjustments MUST NOT touch `costoPromedio`.

#### Scenario: Mixed ITBIS lines

- GIVEN received lines at 18%, 16%, and 0% with ITBIS-exclusive unit costs
- WHEN the cost recomputes
- THEN the new average equals the confirmed formula result and no grossed-up (ITBIS-included) amount enters it

#### Scenario: Denominator spans branches

- GIVEN stock 10 at branch A and 40 at branch B, a receipt of 50 units at 100.00 at A with current CP 80.00
- WHEN the cost updates
- THEN the pre-receipt company stock used is 50 (not branch A's 10), yielding CP = 90.00 ((50×80 + 50×100)/100); a single-branch-or-denominator computation is a defect

#### Scenario: Concurrent receipts serialize

- GIVEN two parallel receipts of the same product
- WHEN both commit
- THEN the row lock serializes updates and the final cost equals sequential application (no lost update)

## MODIFIED Requirements

### Requirement: Tenant isolation and typed future seams

All reads and writes MUST be constrained by the authenticated tenant and branch, including movement history. The module MUST expose typed entry and exit interfaces for purchase, sale, return, and transfer callers; the purchase entry seam is now implemented via `registrarEntradaCompra` and MUST update `costoPromedio`, while sale/return/transfer callers and `TipoReposicion` flows MUST remain unimplemented. The seams MUST return typed success/error results.
(Previously: all entry/exit seams were declared-only and none could require `costoPromedio` changes.)

#### Scenario: Cross-tenant access

- GIVEN an inventory or movement identifier belonging to another tenant
- WHEN a caller requests it or attempts an adjustment
- THEN the result is not-found or forbidden without disclosure
- AND no row is changed

#### Scenario: Schema and cost boundary updated

- GIVEN the 3.4b receipt path is applied
- WHEN the change is reviewed
- THEN no Prisma migration exists (enum values `RECIBIDA`/`ENTRADA_COMPRA` already ship)
- AND the manual adjustment path still never mutates `costoPromedio` while purchase entry always does
- AND future exit callers can type-check against the published seams
