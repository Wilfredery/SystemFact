# Design: foundational-patterns-fase-1-2

## Section 1 — Architecture Overview

The change ships four work units that establish the foundational contract every future business module will follow.

- **WU4 (cleanup)** narrows `TenantCtx.sucursalId` to non-null and centralizes synthetic-email encoding in `auth/domain`. It removes dead code and has no runtime behavior change, so it lands first.
- **WU1 (wrapper)** introduces `withTenantTransaction`, the single place where a Prisma interactive transaction is opened and tenant GUCs are set with `set_config(..., true)`. It is the hard prerequisite for WU3.
- **WU2 (ESLint rule)** is independent of WU1 and WU3; it provides defense-in-depth so Server Actions cannot forget the wrapper.
- **WU3 (Producto)** validates the full ADR-013 layering on the most rule-heavy first module: pure ITBIS domain, use cases returning typed `Result`, Prisma access isolated in infrastructure, and thin Server Actions.

The implementation order is **WU4 → WU1 → (WU2 || WU3)**. WU4 must come first because it changes the `TenantCtx` shape that WU1's signature consumes. WU1 must precede WU3 because every Producto use case relies on the wrapper. WU2 is parallel-safe because it only inspects ASTs.

The critical-path risk is that `setTenantContext` is never called in production (Engram #510). The design mitigates it with three layers: a single mandatory wrapper (WU1), a custom ESLint rule that errors on unwrapped Server Actions (WU2), and a runtime smoke test that asserts the connection role is not `BYPASSRLS` and the pool is in transaction mode (WU1/WU2 supporting script).

## Section 2 — File-by-File Implementation Plan

### `app/src/modules/auth/domain/synthetic-email.ts`

**Action**: CREATE
**Work Unit**: WU4
**Specification source**: REQ-AUTH-SYN-001/002/003 from `specs/auth/changes.md`

**Purpose**: Single source of truth for synthetic email encode/decode (ADR-014).

```typescript
export const SYNTHETIC_EMAIL_SUFFIX = '@users.systemfact.internal';

export class InvalidSyntheticEmailError extends Error {}

export function buildSyntheticEmail(nombreUsuario: string): string;
export function decodeNombreUsuario(email: string): string; // throws InvalidSyntheticEmailError
```

**Dependencies**: none (pure TS).
**Imported by**: `auth/infrastructure/auth-service.ts`, `tenant/infrastructure/tenant-runtime.ts`.
**Tests**: `app/src/modules/auth/domain/synthetic-email.test.ts`.
**Migration impact**: none.

---

### `app/src/modules/auth/infrastructure/auth-service.ts`

**Action**: MODIFY
**Work Unit**: WU4
**Specification source**: REQ-AUTH-SYN-REMOVED-001 from `specs/auth/changes.md`

**Purpose**: Remove duplicated synthetic-email logic and import from `auth/domain`.

```typescript
// Removed:
// export const SYNTHETIC_EMAIL_SUFFIX = ...
// export function buildSyntheticEmail(...)
// Inline decode logic in getCurrentUser/loginWithCredenciales

// Added:
import {
  buildSyntheticEmail,
  decodeNombreUsuario,
} from "@/modules/auth/domain/synthetic-email";
```

**Dependencies**: imports from `auth/domain/synthetic-email`.
**Imported by**: `auth/http/actions.ts`.
**Tests**: existing auth-service tests updated; no new file.
**Migration impact**: none.

---

### `app/src/modules/tenant/infrastructure/tenant-runtime.ts`

**Action**: MODIFY
**Work Unit**: WU4
**Specification source**: REQ-AUTH-SYN-REMOVED-002, REQ-TEN-CTX-001-MOD from `specs/tenant/changes.md`

**Purpose**: Remove private `SYNTHETIC_EMAIL_SUFFIX` and inline decode; import from `auth/domain`; remove null branch in `setTenantContext`.

```typescript
// Removed:
// const SYNTHETIC_EMAIL_SUFFIX = ...
// if (ctx.sucursalId !== null) { ... }

// Added:
import { decodeNombreUsuario } from "@/modules/auth/domain/synthetic-email";

export async function setTenantContext(tx, ctx) {
  await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${String(ctx.empresaId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${String(ctx.sucursalId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_usuario_id', ${String(ctx.usuarioId)}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_es_admin', ${String(ctx.esAdmin)}, true)`;
}
```

**Dependencies**: imports from `auth/domain/synthetic-email`.
**Imported by**: `auth/infrastructure/auth-service.ts`, `tenant/infrastructure/withTenantTransaction.ts`.
**Tests**: `probe-set-local.ts` updated; integration tests.
**Migration impact**: none.

---

### `app/src/modules/tenant/domain/tenant.ts`

**Action**: MODIFY
**Work Unit**: WU4
**Specification source**: REQ-TEN-CTX-001-MOD, REQ-TEN-CTX-002-REMOVED, REQ-TEN-FLT-001-REMOVED from `specs/tenant/changes.md`

**Purpose**: Narrow types and remove dead P6 branch.

```typescript
export type TenantCtx = {
  readonly empresaId: number;
  readonly sucursalId: number; // was number | null
  readonly usuarioId: number;
  readonly esAdmin: boolean;
};

