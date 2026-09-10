# Cliente Specification

## Purpose

Tenant-isolated CRUD for clients (PII): create/read/list/update/soft-deactivate with
fiscal-ID (RNC/cédula) validation, credit-field storage under an Admin-only audited
policy, and per-empresa Consumidor Final provisioning. Mirrors proveedor-parity
patterns; unblocks venta (5b/5c) and CxC (Fase 6) as storage-only seams.

## Task Notes (non-runtime)

- **R4 Migration hygiene**: the DDL defaults (`limiteCredito SET DEFAULT 0`,
  `plazoCreditoDias SET DEFAULT 30`) MUST land in their **own migration commit**,
  separate from feature code (D3; repo Git-workflow rule). Task-level constraint,
  not a runtime scenario.
- `tieneVentasNoCanceladas` returns no matches until Fase 5b exists; the guard MUST
  still ship wired (forward integrity) without over-testing on nonexistent fixtures.

## Requirements

### Requirement: Create client with credit defaults (R3)

Create MUST persist nombre, telefono, direccion and tipoCliente, and MUST apply the
documented credit defaults `limiteCredito` 0.00 (Decimal 12,2) and `plazoCreditoDias`
30 when those fields are omitted, at both use-case and DDL level. Limits MUST be ≥ 0
and plazo > 0; money MUST never be represented as float.

#### Scenario: Create without credit fields
- GIVEN a valid client payload omitting credit fields
- WHEN the create use case runs
- THEN the row is created active at version 1 with limit 0.00 and plazo 30

#### Scenario: Duplicate fiscal ID in tenant
- GIVEN an active client of the same empresa holds the normalized fiscal ID
- WHEN a second create repeats it
- THEN `CLIENTE_IDENTIFICACION_DUPLICADA` is returned and no row is created

### Requirement: Validate fiscal ID on create and update

Create and update MUST validate `identificacionFiscal` through the shared mod-11
validator (`client-validators` capability): separator-stripped 9-digit RNC or 11-digit
cédula with a passing check digit. Only Consumidor Final MAY store NULL. Format checks
are domain-owned, not zod. Invalid input returns a typed stable error with zero writes.

#### Scenario: Check digit fails
- GIVEN a fiscal ID with valid length but failing mod-11 digit
- WHEN create or update runs
- THEN a typed format error is returned and nothing is stored

### Requirement: Credit enabled requires valid fiscal ID (cross-field rule, R5)

Enabling credit for a client (`creditoHabilitado = true`, or setting
`limiteCredito > 0` / a credit-bearing `tipoCliente`) MUST require a stored, mod-11-valid
`identificacionFiscal`. A client whose fiscal identification is NULL or invalid MUST
NOT be credit-enabled by any update or create path; the attempt returns a typed stable
error with zero changes. (Confirms the un-issued exploration rule: credit is issued
against an identifiable client because B01 invoicing requires it.)

#### Scenario: Credit enabled without fiscal ID
- GIVEN a client with NULL `identificacionFiscal` (Consumidor Final or unverified)
- WHEN an update sets `creditoHabilitado = true` (or `limiteCredito > 0`)
- THEN a typed stable error is returned and the credit fields remain unchanged

### Requirement: Optimistic-lock update

Updates MUST match the submitted `version`; on mismatch they MUST return
`CONCURRENCIA_CONFLICTO` (parity with compra patterns) with zero changes; on success
the version increments atomically inside the tenant transaction.

#### Scenario: Stale version
- GIVEN the client changed after it was read
- WHEN an update carries the older version
- THEN `CONCURRENCIA_CONFLICTO` is returned and newer data is preserved

### Requirement: Admin-only audited credit edits (R2, R5)

`creditoHabilitado`, `limiteCredito`, `plazoCreditoDias` and `tipoCliente` MUST be
editable by Administrador only, enforced server-side inside the transaction (never by
hiding UI controls), and each credit edit MUST audit old/new values in-transaction.
Non-admin attempts MUST return a typed forbidden error with zero changes. Other CRUD
stays Admin+Operador.

