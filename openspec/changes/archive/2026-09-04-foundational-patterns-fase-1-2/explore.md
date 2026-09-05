# Explore: foundational-patterns-fase-1-2

## Context recap

Post-R1 audit (Engram #510) surfaced 4 foundational decisions that must be resolved BEFORE Fase 1.2 (first business module) lands. These decisions shape every Server Action and cross-cutting concern for the rest of the ERP.

| Severity | Finding | Status |
|---|---|---|
| CRITICAL | `setTenantContext(tx, ctx)` is NEVER called from production code. Only `probe-set-local.ts` invokes it. | **Decision A** |
| HIGH | `USUARIO.sucursalId` is `NOT NULL` in schema but `TenantCtx.sucursalId` typed `number | null` with dead code branch. | **Decision D** |
| MEDIUM | `SYNTHETIC_EMAIL_SUFFIX` duplicated in `auth-service.ts:15` AND `tenant-runtime.ts:29`. | **Decision C** |
| HIGH | Local postgres is SUPERUSER. `ALTER ROLE postgres NOBYPASSRLS` is NO-OP locally. | Not blocking, documented |

---

## Decision A — `withTenant(ctx, fn)` wrapper vs discipline manual

### Current state

**`setTenantContext(tx, ctx)`** is defined in `app/src/modules/tenant/infrastructure/tenant-runtime.ts:49-59`. It executes 4 `SET LOCAL` calls to configure Postgres session variables for RLS policies:

```typescript
// tenant-runtime.ts:49-59
export async function setTenantContext(
  tx: Prisma.TransactionClient,
  ctx: TenantCtx,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.current_empresa_id', ${ctx.empresaId.toString()}, true)`;
  if (ctx.sucursalId !== null) {
    await tx.$executeRaw`SELECT set_config('app.current_sucursal_id', ${ctx.sucursalId.toString()}, true)`;
  }
  await tx.$executeRaw`SELECT set_config('app.current_usuario_id', ${ctx.usuarioId.toString()}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_es_admin', ${ctx.esAdmin ? "true" : "false"}, true)`;
}
```

**Call sites today:**
- `app/scripts/probe-set-local.ts:63,103,117` — probe script only (NOT production code)
- `app/src/modules/tenant/infrastructure/tenant-runtime.ts:75` — docstring mentions it but doesn't call it

**No production code calls `setTenantContext`.** When Fase 1.2 lands, every Server Action must remember to call it manually — no enforcement, no wrapper.

**Related functions:**
- `setLoginFlow(tx)` — `tenant-runtime.ts:77-81` — special flag for login chicken-and-egg
- `getCurrentTenantContext(supabase)` — `tenant-runtime.ts:94-135` — resolves TenantCtx from session
- `tenantFilter(ctx)` — `domain/tenant.ts:100-111` — produces TenantFilter for app-layer queries
- `tenantWhere(filter)` — `infrastructure/tenant-where.ts:47-52` — translates TenantFilter to Prisma where

### Options analyzed

#### A1: Module-level wrapper `withTenant(ctx, fn)`

Each repository function in `infrastructure/repositories.ts` receives TenantCtx as first arg and calls `setTenantContext` internally:

```typescript
// infrastructure/product-repository.ts (hypothetical)
export async function findProducts(
  tx: Prisma.TransactionClient,
  ctx: TenantCtx,
  params: { page: number; limit: number },
) {
  await setTenantContext(tx, ctx);
  return tx.producto.findMany({
    where: tenantWhere(tenantFilter(ctx)),
    ...params,
  });
}
```

**Pros:**
- Explicit — every repo function shows it needs TenantCtx
- Follows existing pattern (`tenantWhere` already receives filter)
- Easy to test (pass mock ctx)

**Cons:**
- Repetitive — `setTenantContext` called on every repo function (4 `SET LOCAL` calls per function)
- No enforcement — a new repo function could forget to call it
- Blast radius: every new module's infrastructure layer must remember the pattern

**Effort:** Low (convention + lint rule)

#### A2: Prisma extension `$extends`

Create a Prisma extension that automatically calls `setTenantContext` before every query:

```typescript
// lib/prisma-tenant.ts (hypothetical)
export function createTenantClient(base: PrismaClient, ctx: TenantCtx) {
  return base.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        // This runs before every Prisma operation
        // But we need a transaction client, not the base client
        return query(args);
      },
    },
  });
}
```

**Problem:** Prisma `$extends` operates on the client level, not the transaction level. `setTenantContext` requires a `Prisma.TransactionClient` (from `$transaction`). The extension cannot intercept at the transaction level without significant workarounds.

**Alternative:** Use Prisma middleware (deprecated in Prisma 5+) or driver adapter hooks. Neither is clean with Prisma 7 + `@prisma/adapter-pg`.

**Pros:**
- Automatic — once wired, every query gets tenant context
- Zero developer discipline required

**Cons:**
- **Incompatible with Prisma 7 + driver adapter architecture** — `$extends` cannot intercept transaction-level operations
- Requires transaction client, not base client
- Adds complexity to Prisma client initialization
- Testing becomes harder (must mock extension behavior)

**Effort:** High (fighting Prisma internals)

#### A3: Keep discipline manual + lint rule

Each Server Action calls `setTenantContext(tx, ctx)` as first line inside `$transaction`. Add ESLint rule to detect missing calls.

```typescript
// http/actions.ts (hypothetical)
export async function createProduct(input: CreateProductInput) {
  const ctx = await getCurrentTenantContext(supabase);
  return prisma.$transaction(async (tx) => {
    await setTenantContext(tx, ctx); // Manual but enforced by lint
    return tx.producto.create({ data: input });
  });
}
```

**Pros:**
- Matches current architecture (ADR-013: thin adapters)
- No Prisma internals fighting
- Lint rule provides enforcement

**Cons:**
- Relies on discipline + lint rule coverage
- Lint rule may have false negatives (dynamic patterns)
- Every Server Action must remember the pattern

**Effort:** Low (convention + lint rule)

### Recommendation

**A1 (Module-level wrapper) + A3 (lint rule as safety net)**

Rationale:
1. **A2 is incompatible with Prisma 7 + driver adapter** — the transaction-level requirement makes `$extends` impractical
2. **A1 is explicit and testable** — every repo function shows its dependency on TenantCtx
3. **A3 provides defense in depth** — lint rule catches forgotten calls
4. **Pattern already exists** — `tenantWhere(tenantFilter(ctx))` is the app-layer pattern; `setTenantContext` is the DB-layer pattern

The wrapper pattern should be:
- Every `infrastructure/repositories.ts` function receives `tx` + `ctx` as first params
- First line inside every repo function: `await setTenantContext(tx, ctx)`
- ESLint rule: `no-raw-prisma-query` —禁止 direct `prisma.*` calls without tenant context

**Blast radius:** Every new module's infrastructure layer must follow this pattern. The existing `tenant/` module is the exemplar.

### Open questions for propose

1. Should `setTenantContext` be called once per `$transaction` or once per query? (Current implementation: once per transaction is sufficient — `SET LOCAL` persists for the transaction)
2. Should the lint rule be custom ESLint or a simpler `grep`-based check in CI?
3. What's the error handling strategy if `setTenantContext` fails mid-transaction?

---

## Decision B — Module layering (ADR-013)

### Current state

**ADR-013 mandates** (`docs/12-decisiones_de_arquitectura.md:364-403`):
```
src/modules/<domain>/
  domain/           # entidades, reglas de negocio, cálculos — TypeScript PURO
  application/      # casos de uso, orquestación
  infrastructure/   # Prisma, repositorios, servicios externos
  http/             # Server Actions / API Routes — adaptadores delgados