export type TenantFilter = {
  readonly scope: "branch"; // "company" removed
  readonly empresaId: number;
  readonly sucursalId: number;
};

export function tenantFilter(ctx: TenantCtx): TenantFilter {
  return { scope: "branch", empresaId: ctx.empresaId, sucursalId: ctx.sucursalId };
}
```

**Dependencies**: none.
**Imported by**: `tenant/infrastructure/*`, `producto/application/*`, `producto/http/*`.
**Tests**: `tenant.test.ts` updated.
**Migration impact**: none (type-only change).

---

### `app/src/modules/tenant/domain/tenant.test.ts`

**Action**: MODIFY
**Work Unit**: WU4
**Specification source**: REQ-TEN-FLT-001-REMOVED from `specs/tenant/changes.md`

**Purpose**: Remove tests for the deleted `scope: "company"` branch and null `sucursalId`.

**Dependencies**: `tenant/domain/tenant.ts`.
**Migration impact**: none.

---

### `app/scripts/probe-set-local.ts`

**Action**: MODIFY
**Work Unit**: WU4
**Specification source**: REQ-TEN-CTX-001-MOD from `specs/tenant/changes.md`

**Purpose**: Update Test 3 to use a non-null `sucursalId` (admin isolation now branch-scoped).

```typescript
const adminCtx: TenantCtx = {
  empresaId: 1,
  sucursalId: 1, // was null
  usuarioId: 100,
  esAdmin: true,
};
```

**Dependencies**: `tenant/domain/tenant.ts`, `tenant/infrastructure/tenant-runtime.ts`.
**Migration impact**: none.

---

### `app/src/modules/tenant/infrastructure/withTenantTransaction.ts`

**Action**: CREATE
**Work Unit**: WU1
**Specification source**: REQ-WTT-001..007 from `specs/tenant/with-tenant-transaction/spec.md`

**Purpose**: Single fail-fast wrapper that opens a Prisma transaction and sets tenant GUCs before business logic runs.

```typescript
export interface WithTenantTransactionOptions {
  readonly timeoutMs?: number;
}

export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export class NestedTenantTransactionError extends Error {}

/**
 * @throws NestedTenantTransactionError on nested calls
 */
