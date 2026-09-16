# Auditoria-consulta Specification

## Purpose

Admin-only, paginated, filtered, read-only consultation over the append-only audit log (`MovimientoAuditoria`) at `/auditoria`. This capability is read-only by construction: the underlying log stays append-only (ADR-016) and this capability introduces no mutation path.

## Requirements

### Requirement: Admin-only server-enforced access (AC-1)

Consultation MUST be restricted to the Administrator role, verified server-side inside `withTenantTransaction` via the existing role gate (`tieneRolPermitidoEnTx`). Hiding UI controls MUST NOT be the control; a direct invocation of the query action by a non-admin MUST return the stable code `AUDITORIA_NO_AUTORIZADO` (catalog style per module, code + user message + minimal context, no internals exposed).

#### Scenario: Admin opens the screen

- GIVEN an authenticated Administrator
- WHEN they open `/auditoria`
- THEN the first page of the log renders, all-time and unfiltered on first visit, newest-first

#### Scenario: Non-admin denied server-side

- GIVEN an authenticated non-admin user
- WHEN they invoke the consultation action directly
- THEN `AUDITORIA_NO_AUTORIZADO` returns and no audit rows are read
- TEST: integration

### Requirement: Pagination and ordering (AC-2)

Results MUST be paginated with page size default 25 and maximum 100; a larger requested size MUST be clamped to 100, never accepted. Ordering MUST be `fechaHora DESC, id DESC`. The total row count for the active filter MUST be displayed. A page number beyond the last page MUST yield an empty page, not an error.

#### Scenario: Page boundary and clamp

- GIVEN a log with 250 matching rows
- WHEN the admin requests page 2 at the default size, then a page at size 500
- THEN page 2 holds rows 26–50 newest-first and the size-500 request is served at 100 rows with total shown as 250
- TEST: integration

#### Scenario: Empty result set

- GIVEN filters that match no rows
- WHEN the query runs
- THEN an empty page with total 0 renders without error
- TEST: integration

### Requirement: Combinable filters (AC-3)

All filters MUST be combinable with AND: `accion` (any `AccionAuditoria` value, including incidental `LEER` rows as an ordinary option with no special handling), usuario, sucursal (optional; default company-wide across all branches, matching the nullable-`sucursalId` RLS policy), and a date range. An optional free-text search MUST target only the structured fields `entidad`, `idEntidad`, `motivo`; the JSON payload columns `valorAnterior`/`valorNuevo` MUST NOT be searched. Date-range boundaries MUST be interpreted in `America/Santo_Domingo`; storage remains UTC (`timestamptz`).

#### Scenario: Combined filter narrows correctly

- GIVEN audit rows across several users, actions, branches and days
- WHEN the admin filters by `accion=CREAR` AND user U AND the range covering one Santo Domingo day
- THEN only rows matching all criteria appear, newest-first, and the free-text term never matches inside `valorAnterior`/`valorNuevo` payloads
- TEST: integration

### Requirement: Mandatory tenant isolation (AC-4)

Every query MUST pin `empresaId` through `tenantWhere(tenantFilter(ctx))` with the tenant RLS GUCs active; the RLS `audit_select` policy applies as defense-in-depth. No code path MAY issue an audit query without an `empresaId` scope (AGENTS.md multi-tenancy rule).

#### Scenario: Cross-tenant isolation

- GIVEN companies A and B each holding audit rows
- WHEN an admin of A consults with no filters
- THEN zero rows from B appear, under both `tenantWhere` scoping and RLS
- TEST: integration

### Requirement: Read-only guarantee (AC-5)

The `auditoria` consultation surface MUST expose no create/update/delete path against `MOVIMIENTO_AUDITORIA`; its only Prisma operations MUST be `findMany` (scoped, ordered, limited) and `count`. This change MUST NOT add any DB policy beyond the existing `audit_select`/`audit_insert`.

#### Scenario: No mutation surface exists

- GIVEN the built `auditoria` module
- WHEN its infrastructure layer is inspected by a guard test
- THEN no create/update/delete call on the audit model exists and ESLint `systemfact/server-action-must-wrap-tenant` passes for its actions
- TEST: unit
