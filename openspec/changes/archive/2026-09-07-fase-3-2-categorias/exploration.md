# Exploration: fase-3-2-categorias

**Date**: 2026-09-07
**Change**: fase-3-2-categorias
**Status**: exploration complete

## Current State

### Categoria in the Schema

The `Categoria` model already exists in `app/prisma/schema.prisma` (line 353):

```prisma
model Categoria {
  id        Int      @id @default(autoincrement())
  empresaId Int
  nombre    String   @db.VarChar(255)
  activa    Boolean  @default(true)
  version   Int      @default(1)
  createdAt DateTime @default(now()) @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @db.Timestamptz(6)

  empresa   Empresa    @relation(fields: [empresaId], references: [id], onDelete: Restrict)
  productos Producto[]

  @@unique([empresaId, nombre])
  @@map("CATEGORIA")
}
```

Key characteristics already in place:
- **Multi-tenancy**: `empresaId` FK with `onDelete: Restrict`
- **Soft-delete**: `activa` (feminine — noted inconsistency vs `activo` in other tables, tracked as SUGGESTION S4 in doc 21)
- **Optimistic locking**: `version` column
- **Partial UK**: `categoria_empresaId_nombre_active_uk` on `(empresaId, nombre) WHERE activa=true` — deactivation releases the name
- **RLS**: Enabled and forced (`categoria_isolation` policy)
- **FK from Producto**: `Producto.categoriaId → Categoria.id` with `onDelete: Restrict`

### Existing References from Producto

The product module already consumes Categoria:
- `categoriaPerteneceAEmpresa(tx, empresaId, categoriaId)` — cross-tenant guard in `producto-repository.ts`
- `CATEGORIA_INVALIDA` error code in `producto/domain/errors.ts`
- Used in `crear-producto.ts` and `actualizar-producto.ts` to validate category ownership before product create/edit

### No Categoría Module Exists

There is no `src/modules/categoria/` directory. This is a brand-new module.

### Reference Pattern: Product Module

The product module is the canonical reference for all subsequent business modules:

| Layer | File | Pattern |
|-------|------|---------|
| **domain** | `producto.ts` | Pure entity interface (`Producto`), value objects (`ProductoItbis`), pure functions (`buildProductoItbis`, `esTasaItbisValida`) |
| **domain** | `errors.ts` | Stable error codes as `const` + `ProductoErrorCode` union + `messageFor()` + `ProductoDomainError` class |
| **application** | `crear-producto.ts` | Use case: validate → check DB constraints → delegate to repository → audit. Returns `Result` type |
| **application** | `listar-productos.ts` | Paginated listing with explicit `select`, stable ordering, audit event |
| **application** | `actualizar-producto.ts` | Partial update with optimistic locking, domain validation, category/code guards |
| **application** | `desactivar-producto.ts` | Soft-delete with explicit active-reference guard (not Prisma P2003), audit |
| **infrastructure** | `producto-repository.ts` | Prisma data access, `toDomainProducto`, `buildWhere`, role check, audit helpers |
| **http** | `actions.ts` | `"use server"`, zod parse → session → `withTenantTransaction` → role check → use case → map result |
| **http** | `validations.ts` | Zod schemas for create, list, update, deactivate inputs |

### Test Patterns

- **Application tests**: Mock repository functions, test use-case logic in isolation (e.g., `crear-producto.test.ts`)
- **Action tests**: Mock supabase client, tenant context, `withTenantTransaction`, and use cases; test the thin adapter layer (e.g., `actions.test.ts`)
- **Jest** with `jest.mock()` for infrastructure dependencies
- Tests follow REQ-XXX-N naming convention (e.g., `PROD-007-A`)

### Audit Pattern

- Append-only `MovimientoAuditoria` with `AccionAuditoria` enum
- Existing enum values: `CREAR`, `ACTUALIZAR`, `CANCELAR`, `ANULAR`, `PAGAR`, `AJUSTAR`, `LOGIN`, `LOGOUT`, `LEER`
- Product uses `CREAR` for creation, `ACTUALIZAR` for edits, and a custom deactivation event
- Category CRUD would map to `CREAR`, `ACTUALIZAR`, and deactivation (needs decision — see Open Decisions)

