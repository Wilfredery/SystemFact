# Tasks: Categoria Module (fase-3-2-categorias)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 750–800 |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR (size-exception) |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full Categoria module: domain + infra + application + HTTP + tests + producto helper relocation | PR 1 (size-exception) | `pnpm test -- --testPathPattern=categoria` then `pnpm test -- --testPathPattern=producto` | N/A — pure backend module; runtime verification is manual CRUD via Server Actions in future UI | Delete `src/modules/categoria/`; revert `src/modules/producto/` import paths |

## Phase 1: Domain Layer

- [x] 1.1 Create `app/src/modules/categoria/domain/errors.ts` — 8 error codes (`NOMBRE_CATEGORIA_DUPLICADO`, `CATEGORIA_NO_ENCONTRADA`, `CATEGORIA_YA_INACTIVA`, `CATEGORIA_TIENE_PRODUCTOS`, `CONCURRENCIA_CONFLICTO`, `NO_AUTORIZADO`, `SESION_INVALIDA`, `VALIDATION_ERROR`), `CategoriaErrorCode` union, `messageFor()`, `CategoriaDomainError` class. Mirror Producto pattern from `app/src/modules/producto/domain/errors.ts`.
- [x] 1.2 Create `app/src/modules/categoria/domain/categoria.ts` — Pure `Categoria` type (`id`, `empresaId`, `nombre`, `activa`, `version`) and `normalizeNombre()` helper (trim, collapse whitespace). No Prisma/Next.js imports.

## Phase 2: Infrastructure Layer

- [x] 2.1 Create `app/src/modules/categoria/infrastructure/categoria-repository.ts` — Prisma `select`/mapper functions: `categoriaByIdEnEmpresa`, `existeNombreEnEmpresa`, `crearCategoriaEnTx`, `actualizarCategoriaEnTx`, `desactivarCategoriaEnTx`, `listarCategoriasEnEmpresa`, `contarCategoriasEnEmpresa`, `tieneProductosActivos`, `tieneRolPermitidoEnTx`, `registrarAuditCategoriaEnTx`, and relocated `categoriaPerteneceAEmpresa`. All queries filter `empresaId`; all writes are transactional.
- [x] 2.2 RED: Write `app/src/modules/categoria/infrastructure/categoria-repository.test.ts` — mock Prisma client; test `categoriaByIdEnEmpresa` returns null for wrong tenant, `existeNombreEnEmpresa` returns true for active duplicate, `tieneProductosActivos` returns true when `Producto.activo=true` references category, `categoriaPerteneceAEmpresa` returns false for foreign tenant.

## Phase 3: Helper Relocation

- [x] 3.1 Move `categoriaPerteneceAEmpresa` out of `app/src/modules/producto/infrastructure/producto-repository.ts` — delete function and its Prisma import if no longer needed; keep all other Producto repository functions intact.
- [x] 3.2 Update imports in `app/src/modules/producto/application/crear-producto.ts` and `app/src/modules/producto/application/actualizar-producto.ts` — change `categoriaPerteneceAEmpresa` source from `../infrastructure/producto-repository` to `@/modules/categoria/infrastructure/categoria-repository`.
- [x] 3.3 Update mock paths in `app/src/modules/producto/application/crear-producto.test.ts` and `app/src/modules/producto/application/actualizar-producto.test.ts` — mock `@/modules/categoria/infrastructure/categoria-repository` instead of `../infrastructure/producto-repository` for `categoriaPerteneceAEmpresa`.

## Phase 4: Application Layer (TDD)

- [x] 4.1 RED: Create `app/src/modules/categoria/application/crear-categoria.test.ts` — mock repository; assert happy path returns `{ ok: true, data: { id, nombre, version: 1 } }` with audit INSERT; assert blank name → `VALIDATION_ERROR`; assert duplicate active name → `NOMBRE_CATEGORIA_DUPLICADO`.
- [x] 4.2 GREEN: Create `app/src/modules/categoria/application/crear-categoria.ts` — `crearCategoria(tx, ctx, input)`: validate name, pre-check duplicate, `crearCategoriaEnTx`, `registrarAuditCategoriaEnTx(CREAR)`, return typed `CategoriaResult`.
- [x] 4.3 RED: Create `app/src/modules/categoria/application/listar-categorias.test.ts` — assert pagination returns `items/total/page`; assert `limit > 100` → `VALIDATION_ERROR`; assert `incluirInactivas: false` excludes inactive rows.
- [x] 4.4 GREEN: Create `app/src/modules/categoria/application/listar-categorias.ts` — `listarCategorias(tx, ctx, query)`: validate pagination, query with tenant filter, ordered by `nombre`, default active-only.
- [x] 4.5 RED: Create `app/src/modules/categoria/application/actualizar-categoria.test.ts` — assert stale version → `CONCURRENCIA_CONFLICTO`; assert duplicate name → `NOMBRE_CATEGORIA_DUPLICADO`; assert edit on inactive row → error; assert audit row contains old/new values.
- [x] 4.6 GREEN: Create `app/src/modules/categoria/application/actualizar-categoria.ts` — `actualizarCategoria(tx, ctx, input)`: pre-check duplicate (if name changed), `UPDATE WHERE id AND empresaId AND version`, bump version, `registrarAuditCategoriaEnTx(ACTUALIZAR)`.
- [x] 4.7 RED: Create `app/src/modules/categoria/application/desactivar-categoria.test.ts` — assert active products → `CATEGORIA_TIENE_PRODUCTOS`; assert already inactive → `CATEGORIA_YA_INACTIVA`; assert successful deactivation appends `CANCELAR` audit; assert name reusable after deactivation.
- [x] 4.8 GREEN: Create `app/src/modules/categoria/application/desactivar-categoria.ts` — `desactivarCategoria(tx, ctx, input)`: guard `tieneProductosActivos`, check current `activa` state, `UPDATE activa=false`, `registrarAuditCategoriaEnTx(CANCELAR)`.

## Phase 5: HTTP Layer

- [x] 5.1 Create `app/src/modules/categoria/http/validations.ts` — Zod schemas: `zCrearCategoriaInput` (nombre: string trim 1-255), `zListarCategoriasQuery` (page, limit, incluirInactivas), `zActualizarCategoriaInput` (id, version, nombre optional), `zDesactivarCategoriaInput` (id). Mirror Producto validation pattern.
- [x] 5.2 Create `app/src/modules/categoria/http/actions.ts` — 4 Server Actions (`crearCategoriaAction`, `listarCategoriasAction`, `actualizarCategoriaAction`, `desactivarCategoriaAction`): Zod parse → session → `withTenantTransaction` → role check → use case → typed `ActionResult`. Roles CRUD/list: `["Administrador","Operador"]`; deactivate: `["Administrador"]`.
- [x] 5.3 RED: Create `app/src/modules/categoria/http/actions.test.ts` — mock Supabase session, tenant runtime, transaction wrapper, use cases, role helper; assert Zod rejection → `VALIDATION_ERROR`; assert invalid session → `SESION_INVALIDA`; assert forbidden role → `NO_AUTORIZADO`; assert use-case error forwarded; assert happy path returns mapped data.

## Phase 6: Regression Verification

- [x] 6.1 Run `pnpm test -- --testPathPattern=producto` — confirm all existing product tests pass after helper relocation (mock path change is the only behavioral diff).
- [x] 6.2 Run full `pnpm test` — confirm zero regressions across all modules; all new categoria suites green.
- [x] 6.3 Verify ESLint: `npx eslint app/src/modules/categoria/` — confirm server-action-must-wrap-tenant rule passes; zero `any` usage; strict TypeScript.
