# Spec: tenant/with-tenant-transaction

**Capability ID**: tenant/with-tenant-transaction
**Change**: foundational-patterns-fase-1-2
**Status**: draft

## Purpose

Provides a single, fail-fast wrapper that opens a Prisma interactive transaction and sets all Row-Level Security (RLS) GUCs before delegating to business logic. This closes the gap where `setTenantContext` was never invoked from production code (Engram #510).

## Requirements

### Requirement: REQ-WTT-001: Default transaction options

`withTenantTransaction(ctx, fn, options?)` SHALL open a Prisma interactive transaction with `{ timeout: 10_000, isolationLevel: 'ReadCommitted' }` by default.

**Rationale**: Prisma's default 5 s timeout is too tight for multi-statement use cases (sale confirmation, inventory + NCF + audit); research Q2 recommends 10 s as the floor. `ReadCommitted` avoids unnecessary locking while keeping RLS policy evaluation deterministic.

**Acceptance criteria**:
- When `options.timeoutMs` is omitted, the transaction timeout is 10,000 ms.
- When `options.timeoutMs` is supplied, it overrides the default.
- The isolation level is always `ReadCommitted`.

**Scenarios**:

#### Scenario: WTT-001-A: default 10 s timeout

- Given `withTenantTransaction(ctx, fn)` is called without `options`
- When Prisma opens the interactive transaction
- Then the transaction options include `timeout: 10000` and `isolationLevel: 'ReadCommitted'`
- AND the callback executes successfully

#### Scenario: WTT-001-B: override to 5 s

- Given `withTenantTransaction(ctx, fn, { timeoutMs: 5000 })` is called
- When Prisma opens the interactive transaction
- Then the transaction timeout is `5000`
- AND the isolation level remains `ReadCommitted`

#### Scenario: WTT-001-C: override to 30 s

- Given `withTenantTransaction(ctx, fn, { timeoutMs: 30000 })` is called
- When Prisma opens the interactive transaction
- Then the transaction timeout is `30000`

### Requirement: REQ-WTT-002: Tenant GUCs are set first

The function SHALL execute `SELECT set_config('app.current_empresa_id', ..., true), set_config('app.current_sucursal_id', ..., true), set_config('app.current_usuario_id', ..., true), set_config('app.current_es_admin', ..., true)` as the FIRST statements of the transaction.

**Rationale**: All RLS policies rely on these four GUCs. The `true` flag makes them transaction-local so they evaporate on commit/rollback and never leak across pooled connections (research Q2, Supabase/PgBouncer transaction-mode requirement).

**Acceptance criteria**:
- The four `set_config` calls run before the callback receives the transaction client.
- Each value is coerced to `String(...)` before interpolation.
- `set_config` failures fail-fast and abort the transaction.

**Scenarios**:

#### Scenario: WTT-002-A: both tenant GUCs are set

- Given a valid `TenantCtx`
- When `withTenantTransaction(ctx, fn)` is invoked
- Then `tx.$executeRaw` runs the four `set_config(..., true)` calls before `fn(tx)` is called
- AND `fn` observes RLS-filtered rows

#### Scenario: WTT-002-B: set_config rejects

- Given a valid `TenantCtx`
- When the database rejects the `set_config` statement (e.g., role missing function execute permission)
- Then the transaction is rolled back
- AND the error propagates to the caller

### Requirement: REQ-WTT-003: Callback receives transaction client

The function SHALL invoke the callback `fn(tx)` with the transaction client and return its result.

**Rationale**: This is the wrapper's primary purpose â€” business logic must operate inside the tenant-scoped transaction so RLS policies see the GUCs and writes stay atomic.

**Acceptance criteria**:
- `fn` receives a `Prisma.TransactionClient`, not the base `PrismaClient`.
- The resolved value of `fn(tx)` is returned unchanged.
- If `fn` returns a `Promise<T>`, `withTenantTransaction` returns `Promise<T>`.

**Scenarios**:

#### Scenario: WTT-003-A: callback returns a value

- Given a callback `fn` that returns `"ok"`
- When `withTenantTransaction(ctx, fn)` is called
- Then the wrapper resolves to `"ok"`

#### Scenario: WTT-003-B: callback returns a Promise

- Given a callback `fn` that returns `Promise.resolve(42)`
- When `withTenantTransaction(ctx, fn)` is called
- Then the wrapper resolves to `42`

#### Scenario: WTT-003-C: callback throws

- Given a callback `fn` that throws `new BusinessError('DUPLICATE')`
- When `withTenantTransaction(ctx, fn)` is called
- Then the transaction rolls back
- AND the wrapper rejects with `BusinessError('DUPLICATE')`

### Requirement: REQ-WTT-004: Errors propagate without swallowing

The function SHALL propagate errors from `fn` and `set_config` without swallowing, wrapping, or masking.

**Rationale**: Use cases must be able to distinguish business errors (duplicate code) from infrastructure errors (connection loss). The wrapper is intentionally transparent.

**Acceptance criteria**:
- Business errors thrown by `fn` are re-thrown unchanged.
- SQL errors from `set_config` are re-thrown unchanged.
- No internal `try/catch` hides the stack or message.

**Scenarios**:

#### Scenario: WTT-004-A: business error from use case

- Given a callback that throws `CodigoProductoDuplicado`
- When `withTenantTransaction(ctx, fn)` is called
- Then the caller receives `CodigoProductoDuplicado`
- AND the transaction is rolled back

#### Scenario: WTT-004-B: SQL error from set_config

- Given a database connection where `set_config` fails
- When `withTenantTransaction(ctx, fn)` is called
- Then the caller receives the raw Prisma/database error
- AND `fn` is never invoked

### Requirement: REQ-WTT-005: Nested calls are rejected

The function SHALL NOT support nested calls to itself within the same callback.

**Rationale**: Prisma interactive transactions cannot nest (research Q1/Q2). A nested call produces an obscure internal error; an explicit guard gives developers a clear message.

**Acceptance criteria**:
- If `fn` calls `withTenantTransaction` again, the wrapper throws a clear, explicit error.
- The error is thrown before Prisma's internal nested-transaction error is reached.

**Scenarios**:

#### Scenario: WTT-005-A: nested call is rejected

- Given a callback that calls `withTenantTransaction(ctx, innerFn)`
- When the outer `withTenantTransaction(ctx, fn)` is invoked
- Then the nested call throws `NestedTenantTransactionError`
- AND the outer transaction rolls back

### Requirement: REQ-WTT-006: JSDoc documents runtime prerequisites

The function SHALL have a JSDoc block documenting:

- Pool mode requirement (transaction-mode for PgBouncer/Supavisor).
- DB role requirement (NOT table owner, NOT BYPASSRLS).
- Nested-transaction prohibition.
- Reference to `tools/scripts/verify-rls.ts` for setup verification.

**Rationale**: These prerequisites are invisible in the type system but essential for RLS to work. The JSDoc is the primary defense against misconfiguration.

**Acceptance criteria**:
- All four bullets are present in the JSDoc.
- The `@throws` tag mentions `NestedTenantTransactionError`.

### Requirement: REQ-WTT-007: Integration test coverage

The integration test SHALL cover the happy path, rollback behavior, pool-mode safety, and DB-role safety.

**Rationale**: The wrapper is security-critical; unit tests with mocked Prisma cannot prove RLS is actually engaged.

**Acceptance criteria**:
- Happy path: callback runs, `set_config` takes effect, RLS filters work.
- Rollback: callback throws, `set_config` is reverted.
- Pool mode safety: `DATABASE_URL` query params are asserted to be transaction-mode (`pgbouncer=true` or Supavisor port 6543).
- DB role safety: `current_user` is asserted not to be the table owner and `rolbypassrls` is `false`.

**Scenarios**:

#### Scenario: WTT-007-A: happy path

- Given a local Postgres database with RLS enabled on `Producto`
- And `TenantCtx` for empresa `1`, sucursal `1`
- When `withTenantTransaction(ctx, fn)` inserts a product
- Then the product is visible only with matching GUCs
- AND other tenants cannot see the row

#### Scenario: WTT-007-B: rollback

- Given a callback that inserts a product then throws
- When `withTenantTransaction(ctx, fn)` is called
- Then the product is not persisted
- AND `current_setting('app.current_empresa_id')` is empty in a subsequent connection

#### Scenario: WTT-007-C: pool mode safety

- Given `DATABASE_URL` contains `pgbouncer=true` or port `6543`
- When `verify-rls.ts` reads the connection string
- Then it exits `0`

#### Scenario: WTT-007-D: DB role safety

- Given a connection role without `BYPASSRLS`
- When `verify-rls.ts` queries `current_user` and `rolbypassrls`
- Then `rolbypassrls` is `false`
- And `current_user` is not `postgres`, `supabase_admin`, nor the table owner

## Edge cases

- Timeout exceeded â†’ Prisma `TimeoutError` propagates.
- `empresaId`, `sucursalId`, `usuarioId`, or `esAdmin` missing from `ctx` â†’ `TypeError` is thrown before opening the transaction.
- `fn` returns a non-thenable value â†’ wrapper still resolves with that value.
- `fn` is not a function â†’ `TypeError` before opening the transaction.
- Empty/null `ctx` â†’ `TypeError` before opening the transaction.

## Out of scope

- Auto-retry on timeout or deadlock.
- Custom isolation levels other than `ReadCommitted`.
- Setting session-level GUCs (`set_config(..., false)`).
- Generic transaction wrappers that do not set tenant GUCs.
- Solving the Jest CJS/ESM gap for infrastructure tests (integration test uses a separate runner or manual execution).

## Dependencies

- `TenantCtx` from `tenant/domain/tenant.ts`.
- Prisma client configured with `PrismaPg` driver adapter.
- `DATABASE_URL` must use transaction-mode pooling (`pgbouncer=true` or Supavisor port 6543).
- `tools/scripts/verify-rls.ts` for environment smoke tests.