## Affected Areas

- `app/src/modules/categoria/` — **NEW**: entire module directory (domain, application, infrastructure, http)
- `app/src/modules/producto/infrastructure/producto-repository.ts` — `categoriaPerteneceAEmpresa` could migrate to categoria module (or stay as a cross-module reference)
- `app/src/modules/producto/domain/errors.ts` — `CATEGORIA_INVALIDA` may remain here as a cross-cutting concern or move
- `app/prisma/schema.prisma` — no changes needed (model already exists)
- `app/prisma/migrations/` — no schema changes needed; only new code

## Scope Comparison: Candidate vs Reality

### Candidate Scope (from user request)

| Feature | Candidate | ERD/Schema | Pattern Match | Notes |
|---------|-----------|------------|---------------|-------|
| CRUD categorías | Yes | Schema exists, no code | Follow product pattern | Straightforward |
| Soft-delete (`activa=false`) | Yes | `activa` column exists, partial UK in place | Same as product `activo` | Field is `activa` not `activo` |
| Authorization | Yes | Role matrix in AGENTS.md | `tieneRolPermitidoEnTx` | Need role decision |
| Multi-tenancy | Yes | `empresaId` FK + RLS | `withTenantTransaction` | Already enforced by DB |
| Pagination | Yes | — | `listarProductos` pattern | Default 25, max 100 |
| Audit | Yes | `MovimientoAuditoria` exists | `registrarProductoCreadoEnTx` pattern | Need entity name + action decision |
| Validation | Yes | `@@unique([empresaId, nombre])` | Zod schemas | DB constraint + app-level check |
| Product reference validation | Yes | `Producto.categoriaId → Categoria.id` with `onDelete: Restrict` | `categoriaPerteneceAEmpresa` already exists | Soft-delete guard needed |

### What's NOT in Scope (confirmed out)

- No hard delete
- No bulk operations
- No category reactivation flow
- No category hierarchy/nesting
- No migration (schema already complete)

## Open Decisions

### D1: Authorization Roles

**Question**: Which roles can CRUD categories vs. deactivate them?

**Options**:
- A: `["Administrador", "Operador"]` for CRUD, `["Administrador"]` for deactivation (mirrors product module exactly)
- B: `["Administrador"]` for all category operations (categories are configuration, not operational)

**Recommendation**: Option A — mirrors the established product pattern. Categories are part of operational setup; Operadores need to create/edit them during daily work. Deactivation is lifecycle-level, Admin-only.

### D2: Audit Entity Name and Action Enum

**Question**: What `entidad` string and `AccionAuditoria` values to use for category events?

**Options**:
- A: `entidad: "Categoria"`, reuse `CREAR`/`ACTUALIZAR` from existing enum, add new value for deactivation
- B: `entidad: "Categoria"`, reuse `CREAR`/`ACTUALIZAR`/`CANCELAR` (CANCELAR for deactivation)

**Recommendation**: Option B — `CANCELAR` already exists and semantically matches "deactivation" (no fiscal effect, same as product cancelada). No enum extension needed.

### D3: `categoriaPerteneceAEmpresa` Location

**Question**: Should the cross-tenant category validation function move from `producto-repository.ts` to the new `categoria-repository.ts`?

**Options**:
- A: Move to `categoria/infrastructure/categoria-repository.ts` — cleaner module boundary, product imports from categoria
- B: Leave in `producto-repository.ts` — avoids changing existing tested code

**Recommendation**: Option A — proper module boundary. The function validates Categoria ownership, not Producto. Moving it creates a clean dependency: `producto → categoria` (not a circular dependency). The existing product tests mock this function, so the move is transparent to them.

### D4: Deactivation Reference Guard

**Question**: Which references block category deactivation?

**Options**:
- A: Only count `Producto` rows where `activo=true` (or `activa=true` for Categoria) — matches product deactivation pattern
- B: Also count other potential future references

**Recommendation**: Option A — YAGNI. The only current FK reference is `Producto.categoriaId` with `onDelete: Restrict`. Guard against active products only. Future references will need their own guards when added.

### D5: Duplicate Name Validation

