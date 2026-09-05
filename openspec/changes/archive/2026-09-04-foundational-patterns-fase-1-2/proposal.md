# Proposal: foundational-patterns-fase-1-2

**Change ID**: foundational-patterns-fase-1-2
**Date**: 2026-09-02
**Author**: sdd-propose-calidad-precio
**Project**: systemfact
**Status**: ready-for-spec

## Intent (the WHY)

Post-R1 audit (Engram #510) surfaced 4 foundational decisions that must be resolved BEFORE Fase 1.2 (first business module) lands. These decisions shape every Server Action and cross-cutting concern for the rest of the ERP. The change ships 4 work units:

1. **Tenant context wrapper (A1)** — close the CRITICAL gap that `setTenantContext` is never called in production
2. **Custom ESLint rule (A3)** — defense in depth so future modules can't forget the wrapper
3. **First business module: Producto (B)** — validates the full ADR-013 layering with the most rule-heavy domain (ITBIS, multi-branch inventory, audit logging)
4. **Module cleanup** — extract synthetic email (C), remove P6 dead code (D)

## Scope

### In scope (this change)

- `app/src/modules/tenant/infrastructure/withTenantTransaction.ts` — new wrapper function
- `app/src/modules/auth/domain/synthetic-email.ts` — new pure module with encode/decode
- `app/src/modules/auth/infrastructure/auth-service.ts` — refactor to import from auth/domain
- `app/src/modules/tenant/infrastructure/tenant-runtime.ts` — refactor to import from auth/domain + remove SYNTHETIC_EMAIL_SUFFIX duplication
- `app/src/modules/tenant/domain/tenant.ts` — `TenantCtx.sucursalId: number` (remove null), remove `scope: "company"`, remove dead branch in `tenantFilter`
- `app/src/modules/tenant/domain/tenant.test.ts` — update tests that exercise the null branch (probe-set-local.ts test 3)
- `app/src/modules/producto/` — full new module with `domain/application/infrastructure/http`
  - `domain/producto.ts` — entity + ITBIS domain (TasaItbis enum, vigenteDesde/Hasta, aplicaRetencionITBIS)
  - `domain/calcular-itbis.ts` — pure calculation function
  - `domain/calcular-itbis.test.ts` — unit tests with DGII fixtures
  - `application/crear-producto.ts` — use case (validates uniqueness, applies withTenantTransaction)
  - `application/listar-productos.ts` — paginated query (with select, no N+1)
  - `infrastructure/producto-repository.ts` — Prisma access ONLY here
  - `http/actions.ts` — Server Actions (thin adapters, wrap in withTenantTransaction)
  - `http/validations.ts` — zod schemas for input
- `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts` — new ESLint custom rule
- `app/eslint.config.mjs` — register the new plugin
- `app/tools/scripts/verify-rls.ts` — smoke test asserting current_user + rolbypassrls
- `app/prisma/migrations/<timestamp>_add_itbis_validity_to_producto/migration.sql` — add vigenteDesde, vigenteHasta columns
- `app/docs/21-evaluacion_por_fases_prisma.md` — note about ITBIS validity migration
- `app/docs/19-directivas_desarrollo.md` — add the withTenantTransaction convention to the standards
- `app/scripts/probe-set-local.ts` — update test 3 to use the new non-null TenantCtx shape

### Out of scope (deferred to future changes)

- Cliente module (next after Producto lands)
- Proveedor module
- Venta (sale) flow — depends on Producto for catalog
- NCF sequence management (separate change with its own audit-heavy design)
- Compra (purchase) flow
- Cobros (collections)
- Reportes / 607 generation (separate change)
- Multi-currency / multi-country support
- Admin empresa-wide mode (P6 already decided: not supported)

## Capabilities

> Contract between proposal and specs phases. Each new capability gets a full spec; each modified capability gets a delta spec.

### New Capabilities

- `tenant-transaction-wrapper`: `withTenantTransaction(ctx, fn)` opens a Prisma interactive transaction, sets all tenant GUCs (`app.current_empresa_id`, `app.current_sucursal_id`, `app.current_usuario_id`, `app.current_es_admin`) with `set_config(..., true)`, and delegates to the callback.
- `server-action-tenant-lint`: Custom ESLint rule `server-action-must-wrap-tenant` that errors when an exported function in `app/**/actions/*` does not wrap its body in `withTenantTransaction`.
- `rls-runtime-verification`: `tools/scripts/verify-rls.ts` smoke test asserting the Prisma connection role is not `BYPASSRLS` and pool mode is transaction-mode.
- `producto-catalog`: Full CRUD + listing for products with ITBIS rate, validity window, and retention flag.
- `itbis-calculation`: Pure domain function `calcularItbisProducto` for DGII-aligned 18%/16%/0% calculations.

### Modified Capabilities

- `auth-synthetic-email`: Existing synthetic email encode/decode moves from `auth/infrastructure` and `tenant/infrastructure` to `auth/domain/synthetic-email.ts`. No behavior change.
- `tenant-context-cleanup`: `TenantCtx.sucursalId` narrowed from `number | null` to `number`; `TenantFilter` loses `scope: "company"`; `tenantFilter` loses the null branch. No runtime behavior change for valid data.

## Approach (the HOW)

### Work unit 1 — Tenant context wrapper (A1)

**File**: `app/src/modules/tenant/infrastructure/withTenantTransaction.ts`

**Signature** (from research):
```ts
export async function withTenantTransaction<T>(
  ctx: TenantCtx,
  fn: (tx: PrismaTx) => Promise<T>,
  options?: { timeoutMs?: number }
): Promise<T>
```

**Behavior**:
- Opens `prisma.$transaction` with `{ timeout: options?.timeoutMs ?? 10_000, isolationLevel: 'ReadCommitted' }`
- First statement: `tx.$executeRaw` sets all tenant GUCs with `set_config(..., true)`:
  ```ts
  await tx.$executeRaw`
    SELECT
      set_config('app.current_empresa_id', ${String(ctx.empresaId)}, true),
      set_config('app.current_sucursal_id', ${String(ctx.sucursalId)}, true),
      set_config('app.current_usuario_id', ${String(ctx.usuarioId)}, true),
      set_config('app.current_es_admin', ${String(ctx.esAdmin)}, true)
  `
  ```
- Invokes `fn(tx)` and returns its result
- **Throws** if `set_config` fails (fail-fast)
- **Does NOT** catch errors from `fn` — they propagate for use-case-level handling

**Documentation in JSDoc**:
- Nested transactions not allowed (Prisma limitation) — `fn` must not invoke `withTenantTransaction` recursively
- Pool mode must be transaction-mode (PgBouncer/Supavisor) — referenced in the AGENTS.md addition
- DB role must NOT be `BYPASSRLS` — enforced by `verify-rls.ts`

**Test**: `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts` (integration test, requires local Postgres)

### Work unit 2 — ESLint custom rule (A3)

**Files**:
- `app/tools/eslint-plugin-systemfact/index.ts` — plugin entry
- `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts` — the rule
- `app/tools/eslint-plugin-systemfact/package.json` — package manifest
- `app/eslint.config.mjs` — register plugin in the existing typescript-eslint chain

**Rule**: `server-action-must-wrap-tenant`
- Targets: all exported `FunctionDeclaration` and `ExportNamedDeclaration → FunctionDeclaration` in files matching `app/**/actions/*.ts` and `app/**/actions/*.tsx`
- Visitor checks: `node.body.body[0]` must be a `ReturnStatement` or `AwaitExpression` whose argument is a `CallExpression` to `withTenantTransaction` (matched by callee identifier name)
- Report: `messageId: 'missingTenantWrap'` with a self-documenting message naming `withTenantTransaction`
- Severity: error
- Auto-fix: not provided (would require AST rewriting — risky)

**Plugin scaffold**:
```ts
import { ESLintUtils } from '@typescript-eslint/utils';
export const RULE_NAME = 'server-action-must-wrap-tenant';
export const rule = ESLintUtils.RuleCreator(/* name */)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: { description: 'Server Actions must wrap their body in withTenantTransaction(ctx, ...)' },
    messages: {
      missingTenantWrap: 'Server Action "{{name}}" must call withTenantTransaction(ctx, async (tx) => {...}) as its first statement to enforce tenant isolation.'
    },
    schema: []
  },
  defaultOptions: [],
  create(context) {
    /* visitor logic */
  }
});
```

**Wire-up**: in `app/eslint.config.mjs` add the plugin under the existing typescript-eslint plugin chain, enable the rule for `app/**/actions/**`.

### Work unit 3 — First business module: Producto (B)

**File layout** (full ADR-013 layering):
```
app/src/modules/producto/
  domain/
    producto.ts                    # Producto entity, TasaItbis enum, ProductoItbis
    calcular-itbis.ts              # pure ITBIS calculation
    calcular-itbis.test.ts         # unit tests with DGII fixtures
    errors.ts                      # typed domain errors (CodigoProductoDuplicado, TasaItbisInvalida, etc.)
  application/
    crear-producto.ts              # use case: validates uniqueness + persists
    listar-productos.ts            # use case: paginated query with select
    crear-producto.test.ts         # unit tests (mock repo)
    listar-productos.test.ts       # unit tests (mock repo)
  infrastructure/
    producto-repository.ts         # Prisma access ONLY here; wraps in withTenantTransaction
  http/
    validations.ts                 # zod schemas for input (zCrearProductoInput, zListarProductosQuery)
    actions.ts                     # Server Actions: thin adapters, wrap in withTenantTransaction
```

**Entity shape** (from research):
```ts
// producto.ts
export type TasaItbis = '0' | '16' | '18' // frozen enum, DGII 2026 vigente

export interface ProductoItbis {
  readonly tasa: TasaItbis
  readonly vigenteDesde: Date
  readonly vigenteHasta: Date | null  // null = current open-ended
  readonly aplicaRetencionITBIS: boolean  // Norma 02-05
}

export interface Producto {
  readonly id: string
  readonly empresaId: string
  readonly codigo: string
  readonly descripcion: string
  readonly precioBase: Decimal
  readonly itbis: ProductoItbis
  readonly exento: boolean  // derived: tasa === '0'
}
```

**Pure ITBIS calculation** (from research):
```ts
// calcular-itbis.ts
export function calcularItbisProducto(
  producto: Producto,
  cantidad: Decimal
): { baseImponible: Decimal; itbis: Decimal; total: Decimal }
```

**Migration**: `app/prisma/migrations/<timestamp>_add_itbis_validity_to_producto/migration.sql`
- Adds `itbisVigenteDesde DateTime NOT NULL`, `itbisVigenteHasta DateTime NULL`, `itbisAplicaRetencionITBIS Boolean NOT NULL DEFAULT false` to `Producto`
- Adds partial index for active products filtered by ITBIS vigencia

**Use cases** (application layer):
- `crearProducto(ctx, input)` → validates uniqueness, opens `withTenantTransaction(ctx, async (tx) => { ... })`, persists
- `listarProductos(ctx, query)` → opens `withTenantTransaction`, paginated Prisma query with `select` (no full include)

**Server Actions** (http layer):
- `crearProductoAction(input)` → zod parse → `crearProducto(ctxFromSession(), parsed)`
- `listarProductosAction(query)` → zod parse → `listarProductos(ctxFromSession(), parsed)`

**Tests** (per AGENTS.md priority: fiscal domain first):
- `calcular-itbis.test.ts` — DGII fixtures (laptop 18%, yogurt 16%, leche 0%, mixed cart, edge cases)
- `crear-producto.test.ts` — uniqueness, validation, error mapping
- `listar-productos.test.ts` — pagination, select-only, no N+1

### Work unit 4 — Cleanup (C + D)

**C — Synthetic email centralization**:
- New: `app/src/modules/auth/domain/synthetic-email.ts`
  ```ts
  export const SYNTHETIC_EMAIL_SUFFIX = '@users.systemfact.internal'
  export function buildSyntheticEmail(nombreUsuario: string): string
  export function decodeNombreUsuario(email: string): string  // throws on invalid
  ```
- Refactor: `auth/infrastructure/auth-service.ts` to import from `auth/domain`
- Refactor: `tenant/infrastructure/tenant-runtime.ts` to import from `auth/domain` (cross-module import — legitimate per research)

**D — Remove dead code**:
- `tenant/domain/tenant.ts`:
  - `TenantCtx.sucursalId: number` (was `number | null`)
  - Remove `scope: "company"` from `TenantFilter`
  - Remove dead branch `if (filter.sucursalId === null) { ... }` in `tenantFilter`
- `tenant/domain/tenant.test.ts`:
  - Update test cases that exercised the null branch (probe-set-local.ts test 3 was the only one)
- `scripts/probe-set-local.ts`:
  - Update test 3 to use `sucursalId: 1` (or similar non-null) since admin isolation is closed

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/tenant/infrastructure/` | New | `withTenantTransaction.ts` wrapper; `tenant-runtime.ts` refactored to import synthetic email |
| `app/src/modules/tenant/domain/` | Modified | `TenantCtx.sucursalId` non-null; `TenantFilter` loses company scope |
| `app/src/modules/auth/domain/` | New | `synthetic-email.ts` canonical home |
| `app/src/modules/auth/infrastructure/` | Modified | `auth-service.ts` imports synthetic email from domain |
| `app/src/modules/producto/` | New | Full ADR-013 module: domain/application/infrastructure/http |
| `app/tools/eslint-plugin-systemfact/` | New | Project-local ESLint plugin and rule |
| `app/tools/scripts/` | New | `verify-rls.ts` smoke test |
| `app/eslint.config.mjs` | Modified | Register custom plugin |
| `app/prisma/migrations/` | New | ITBIS validity columns on `Producto` |
| `app/docs/` | Modified | Add wrapper convention to engineering standards |
| `app/scripts/probe-set-local.ts` | Modified | Update test 3 for non-null `sucursalId` |

## Acceptance criteria

- [ ] `withTenantTransaction` exists, has integration test passing locally
- [ ] ESLint rule `server-action-must-wrap-tenant` is registered and active; CI fails on violation
- [ ] `tools/scripts/verify-rls.ts` exits 0 on local dev, exits non-zero if current_user has BYPASSRLS=true
- [ ] `auth/domain/synthetic-email.ts` exists; old duplications removed; auth-service tests pass
- [ ] `TenantCtx.sucursalId: number` (no null); tenant tests pass; probe-set-local test 3 updated
- [ ] `modules/producto/` has all 4 layers with at least 5 tests in domain/calcular-itbis.test.ts and 3+ tests in each application/ use case
- [ ] Migration for ITBIS validity columns applied locally
- [ ] `tsc --noEmit` passes; `pnpm test` passes
- [ ] At least one Server Action (Producto) demonstrated wrapping in `withTenantTransaction` and survives the ESLint rule
- [ ] AGENTS.md and docs/19-directivas_desarrollo.md updated with the wrapper convention

## Risks

| Severity | Risk | Mitigation in this change |
|---|---|---|
| CRITICAL | `setTenantContext` never called in production | WU1 (wrapper) + WU2 (lint rule) |
| HIGH | BYPASSRLS / table owner silent no-op | WU+ tool: `verify-rls.ts` smoke test |
| HIGH | Session-mode pool leaks GUCs | Documented in `withTenantTransaction` JSDoc; AGENTS.md addition; verified via `verify-rls.ts` reading pool mode from `DATABASE_URL` |
| HIGH | `USUARIO.sucursalId` null semantics drift | WU4 (D): remove null branch |
| MEDIUM | ITBIS rate historical changes | WU3: `vigenteDesde`/`vigenteHasta` columns + domain rule "stamp historical at confirm" |
| MEDIUM | 5s Prisma transaction timeout too tight | WU1: 10s default with per-use-case override |
| MEDIUM | Jest CJS/ESM gap | Out of scope — call out in `withTenantTransaction.test.ts` plan (use integration test pattern, not unit) |

## Rollback Plan

1. **Code rollback**: revert the PR/commit that introduced the change; `TenantCtx.sucursalId` and `TenantFilter` changes are type-only and reversible without migration.
2. **Database rollback**: if the ITBIS validity migration was applied, create a follow-up migration to drop `itbisVigenteDesde`, `itbisVigenteHasta`, and `itbisAplicaRetencionITBIS` columns only if no `Producto` rows reference them.
3. **ESLint rollback**: remove the plugin registration from `eslint.config.mjs` and delete `tools/eslint-plugin-systemfact/`.
4. **Safety net**: the wrapper is additive; removing it returns to the pre-Fase-1.2 state where production code did not call `setTenantContext`. No existing runtime behavior is broken by partial rollback.

## Dependencies

- Confirmed decisions: research + explore artifacts complete (Engram #513, #515, #516)
- Existing modules: `tenant/` (exemplar), `auth/` (will be refactored)
- Prisma schema: `Producto` model exists (`app/prisma/schema.prisma`)
- Supabase project: local dev setup verified (R1 closed)

## Spec phase handoff (what sdd-spec needs to produce)

For each work unit, sdd-spec must produce detailed requirements + scenarios:

1. **WU1**: `withTenantTransaction` — TypeScript signature, error contract, JSDoc examples, integration test scenarios (success, nested-tx-rejection, rollback-on-fail)
2. **WU2**: ESLint rule — false-positive analysis, JSDoc on the rule, sample violation messages, CI wiring steps
3. **WU3 (Producto)**: domain rules (ITBIS calculation edge cases, validity semantics), use case contracts (input/output types, error mapping), HTTP validation schemas, Server Action authorization matrix (only Admin/Operador can create; all roles can list with pagination), observability events (`producto.created`, `producto.listed`), test fixtures from DGII examples
4. **WU4**: synthetic-email refactor contract (no behavior change, only location); P6 dead-code removal contract (no API change; type narrowing only)

## Open questions for spec phase (NOT for user)

These are spec-phase concerns, NOT user clarifications — do not surface them as questions:

- Use case error mapping: should `crearProducto` throw or return typed Result? (recommendation: typed Result per AGENTS.md "Explicit errors")
- Server Action response shape: full `Producto` object or minimal `{ id, codigo }`? (recommendation: full object for create, paginated DTO for list)
- List query filter syntax: query params vs JSON body? (recommendation: query params for GET-style pagination, JSON body only for mutations)
- ESLint rule auto-fix feasibility: revisit after WU2 lands — likely "no" for v1

## Sources

(Engram cross-references — do not duplicate content here, reference the artifacts)

- Engram #510 — post-R1 audit findings
- Engram #513 — explore artifact (codebase analysis)
- Engram #515 — confirmed decisions
- Engram #516 — research artifact (25 external findings)
- `openspec/changes/foundational-patterns-fase-1-2/explore.md`
- `openspec/changes/foundational-patterns-fase-1-2/research.md`
- `app/AGENTS.md` (engineering constitution)
- `app/docs/12-decisiones_de_arquitectura.md` (ADR-013, ADR-019)
- `app/docs/19-directivas_desarrollo.md`
- `app/docs/20-Respreguntas_jefe_seguridad_auth.md` (P6)
