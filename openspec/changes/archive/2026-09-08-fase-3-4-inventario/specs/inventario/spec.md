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

All reads and writes MUST be constrained by the authenticated tenant and
branch, including movement history. The module MUST expose typed entry and exit
interfaces for future purchase, sale, return, and transfer callers; 3.4a MUST
not implement those callers or `TipoReposicion` flows. The seams MUST return
typed success/error results and MUST NOT require `costoPromedio` changes.

#### Scenario: Cross-tenant access

- GIVEN an inventory or movement identifier belonging to another tenant
- WHEN a caller requests it or attempts an adjustment
- THEN the result is not-found or forbidden without disclosure
- AND no row is changed

#### Scenario: Schema and cost boundary

- GIVEN the 3.4a implementation is applied
- WHEN the change is reviewed
- THEN no Prisma migration, purchase flow, or `costoPromedio` mutation exists
- AND future entry/exit callers can type-check against the published seams