**Question**: Should the application layer explicitly check for duplicate `(empresaId, nombre)` before insert, or rely solely on the DB partial unique constraint?

**Options**:
- A: Explicit check + DB constraint (fast-path + TOCTOU guard, same as product `existeCodigoEnEmpresa`)
- B: DB constraint only

**Recommendation**: Option A — mirrors the product pattern. The explicit check provides a user-friendly error message; the DB constraint handles the race condition. The product module already established this two-layer pattern.

## Recommended Strict Scope

Based on the exploration, here is the **strict, reviewable scope** for `fase-3-2-categorias`:

### In Scope (8 files, ~350-400 lines)

1. **Domain** (`categoria/domain/`):
   - `categoria.ts` — `Categoria` entity interface (id, empresaId, nombre, activa, version)
   - `errors.ts` — Stable error codes: `NOMBRE_CATEGORIA_DUPLICADO`, `CATEGORIA_NO_ENCONTRADA`, `CATEGORIA_YA_INACTIVA`, `CATEGORIA_TIENE_PRODUCTOS`, `CONCURRENCIA_CONFLICTO`, `NO_AUTORIZADO`, `SESION_INVALIDA`, `VALIDATION_ERROR` + `CategoriaDomainError` class + `messageFor()`

2. **Application** (`categoria/application/`):
   - `crear-categoria.ts` — Create use case: validate nombre, check duplicate, insert, audit
   - `listar-categorias.ts` — Paginated list with optional `incluirInactivas` filter
   - `actualizar-categoria.ts` — Partial edit (nombre) with optimistic locking
   - `desactivar-categoria.ts` — Soft-delete with active-product guard, audit

3. **Infrastructure** (`categoria/infrastructure/`):
   - `categoria-repository.ts` — Prisma CRUD, `toDomainCategoria`, `buildWhere`, `existeNombreEnEmpresa`, `categoriaPerteneceAEmpresa` (moved from producto), `tieneProductosActivos`, audit helpers

4. **HTTP** (`categoria/http/`):
   - `actions.ts` — Server Actions: `crearCategoriaAction`, `listarCategoriasAction`, `actualizarCategoriaAction`, `desactivarCategoriaAction`
   - `validations.ts` — Zod schemas: `zCrearCategoriaInput`, `zListarCategoriasQuery`, `zActualizarCategoriaInput`, `zDesactivarCategoriaInput`

5. **Tests** (6 test files):
   - `application/crear-categoria.test.ts`
   - `application/listar-categorias.test.ts`
   - `application/actualizar-categoria.test.ts`
   - `application/desactivar-categoria.test.ts`
   - `http/actions.test.ts`
   - Update `producto/application/crear-producto.test.ts` and `actualizar-producto.test.ts` to reflect moved `categoriaPerteneceAEmpresa` import (if moved)

### Out of Scope (explicitly deferred)

- Category reactivation flow
- Bulk category operations
- Category hierarchy/nesting
- UI components (frontend is a separate phase)
- Moving `CATEGORIA_INVALIDA` error out of product module (cross-cutting, leave for now)

## Risks

1. **Module boundary refactoring**: Moving `categoriaPerteneceAEmpresa` changes import paths in product module. Mitigated by mocking in tests — import path change is transparent.
2. **`activa` vs `activo` inconsistency**: The Categoria model uses `activa` (feminine) while all other models use `activo`. This is a known cosmetic inconsistency (SUGGESTION S4 in doc 21). We follow the existing schema, not fix it in this phase.
3. **Partial UK race condition**: The partial unique index on `(empresaId, nombre) WHERE activa=true` allows duplicate names across active/inactive rows. Application-level check provides fast-path; DB constraint handles TOCTOU.
4. **Budget**: At ~350-400 lines for code + ~400 lines for tests, this is close to the 800-line review budget. The change is cohesive and follows established patterns, so review should be efficient.

## Ready for Proposal

**Yes** — all necessary context is available:
- Schema is complete (no migration needed)
- Pattern is established (product module)
- Authorization model is clear
- Test patterns are documented
- Open decisions have clear recommendations

The orchestrator should present the scope and open decisions (D1-D5) to the user for confirmation before proceeding to proposal.
