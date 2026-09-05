# Tasks: foundational-patterns-fase-1-2

**Change ID**: foundational-patterns-fase-1-2
**Date**: 2026-09-02
**Author**: sdd-tasks-calidad-precio
**Project**: systemfact
**Source artifacts**: proposal.md, specs/*, design.md

## Summary

- **Total tasks**: 32
- **Implementation phases**: 4 (from design §6)
- **Total estimated lines changed**: ~1145
- **Review budget risk**: Medium — Phase 4 at ~650 lines is under the 800-line budget but tight; all other phases are well under.
- **Chained PRs recommended**: No — no single phase exceeds 800 lines.
- **Decision needed before apply**: No

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

## Review Workload Forecast

| Phase | Files | Estimated LOC | PR boundary |
|---|---|---|---|
| Phase 1 (WU4 cleanup) | 6 | ~60 | Single PR |
| Phase 2 (WU1 wrapper) | 5 | ~200 | Single PR |
| Phase 3 (WU2 ESLint) | 5 | ~235 | Single PR |
| Phase 4 (WU3 Producto) | 16 | ~650 | Single PR (under 800 budget) |
| **Total** | **32** | **~1145** | — |

Phase 4 is the largest at ~650 lines but remains under the 800-line review budget. Each phase maps to one PR. No chained PRs needed.

## Tasks

### Phase 1 — WU4 cleanup (parallel-safe, no dependencies)

#### Task 1.1 — Create `app/src/modules/auth/domain/synthetic-email.ts`
- **File**: CREATE `app/src/modules/auth/domain/synthetic-email.ts`
- **Spec source**: REQ-AUTH-SYN-001, REQ-AUTH-SYN-002, REQ-AUTH-SYN-003
- **Action**:
  1. Export `SYNTHETIC_EMAIL_SUFFIX = '@users.systemfact.internal'` (hardcoded, per ADR-014)
  2. Export `InvalidSyntheticEmailError extends Error`
  3. Export `buildSyntheticEmail(nombreUsuario: string): string` — concatenates with suffix
  4. Export `decodeNombreUsuario(email: string): string` — strips suffix, throws `InvalidSyntheticEmailError` if email doesn't end with suffix
  5. Pure TS only — no imports from infra, Next.js, or Prisma
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - `buildSyntheticEmail('jdoe')` returns `'jdoe@users.systemfact.internal'`
  - `decodeNombreUsuario('jdoe@users.systemfact.internal')` returns `'jdoe'`
  - `decodeNombreUsuario('jdoe@example.com')` throws `InvalidSyntheticEmailError`
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `refactor(auth): add synthetic-email domain module (foundational-patterns-fase-1-2 WU4)`
- **Estimated lines**: ~30

#### Task 1.2 — Modify `app/src/modules/auth/infrastructure/auth-service.ts` to import from auth/domain
- **File**: MODIFY `app/src/modules/auth/infrastructure/auth-service.ts`
- **Spec source**: REQ-AUTH-SYN-REMOVED-001
- **Action**:
  1. Remove the exported `SYNTHETIC_EMAIL_SUFFIX` constant
  2. Remove the `buildSyntheticEmail` function
  3. Remove any inline decode logic
  4. Add `import { buildSyntheticEmail, decodeNombreUsuario } from '@/modules/auth/domain/synthetic-email'`
  5. Update internal callers to use the imported functions
- **Acceptance criteria**:
  - No `export const SYNTHETIC_EMAIL_SUFFIX` in this file
  - No local `buildSyntheticEmail` function definition
  - `pnpm test` passes
- **Verification**: `cd app && pnpm test`
- **Commit message**: `refactor(auth): import synthetic-email from auth/domain (foundational-patterns-fase-1-2 WU4)`
- **Estimated lines**: -10 +5

#### Task 1.3 — Modify `app/src/modules/tenant/infrastructure/tenant-runtime.ts` to import from auth/domain
- **File**: MODIFY `app/src/modules/tenant/infrastructure/tenant-runtime.ts`
- **Spec source**: REQ-AUTH-SYN-REMOVED-002, REQ-TEN-CTX-001-MOD
- **Action**:
  1. Remove private `SYNTHETIC_EMAIL_SUFFIX` constant
  2. Remove inline decode logic (replace with import)
  3. Add `import { decodeNombreUsuario } from '@/modules/auth/domain/synthetic-email'`
  4. Remove null branch in `setTenantContext` (the `if (ctx.sucursalId !== null)` guard)
  5. `ctx.sucursalId` is now always `number` — pass directly to `set_config`
- **Acceptance criteria**:
  - No local `SYNTHETIC_EMAIL_SUFFIX` in this file
  - No null-check on `sucursalId` in `setTenantContext`
  - `pnpm test` passes
- **Verification**: `cd app && pnpm test`
- **Commit message**: `refactor(tenant): import synthetic-email from auth/domain, remove null branch (foundational-patterns-fase-1-2 WU4)`
- **Estimated lines**: -15 +5

#### Task 1.4 — Modify `app/src/modules/tenant/domain/tenant.ts` — narrow TenantCtx and remove dead code
- **File**: MODIFY `app/src/modules/tenant/domain/tenant.ts`
- **Spec source**: REQ-TEN-CTX-001-MOD, REQ-TEN-CTX-002-REMOVED, REQ-TEN-FLT-001-REMOVED
- **Action**:
  1. Change `TenantCtx.sucursalId` from `number | null` to `number`
  2. Remove `scope: "company"` from `TenantFilter` — scope field is removed entirely (or narrowed to just `"branch"`)
  3. Remove dead branch in `tenantFilter()`: `if (filter.sucursalId === null) { ... }`
  4. `tenantFilter(ctx)` always returns `{ empresaId, sucursalId }` — both required
- **Acceptance criteria**:
  - `TenantCtx` has `sucursalId: number` (not `number | null`)
  - `TenantFilter` has no `scope: "company"` option
  - No null branch in `tenantFilter()`
  - `tsc --noEmit` passes
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `refactor(tenant): narrow TenantCtx.sucursalId to number, remove dead P6 code (foundational-patterns-fase-1-2 WU4)`
- **Estimated lines**: -20 +5

#### Task 1.5 — Modify `app/src/modules/tenant/domain/tenant.test.ts` — update tests for non-null sucursalId
- **File**: MODIFY `app/src/modules/tenant/domain/tenant.test.ts`
- **Spec source**: REQ-TEN-FLT-001-REMOVED
- **Action**:
  1. Remove test cases that exercise the deleted `scope: "company"` branch
  2. Remove test cases that pass `sucursalId: null`
  3. Update any test that constructed `TenantCtx` with null sucursalId to use a real number
  4. Ensure remaining tests pass with the narrowed types
- **Acceptance criteria**:
  - No test passes `sucursalId: null`
  - No test asserts `scope: "company"` behavior
  - `pnpm test src/modules/tenant/domain/tenant.test.ts` passes
- **Verification**: `cd app && pnpm test src/modules/tenant/domain/tenant.test.ts`
- **Commit message**: `test(tenant): update tests for non-null TenantCtx.sucursalId (foundational-patterns-fase-1-2 WU4)`
- **Estimated lines**: -15 +10

#### Task 1.6 — Modify `app/scripts/probe-set-local.ts` — update Test 3 for non-null sucursalId
- **File**: MODIFY `app/scripts/probe-set-local.ts`
- **Spec source**: REQ-TEN-CTX-001-MOD
- **Action**:
  1. Update Test 3 admin context: change `sucursalId: null` to `sucursalId: 1`
  2. Verify the probe script still runs and all 3 tests pass
- **Acceptance criteria**:
  - `sucursalId` in Test 3 admin context is `1` (not null)
  - `npx tsx scripts/probe-set-local.ts` passes all tests
- **Verification**: `cd app && npx tsx scripts/probe-set-local.ts`
- **Commit message**: `fix(scripts): update probe-set-local Test 3 for non-null sucursalId (foundational-patterns-fase-1-2 WU4)`
- **Estimated lines**: -3 +3

---

### Phase 2 — WU1 wrapper (depends on Phase 1 for TenantCtx shape)

#### Task 2.1 — Create `app/src/modules/tenant/infrastructure/withTenantTransaction.ts`
- **File**: CREATE `app/src/modules/tenant/infrastructure/withTenantTransaction.ts`
- **Spec source**: REQ-WTT-001, REQ-WTT-002, REQ-WTT-003, REQ-WTT-004, REQ-WTT-005, REQ-WTT-006
- **Action**:
  1. Export `WithTenantTransactionOptions` interface with `timeoutMs?: number`
  2. Export `PrismaTx` type (Omit of `$connect/$disconnect/$on/$transaction/$use/$extends`)
  3. Export `NestedTenantTransactionError extends Error`
  4. Implement `withTenantTransaction<T>(ctx, fn, options?)`:
     - Default timeout 10_000, isolationLevel `'ReadCommitted'`
     - `tx.$executeRaw` sets 4 GUCs (`app.current_empresa_id`, `app.current_sucursal_id`, `app.current_usuario_id`, `app.current_es_admin`) with `set_config(..., true)`
     - Invoke `fn(tx)` and return result
     - Errors propagate without wrapping
  5. JSDoc documents: pool-mode requirement, BYPASSRLS prohibition, nested-tx prohibition, reference to `verify-rls.ts`
  6. Import `prisma` from `@/lib/prisma`, `TenantCtx` from `tenant/domain/tenant`, `setTenantContext` from `tenant/infrastructure/tenant-runtime`
- **Acceptance criteria**:
  - File exports all 4 symbols
  - `tsc --noEmit` passes
  - JSDoc contains all 4 prerequisite bullets
  - `@throws NestedTenantTransactionError` is documented
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `feat(tenant): add withTenantTransaction wrapper (foundational-patterns-fase-1-2 WU1)`
- **Estimated lines**: ~55

#### Task 2.2 — Create `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts`
- **File**: CREATE `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts`
- **Spec source**: REQ-WTT-007
- **Action**:
  1. Integration test covering happy path (GUCs set, callback runs, RLS filters)
  2. Rollback test (callback throws, data not persisted, GUCs reverted)
  3. Nested rejection test (inner `withTenantTransaction` throws `NestedTenantTransactionError`)
  4. Pool mode safety (assert `DATABASE_URL` has `pgbouncer=true` or port 6543)
  5. DB role safety (assert `current_user` not superuser, `rolbypassrls` is false)
  6. Run outside Jest CJS (tsx or integration runner) due to Prisma ESM gap
- **Acceptance criteria**:
  - 5 test cases pass against local Postgres
  - Happy path verifies RLS filtering
  - Rollback verifies no persisted data
  - Nested test verifies `NestedTenantTransactionError`
- **Verification**: `cd app && npx tsx src/modules/tenant/infrastructure/withTenantTransaction.test.ts`
- **Commit message**: `test(tenant): add withTenantTransaction integration tests (foundational-patterns-fase-1-2 WU1)`
- **Estimated lines**: ~80

#### Task 2.3 — Modify `app/scripts/verify-rls.ts` — add BYPASSRLS and pool-mode checks
- **File**: MODIFY `app/scripts/verify-rls.ts`
- **Spec source**: REQ-WTT-007-C, REQ-WTT-007-D
- **Action**:
  1. Add query: `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`
  2. Add assertion: `rolbypassrls` is `false`
  3. Add check: `current_user` not in `('postgres', 'supabase_admin', <table_owner>)`
  4. Add check: `DATABASE_URL` includes `pgbouncer=true` or port `6543`
  5. Exit 0 on all checks pass, non-zero on failure
- **Acceptance criteria**:
  - `pnpm rls:verify` exits 0 on local dev (or documents why it can't — SUPERUSER local)
  - Script checks all 3 conditions: BYPASSRLS, current_user, pool mode
- **Verification**: `cd app && npx tsx scripts/verify-rls.ts`
- **Commit message**: `feat(scripts): add BYPASSRLS and pool-mode checks to verify-rls (foundational-patterns-fase-1-2 WU1)`
- **Estimated lines**: +40

#### Task 2.4 — Modify `app/package.json` — add `rls:verify` script
- **File**: MODIFY `app/package.json`
- **Spec source**: REQ-WTT-007 support
- **Action**:
  1. Add `"rls:verify": "npx tsx scripts/verify-rls.ts"` to `scripts`
- **Acceptance criteria**:
  - `pnpm rls:verify` runs the script
- **Verification**: `cd app && pnpm rls:verify`
- **Commit message**: `chore: add rls:verify script to package.json (foundational-patterns-fase-1-2 WU1)`
- **Estimated lines**: +1

#### Task 2.5 — Modify `app/docs/19-directivas_desarrollo.md` — document wrapper convention
- **File**: MODIFY `app/docs/19-directivas_desarrollo.md`
- **Spec source**: proposal acceptance criteria, REQ-WTT-006
- **Action**:
  1. Add section documenting `withTenantTransaction` as the mandatory wrapper for all Server Actions
  2. Document that `auth/domain/synthetic-email.ts` is the canonical location for synthetic email
  3. Reference the ESLint rule as defense-in-depth
- **Acceptance criteria**:
  - Document mentions `withTenantTransaction` by name
  - Document mentions `auth/domain/synthetic-email.ts` as canonical
- **Verification**: Manual review
- **Commit message**: `docs: add withTenantTransaction convention to development directives (foundational-patterns-fase-1-2 WU1)`
- **Estimated lines**: +25

---

### Phase 3 — WU2 ESLint rule (parallel-safe with Phase 4)

#### Task 3.1 — Create `app/tools/eslint-plugin-systemfact/package.json`
- **File**: CREATE `app/tools/eslint-plugin-systemfact/package.json`
- **Spec source**: REQ-LINT-001
- **Action**:
  1. Create package manifest: name `eslint-plugin-systemfact`, version `0.1.0`, main `./index.ts`, type `module`
  2. Add `@typescript-eslint/utils` as peer/dev dependency reference
- **Acceptance criteria**:
  - File exists with correct structure
- **Verification**: `cat app/tools/eslint-plugin-systemfact/package.json`
- **Commit message**: `chore(eslint): create systemfact plugin package manifest (foundational-patterns-fase-1-2 WU2)`
- **Estimated lines**: ~10

#### Task 3.2 — Create `app/tools/eslint-plugin-systemfact/index.ts`
- **File**: CREATE `app/tools/eslint-plugin-systemfact/index.ts`
- **Spec source**: REQ-LINT-001
- **Action**:
  1. Import `rule` from `./rules/server-action-must-wrap-tenant`
  2. Export default `{ rules: { 'server-action-must-wrap-tenant': rule } }`
- **Acceptance criteria**:
  - `plugin.rules['server-action-must-wrap-tenant']` is defined
  - `meta.type === 'problem'`
- **Verification**: `cd app && npx tsc --noEmit tools/eslint-plugin-systemfact/index.ts`
- **Commit message**: `feat(eslint): create systemfact plugin entry point (foundational-patterns-fase-1-2 WU2)`
- **Estimated lines**: ~15

#### Task 3.3 — Create `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts`
- **File**: CREATE `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts`
- **Spec source**: REQ-LINT-002, REQ-LINT-003, REQ-LINT-004
- **Action**:
  1. Use `ESLintUtils.RuleCreator` from `@typescript-eslint/utils`
  2. Export `RULE_NAME = 'server-action-must-wrap-tenant'`
  3. `meta.type = 'problem'`, `messages.missingTenantWrap` with self-documenting text
  4. Visitor: inspect `FunctionDeclaration` and `ExportNamedDeclaration > FunctionDeclaration`
  5. Check `node.body.body[0]` is `ReturnStatement` or `AwaitExpression` whose argument is `CallExpression` to `withTenantTransaction`
  6. Report `missingTenantWrap` with function name in message
  7. v1 limitation: arrow-function exports not covered (documented)
- **Acceptance criteria**:
  - Rule reports error when first statement is not `withTenantTransaction` call
  - Rule passes when first statement is `return withTenantTransaction(...)` or `return await withTenantTransaction(...)`
  - Message contains literal `withTenantTransaction` and function name
  - Only targets files matching `app/**/actions/*.ts`
- **Verification**: `cd app && pnpm tsc --noEmit tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts`
- **Commit message**: `feat(eslint): implement server-action-must-wrap-tenant rule (foundational-patterns-fase-1-2 WU2)`
- **Estimated lines**: ~80

#### Task 3.4 — Create `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts`
- **File**: CREATE `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts`
- **Spec source**: REQ-LINT-006
- **Action**:
  1. Use `RuleTester` from `@typescript-eslint/rule-tester`
  2. Valid cases (3+): `return withTenantTransaction(...)`, `return await withTenantTransaction(...)`, `await withTenantTransaction(...)`
  3. Invalid cases (3+): first statement is `const x = ...`, no body, wrapper after other statements
  4. Each invalid case asserts `messageId: 'missingTenantWrap'`
- **Acceptance criteria**:
  - 6+ test cases pass
  - 3+ valid, 3+ invalid
  - Tests exercise `ReturnStatement`, `AwaitExpression`, and non-first-statement patterns
- **Verification**: `cd app && pnpm test tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts`
- **Commit message**: `test(eslint): add RuleTester tests for server-action-must-wrap-tenant (foundational-patterns-fase-1-2 WU2)`
- **Estimated lines**: ~120

#### Task 3.5 — Modify `app/eslint.config.mjs` — register plugin and enable rule
- **File**: MODIFY `app/eslint.config.mjs`
- **Spec source**: REQ-LINT-005
- **Action**:
  1. Import the local plugin: `import systemfact from './tools/eslint-plugin-systemfact/index.js'`
  2. Add plugin config block: `plugins: { systemfact }`, `rules: { 'systemfact/server-action-must-wrap-tenant': 'error' }`
  3. Scope to `files: ['src/**/actions/**/*.ts', 'src/**/actions/**/*.tsx']`
  4. Verify `pnpm lint` runs without config errors