export async function withTenantTransaction<T>(
  ctx: TenantCtx,
  fn: (tx: PrismaTx) => Promise<T>,
  options?: WithTenantTransactionOptions,
): Promise<T>;
```

**Dependencies**: `prisma` from `@/lib/prisma`, `TenantCtx` from `tenant/domain/tenant`, `setTenantContext` from `tenant/infrastructure/tenant-runtime`.
**Imported by**: `producto/infrastructure/producto-repository.ts`, `producto/application/*`, `producto/http/actions.ts`.
**Tests**: `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts` (integration).
**Migration impact**: none.

---

### `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts`

**Action**: CREATE
**Work Unit**: WU1
**Specification source**: REQ-WTT-007 from `specs/tenant/with-tenant-transaction/spec.md`

**Purpose**: Integration tests for happy path, rollback, nested rejection, and RLS filtering.

**Dependencies**: `withTenantTransaction`, local Postgres.
**Test command**: run outside Jest CJS (tsx or integration runner) due to Prisma ESM / ts-jest gap.
**Migration impact**: none.

---

### `app/scripts/verify-rls.ts`

**Action**: MODIFY
**Work Unit**: WU1
**Specification source**: REQ-WTT-007-C/D from `specs/tenant/with-tenant-transaction/spec.md`

**Purpose**: Add runtime smoke checks for `BYPASSRLS=false`, `current_user` not superuser/table owner, and transaction-mode pool.

```typescript
// Added checks:
// - SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
// - current_user NOT IN ('postgres', 'supabase_admin', table owner)
// - DATABASE_URL includes pgbouncer=true or port 6543
```

**Dependencies**: `prisma`, `serverEnv.DATABASE_URL`.
**Imported by**: package.json `rls:verify` script.
**Tests**: manual / CI smoke.
**Migration impact**: none.

---

### `tools/eslint-plugin-systemfact/package.json`

**Action**: CREATE
**Work Unit**: WU2
**Specification source**: REQ-LINT-001 from `specs/tools/eslint-plugin-systemfact/spec.md`

**Purpose**: Package manifest for the project-local ESLint plugin.

```json
{
  "name": "eslint-plugin-systemfact",
  "version": "0.1.0",
  "main": "./index.ts",
  "type": "module"
}
```

**Dependencies**: `@typescript-eslint/utils` (peer/dev).
**Migration impact**: none.

---

### `tools/eslint-plugin-systemfact/index.ts`

**Action**: CREATE
**Work Unit**: WU2
**Specification source**: REQ-LINT-001 from `specs/tools/eslint-plugin-systemfact/spec.md`

**Purpose**: Plugin entry exporting `server-action-must-wrap-tenant`.

```typescript
import { rule as serverActionMustWrapTenant } from './rules/server-action-must-wrap-tenant';

export default {
  rules: {
    'server-action-must-wrap-tenant': serverActionMustWrapTenant,
  },
};
```

**Dependencies**: `rules/server-action-must-wrap-tenant`.
**Imported by**: `app/eslint.config.mjs`.
**Migration impact**: none.

---

### `tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts`

**Action**: CREATE
**Work Unit**: WU2
**Specification source**: REQ-LINT-002/003/004 from `specs/tools/eslint-plugin-systemfact/spec.md`

**Purpose**: Custom rule that requires Server Actions to call `withTenantTransaction` as the first statement.

```typescript
import { ESLintUtils } from '@typescript-eslint/utils';

export const RULE_NAME = 'server-action-must-wrap-tenant';

export const rule = ESLintUtils.RuleCreator(
  (name) => `https://systemfact.dev/docs/eslint/${name}`
)({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Server Actions must wrap their body in withTenantTransaction(ctx, ...)',
    },
    messages: {
      missingTenantWrap:
        'Server Action "{{name}}" must call withTenantTransaction(ctx, async (tx) => {...}) as its first statement to enforce tenant isolation.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    // Inspect exported FunctionDeclaration in app/**/actions/*.ts
    // Check node.body.body[0] is ReturnStatement/AwaitExpression to withTenantTransaction
  },
});
```

**Dependencies**: `@typescript-eslint/utils`.
**Imported by**: `tools/eslint-plugin-systemfact/index.ts`.
**Tests**: `tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts`.
**Migration impact**: none.

---

### `tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts`

**Action**: CREATE
**Work Unit**: WU2
**Specification source**: REQ-LINT-006 from `specs/tools/eslint-plugin-systemfact/spec.md`

**Purpose**: RuleTester unit tests (3+ valid, 3+ invalid cases).

**Dependencies**: `rule`, `@typescript-eslint/rule-tester`.
**Test command**: `pnpm test tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts` (or Vitest/Jest depending on toolchain).
**Migration impact**: none.

---

### `app/eslint.config.mjs`

**Action**: MODIFY
**Work Unit**: WU2
**Specification source**: REQ-LINT-005 from `specs/tools/eslint-plugin-systemfact/spec.md`

**Purpose**: Register the local plugin and enable the rule for `app/**/actions/**`.

```javascript
import systemfact from './tools/eslint-plugin-systemfact/index.js';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { systemfact },
    rules: {
      'systemfact/server-action-must-wrap-tenant': 'error',
    },
    files: ['src/**/actions/**/*.ts', 'src/**/actions/**/*.tsx'],
  },
  globalIgnores([...]),
]);
```

**Dependencies**: local plugin.
**Migration impact**: none.

---

### `app/prisma/migrations/<timestamp>_add_itbis_validity_to_producto/migration.sql`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-009 from `specs/producto/spec.md`

**Purpose**: Add ITBIS validity and retention columns to `Producto`.

```sql
ALTER TABLE "PRODUCTO"
  ADD COLUMN "itbisVigenteDesde" TIMESTAMPTZ NOT NULL DEFAULT '2012-01-01 00:00:00+00',
  ADD COLUMN "itbisVigenteHasta" TIMESTAMPTZ NULL,
  ADD COLUMN "itbisAplicaRetencionITBIS" BOOLEAN NOT NULL DEFAULT false;

