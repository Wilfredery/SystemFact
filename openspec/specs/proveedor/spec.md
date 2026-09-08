# Proveedor Specification

## Requirements

### Requirement: Create suppliers

Administradores and Operadores MUST create suppliers with required fields
and optional RNC. Fiscal enums MUST be preserved.

#### Scenario: Valid creation
- GIVEN an authorized user submits valid data
- WHEN the create action runs
- THEN an active supplier is created at version 1 in that empresa

#### Scenario: Invalid creation
- GIVEN required or enum data is invalid
- WHEN the create action runs
- THEN a validation error is returned and no row is created

### Requirement: Normalize and uniquely validate RNC

RNC separators MUST be removed before storage; normalized values require 9–11
digits. Nulls are repeatable; active non-null RNCs MUST be unique per empresa.

#### Scenario: Normalize and validate
- GIVEN an RNC has separators or an invalid digit count
- WHEN it is created or edited
- THEN valid input is stored as digits only and invalid input is rejected

#### Scenario: Null and duplicate values
- GIVEN two suppliers in one empresa
- WHEN both RNCs are null, or the second repeats an active RNC
- THEN null values succeed and the duplicate fails

### Requirement: Paginated searchable listing

Lists MUST use deterministic ordering, default size 25, and maximum size 100.
`buscar` MUST match name/RNC; inactive rows require `incluirInactivos`.

#### Scenario: Search and pagination
- GIVEN matching suppliers exist in the current empresa
- WHEN a page, size, and `buscar` term are requested
- THEN matching tenant rows and pagination metadata are returned

#### Scenario: Enforce bounds and status
- GIVEN size exceeds 100 and inactive inclusion is false
- WHEN listing runs
- THEN size is rejected/bounded to 100 and inactive rows are omitted

### Requirement: Optimistic-lock editing

Administradores and Operadores MUST edit only with matching `version`.
Edits MUST increment it atomically; stale versions MUST return
`CONCURRENCIA_CONFLICTO` without changing data.

#### Scenario: Current version
- GIVEN an active supplier at version 1
- WHEN valid changes are submitted with version 1
- THEN changes save and version increments to 2

#### Scenario: Stale version
- GIVEN the supplier changed after version 1 was read
- WHEN version 1 is submitted
- THEN `CONCURRENCIA_CONFLICTO` is returned and newer data is preserved

### Requirement: Guarded soft deactivation

Only an Administrador MAY deactivate. It MUST retain the row and be idempotent
when inactive, and reject non-cancelled purchase references with
`PROVEEDOR_TIENE_COMPRAS`.

#### Scenario: Deactivate safely
- GIVEN an active supplier has no non-cancelled purchases
- WHEN an Administrator deactivates it
- THEN `activo` becomes false and historical data remains queryable

#### Scenario: Block live reference
- GIVEN a purchase references the supplier with state other than `CANCELADA`
- WHEN deactivation is requested
- THEN the guard error is returned and the supplier remains active

### Requirement: Authorization and tenant isolation

Every Server Action MUST authenticate inside `withTenantTransaction`, enforce
roles server-side: Administrador/Operador for create/list/edit; Administrador
for deactivate. Every operation MUST filter by `empresaId`.

#### Scenario: Deny unauthorized or cross-tenant access
- GIVEN a missing role or a supplier from another empresa
- WHEN an action is invoked
- THEN an authorization/not-found error is returned with no data change

### Requirement: Transactional audit

Each successful mutation MUST append one audit row in the
tenant transaction, using `CREAR`, `ACTUALIZAR`, or `CANCELAR`. Audit rows MUST
be append-only; failed mutations MUST create none.

#### Scenario: Audit mutation
- GIVEN a mutation succeeds or fails
- WHEN its transaction completes
- THEN success has its matching audit row and failure has none

### Requirement: Server Actions and automated tests

The module MUST expose four thin Server Actions for create, list, edit,
and deactivate. Each MUST validate input and hide internal errors. Tests MUST
cover validation, RNC, pagination, locking, guards, authorization, isolation,
and audit.

#### Scenario: Preserve the action boundary
- GIVEN malformed input or a business-rule failure
- WHEN a Server Action runs
- THEN it returns the typed error without exposing internal details