- **Acceptance criteria**:
  - `pnpm lint` runs without configuration errors
  - Violations in `actions.ts` files are reported
- **Verification**: `cd app && pnpm lint`
- **Commit message**: `chore(eslint): register systemfact plugin and enable wrap-tenant rule (foundational-patterns-fase-1-2 WU2)`
- **Estimated lines**: +10

---

### Phase 4 — WU3 Producto module (depends on Phase 2 wrapper)

#### Task 4.1 — Create Prisma migration for ITBIS validity columns
- **File**: CREATE `app/prisma/migrations/<timestamp>_add_itbis_validity_to_producto/migration.sql`
- **Spec source**: REQ-PROD-009
- **Action**:
  1. `ALTER TABLE "PRODUCTO"` — add `itbisVigenteDesde TIMESTAMPTZ NOT NULL DEFAULT '2012-01-01 00:00:00+00'`
  2. Add `itbisVigenteHasta TIMESTAMPTZ NULL`
  3. Add `itbisAplicaRetencionITBIS BOOLEAN NOT NULL DEFAULT false`
  4. Include down migration: `DROP COLUMN IF EXISTS` for all three
  5. Commit migration file separately from feature code (AGENTS.md rule)
- **Acceptance criteria**:
  - Migration file exists with correct SQL
  - `prisma migrate dev` applies cleanly
  - Existing rows get default values