-- Down
ALTER TABLE "PRODUCTO"
  DROP COLUMN IF EXISTS "itbisVigenteDesde",
  DROP COLUMN IF EXISTS "itbisVigenteHasta",
  DROP COLUMN IF EXISTS "itbisAplicaRetencionITBIS";
```

**Migration impact**: backfills existing rows with `2012-01-01` and `false`; down migration drops columns (acceptable for pre-production data).

---

### `app/src/modules/producto/domain/producto.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-001/002/003 from `specs/producto/spec.md`

**Purpose**: Pure Producto entity and ITBIS value object.

```typescript
import type { Decimal } from '@prisma/client/runtime/library';

export type TasaItbis = '0' | '16' | '18';

export interface ProductoItbis {
  readonly tasa: TasaItbis;
  readonly vigenteDesde: Date;
  readonly vigenteHasta: Date | null;
  readonly aplicaRetencionITBIS: boolean;
}

export interface Producto {
  readonly id: number;
  readonly empresaId: number;
  readonly categoriaId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly precioVenta: Decimal;
  readonly itbis: ProductoItbis;
  readonly exento: boolean;
  readonly activo: boolean;
}
```

**Dependencies**: `Decimal` type only.
**Imported by**: `producto/domain/calcular-itbis.ts`, `producto/application/*`, `producto/infrastructure/*`, `producto/http/*`.
**Tests**: domain tests via `calcular-itbis.test.ts`.
**Migration impact**: none.

---

### `app/src/modules/producto/domain/errors.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-005 from `specs/producto/spec.md`

**Purpose**: Stable error codes for the Producto domain.

```typescript
export const CODIGO_PRODUCTO_DUPLICADO = 'CODIGO_PRODUCTO_DUPLICADO';
export const TASA_ITBIS_INVALIDA = 'TASA_ITBIS_INVALIDA';
export const PRECIO_BASE_INVALIDO = 'PRECIO_BASE_INVALIDO';
export const VIGENCIA_INVALIDA = 'VIGENCIA_INVALIDA';
export const LIMITE_PAGINACION_INVALIDO = 'LIMITE_PAGINACION_INVALIDO';
export const PAGINA_INVALIDA = 'PAGINA_INVALIDA';
export const CANTIDAD_INVALIDA = 'CANTIDAD_INVALIDA';

export type ProductoErrorCode = /* union of above */;

export class ProductoDomainError extends Error {
  readonly code: ProductoErrorCode;
  readonly details?: Record<string, unknown>;
}
```

**Dependencies**: none.
**Imported by**: `producto/domain/*`, `producto/application/*`, `producto/http/*`.
**Migration impact**: none.

---

### `app/src/modules/producto/domain/calcular-itbis.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-004 from `specs/producto/spec.md`

**Purpose**: Pure DGII-aligned ITBIS calculation.