#### Scenario: Operador attempts credit edit
- GIVEN an Operador submits a credit-field change
- WHEN the action runs
- THEN a typed authorization error is returned and the row is untouched

#### Scenario: Admin edits credit
- GIVEN an Administrador submits a valid credit change at the current version
- WHEN the action runs
- THEN values save, version increments, and one audit row records before/after

### Requirement: Paginated searchable listing

Listing MUST default to 25 rows, cap at 100, order deterministically, show only
active rows unless `incluirInactivos`, and search by name or digits of the fiscal ID.
Credit fields MUST be readable in the projection so 5b/5c/6 consume them without
re-plumbing.

#### Scenario: Bounds and status filter
- GIVEN inactive clients exist and a page size above 100 is requested
- WHEN listing runs without `incluirInactivos`
- THEN inactive rows are omitted and size is bounded to 100

### Requirement: Guarded soft deactivation (R6)

Deactivation MUST be soft, Admin-only, idempotent when already inactive, and MUST
release the fiscal ID for reuse (partial unique over active rows). It MUST be rejected
with a typed stable error while any non-`CANCELADA` sale references the client.
Consumidor Final rows MUST be read-only through operator CRUD: update and
deactivation of them are rejected.

#### Scenario: Block live sales reference
- GIVEN a sale in a state other than `CANCELADA` references the client
- WHEN deactivation is requested
- THEN `CLIENTE_TIENE_VENTAS` is returned with zero writes

#### Scenario: Deactivation frees the code
- GIVEN the only client holding a fiscal ID is deactivated
- WHEN a new active client reuses that ID
- THEN creation succeeds

### Requirement: Consumidor Final seed on empresa provisioning

Each new empresa MUST be provisioned with exactly one `esConsumidorFinal=true` client
(NULL fiscal ID) via `seedConsumidorFinalParaEmpresa`, mirroring the idempotent
`seedRetencionConfigParaEmpresa` convention, plus an idempotent backfill script for
existing tenants.

#### Scenario: Seed re-run
- GIVEN an empresa whose Consumidor Final already exists
- WHEN the seed or backfill runs again
- THEN no duplicate or conflicting row is created

### Requirement: Race-safe Consumidor Final get-or-create (R2)

The shared get-or-create use case MUST fetch by `(empresaId, esConsumidorFinal=true)`
and, on miss, insert catching `P2002` and re-fetching, so concurrent provisioning or
sale-path calls leave **exactly one** CF row per empresa; the DB partial unique
`cliente_consumidor_final_uk` is the definitive backstop and MUST be provable in a
concurrency test.

#### Scenario: Concurrent get-or-create
- GIVEN two concurrent callers both see no CF row for the same empresa
- WHEN both execute get-or-create
- THEN exactly one CF row exists afterward and both callers observe it

### Requirement: Tenant isolation of PII (R1)

Every query MUST filter by `empresaId`; RLS policy `cliente_isolation` MUST reinforce
repository scoping; cross-tenant reads and probes MUST return typed not-found or zero
rows with no existence leakage. `cliente-tenant.integration.test.ts` MUST prove
isolation and the CF race against a real database before shipping.

#### Scenario: Foreign-row probe
- GIVEN a context for empresa A and a client id owned by empresa B
- WHEN any action reads it
- THEN the result is not-found/zero-rows, indistinguishable from an unknown id

### Requirement: Transactional audit

Every successful mutation MUST append exactly one audit row inside the same tenant
transaction using frozen `AccionAuditoria` values (CREAR/ACTUALIZAR/CANCELAR) with
entity "Cliente"; failed mutations MUST leave none; audit remains append-only.

#### Scenario: Rollback leaves no audit
- GIVEN a mutation fails mid-transaction
- WHEN the transaction rolls back
- THEN neither the client change nor its audit row persists

### Requirement: No authentication linkage for clients

Clients are fiscal/commercial records, not identities: ADR-014 does not apply. The
module MUST NOT create Supabase Auth users or synthetic emails, and
`identificacionFiscal` MUST NOT be used or exposed as an access credential.

#### Scenario: Create touches no auth surface
- GIVEN a client is created
- WHEN its transaction completes
- THEN no auth user exists for it and no credential field is persisted