- **Verification**: `cd app && npx prisma migrate dev --name add_itbis_validity_to_producto`
- **Commit message**: `chore(prisma): add ITBIS validity columns to Producto (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~15

#### Task 4.2 — Create `app/src/modules/producto/domain/producto.ts`
- **File**: CREATE `app/src/modules/producto/domain/producto.ts`
- **Spec source**: REQ-PROD-001, REQ-PROD-002, REQ-PROD-003
- **Action**:
  1. Export `TasaItbis = '0' | '16' | '18'` (frozen enum)
  2. Export `ProductoItbis` interface: `tasa`, `vigenteDesde`, `vigenteHasta`, `aplicaRetencionITBIS`
  3. Export `Producto` interface: `id`, `empresaId`, `categoriaId`, `codigo`, `nombre`, `descripcion`, `precioVenta: Decimal`, `itbis: ProductoItbis`, `exento: boolean`, `activo: boolean`
  4. Pure TS — only import `Decimal` type from `@prisma/client/runtime/library`
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - `TasaItbis` accepts only `'0'`, `'16'`, `'18'`
  - `exento` is derived from `itbis.tasa === '0'`
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `feat(producto): add Producto entity and TasaItbis enum (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~40

#### Task 4.3 — Create `app/src/modules/producto/domain/errors.ts`
- **File**: CREATE `app/src/modules/producto/domain/errors.ts`
- **Spec source**: REQ-PROD-005
- **Action**:
  1. Export error code constants: `CODIGO_PRODUCTO_DUPLICADO`, `TASA_ITBIS_INVALIDA`, `PRECIO_BASE_INVALIDO`, `VIGENCIA_INVALIDA`, `LIMITE_PAGINACION_INVALIDO`, `PAGINA_INVALIDA`, `CANTIDAD_INVALIDA`
  2. Export `ProductoErrorCode` union type
  3. Export `ProductoDomainError extends Error` with `code: ProductoErrorCode` and optional `details`
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - All 7 error codes exported
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `feat(producto): add domain error codes and ProductoDomainError (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~35

#### Task 4.4 — Create `app/src/modules/producto/domain/calcular-itbis.ts`
- **File**: CREATE `app/src/modules/producto/domain/calcular-itbis.ts`
- **Spec source**: REQ-PROD-004
- **Action**:
  1. Export `ItbisLine` interface: `baseImponible: Decimal`, `itbis: Decimal`, `total: Decimal`
  2. Export `calcularItbisProducto(producto, cantidad): ItbisLine`
  3. Formula: `baseImponible = precioBase.mul(cantidad)`, `itbis = tasa === '0' ? 0 : baseImponible.mul(tasa).div(100)`, `total = baseImponible.plus(itbis)`
  4. Pure TS — no Prisma, Next.js, React, or Supabase imports
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - All monetary arithmetic uses `Decimal`
  - Laptop 18%: `50000 * 1 = 50000 base, 9000 itbis, 59000 total`
  - Yogurt 16%: `1000 * 1 = 1000 base, 160 itbis, 1160 total`
  - Leche 0%: `100 * 1 = 100 base, 0 itbis, 100 total`
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `feat(producto): add pure ITBIS calculation function (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~25

#### Task 4.5 — Create `app/src/modules/producto/domain/calcular-itbis.test.ts`
- **File**: CREATE `app/src/modules/producto/domain/calcular-itbis.test.ts`
- **Spec source**: REQ-PROD-004 scenarios (PROD-004-A through PROD-004-E)
- **Action**:
  1. Test laptop at 18% (PROD-004-A): `50000.00, qty 1 → base 50000, itbis 9000, total 59000`
  2. Test yogurt at 16% (PROD-004-B): `1000.00, qty 1 → base 1000, itbis 160, total 1160`
  3. Test leche at 0% (PROD-004-C): `100.00, qty 1 → base 100, itbis 0, total 100`
  4. Test mixed cart (PROD-004-D): per-line calculation independently
  5. Test decimal precision (PROD-004-E): `50000.00 * 18% = exactly 9000.00`
  6. Test edge cases: zero quantity, negative quantity throws `CantidadInvalida`
  7. Use `new Decimal('50000')` string constructor to avoid float loss
- **Acceptance criteria**:
  - 5+ test cases pass
  - All DGII fixtures match exactly
  - No floating-point imprecision
- **Verification**: `cd app && pnpm test src/modules/producto/domain/calcular-itbis.test.ts`
- **Commit message**: `test(producto): add ITBIS calculation unit tests with DGII fixtures (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~80

#### Task 4.6 — Create `app/src/modules/producto/infrastructure/producto-repository.ts`
- **File**: CREATE `app/src/modules/producto/infrastructure/producto-repository.ts`
- **Spec source**: REQ-PROD-005, REQ-PROD-006
- **Action**:
  1. Export `CrearProductoInput` interface (categoriaId, codigo, nombre, descripcion, precioVenta, itbis fields)
  2. Export `ListarProductosQuery` interface (page, limit, descripcion?, incluirInactivos?)
  3. Export `existeCodigoEnEmpresa(tx, empresaId, codigo): Promise<boolean>` — `SELECT 1` with exists check
  4. Export `crearProductoEnTx(tx, ctx, input): Promise<Producto>` — Prisma create
  5. Export `contarProductos(tx, ctx, query): Promise<number>` — Prisma count with filters
  6. Export `listarProductosEnTx(tx, ctx, query): Promise<Producto[]>` — Prisma findMany with `select`, `orderBy: { codigo: 'asc' }`, `skip/take`
  7. ALL Prisma access is ONLY in this file — no `prisma.*` calls elsewhere in the module
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - No `prisma.*` imports outside this file in `producto/`
  - `listarProductosEnTx` uses `select` (not full `include`)
  - Pagination: `skip = (page - 1) * limit`, `take = limit`
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `feat(producto): add Prisma repository with select-only queries (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~80

#### Task 4.7 — Create `app/src/modules/producto/application/crear-producto.ts`
- **File**: CREATE `app/src/modules/producto/application/crear-producto.ts`
- **Spec source**: REQ-PROD-005
- **Action**:
  1. Export `CrearProductoResult` type: `Ok({ producto })` or `Err({ code, message })`
  2. Export `crearProducto(ctx, input): Promise<CrearProductoResult>`
  3. Validate: tasa in `['0', '16', '18']`, vigencia window valid, precioBase > 0
  4. Open `withTenantTransaction(ctx, async (tx) => { ... })`
  5. Check uniqueness via `existeCodigoEnEmpresa`
  6. Persist via `crearProductoEnTx`
  7. Emit `producto.created` audit event
  8. Return typed Result — no thrown exceptions for business errors
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - Duplicate codigo returns `Err(CODIGO_PRODUCTO_DUPLICADO)`
  - Invalid tasa returns `Err(TASA_ITBIS_INVALIDA)`
  - Invalid vigencia returns `Err(VIGENCIA_INVALIDA)`
  - All DB ops inside `withTenantTransaction`
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `feat(producto): add crearProducto use case with typed Result (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~55

#### Task 4.8 — Create `app/src/modules/producto/application/listar-productos.ts`
- **File**: CREATE `app/src/modules/producto/application/listar-productos.ts`
- **Spec source**: REQ-PROD-006
- **Action**:
  1. Export `ListarProductosOutput`: `items: ProductoListItem[]`, `total: number`, `page: number`
  2. Export `ListarProductosResult`: `Ok({ data })` or `Err({ code, message })`
  3. Export `listarProductos(ctx, query): Promise<ListarProductosResult>`
  4. Validate: limit 1-100, page >= 1
  5. Open `withTenantTransaction(ctx, async (tx) => { ... })`
  6. Call `contarProductos` + `listarProductosEnTx` with pagination
  7. Emit `producto.listed` audit event
  8. Return typed Result
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - Default limit 25, max 100
  - `limit > 100` returns `Err(LIMITE_PAGINACION_INVALIDO)`
  - `page < 1` returns `Err(PAGINA_INVALIDA)`
  - All DB ops inside `withTenantTransaction`
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `feat(producto): add listarProductos use case with pagination (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~50

#### Task 4.9 — Create `app/src/modules/producto/application/crear-producto.test.ts`
- **File**: CREATE `app/src/modules/producto/application/crear-producto.test.ts`
- **Spec source**: REQ-PROD-005 scenarios (PROD-005-A through PROD-005-E)
- **Action**:
  1. Mock `producto-repository` functions
  2. Mock `withTenantTransaction` to invoke callback directly
  3. Test happy path: unique code → returns `Ok({ producto })`
  4. Test duplicate: `existeCodigoEnEmpresa` returns true → `Err(CODIGO_PRODUCTO_DUPLICADO)`
  5. Test invalid tasa: `Err(TASA_ITBIS_INVALIDA)`
  6. Test invalid vigencia: `Err(VIGENCIA_INVALIDA)`
  7. Test transaction rollback: callback throws → no data persisted
- **Acceptance criteria**:
  - 5+ test cases pass
  - All error codes tested
  - Mocks verify `withTenantTransaction` is called
- **Verification**: `cd app && pnpm test src/modules/producto/application/crear-producto.test.ts`
- **Commit message**: `test(producto): add crearProducto use case unit tests (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~65

#### Task 4.10 — Create `app/src/modules/producto/application/listar-productos.test.ts`
- **File**: CREATE `app/src/modules/producto/application/listar-productos.test.ts`
- **Spec source**: REQ-PROD-006 scenarios (PROD-006-A through PROD-006-D)
- **Action**:
  1. Mock repository functions
  2. Test page 1 of 25: 30 products → returns 25 items, total 30
  3. Test page 2: returns remaining 5 items
  4. Test filter by descripcion
  5. Test empty result: no products → `items: [], total: 0`
  6. Test limit validation: `limit > 100` → error
- **Acceptance criteria**:
  - 5+ test cases pass
  - Pagination math verified
  - Empty result handled
- **Verification**: `cd app && pnpm test src/modules/producto/application/listar-productos.test.ts`
- **Commit message**: `test(producto): add listarProductos use case unit tests (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~60

#### Task 4.11 — Create `app/src/modules/producto/http/validations.ts`
- **File**: CREATE `app/src/modules/producto/http/validations.ts`
- **Spec source**: REQ-PROD-007, REQ-PROD-008
- **Action**:
  1. Export `zCrearProductoInput` zod schema: `categoriaId` (int, positive), `codigo` (trim, 1-255), `nombre` (trim, 1-255), `descripcion` (trim, max 255, optional), `precioVenta` (string regex for Decimal), `itbisTasa` (enum `'0'|'16'|'18'`), `itbisVigenteDesde` (coerce date), `itbisVigenteHasta` (coerce date, nullable, optional), `itbisAplicaRetencionITBIS` (boolean, default false)
  2. Export `zListarProductosQuery` zod schema: `page` (coerce int, min 1, default 1), `limit` (coerce int, min 1, max 100, default 25), `descripcion` (trim, optional), `incluirInactivos` (coerce boolean, default false)
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - Valid inputs parse without error
  - Invalid inputs (missing codigo, limit > 100) throw ZodError
- **Verification**: `cd app && pnpm tsc --noEmit`
- **Commit message**: `feat(producto): add zod validation schemas for HTTP input (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~40

#### Task 4.12 — Create `app/src/modules/producto/http/actions.ts`
- **File**: CREATE `app/src/modules/producto/http/actions.ts`
- **Spec source**: REQ-PROD-007, REQ-PROD-008
- **Action**:
  1. `"use server"` directive at top
  2. Import `withTenantTransaction`, `getCurrentTenantContext`, `zCrearProductoInput`, `zListarProductosQuery`, use cases
  3. Export `ActionResult<T>` type
  4. Implement `crearProductoAction(input)`: zod parse → build ctx → `withTenantTransaction(ctx, async (tx) => { crearProducto(ctx, parsed) })` → map to `ActionResult`
  5. Implement `listarProductosAction(query)`: zod parse → build ctx → `withTenantTransaction(ctx, async (tx) => { listarProductos(ctx, parsed) })` → map to `ActionResult`
  6. First statement of each action MUST be `return withTenantTransaction(...)` (satisfies ESLint rule)
- **Acceptance criteria**:
  - `tsc --noEmit` passes
  - Both actions have `withTenantTransaction` as first statement (ESLint rule passes)
  - Zod validation errors map to `ActionResult.error`
  - Session/ctx errors map to `ActionResult.error({ code: 'UNAUTHORIZED' })`
- **Verification**: `cd app && pnpm tsc --noEmit && pnpm lint`
- **Commit message**: `feat(producto): add Server Actions with withTenantTransaction wrapper (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: ~70

#### Task 4.13 — Modify `app/docs/21-evaluacion_por_fases_prisma.md` — ITBIS validity note
- **File**: MODIFY `app/docs/21-evaluacion_por_fases_prisma.md`
- **Spec source**: REQ-PROD-009
- **Action**:
  1. Add note documenting the ITBIS validity migration and backfill rationale
  2. Explain `itbisVigenteDesde` default of `'2012-01-01'` (year of last rate change)
- **Acceptance criteria**:
  - Document mentions ITBIS validity columns
  - Document explains backfill default
- **Verification**: Manual review
- **Commit message**: `docs: add ITBIS validity migration note (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: +10

#### Task 4.14 — Modify `app/AGENTS.md` — add wrapper requirement
- **File**: MODIFY `app/AGENTS.md`
- **Spec source**: proposal acceptance criteria
- **Action**:
  1. Add `withTenantTransaction` as mandatory wrapper requirement in Security section
  2. Document that Server Actions MUST wrap in `withTenantTransaction` as first statement
  3. Reference ESLint rule `server-action-must-wrap-tenant`
- **Acceptance criteria**:
  - `AGENTS.md` mentions `withTenantTransaction` by name
  - `AGENTS.md` mentions the ESLint rule
- **Verification**: Manual review
- **Commit message**: `docs: add withTenantTransaction requirement to AGENTS.md (foundational-patterns-fase-1-2 WU3)`
- **Estimated lines**: +8

---

## Dependency Graph

```
Phase 1 (WU4) ──> Phase 2 (WU1) ──┬──> Phase 3 (WU2) [parallel-safe]
                                   │
                                   └──> Phase 4 (WU3) [depends on WU1]
```

## Commit Strategy

- One commit per task (matches `work-unit-commits` skill convention)
- Conventional commits: `feat|refactor|chore|test|fix(<scope>): <message>`
- Reference the WU in the commit body
- Migration commit is ALWAYS separate from feature commits (AGENTS.md rule)

## Rollback Plan

- Each phase is independently revertible via `git revert`
- Each task's commit can be reverted individually
- Migration has explicit down script in the migration file
- Wrapper is additive; removing it returns to pre-Fase-1.2 state

## Open Items for apply phase

- Phase 4 is ~650 lines — reviewer should be aware it's the largest phase
- Integration tests (2.2) need local Postgres running
- ESLint rule v1 limitation: arrow-function exports not covered (documented)
- `verify-rls.ts` may exit non-zero locally due to SUPERUSER — document expected behavior

## Tasks Index (markdown checkboxes for runtime tracking)

<!-- This index mirrors the detailed tasks below. The runtime tracks progress via these checkboxes.
     Detailed action/verification steps are in the sections below; this index is for status tracking. -->

### Phase 1 � WU4 cleanup (6 tasks)

- [x] 1.1 Create `app/src/modules/auth/domain/synthetic-email.ts`
- [x] 1.2 Modify `app/src/modules/auth/infrastructure/auth-service.ts`
- [x] 1.3 Modify `app/src/modules/tenant/infrastructure/tenant-runtime.ts`
- [x] 1.4 Modify `app/src/modules/tenant/domain/tenant.ts` (narrow + remove dead code)
- [x] 1.5 Modify `app/src/modules/tenant/domain/tenant.test.ts` (update affected tests)
- [x] 1.6 Modify `app/scripts/probe-set-local.ts` (test 3 update)

### Phase 2 � WU1 wrapper (5 tasks)

- [x] 2.1 Create `app/src/modules/tenant/infrastructure/withTenantTransaction.ts`
- [x] 2.2 Create `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts`
- [x] 2.3 Create `app/tools/scripts/verify-rls.ts`
- [x] 2.4 Modify `app/package.json` (add `rls:verify` script)
- [x] 2.5 Modify `app/docs/19-directivas_desarrollo.md` (add wrapper convention)

### Phase 3 � WU2 ESLint rule (6 tasks)

- [x] 3.1 Create `app/tools/eslint-plugin-systemfact/package.json`
- [x] 3.2 Create `app/tools/eslint-plugin-systemfact/index.ts`
- [x] 3.3 Create `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts`
- [x] 3.4 Create `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts`
- [x] 3.5 Modify `app/eslint.config.mjs` (register plugin)
- [x] 3.6 Create + delete `app/src/modules/_example/actions.ts` (rule testing — ephemeral)

### Phase 4 � WU3 Producto module (15 tasks)

- [x] 4.1 Create Prisma migration `app/prisma/migrations/<ts>_add_itbis_validity_to_producto/migration.sql
- [x] 4.2 Apply migration locally + verify backfill (run-only, no file) — VERIFIED 2026-09-03: `prisma migrate status` → 9 applied, schema up-to-date at `localhost:5433`; live `PRODUCTO` carries `itbisVigenteDesde` (NOT NULL, default `2012-01-01`), `itbisVigenteHasta` (NULL), `itbisAplicaRetencionITBIS` (NOT NULL, default `false`); `migrate diff` emits no `ADD COLUMN`; `PRODUCTO` row count = 0 → backfill vacuously correct (DEFAULT-guaranteed).
- [x] 4.3 Create `app/src/modules/producto/domain/producto.ts
- [x] 4.4 Create `app/src/modules/producto/domain/errors.ts
- [x] 4.5 Create `app/src/modules/producto/domain/calcular-itbis.ts
- [x] 4.6 Create `app/src/modules/producto/domain/calcular-itbis.test.ts
- [x] 4.7 Create `app/src/modules/producto/infrastructure/producto-repository.ts
- [x] 4.8 Create `app/src/modules/producto/application/crear-producto.ts
- [x] 4.9 Create `app/src/modules/producto/application/listar-productos.ts
- [x] 4.10 Create `app/src/modules/producto/application/crear-producto.test.ts
- [x] 4.11 Create `app/src/modules/producto/application/listar-productos.test.ts
- [x] 4.12 Create `app/src/modules/producto/http/validations.ts
- [x] 4.13 Create `app/src/modules/producto/http/actions.ts
- [x] 4.14 Modify `app/eslint.config.mjs for plugin wiring (already in 3.5; document split)
- [x] 4.15 Modify `app/docs/21-evaluacion_por_fases_prisma.md (ITBIS validity note)

<!-- Sub-slicing (delivery: auto-chain, stacked-to-main, 400-line budget). Phase 4 split:
     Slice 4-A (domain + migration + doc) = 4.1,4.3,4.4,4.5,4.6,4.15 — DONE, see apply-progress.
     Slice 4-B (infra + application + AGENTS note) = 4.7,4.8,4.9,4.10,4.11,4.14.
     Slice 4-C (http validations/actions + resolve REQ-LINT-003 conflict in actions.ts) = 4.12,4.13.
     4.2 deferred pending local DB. -->
