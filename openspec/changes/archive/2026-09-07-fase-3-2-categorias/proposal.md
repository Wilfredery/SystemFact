# Proposal: fase-3-2-categorias — Categoria Module

## Intent

Products need category management (`Producto.categoriaId` exists with no CRUD, authorization, audit, or deactivation guard). Deliver the complete Categoria module following the Producto pattern (ADR-013), closing Phase 3.2.

## Scope

### In Scope

- New module `src/modules/categoria/` (domain/application/infrastructure/http), mirroring `producto/`
- Domain: `Categoria` entity + stable error codes: `NOMBRE_CATEGORIA_DUPLICADO`, `CATEGORIA_NO_ENCONTRADA`, `CATEGORIA_YA_INACTIVA`, `CATEGORIA_TIENE_PRODUCTOS`, `CONCURRENCIA_CONFLICTO`, `NO_AUTORIZADO`, `SESION_INVALIDA`, `VALIDATION_ERROR`
- Application: crear, listar (paginated, `incluirInactivas`), actualizar (optimistic locking), desactivar (soft-delete)
- Infrastructure: `categoria-repository.ts` — CRUD, `existeNombreEnEmpresa`, `tieneProductosActivos`, audit helpers, and `categoriaPerteneceAEmpresa` moved from `producto-repository` (D3)
- HTTP: 4 Server Actions + Zod validations
- Tests: application suites per use case + actions suite; product tests updated for the moved import
- Audit: entidad `"Categoria"` reusing `CREAR`/`ACTUALIZAR`/`CANCELAR`; no enum extension (D2)

### Out of Scope

- Migrations — schema, RLS, and partial UK already exist
- Reactivation, bulk operations, hierarchy, hard delete, UI components
- Moving `CATEGORIA_INVALIDA` out of the product module
- External research (per confirmed handoff)

## Capabilities

> Contract for sdd-spec.

### New Capabilities

- `categoria`: tenant-scoped category CRUD — soft-delete, active-product deactivation guard, two-layer duplicate-name validation, paginated listing, transactional audit.

### Modified Capabilities

- None. The `categoriaPerteneceAEmpresa` relocation is implementation-level; `producto` spec (REQ-PROD-001..015) is unchanged — products only gain a new import source.

## Approach

Mirror `producto/` layer-for-layer. Actions: Zod parse → session ctx → `withTenantTransaction` → role check → use case → typed `Result`. Roles (D1): CRUD and listado = Administrador+Operador; desactivar = Administrador only. Duplicate names (D5): application pre-check for a friendly error + existing partial UK as TOCTOU guard. Deactivation (D4): blocked only by active products (`activo=true`); success releases the name and appends a `CANCELAR` audit row. Never rely on Prisma `P2003`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/categoria/**` | New | Full module: 4 layers + tests |
| `app/src/modules/producto/**` (repository, use cases, tests) | Modified | Helper relocation; import-path updates only |
| `app/prisma/**` | None | No schema or migration changes |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Import move breaks product tests | Low | Tests mock the function; path-only change |
| `activa` vs `activo` naming inconsistency | Low | Follow schema; tracked as SUGGESTION S4 |
| Partial-UK race on duplicate names | Low | Pre-check + DB constraint, two layers |
| ~750-800 estimated lines vs 400 initial budget | Medium | Cohesive unit; documented quality-first exception per preflight; within configured 800 |

## Rollback Plan

Feature-branch only: delete `feat/fase-3-2-categorias`; no migrations or data changes to unwind. Post-merge: `git revert` the single merge commit — product import changes revert atomically with the module (one commit = one work unit).

## Dependencies

- Existing infrastructure only: `withTenantTransaction`, role checks, audit helpers, Supabase session, Prisma `Categoria`, Zod.
- Branch `feat/fase-3-2-categorias` → PR to `master`.

## Success Criteria

- [ ] `pnpm test` green — new categoria suites and existing product suites
- [ ] Typed `Result` everywhere, stable error codes, zero `any`
- [ ] Every query filters `empresaId`; all writes inside `withTenantTransaction`
- [ ] Deactivation blocked by active products only; name reusable afterward
- [ ] Audit rows transactional and append-only; zero migrations; tenant-wrapper ESLint rule passes
