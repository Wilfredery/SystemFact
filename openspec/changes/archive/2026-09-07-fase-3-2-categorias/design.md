# Design: Categoria Module

## Technical Approach

Add `src/modules/categoria/` as a four-layer modular-monolith feature, mirroring the established Producto module. The domain remains pure; application use cases orchestrate validation, tenant-scoped repository calls, optimistic locking, reference guards, and transactional audit; infrastructure owns Prisma; HTTP actions remain thin adapters. The existing `Categoria` schema, RLS, partial active-name unique index, `version`, and `Producto.categoriaId` FK are reused. No migration or UI work is included.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Module boundary | Move `categoriaPerteneceAEmpresa` to `categoria/infrastructure/categoria-repository.ts`; Producto imports it | Leave the helper in Producto | The helper validates Categoria ownership; the move establishes the correct dependency without changing the product contract. |
| Lifecycle | Soft-delete with `activa=false`; no reactivation or hard delete | Delete rows or add reactivation | Preserves FK/history and follows the schema and strict proposal scope. The existing partial unique index releases active names. |
| Deactivation guard | Block only when active Productos reference the category | Rely on FK `P2003` or scan future references | The business rule is explicit and deterministic; FK behavior is not a user-facing guard. YAGNI keeps future references out of scope. |
| Authorization/audit | CRUD/list: `Administrador` + `Operador`; deactivate: `Administrador`; audit entity `Categoria`, actions `CREAR`, `ACTUALIZAR`, `CANCELAR` | Admin-only or enum extension | Matches Producto and frozen `AccionAuditoria`; no migration is justified. |

## Data Flow

```text
Server Action
  -> Zod parse -> Supabase session/TenantCtx
  -> withTenantTransaction (tenant GUCs first)
  -> tenant/company/branch role check
  -> Categoria use case
  -> Categoria repository + audit INSERT in same tx
  -> typed ActionResult
```

All repository reads and writes include `empresaId`; list queries are paginated (default 25, maximum 100), ordered by `nombre`, and default to active categories. `incluirInactivas` is explicit. Create/update use an application duplicate-name pre-check plus mapping of the partial unique constraint race. Update must pass the client-submitted `version` to `UPDATE ... WHERE id AND empresaId AND version`, bumping the version only on success.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/categoria/domain/categoria.ts` | Create | Pure `Categoria` entity and name validation. |
| `app/src/modules/categoria/domain/errors.ts` | Create | Stable category, authorization, session, pagination, and concurrency errors. |
| `app/src/modules/categoria/application/{crear,listar,actualizar,desactivar}-categoria.ts` | Create | Typed use cases; duplicate checks, partial update, optimistic lock, active-product guard, and audit orchestration. |
| `app/src/modules/categoria/infrastructure/categoria-repository.ts` | Create | Prisma selects/mappers, tenant filters, CRUD, ownership/reference helpers, role helper, and append-only audit helpers. |
| `app/src/modules/categoria/http/{actions,validations}.ts` | Create | Four Server Actions and Zod adapters following Producto’s session-before-wrapper convention. |
| `app/src/modules/categoria/**/` tests | Create | Four application suites and one action-adapter suite. |
| `app/src/modules/producto/{infrastructure/producto-repository.ts,application/*-producto.test.ts}` | Modify | Import `categoriaPerteneceAEmpresa` from Categoria; behavior remains unchanged. |

## Interfaces / Contracts

```typescript
type Categoria = {
  readonly id: number;
  readonly empresaId: number;
  readonly nombre: string;
  readonly activa: boolean;
  readonly version: number;
};

type CategoriaResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: CategoriaErrorCode; readonly message: string };
```

Create/update normalize and validate the name; update rejects empty patches and inactive rows. Deactivation returns `CATEGORIA_TIENE_PRODUCTOS` when any `Producto` with `activo=true` references it, and records `CANCELAR` only after the guarded update succeeds. Every successful mutation and listing audit is inside the same tenant transaction.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Domain | Entity/name validation and stable messages | Pure Jest tests. |
| Application | CRUD results, tenant ownership, duplicate TOCTOU mapping, pagination, stale version, inactive rows, active-product guard, audit ordering | Mock repository functions with Jest; assert client version is forwarded. |
| HTTP | Zod rejection, invalid session, role matrix, transaction wrapper, result mapping | Mock Supabase, tenant runtime, transaction, use cases; mirror Producto action tests. |
| Regression | Product create/edit category ownership after helper move | Update existing Producto mocks and run full `pnpm test`. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary is introduced. Server Actions are application adapters, not shell/process execution or route-selection logic.

## Migration / Rollout

No migration required. Schema, RLS, FK, `version`, and partial unique index already exist. Roll out as one feature-branch work unit; revert removes the module and restores Producto imports atomically.

## Open Questions

- None. Proposal decisions D1–D5 are ratified in scope.