```typescript
import { Decimal } from '@prisma/client/runtime/library';
import type { Producto } from './producto';

export interface ItbisLine {
  readonly baseImponible: Decimal;
  readonly itbis: Decimal;
  readonly total: Decimal;
}

export function calcularItbisProducto(
  producto: Producto,
  cantidad: Decimal,
): ItbisLine;
```

**Dependencies**: `producto/domain/producto.ts`, `Decimal`.
**Imported by**: `producto/application/*`, tests, future Venta/Compra modules.
**Tests**: `app/src/modules/producto/domain/calcular-itbis.test.ts`.
**Migration impact**: none.

---

### `app/src/modules/producto/domain/calcular-itbis.test.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-004 scenarios from `specs/producto/spec.md`

**Purpose**: Unit tests with DGII fixtures (laptop 18%, yogurt 16%, leche 0%, mixed cart, precision).

**Dependencies**: `calcular-itbis.ts`.
**Test command**: `pnpm test src/modules/producto/domain/calcular-itbis.test.ts`.
**Migration impact**: none.

---

### `app/src/modules/producto/infrastructure/producto-repository.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-005/006 from `specs/producto/spec.md`

**Purpose**: Sole Prisma access point for Producto.

```typescript
import type { PrismaTx } from '@/modules/tenant/infrastructure/withTenantTransaction';
import type { TenantCtx } from '@/modules/tenant/domain/tenant';
import type { Producto } from '../domain/producto';

export interface CrearProductoInput {
  readonly categoriaId: number;
  readonly codigo: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly precioVenta: Decimal;
  readonly itbisTasa: '0' | '16' | '18';
  readonly itbisVigenteDesde: Date;
  readonly itbisVigenteHasta: Date | null;
  readonly itbisAplicaRetencionITBIS: boolean;
}

export interface ListarProductosQuery {
  readonly page: number;
  readonly limit: number;
  readonly descripcion?: string;
  readonly incluirInactivos?: boolean;
}

export async function existeCodigoEnEmpresa(
  tx: PrismaTx,
  empresaId: number,
  codigo: string,
): Promise<boolean>;

export async function crearProductoEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  input: CrearProductoInput,
): Promise<Producto>;

export async function contarProductos(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarProductosQuery,
): Promise<number>;

export async function listarProductosEnTx(
  tx: PrismaTx,
  ctx: TenantCtx,
  query: ListarProductosQuery,
): Promise<Producto[]>;
```

**Dependencies**: `withTenantTransaction` types, `tenant/domain/tenant`, Prisma generated types.
**Imported by**: `producto/application/*`.
**Tests**: mocked in application unit tests; integration via `withTenantTransaction.test.ts`.
**Migration impact**: requires the `add_itbis_validity_to_producto` migration.

---

### `app/src/modules/producto/application/crear-producto.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-005 from `specs/producto/spec.md`

**Purpose**: Use case orchestrating product creation with validation and audit event.

```typescript
import { withTenantTransaction } from '@/modules/tenant/infrastructure/withTenantTransaction';
import type { TenantCtx } from '@/modules/tenant/domain/tenant';
import type { Producto } from '../domain/producto';
import type { CrearProductoInput } from '../infrastructure/producto-repository';

export type CrearProductoResult =
  | { ok: true; producto: Producto }
  | { ok: false; code: ProductoErrorCode; message: string };

export async function crearProducto(
  ctx: TenantCtx,
  input: CrearProductoInput,
): Promise<CrearProductoResult>;
```

**Dependencies**: `domain/*`, `infrastructure/producto-repository`, `tenant/*`.
**Imported by**: `producto/http/actions.ts`.
**Tests**: `app/src/modules/producto/application/crear-producto.test.ts`.
**Migration impact**: emits `producto.created` audit event.

---

### `app/src/modules/producto/application/listar-productos.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-006 from `specs/producto/spec.md`

**Purpose**: Paginated product listing use case.

```typescript
export interface ListarProductosOutput {
  readonly items: ProductoListItem[];
  readonly total: number;
  readonly page: number;
}

export type ListarProductosResult =
  | { ok: true; data: ListarProductosOutput }
  | { ok: false; code: ProductoErrorCode; message: string };

export async function listarProductos(
  ctx: TenantCtx,
  query: ListarProductosQuery,
): Promise<ListarProductosResult>;
```

