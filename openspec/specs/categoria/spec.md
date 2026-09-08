# Categoria Specification

## Purpose

Provide tenant-scoped category management with soft deactivation, safe product-reference handling, optimistic locking, authorization, and transactional auditability.

## Requirements

### Requirement: CAT-001 Category creation

The system MUST create an active `Categoria` with a non-empty normalized name and the request tenant's `empresaId`. It MUST return a typed result and append a transactional `Categoria`/`CREAR` audit row.

#### Scenario: CAT-001-A successful creation

- GIVEN an authorized `Administrador` or `Operador` and a unique valid name
- WHEN the create operation commits
- THEN one active category is returned with `version = 1`
- AND exactly one matching audit row is appended

#### Scenario: CAT-001-B invalid name

- GIVEN a blank or invalid name
- WHEN creation is requested
- THEN `VALIDATION_ERROR` is returned and neither category nor audit row is persisted

### Requirement: CAT-002 Tenant-scoped duplicate names

The system MUST reject duplicate active names within the same tenant using an application pre-check and the database uniqueness constraint as a TOCTOU guard. Names in different tenants MAY be equal, and names released by deactivation MAY be reused.

#### Scenario: CAT-002-A duplicate active name

- GIVEN an active category with the same normalized name in the request tenant
- WHEN creation or rename is requested
- THEN `NOMBRE_CATEGORIA_DUPLICADO` is returned and no mutation is committed

#### Scenario: CAT-002-B concurrent duplicate

- GIVEN two concurrent creations of the same tenant/name
- WHEN both reach persistence
- THEN at most one succeeds and the other returns `NOMBRE_CATEGORIA_DUPLICADO`

### Requirement: CAT-003 Paginated category listing

The system MUST list categories with explicit pagination, stable ordering, tenant filtering, and active-only results by default. It MUST support `incluirInactivas` when authorized and return `items`, `total`, and `page`; limits MUST be 1–100 with a default of 25.

#### Scenario: CAT-003-A paginated active list

- GIVEN 30 active categories in the tenant
- WHEN page 2 is requested with limit 25
- THEN 5 tenant-owned items are returned with `total = 30` and `page = 2`

#### Scenario: CAT-003-B invalid pagination or inactive filter

- GIVEN `page < 1` or `limit > 100`
- WHEN listing is requested
- THEN `VALIDATION_ERROR` is returned; inactive categories are included only when `incluirInactivas` is explicitly authorized

### Requirement: CAT-004 Optimistic-lock category editing

The system MUST allow authorized partial editing of the category name with the client-submitted `version`, preserve omitted fields, increment `version`, and append `ACTUALIZAR` audit data containing old and new values. A stale version MUST cause no mutation.

#### Scenario: CAT-004-A successful edit

- GIVEN an active category and its current version
- WHEN an authorized user submits a valid new unique name
- THEN the name changes, `version` increases by one, and one update audit row commits

#### Scenario: CAT-004-B stale or duplicate edit

- GIVEN a stale version or a name already active in the tenant
- WHEN editing is requested
- THEN `CONCURRENCIA_CONFLICTO` or `NOMBRE_CATEGORIA_DUPLICADO` is returned respectively, with no category or audit change

### Requirement: CAT-005 Guarded soft deactivation

Only an authorized `Administrador` MAY set `activa=false`; the system MUST NOT hard-delete categories. Deactivation MUST be blocked when any `Producto` in the tenant references the category with `activo=true`, returning `CATEGORIA_TIENE_PRODUCTOS`. It MUST use an explicit guard, not Prisma referential-error handling, and successful deactivation MUST append `CANCELAR` audit data.

#### Scenario: CAT-005-A blocked by active product

- GIVEN an active category referenced by an active product
- WHEN an administrator requests deactivation
- THEN `CATEGORIA_TIENE_PRODUCTOS` is returned and the category remains active

#### Scenario: CAT-005-B reusable and idempotent lifecycle

- GIVEN an active category with no active products
- WHEN an administrator deactivates it and later creates the same name
- THEN deactivation succeeds, the name is reusable, and repeating deactivation returns `CATEGORIA_YA_INACTIVA`

### Requirement: CAT-006 Authorization and tenant isolation

Every Server Action MUST derive authorization from the server session and execute database work inside `withTenantTransaction`. Create, edit, and list require `Administrador` or `Operador`; deactivation requires `Administrador`. Queries and writes MUST constrain `empresaId`; cross-tenant identifiers MUST return `CATEGORIA_NO_ENCONTRADA` without disclosure or writes, and invalid sessions MUST return `SESION_INVALIDA`.

#### Scenario: CAT-006-A forbidden operation

- GIVEN an authenticated user with an unauthorized role
- WHEN the user invokes a protected category action
- THEN `NO_AUTORIZADO` is returned and no database operation is committed

#### Scenario: CAT-006-B cross-tenant access

- GIVEN a category belonging to another tenant
- WHEN its identifier is submitted to edit or deactivate
- THEN `CATEGORIA_NO_ENCONTRADA` is returned and the foreign row is unchanged

### Requirement: CAT-007 Verifiable Server Actions and tests

The system MUST expose four validated Server Actions for create, list, edit, and deactivate. Application and HTTP tests MUST cover validation, success, duplicate races, pagination, optimistic conflicts, product guards, authorization, tenant isolation, audit rollback, and repeated deactivation; `pnpm test` MUST keep existing product tests green.

#### Scenario: CAT-007-A invalid action payload

- GIVEN an action payload that fails its Zod schema
- WHEN the Server Action is invoked
- THEN it returns `VALIDATION_ERROR` and does not invoke the use case or database

#### Scenario: CAT-007-B regression suite

- GIVEN the category and updated product test suites
- WHEN `pnpm test` runs
- THEN all category scenarios pass and existing product tests remain green
