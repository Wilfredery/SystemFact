# Delta for inventario

## ADDED Requirements

### Requirement: Batched ownership verification guard (R-INV-B1)

Wherever the inventory module verifies that a set of `productoId`s belongs to the caller's tenant (the guard path that today performs one `findFirst` per product in `inventario-repository.ts`), the check MUST execute as ONE batched tenant-safe query inside the tenant transaction: a single query returning the ids owned by the caller's `empresaId` (and branch where applicable), followed by a pure set-difference that names every requested id missing from the ownership set. Deny-by-default semantics MUST be unchanged: any id not provably owned MUST be rejected with a typed error that names the missing ids, without disclosure of foreign data. The batched query MUST NOT widen the company branch (`app.current_sucursal_id`) or clear any RLS GUC. The per-product `findFirst` guard loop MUST NOT exist in that path.

**Locking invariant:** the per-row `SELECT ... FOR UPDATE` lock loops in the entry, exit, return, and adjustment batches are explicitly NOT part of this requirement — they remain governed by their existing requirements and MUST stay unchanged.

#### Scenario: Batched single query replaces the N+1 loop

- GIVEN a caller requesting 40 products in one listing-guard operation
- WHEN the guard runs
- THEN exactly one ownership query executes (no per-product `findFirst` loop) and the path continues or rejects from its result
- TEST: integration

#### Scenario: Cross-tenant id denied by default, named

- GIVEN a request set containing 39 owned products and 1 `productoId` belonging to another empresa
- WHEN the guard resolves
- THEN the operation rejects with a typed error naming the missing id, reveals no foreign data, and no inventory row changes
- TEST: integration

#### Scenario: Ownership semantics identical to per-row guards

- GIVEN the batched guard replaces the previous per-product `findFirst` guards
- WHEN every previously-passing ownership decision is re-evaluated
- THEN the allow/deny outcome is identical (existing ownership integration suites pass unchanged)
- TEST: integration

#### Scenario: Locking loops untouched

- GIVEN the batched-guard change lands
- WHEN the FOR UPDATE transaction blocks in `inventario-repository.ts` are reviewed
- THEN no diff exists in their locking semantics
- TEST: integration (code-review grep + lock fixtures)