```

**Current module structures:**

1. **`tenant/`** (exemplar):
   - `domain/tenant.ts` — pure types + functions (TenantCtx, TenantFilter, buildTenantContext, tenantFilter)
   - `domain/tenant.test.ts` — 14 unit tests (pure, no DB)
   - `infrastructure/tenant-runtime.ts` — BD effects (setTenantContext, setLoginFlow, getCurrentTenantContext)
   - `infrastructure/tenant-where.ts` — Prisma translator (tenantWhere)
   - **No `application/` or `http/`** — tenant is infrastructure, not a business module

2. **`auth/`** (incomplete):
   - `domain/errors.ts` — pure error codes + messages
   - `infrastructure/auth-service.ts` — loginWithCredenciales, logout, getCurrentUser
   - `http/actions.ts` — Server Actions (login, logoutAction, getCurrentUserContext)
   - **No `application/`** — auth is cross-cutting, not a business module

**Key observations:**
- `domain/` is pure: `tenant.ts` imports nothing from Next.js, React, Prisma, Supabase
- `infrastructure/` handles Prisma + external services
- `http/` is thin adapter: validates input, delegates to service, returns result
- Zod schemas live in `http/actions.ts` (adapters layer)
- No `application/` layer exists yet in any module

### Options analyzed

#### B1: What belongs in `domain/` vs `application/`?

**Boundary test:** "Can this function be tested without a database AND without Next.js/React/Supabase?"

- **`domain/`**: Pure business rules, entities, value objects, state transitions
  - Example: `calcularITBIS(producto, cantidad)` — pure math
  - Example: `transitionVentaState(venta, action)` — state machine
  - Example: `TenantCtx`, `TenantFilter` — domain types

- **`application/`**: Orchestration, use cases, workflows
  - Example: `confirmarVenta(ventaId, ctx)` — coordinates: validate → check stock → assign NCF → update inventory → create movement
  - Example: `createUser(userData, ctx)` — coordinates: validate → check permissions → hash password → create in Supabase + Prisma

**Current evidence:**
- `auth-service.ts` mixes infrastructure (Supabase + Prisma) with orchestration (login flow)
- `tenant-runtime.ts` is pure infrastructure (Prisma + Supabase)
- No pure use cases exist yet

#### B2: Where should zod schemas live?

**Option 1: `http/` (adapters)** — current pattern in `auth/http/actions.ts:27-30`:
```typescript
const loginInputSchema = z.object({
  nombreUsuario: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(255),
});
```

**Option 2: `application/` (use case input)** — schema validates use case input, not HTTP input

**Recommendation:** `http/` for HTTP-specific validation (FormData, headers), `application/` for business input validation. The HTTP adapter extracts from FormData, validates shape, then delegates to use case which validates business rules.

#### B3: Where should Server Actions live?

**Current pattern:** `http/actions.ts` file per module (auth has single file)

**Alternative:** Split by intent (`login.ts`, `logout.ts`, `refresh.ts`)

**Recommendation:** Keep `actions.ts` per module until it exceeds ~200 lines. Auth has 3 actions (77 lines total). Splitting prematurely adds navigation overhead.

### Recommendation

**Follow `tenant/` as exemplar, create `application/` layer when first business module lands.**

For Fase 1.2 (first business module — likely `producto/` or `cliente/`):
1. `domain/` — pure entities + rules (Producto, Cliente, validation rules)
2. `application/` — use cases (crearProducto, actualizarStock, etc.)
3. `infrastructure/` — Prisma repos (producto-repository.ts)
4. `http/` — Server Actions (actions.ts)

**Zod schemas:** HTTP validation in `http/`, business validation in `application/`.

**Server Actions:** Single `actions.ts` per module until >200 lines.

### Open questions for propose

1. Which module lands first in Fase 1.2? (producto? cliente? This determines the exemplar)
2. Should `application/` use cases return typed results (Success/Error) or throw exceptions?
3. How do use cases receive their dependencies (repository interfaces, external services)?

---

## Decision C — Synthetic email centralization

### Current state

**Duplication sites:**

1. **`app/src/modules/auth/infrastructure/auth-service.ts:15`**:
   ```typescript
   export const SYNTHETIC_EMAIL_SUFFIX = "@users.systemfact.internal";
   
   export function buildSyntheticEmail(nombreUsuario: string): string {
     return `${nombreUsuario}${SYNTHETIC_EMAIL_SUFFIX}`;
   }
   ```

2. **`app/src/modules/tenant/infrastructure/tenant-runtime.ts:29`**:
   ```typescript
   const SYNTHETIC_EMAIL_SUFFIX = "@users.systemfact.internal";
   ```

**Decode logic duplication:**

1. **`auth-service.ts:121-125`**:
   ```typescript
   const email = user.email ?? "";
   if (!email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) return null;
   const nombreUsuario = email.slice(0, -SYNTHETIC_EMAIL_SUFFIX.length);
   ```

2. **`tenant-runtime.ts:102-104`**:
   ```typescript
   const email = user.email ?? "";
   if (!email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) return null;
   const nombreUsuario = email.slice(0, -SYNTHETIC_EMAIL_SUFFIX.length);
   ```

**Import graph:**
- `auth-service.ts` exports `SYNTHETIC_EMAIL_SUFFIX` and `buildSyntheticEmail`
- `tenant-runtime.ts` defines its own private `SYNTHETIC_EMAIL_SUFFIX`
- Both are in `infrastructure/` layer

### Options analyzed

#### C1: Canonical home in `auth/domain/synthetic-email.ts`

```typescript
// auth/domain/synthetic-email.ts (pure TS)
export const SYNTHETIC_EMAIL_SUFFIX = "@users.systemfact.internal";

