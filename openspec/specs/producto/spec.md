# Spec: producto

**Capability ID**: producto
**Change**: foundational-patterns-fase-1-2
**Status**: draft

## Purpose

Implements the first business module in the SystemFact ERP: a product catalog with DGII-aligned ITBIS rates, validity windows, and retention flags. This module validates the full ADR-013 layering (domain/application/infrastructure/http) for all subsequent business modules.

## Requirements

### Requirement: REQ-PROD-001: Producto entity shape

The `Producto` entity SHALL have fields: `id`, `empresaId`, `codigo`, `descripcion`, `precioBase: Decimal(12,2)`, `itbis: ProductoItbis`, `exento: boolean (derived)`.

**Rationale**: Aligns with ERD v4.7 and AGENTS.md money-as-Decimal rule. The derived `exento` flag simplifies list views and fiscal reporting.

**Acceptance criteria**:
- `precioBase` is represented as `Decimal` with scale 2.
- `exento` is derived from `itbis.tasa === '0'` and is read-only.

**Scenarios**:

#### Scenario: PROD-001-A: entity construction

- Given a valid `ProductoItbis` with tasa `'18'`
- When a `Producto` value is constructed
- Then `exento` is `false`
- And `precioBase` is a `Decimal`

#### Scenario: PROD-001-B: exempt product

- Given a `ProductoItbis` with tasa `'0'`
- When a `Producto` value is constructed
- Then `exento` is `true`

### Requirement: REQ-PROD-002: TasaItbis frozen enum

The `TasaItbis` type SHALL be a frozen enum with exactly three values: `'0' | '16' | '18'`.

**Rationale**: DGII 2026 vigente recognizes only these three rates (general 18%, reduced 16%, exempt 0%). A frozen enum prevents drift.

**Acceptance criteria**:
- `'0'`, `'16'`, and `'18'` are accepted.
- Any other string value is rejected at compile time (or by runtime validation where compile-time is unavailable).

**Scenarios**:

#### Scenario: PROD-002-A: valid rates accepted

- Given inputs `'0'`, `'16'`, and `'18'`
- When they are assigned to `TasaItbis`
- Then TypeScript accepts all three

#### Scenario: PROD-002-B: invalid rate rejected at compile time

- Given the string `'19'`
- When it is assigned to `TasaItbis`
- Then TypeScript reports a type error

### Requirement: REQ-PROD-003: ProductoItbis value object

`ProductoItbis` SHALL have fields: `tasa: TasaItbis`, `vigenteDesde: Date`, `vigenteHasta: Date | null`, `aplicaRetencionITBIS: boolean`.

**Rationale**: Historical rate changes (research Q4) require validity windows. `aplicaRetencionITBIS` supports Norma 02-05 reporting.

**Acceptance criteria**:
- `vigenteHasta: null` means the rate is currently open-ended.
- `vigenteHasta < vigenteDesde` is rejected as a domain error.

**Scenarios**:

#### Scenario: PROD-003-A: open-ended rate

- Given `vigenteDesde = 2026-01-01` and `vigenteHasta = null`
- When a `ProductoItbis` is constructed
- Then it is valid

#### Scenario: PROD-003-B: invalid validity window

- Given `vigenteDesde = 2026-12-31` and `vigenteHasta = 2026-01-01`
- When a `ProductoItbis` is constructed or validated
- Then it throws `VigenciaInvalida`

### Requirement: REQ-PROD-004: Pure ITBIS calculation

The pure function `calcularItbisProducto(producto, cantidad): { baseImponible, itbis, total }` SHALL be implemented in `domain/calcular-itbis.ts` with NO imports from Prisma, Next.js, React, or Supabase.

**Rationale**: Fiscal math must be testable without a database and must never depend on infrastructure (AGENTS.md domain purity rule).

**Acceptance criteria**:
- Uses `Decimal` for all monetary arithmetic.
- Returns `baseImponible`, `itbis`, and `total` as `Decimal`.
- DGII fixtures pass exactly.

**Scenarios**:

#### Scenario: PROD-004-A: laptop at 18%

- Given a `Producto` with `precioBase = 50000.00` and `itbis.tasa = '18'`
- And `cantidad = 1`
- When `calcularItbisProducto` is called
- Then `baseImponible = 50000.00`, `itbis = 9000.00`, `total = 59000.00`

#### Scenario: PROD-004-B: yogurt at 16%

- Given a `Producto` with `precioBase = 1000.00` and `itbis.tasa = '16'`
- And `cantidad = 1`
- When `calcularItbisProducto` is called
- Then `baseImponible = 1000.00`, `itbis = 160.00`, `total = 1160.00`

#### Scenario: PROD-004-C: leche fresca at 0%

- Given a `Producto` with `precioBase = 100.00` and `itbis.tasa = '0'`
- And `cantidad = 1`
- When `calcularItbisProducto` is called
- Then `baseImponible = 100.00`, `itbis = 0.00`, `total = 100.00`

#### Scenario: PROD-004-D: mixed cart