**Dependencies**: `domain/*`, `infrastructure/producto-repository`, `tenant/*`.
**Imported by**: `producto/http/actions.ts`.
**Tests**: `app/src/modules/producto/application/listar-productos.test.ts`.
**Migration impact**: emits `producto.listed` audit event.

---

### `app/src/modules/producto/application/crear-producto.test.ts` and `listar-productos.test.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-005/006 scenarios from `specs/producto/spec.md`

**Purpose**: Unit tests for use cases using mocked repository functions.

**Test command**: `pnpm test src/modules/producto/application/crear-producto.test.ts`

---

### `app/src/modules/producto/http/validations.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-007/008 from `specs/producto/spec.md`

**Purpose**: Zod schemas for HTTP input/query validation.

```typescript
import { z } from 'zod';

export const zCrearProductoInput = z.object({
  categoriaId: z.number().int().positive(),
  codigo: z.string().trim().min(1).max(255),
  nombre: z.string().trim().min(1).max(255),
  descripcion: z.string().trim().max(255).optional(),
  precioVenta: z.string().regex(/^\d+(\.\d{1,2})?$/), // parsed to Decimal
  itbisTasa: z.enum(['0', '16', '18']),
  itbisVigenteDesde: z.coerce.date(),
  itbisVigenteHasta: z.coerce.date().nullable().optional(),
  itbisAplicaRetencionITBIS: z.boolean().default(false),
});

export const zListarProductosQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  descripcion: z.string().trim().optional(),
  incluirInactivos: z.coerce.boolean().default(false),
});
```

**Dependencies**: `zod`.
**Imported by**: `producto/http/actions.ts`.
**Migration impact**: none.

---

### `app/src/modules/producto/http/actions.ts`

**Action**: CREATE
**Work Unit**: WU3
**Specification source**: REQ-PROD-007/008 from `specs/producto/spec.md`

**Purpose**: Thin Server Action adapters that satisfy the ESLint rule.

```typescript
"use server";

import { withTenantTransaction } from '@/modules/tenant/infrastructure/withTenantTransaction';
import { getCurrentTenantContext } from '@/modules/tenant/infrastructure/tenant-runtime';
import { createClient } from '@/lib/supabase/client';
import { zCrearProductoInput, zListarProductosQuery } from './validations';
import { crearProducto, listarProductos } from '../application';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export async function crearProductoAction(input: unknown): Promise<ActionResult<{ id: number; codigo: string }>> {
  return withTenantTransaction(
    await buildCtxOrThrow(input), // helper reads session + checks role
    async (tx) => {
      const parsed = zCrearProductoInput.parse(input);
      const result = await crearProducto(ctx, parsed);
      // map to ActionResult
    },
  );
}

export async function listarProductosAction(query: unknown): Promise<ActionResult<...>> {
  return withTenantTransaction(await buildCtxOrThrow(query), async (tx) => {
    // ...
  });
}
```

**Dependencies**: `withTenantTransaction`, `tenant-runtime`, `application/*`, `validations.ts`, `zod`, `supabase/client`.
**Imported by**: UI pages/components.
**Tests**: ESLint rule verification + E2E.
**Migration impact**: none.

---

### `docs/19-directivas_desarrollo.md`

**Action**: MODIFY
**Work Unit**: WU1 / WU4
**Specification source**: proposal acceptance criteria

**Purpose**: Document the `withTenantTransaction` convention and synthetic-email canonical location.

**Migration impact**: documentation only.

---

### `docs/21-evaluacion_por_fases_prisma.md`

**Action**: MODIFY
**Work Unit**: WU3
**Specification source**: REQ-PROD-009 from `specs/producto/spec.md`

**Purpose**: Add note about the ITBIS validity migration and backfill rationale.

**Migration impact**: documentation only.

## Section 3 — Cross-Cutting Concerns

### 3.1 Multi-tenant isolation (defense in depth)