export function buildSyntheticEmail(nombreUsuario: string): string {
  return `${nombreUsuario}${SYNTHETIC_EMAIL_SUFFIX}`;
}

export function decodeNombreUsuario(email: string): string | null {
  if (!email.endsWith(SYNTHETIC_EMAIL_SUFFIX)) return null;
  return email.slice(0, -SYNTHETIC_EMAIL_SUFFIX.length);
}
```

**Pros:**
- Pure TypeScript (no infra deps) — fits `domain/` mandate
- Single source of truth
- Both `auth/infrastructure` and `tenant/infrastructure` import from `auth/domain`
- Encode/decode are inverse operations — co-located

**Cons:**
- Cross-module dependency: `tenant/` imports from `auth/domain`
- Is this acceptable for a foundational primitive?

**Assessment:** Yes — synthetic email is an **auth domain concept** (ADR-014). The tenant module needs to decode it to resolve TenantCtx. This is a legitimate cross-module dependency on a foundational primitive, not a circular dependency.

#### C2: Move to shared `lib/synthetic-email.ts`

```typescript
// lib/synthetic-email.ts
export const SYNTHETIC_EMAIL_SUFFIX = "@users.systemfact.internal";
export function buildSyntheticEmail(nombreUsuario: string): string { ... }
export function decodeNombreUsuario(email: string): string | null { ... }
```

**Pros:**
- Avoids cross-module dependency
- Easy to import from anywhere

**Cons:**
- Violates ADR-013: `lib/` is for infrastructure concerns, not domain concepts
- Synthetic email IS a domain concept (ADR-014: "email sintético interno por usuario")
- Mixing domain concepts in `lib/` degrades module boundaries

#### C3: Keep duplication, add comment

**Pros:**
- No refactoring needed now

**Cons:**
- Two places to update if suffix changes
- Inconsistent API (one exports, one private)
- Decode logic duplicated

### Recommendation

**C1: Canonical home in `auth/domain/synthetic-email.ts`**

Rationale:
1. **Synthetic email is an auth domain concept** (ADR-014) — it belongs in `auth/domain/`
2. **Pure TypeScript** — no infra deps, testable without DB
3. **Cross-module dependency is legitimate** — tenant needs to decode auth's email format
4. **Single source of truth** — both encode and decode in one place

The import path would be:
```typescript
// tenant/infrastructure/tenant-runtime.ts
import { decodeNombreUsuario } from "@/modules/auth/domain/synthetic-email";

