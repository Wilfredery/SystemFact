# Delta for producto

## ADDED Requirements

### Requirement: REQ-PROD-011: Partial product editing

The system MUST provide a partial update accepting at least one editable field (`nombre`, `descripcion`, `precioVenta`, ITBIS data, `codigo`, or `categoria`) and the current `version`. It MUST validate changed fields, preserve omitted fields, increment `version`, and return `CONCURRENCIA_CONFLICTO` for a stale version. A changed `codigo` MUST be tenant-unique.

#### Scenario: PROD-011-A: successful partial edit

- GIVEN an active product and its current version
- WHEN an authorized operator changes only `precioVenta`
- THEN the price is updated, omitted fields are unchanged, and `version` increases by one

#### Scenario: PROD-011-B: stale version

- GIVEN a product whose stored version is newer than the submitted version
- WHEN an authorized user submits an edit
- THEN no product field changes and the result is `CONCURRENCIA_CONFLICTO`

#### Scenario: PROD-011-C: duplicate changed code

- GIVEN another active product in the same tenant already uses the submitted `codigo`
- WHEN a user changes the product code
- THEN the edit is rejected with the stable duplicate-code error

### Requirement: REQ-PROD-012: Product soft deactivation

The system MUST deactivate one product by setting `activo=false` and MUST NOT hard-delete it. It MUST explicitly check for active references or movements and return `PRODUCTO_TIENE_MOVIMIENTOS`; it MUST NOT rely on Prisma `P2003`. Success MUST make the code reusable; repetition MUST return `PRODUCTO_YA_INACTIVO`.

#### Scenario: PROD-012-A: successful deactivation

- GIVEN an active product with no active references or movements
- WHEN an authorized administrator deactivates it
- THEN `activo` becomes `false` and its code can be assigned to a new product in the same tenant

#### Scenario: PROD-012-B: active references block deactivation

- GIVEN an active product with at least one active reference or movement
- WHEN an administrator requests deactivation
- THEN the product remains active and the result is `PRODUCTO_TIENE_MOVIMIENTOS`

### Requirement: REQ-PROD-013: Authorization and tenant isolation

The edit action MUST allow only `Admin` and `Operador`; deactivation MUST allow only `Admin`. Both MUST authorize from the server session, use the tenant transaction boundary, and constrain reads and writes to the request tenant. Unauthorized roles MUST receive `FORBIDDEN`; missing products MUST return `PRODUCTO_NO_ENCONTRADO` without cross-tenant disclosure.

#### Scenario: PROD-013-A: forbidden deactivation

- GIVEN an authenticated `Operador` and an active product
- WHEN the operator requests deactivation
- THEN the action returns `FORBIDDEN` and the product is unchanged

#### Scenario: PROD-013-B: cross-tenant product access

- GIVEN a product belonging to another tenant
- WHEN a caller submits its identifier to either action
- THEN the action returns `PRODUCTO_NO_ENCONTRADO` and performs no write

### Requirement: REQ-PROD-014: Transactional audit events

An edit MUST append `producto.updated` with old and new values, and deactivation MUST append `producto.deactivated`. Each audit row MUST be in the same transaction as its mutation and remain append-only; failed mutations MUST produce neither change nor event.

#### Scenario: PROD-014-A: edit audit

- GIVEN a valid authorized edit
- WHEN the transaction commits
- THEN one `producto.updated` event contains the changed old and new values

#### Scenario: PROD-014-B: rollback audit

- GIVEN a mutation that fails before commit
- WHEN the use case returns an error
- THEN neither the product change nor its audit event is persisted

### Requirement: REQ-PROD-015: Verifiable actions and tests

The system MUST expose validated Server Actions for editing and deactivation and application/HTTP tests covering success, validation, authorization, tenant isolation, stale versions, active-reference blocking, repeated deactivation, code reuse, and transactional audit behavior.

#### Scenario: PROD-015-A: invalid action input

- GIVEN an edit payload with no editable fields or invalid ITBIS data
- WHEN the Server Action is invoked
- THEN it returns `VALIDATION_ERROR` and performs no database operation

#### Scenario: PROD-015-B: HTTP coverage

- GIVEN the application and HTTP test suites
- WHEN `pnpm test` runs
- THEN the new product edit/deactivation tests pass and existing tests remain green

## MODIFIED Requirements

(None)

## REMOVED Requirements

(None)

## RENAMED Requirements

(None)