| Layer | Mechanism | Owner |
|---|---|---|
| 1 | `withTenantTransaction` sets GUCs first in every transaction | WU1 |
| 2 | Prisma `PrismaPg` driver adapter + transaction-mode pool | existing |
| 3 | Postgres RLS policies on 25 tables | existing |
| 4 | `scripts/verify-rls.ts` smoke test (BYPASSRLS, pool mode) | WU1 |
| 5 | ESLint rule `server-action-must-wrap-tenant` | WU2 |

Typical Server Action call sequence:

```
Client → Server Action (http/actions.ts)
       → ctx = await getCurrentTenantContext(supabase)
       → authorize(role)
       → return withTenantTransaction(ctx, async (tx) => {
             await tx.$executeRaw`SELECT set_config(...)`  // first
             return useCase(tx, parsedInput)
           })
       → ActionResult
```

### 3.2 Money & Decimal handling

- All monetary amounts use `prisma.Decimal` / `Decimal.js` via `@prisma/client/runtime/library`.
- Amounts: scale 2; quantities: scale 3 (ERD v4.7).
- ITBIS math: `base.mul(tasa).div(100)`; never implicit `number` arithmetic.
- Test fixtures use `new Decimal('50000')` (string constructor) to avoid float loss.

### 3.3 Error model

- Use cases return `Result<T, E>` where `E` carries `code`, `message`, and optional `details`.
- Server Actions return `ActionResult<T>`.
- HTTP status mapping: `400` validation/business, `401` unauthenticated, `403` forbidden, `500` unexpected (logged, not exposed).

### 3.4 Test strategy

| Priority | Layer | Focus |
|---|---|---|
| 1 | Domain | `calcular-itbis.test.ts` with DGII fixtures |
| 1 | Integration | `withTenantTransaction.test.ts` (success, rollback, nested, RLS) |
| 2 | Application | `crear-producto.test.ts`, `listar-productos.test.ts` (mocked repos) |
| 2 | Tooling | `server-action-must-wrap-tenant.test.ts` (RuleTester) |
| 3 | E2E | Playwright product create/list flow |

### 3.5 Observability (audit log)

- `producto.created`: append-only row with `empresaId`, `sucursalId`, `usuarioId`, `codigo`, `tasa`.
- `producto.listed`: append-only row with `count`.
- No UPDATE/DELETE on `MOVIMIENTO_AUDITORIA`.

### 3.6 Migration safety

- `itbisVigenteDesde` is `NOT NULL` with default `'2012-01-01'`.
- Existing rows backfilled in one `UPDATE` inside the migration.
- Down migration drops the three columns (acceptable: no production data yet).

## Section 4 — Module Boundaries (ADR-013)

```
modules/producto/
  domain/         # producto.ts, calcular-itbis.ts, errors.ts — pure TS
  application/    # crear-producto.ts, listar-productos.ts — orchestration
  infrastructure/ # producto-repository.ts — Prisma ONLY here
  http/           # validations.ts, actions.ts — thin adapters
```

Dependency rules:

- `domain/` → only other `domain/` modules.
- `application/` → `domain/` (same module) + repository interfaces/types.
- `infrastructure/` → Prisma client + `application/` interfaces.
- `http/` → zod, session helpers, `application/` use cases.

## Section 5 — Integration Contracts

### 5.1 `withTenantTransaction`

```typescript
export interface WithTenantTransactionOptions {
  readonly timeoutMs?: number; // default 10_000
}

export type PrismaTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export async function withTenantTransaction<T>(
  ctx: TenantCtx,
  fn: (tx: PrismaTx) => Promise<T>,
  options?: WithTenantTransactionOptions,
): Promise<T>;
```

### 5.2 `buildTenantContext`

```typescript
export function buildTenantContext(
  usuario: { id: number; empresaId: number; sucursalId: number },
  roles: readonly string[],
): TenantCtx; // sucursalId is now number
```

### 5.3 Synthetic email

```typescript
export const SYNTHETIC_EMAIL_SUFFIX: '@users.systemfact.internal';
export function buildSyntheticEmail(nombreUsuario: string): string;
export function decodeNombreUsuario(email: string): string; // throws InvalidSyntheticEmailError
```