// auth/infrastructure/auth-service.ts
import { buildSyntheticEmail, decodeNombreUsuario } from "@/modules/auth/domain/synthetic-email";
```

### Open questions for propose

1. Should `decodeNombreUsuario` return `string | null` or throw on invalid email?
2. Should the suffix be configurable via env var (for testing/staging environments)?
3. Is the cross-module import `tenant → auth/domain` acceptable, or should we create a shared kernel?

---

## Decision D — `USUARIO.sucursalId` null semantics

### Current state

**Schema** (`app/prisma/schema.prisma:244`):
```prisma
model Usuario {
  id            Int      @id @default(autoincrement())
  empresaId     Int
  sucursalId    Int      // NOT NULL
  ...
}
```

**TypeScript type** (`app/src/modules/tenant/domain/tenant.ts:38-43`):
```typescript
export type TenantCtx = {
  readonly empresaId: number;
  readonly sucursalId: number | null;  // null when esAdmin && empresa-wide
  readonly usuarioId: number;
  readonly esAdmin: boolean;
};
```

**Docstring** (`tenant.ts:34-35`):
```
*   - `sucursalId` es `null` SOLO cuando `esAdmin === true` y el Administrador
*     opera a nivel de empresa (P6 de `docs/20-Respreguntas_jefe_seguridad_auth.md`).
```

**Dead code branch** (`tenant.ts:103-105`):
```typescript
if (ctx.sucursalId === null) {
  return { scope: "company", empresaId: ctx.empresaId };
}
```

**P6 decision** (`docs/20-Respreguntas_jefe_seguridad_auth.md:64-68`):
```
### P6. Alcance de acceso del Administrador
Un usuario **Administrador**, ¿puede ver y operar datos de **cualquier** empresa del sistema, o solo de su propia empresa?