- Given one laptop at 18% (qty 2), one yogurt at 16% (qty 3), one leche at 0% (qty 5)
- When each line is calculated
- Then per-line ITBIS is correct and summed independently

#### Scenario: PROD-004-E: decimal precision

- Given `precioBase = 50000.00`, `tasa = '18'`, `cantidad = 1`
- When `calcularItbisProducto` is called
- Then `itbis` is exactly `9000.00` (NOT `8999.999999...`)


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
## Edge cases

- Negative `cantidad` â†’ throws `CantidadInvalida`.
- Zero `cantidad` â†’ `baseImponible = 0`, `itbis = 0`, `total = 0`.
- Non-Decimal `precioBase` â†’ type error at compile time.

### Requirement: REQ-PROD-005: Crear producto use case

The use case `crearProducto(ctx, input)` SHALL validate uniqueness of `codigo` within `empresaId`, wrap all DB access in `withTenantTransaction`, and return a typed `Result<{ producto: Producto }, CrearProductoError>`.

**Rationale**: AGENTS.md requires explicit errors, multi-tenancy, and no direct Prisma calls outside infrastructure. The use case orchestrates validation and persistence.

**Acceptance criteria**:
- Duplicate `codigo` within the same `empresaId` returns `CodigoProductoDuplicado`.
- Invalid tasa returns `TasaItbisInvalida`.
- Invalid `precioBase` returns `PrecioBaseInvalido`.
- Invalid validity window returns `VigenciaInvalida`.
- All DB operations run inside `withTenantTransaction`.

**Scenarios**:

#### Scenario: PROD-005-A: happy path

- Given a unique `codigo` and valid input
- When `crearProducto(ctx, input)` is called
- Then it returns `Ok({ producto })`

#### Scenario: PROD-005-B: duplicate codigo

- Given a `codigo` that already exists for the same `empresaId`
- When `crearProducto(ctx, input)` is called
- Then it returns `Err(CodigoProductoDuplicado)`

#### Scenario: PROD-005-C: invalid tasa

- Given an input with `itbis.tasa = '19'`
- When `crearProducto(ctx, input)` is called
- Then it returns `Err(TasaItbisInvalida)`

#### Scenario: PROD-005-D: invalid vigencia

- Given an input with `vigenteHasta < vigenteDesde`
- When `crearProducto(ctx, input)` is called
- Then it returns `Err(VigenciaInvalida)`

#### Scenario: PROD-005-E: transaction rollback on error

- Given a callback that fails after a partial write
- When `crearProducto` returns an error
- Then no `Producto` row is persisted

### Requirement: REQ-PROD-006: Listar productos use case

The use case `listarProductos(ctx, query)` SHALL open `withTenantTransaction`, use `select` (not full include), paginate, filter, and order results.

**Rationale**: AGENTS.md requires pagination, explicit `select`, and stable ordering. Listing must never leak cross-tenant data.

**Acceptance criteria**:
- `take` defaults to 25 and max is 100.
- `skip` is `(page - 1) * limit`.
- `where` includes `empresaId: ctx.empresaId` and `activo: true`.
- `orderBy` is `{ codigo: 'asc' }`.
- Returns typed `Result<{ items: ProductoListItem[], total: number, page: number }>`.

**Scenarios**:

#### Scenario: PROD-006-A: page 1 of 25

- Given 30 active products and query `{ page: 1, limit: 25 }`
- When `listarProductos(ctx, query)` is called
- Then it returns 25 items, `total: 30`, `page: 1`

#### Scenario: PROD-006-B: page 2 with skip

- Given 30 active products and query `{ page: 2, limit: 25 }`
- When `listarProductos(ctx, query)` is called
- Then it returns the remaining 5 items, `total: 30`, `page: 2`

#### Scenario: PROD-006-C: filter by descripcion

- Given products with descriptions matching and not matching a search term
- When `listarProductos(ctx, { descripcion: 'laptop' })` is called
- Then only matching products are returned

#### Scenario: PROD-006-D: empty result

- Given no active products
- When `listarProductos(ctx, query)` is called
- Then it returns `items: []`, `total: 0`

## Edge cases

- `limit > 100` â†’ returns `Err(LimitePaginacionInvalido)`.
- `limit < 1` â†’ returns `Err(LimitePaginacionInvalido)`.
- `page < 1` â†’ returns `Err(PaginaInvalida)`.

### Requirement: REQ-PROD-007: Crear producto Server Action

The Server Action `crearProductoAction(input)` SHALL parse input with `zCrearProductoInput`, build `ctx` from session, delegate to `crearProducto`, and return a typed `ActionResult<{ id, codigo }>`.

**Rationale**: HTTP adapters must be thin; authorization and business rules belong server-side. The action returns a minimal DTO to avoid leaking full entity details to the client.

**Acceptance criteria**:
- Input parsing failures return a 400-style `ActionResult` error.
- Session/`ctx` build failures return a 401-style `ActionResult` error.
- Use-case errors are mapped to typed business errors in the response.
- Only `Admin` and `Operador` roles may invoke it.