## Section 6 — Implementation Sequence

1. **Phase 1: WU4 cleanup** (parallel-safe, no dependencies)
   - Create `auth/domain/synthetic-email.ts`.
   - Modify `auth/infrastructure/auth-service.ts`, `tenant/infrastructure/tenant-runtime.ts`, `tenant/domain/tenant.ts`, `tenant/domain/tenant.test.ts`, `scripts/probe-set-local.ts`.
   - *Why first*: pure refactor; smallest blast radius.

2. **Phase 2: WU1 wrapper**
   - Create `tenant/infrastructure/withTenantTransaction.ts` + `.test.ts`.
   - Modify `scripts/verify-rls.ts` to add BYPASSRLS/pool-mode checks.
   - *Why second*: hard prerequisite for WU3.

3. **Phase 3: WU2 ESLint rule** (parallel with Phase 4)
   - Create `tools/eslint-plugin-systemfact/*`.
   - Modify `eslint.config.mjs`.
   - *Why parallel*: AST-only; no runtime dependency.

4. **Phase 4: WU3 Producto module** (depends on WU1)
   - Create migration + module files.
   - Verify ESLint rule passes on `producto/http/actions.ts`.
   - *Why last*: largest WU; isolated to a new module.

## Section 7 — Test Plan

| File | Type | Coverage | Priority |
|---|---|---|---|
| `calcular-itbis.test.ts` | Unit | DGII fixtures (18%, 16%, 0%, mixed, precision) | 1 |
| `withTenantTransaction.test.ts` | Integration | success, rollback, nested rejection, RLS | 1 |
| `crear-producto.test.ts` | Unit (mock repo) | duplicate, invalid tasa, invalid vigencia | 2 |
| `listar-productos.test.ts` | Unit (mock repo) | pagination, filter, empty | 2 |
| `server-action-must-wrap-tenant.test.ts` | Unit (RuleTester) | 6+ positive/negative cases | 2 |
| `verify-rls.ts` | Smoke | BYPASSRLS, pool mode | 2 |
| `producto-flow.spec.ts` | E2E | login → create → list | 3 |

## Section 8 — Risk Mitigation Map

| Severity | Risk | Mitigation |
|---|---|---|
| CRITICAL | `setTenantContext` never called | WU1 wrapper + WU2 ESLint rule |
| HIGH | BYPASSRLS silent no-op | `verify-rls.ts` smoke test |
| HIGH | Session-mode pool leaks GUCs | assert `pgbouncer=true`/port 6543 in `verify-rls.ts`; JSDoc on wrapper |
| HIGH | `TenantCtx.sucursalId` drift | WU4 type narrowing |
| MEDIUM | ITBIS historical changes | `vigenteDesde`/`vigenteHasta` columns |
| MEDIUM | 5s Prisma tx timeout | 10s default, per-use-case override |
| MEDIUM | Jest CJS/ESM gap | integration tests run via `tsx`, not Jest |
| MEDIUM | ESLint rule v1 limited to FunctionDeclaration | documented limitation; arrow functions deferred |
| LOW | NOT NULL backfill | default `'2012-01-01'`; down migration available |

## Section 9 — Out of Scope Confirmation

This design does NOT touch:

- Cliente / Proveedor modules
- Venta / Compra / Cobros flows
- NCF sequence management
- Reportes / 607 / 608 generation
- Multi-currency
- Admin empresa-wide mode (P6 closed)

## Section 10 — Migration Plan

- **Dev**: apply migration first; verify backfill on local data; run `rls:verify`.
- **Staging**: full test suite + manual smoke of all four WUs.
- **Production**: 4 PRs aligned to phases; each independently revertible.
- **Rollback**: revert code PRs; if migration applied, run down migration to drop the three Producto columns.

## Section 11 — Open Questions for Tasks Phase

- Task granularity: per-file or per-WU?
- Commit structure: one commit per task or one per WU?
- Coordinate Phase 3 and Phase 4 in the same PR or chained PRs?
- Jest coverage thresholds to enforce?
- Audit-log helper location: shared `infrastructure/audit.ts` or per-module?