- **A)** Solo su empresa — incluso el Administrador está aislado a su empresa/sucursal. **(Recomendado)**
```

**P6 status** (`docs/20-Respreguntas_jefe_seguridad_auth.md:93`):
```
| P6 | Alcance del Administrador | A (solo su empresa) | ✅ Decidido |
```

### Options analyzed

#### D1: Schema is correct, TypeScript `null` is dead code

**Evidence:**
- P6 decided: Admin is isolated to their empresa/sucursal (Option A)
- `USUARIO.sucursalId` is `NOT NULL` in schema
- `buildTenantContext` receives `sucursalId: number` (not nullable)
- `getCurrentTenantContext` reads `sucursalId: number` from Prisma query

**Implications:**
- Remove `number | null` from `TenantCtx.sucursalId` — make it `number`
- Remove `scope: "company"` from `TenantFilter` — only `scope: "branch"` exists
- Remove dead code branch in `tenantFilter()`
- Remove admin-wide logic from `setTenantContext` (line 54: `if (ctx.sucursalId !== null)`)
- Update probe-set-local.ts test 3 (admin-wide test becomes invalid)

**Cost:** Low — remove dead code, simplify types

#### D2: Schema should be `Int?` to support admin-empresa-wide

**Evidence:**
- `TenantCtx` docstring explicitly mentions admin-empresa-wide case
- `tenantFilter` has explicit `scope: "company"` branch
- `setTenantContext` has explicit null check for `sucursalId`
- Probe test 3 validates admin-wide behavior

**But:**
- P6 explicitly decided admin is isolated to their empresa/sucursal
- Schema is `NOT NULL` — no existing data has null `sucursalId`
- The `null` branch was designed for a future that was explicitly rejected

**Cost:** Medium — requires Prisma migration, data validation, test updates

### Recommendation

**D1: Schema is correct, TypeScript `null` is dead code**

Rationale:
1. **P6 explicitly decided** admin is isolated to their empresa/sucursal (Option A)
2. **Schema is `NOT NULL`** — no existing data has null `sucursalId`
3. **`buildTenantContext` receives `sucursalId: number`** — not nullable
4. **`getCurrentTenantContext` reads `sucursalId: number`** from Prisma — not nullable
5. **The `null` branch was designed for a future that was explicitly rejected**

The cleanup should:
1. Change `TenantCtx.sucursalId` from `number | null` to `number`
2. Remove `scope: "company"` from `TenantFilter` — only `scope: "branch"` exists
3. Remove dead code branch in `tenantFilter()` (lines 103-105)
4. Remove admin-wide logic from `setTenantContext` (line 54: `if (ctx.sucursalId !== null)`)
5. Update probe-set-local.ts test 3 (admin-wide test becomes: admin with branch works normally)
6. Update docstrings to remove admin-empresa-wide references

**If P6 decision is reversed in the future:** A schema migration to `Int?` is straightforward (single ALTER TABLE), but the decision was explicit and documented.

### Open questions for propose

1. Should we create a new migration to change schema, or is the current `NOT NULL` correct?
2. Should we add a lint rule to prevent `sucursalId: null` in TenantCtx construction?
3. How do we handle the probe test 3 update?

---

## Cross-cutting risks

### Jest CJS/ESM gap

**Current state** (`app/jest.config.js:34`):
```javascript
module: "commonjs",
```

**Problem:** Prisma client is ESM-only. Any infrastructure file importing Prisma will fail in Jest with CJS module system.

**Impact:** Cannot unit test `infrastructure/` files that import Prisma client. Only `domain/` tests work reliably.

**Mitigation:** 
- Domain tests (pure TS) work fine
- Integration tests need separate runner (not Jest) or Prisma client mock
- E2E tests (Playwright) bypass this issue

**Risk for Fase 1.2:** If Fase 1.2 requires infrastructure tests, this becomes a blocker.

### env.ts validation gaps

**Current state** (`app/src/lib/env.ts:17-22`):
```typescript
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});
```

**Missing:**
- `SUPABASE_SERVICE_ROLE_KEY` (for admin operations)
- `JWT_SECRET` (for token validation)
- No validation that `DATABASE_URL` uses non-superuser role (added recently)

**Risk:** Low — mitigated by `assertAppRoleUrl` for DATABASE_URL

### Migration file in git history

**Finding:** Hardcoded password `SF_App_2026` was in 3 places. Removed from current files. Migration file is in git history forever unless rewritten.

**Risk:** Low — passwords are hashed, not plaintext. The migration file contains the seed data setup, not actual user passwords.

---

## Evidence map

| File | Lines | What it informed |
|------|-------|------------------|
| `app/src/modules/tenant/domain/tenant.ts` | 1-111 | TenantCtx type, TenantFilter tagged union, buildTenantContext, tenantFilter |
| `app/src/modules/tenant/domain/tenant.test.ts` | 1-197 | Test style exemplar (14 unit tests, pure functions) |
| `app/src/modules/tenant/infrastructure/tenant-runtime.ts` | 1-146 | setTenantContext implementation, SYNTHETIC_EMAIL_SUFFIX duplication, getCurrentTenantContext |
| `app/src/modules/tenant/infrastructure/tenant-where.ts` | 1-52 | Prisma translator (tenantWhere) |
| `app/src/modules/auth/infrastructure/auth-service.ts` | 1-154 | SYNTHETIC_EMAIL_SUFFIX duplication, buildSyntheticEmail, loginWithCredenciales |
| `app/src/modules/auth/http/actions.ts` | 1-77 | Server Actions pattern (thin adapters), zod schema in http layer |
| `app/prisma/schema.prisma` | 241-274 | USUARIO.sucursalId is Int (NOT NULL) |
| `app/src/lib/env.ts` | 1-116 | Env validation, SUPERUSER_LIKE_ROLES check |
| `app/scripts/probe-set-local.ts` | 1-144 | ONLY caller of setTenantContext, admin-wide test |
| `app/AGENTS.md` | 1-96 | Engineering constitution (architecture, security, data integrity) |
| `docs/12-decisiones_de_arquitectura.md` | 364-403, 540-617 | ADR-013 (modular monolith), ADR-019 (defense in depth) |
| `docs/19-directivas_desarrollo.md` | 1-272 | Full engineering directives (canonical source) |
| `docs/20-Respreguntas_jefe_seguridad_auth.md` | 64-68, 93 | P6: Admin isolated to their empresa/sucursal (decided) |
| `docs/03-reglasNegocioFact.md` | 1-100 | Business rules reference |
| `openspec/config.yaml` | 1-25 | SDD config (hybrid persistence, language settings) |
| `app/.atl/skill-registry.md` | 1-81 | Skill index for future launches |

---

## Suggested sdd-propose next

### Concrete proposal steps

1. **Decision A (withTenant wrapper):**
   - Propose `setTenantContext` called once per `$transaction` in every infrastructure repo function
   - Propose ESLint rule `no-raw-prisma-query` as safety net
   - Escalate: Should we create a `withTenantTransaction(ctx, fn)` wrapper that handles `$transaction` + `setTenantContext` automatically?

2. **Decision B (module layering):**
   - Propose `domain/application/infrastructure/http` structure for first business module
   - Propose zod schemas in `http/` for HTTP validation, `application/` for business validation
   - Escalate: Which module lands first? (producto? cliente?)

3. **Decision C (synthetic email):**
   - Propose `auth/domain/synthetic-email.ts` as canonical home
   - Propose `buildSyntheticEmail` + `decodeNombreUsuario` as pure functions
   - Escalate: Should suffix be configurable via env var?

4. **Decision D (sucursalId null):**
   - Propose removing dead code: `TenantCtx.sucursalId: number` (not nullable)
   - Propose removing `scope: "company"` from TenantFilter
   - Escalate: Confirm P6 decision is final (admin isolated to their empresa/sucursal)

### Questions to escalate to user

1. **Decision A:** Should we create a `withTenantTransaction(ctx, fn)` wrapper, or keep the pattern explicit in each repo function?
2. **Decision B:** Which module lands first in Fase 1.2? This determines the exemplar for all future modules.
3. **Decision C:** Should the synthetic email suffix be configurable via env var for testing/staging?
4. **Decision D:** Is the P6 decision (admin isolated to their empresa/sucursal) final, or might it be revisited?

### Research offered

Set `research_offered: true` because the orchestrator will surface `sdd-research-calidad-precio` to the user before sdd-propose. The proposal phase benefits from source-backed evidence on:
- Prisma `$extends` patterns (to confirm A2 incompatibility)
- Multi-tenant wrapper patterns in Next.js + Prisma
- ESLint rule patterns for enforcement