**Scenarios**:

#### Scenario: PROD-007-A: happy path

- Given a valid input and an authenticated `Operador`
- When `crearProductoAction(input)` is called
- Then it returns `ActionResult.ok({ id, codigo })`

#### Scenario: PROD-007-B: zod validation fails

- Given an input with missing `codigo`
- When `crearProductoAction(input)` is called
- Then it returns `ActionResult.error({ code: 'VALIDATION_ERROR', issues: [...] })`

#### Scenario: PROD-007-C: ctx build fails

- Given an unauthenticated request
- When `crearProductoAction(input)` is called
- Then it returns `ActionResult.error({ code: 'UNAUTHORIZED' })`

#### Scenario: PROD-007-D: use case error

- Given a duplicate `codigo`
- When `crearProductoAction(input)` is called
- Then it returns `ActionResult.error({ code: 'CODIGO_PRODUCTO_DUPLICADO' })`

#### Scenario: PROD-007-E: unauthorized role

- Given a `Visualizador` role
- When `crearProductoAction(input)` is called
- Then it returns `ActionResult.error({ code: 'FORBIDDEN' })`

### Requirement: REQ-PROD-008: Listar productos Server Action

The Server Action `listarProductosAction(query)` SHALL parse input with `zListarProductosQuery`, build `ctx` from session, delegate to `listarProductos`, and return a typed `ActionResult<{ items, total, page }>`.

**Rationale**: Listing is read-only and safe for all authenticated roles.

**Acceptance criteria**:
- All authenticated roles may invoke it.
- Invalid query params return a validation error.
- Pagination metadata is returned with the list.

**Scenarios**:

#### Scenario: PROD-008-A: happy path

- Given a valid query and any authenticated role
- When `listarProductosAction(query)` is called
- Then it returns `ActionResult.ok({ items, total, page })`

#### Scenario: PROD-008-B: invalid query params

- Given `limit: 500`
- When `listarProductosAction(query)` is called
- Then it returns `ActionResult.error({ code: 'VALIDATION_ERROR' })`

### Requirement: REQ-PROD-009: ITBIS validity migration

The Prisma migration SHALL add `itbisVigenteDesde DateTime NOT NULL`, `itbisVigenteHasta DateTime NULL`, and `itbisAplicaRetencionITBIS Boolean NOT NULL DEFAULT false` to `Producto`.

**Rationale**: The schema must support the new `ProductoItbis` fields while preserving existing product rows.

**Acceptance criteria**:
- Migration applies cleanly on top of existing migrations.
- Existing rows get a default `itbisAplicaRetencionITBIS = false`.
- Rollback script drops the columns only if no data depends on them.
- Down-migration preserves data integrity.

**Scenarios**:

#### Scenario: PROD-009-A: migration applies

- Given an existing `Producto` table
- When the migration runs
- Then the three columns exist and existing rows remain valid

#### Scenario: PROD-009-B: rollback

- Given the migration was applied
- When the down migration runs
- Then the columns are dropped without orphaning dependent rows

### Requirement: REQ-PROD-010: Observability events

The Producto module SHALL emit observability events: `producto.created` (with `codigo`, `tasa`) and `producto.listed` (with `count`).

**Rationale**: AGENTS.md mandates an append-only audit log for every state-changing action and for significant reads. These events feed that log.

**Acceptance criteria**:
- `producto.created` is emitted after a successful `crearProducto`.
- `producto.listed` is emitted after a successful `listarProductos`.
- Events are written to the append-only audit log.
- Format follows `docs/19-directivas_desarrollo.md` audit section.

**Scenarios**:

#### Scenario: PROD-010-A: product created event

- Given a successful `crearProducto(ctx, input)`
- When the use case completes
- Then an audit row with event `producto.created` and payload `{ codigo, tasa }` is appended

#### Scenario: PROD-010-B: product listed event

- Given a successful `listarProductos(ctx, query)` returning 10 items
- When the use case completes
- Then an audit row with event `producto.listed` and payload `{ count: 10 }` is appended

## Edge cases

- `precioBase` with more than 2 decimal places â†’ validation error.
- `codigo` with leading/trailing whitespace â†’ normalized or rejected by zod schema.
- Creating a product with `activo = false` (soft-delete marker) â†’ rejected; creation always sets `activo = true`.
- Listing includes inactive products only if an explicit `incluirInactivos` flag is passed by an Admin; default is active only.

## Out of scope


- Multi-currency pricing.
- Inventory management (stock is handled by the Inventario module).
- NCF sequence assignment.
- 607/608 reporting generation.
- Complex product variants or units of measure beyond quantity.
- Supplier/purchase cost tracking.

## Dependencies

- `tenant/with-tenant-transaction` â€” all DB access must use the wrapper.
- `auth/domain/synthetic-email.ts` and `tenant/domain/tenant.ts` â€” building `TenantCtx`.
- `prisma/schema.prisma` â€” existing `Producto` model.
- `Decimal` library and AGENTS.md money rules.
- Append-only audit log infrastructure.
