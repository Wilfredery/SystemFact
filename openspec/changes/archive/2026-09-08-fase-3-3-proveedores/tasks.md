# Tasks: Proveedor Module (fase-3-3-proveedores)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1000–1100 |
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
| 1 | Full Proveedor module: domain + infra + application + HTTP + tests | PR 1 (size-exception) | `pnpm test -- --testPathPattern=proveedor` | N/A — pure backend module; runtime verification is manual CRUD via Server Actions in future UI | Delete `src/modules/proveedor/`; revert no existing files |

## Phase 1: Domain Layer

- [x] 1.1 Create `app/src/modules/proveedor/domain/errors.ts` — 9 error codes (`RNC_PROVEEDOR_DUPLICADO`, `RNC_FORMATO_INVALIDO`, `PROVEEDOR_NO_ENCONTRADO`, `PROVEEDOR_YA_INACTIVO`, `PROVEEDOR_TIENE_COMPRAS`, `CONCURRENCIA_CONFLICTO`, `NO_AUTORIZADO`, `SESION_INVALIDA`, `VALIDATION_ERROR`), `ProveedorErrorCode` union, `messageFor()`, `ProveedorDomainError` class. Mirror Categoria pattern from `app/src/modules/categoria/domain/errors.ts`.
- [x] 1.2 Create `app/src/modules/proveedor/domain/proveedor.ts` — Pure `Proveedor` type (`id`, `empresaId`, `nombre`, `contacto`, `telefono`, `rnc` nullable, `tipoProveedor`, `tipoPersona`, `activo`, `version`) and `normalizeRnc(rnc: string | null): string | null` (strip separators → digits-only, validate 9–11 digits, null passthrough). `as const` enums for `TipoProveedor` (FORMAL/INFORMAL) and `TipoPersona` (FISICA/JURIDICA). `ProveedorResult<T>` typed union. No Prisma/Next.js imports.

## Phase 2: Infrastructure Layer

- [x] 2.1 Create `app/src/modules/proveedor/infrastructure/proveedor-repository.ts` — Prisma `select`/mapper functions: `proveedorByIdEnEmpresa`, `existeRncEnEmpresa(tx, empresaId, rnc, excludeId?)` (skips null rnc, excludes self on edit), `tieneComprasNoCanceladas(tx, empresaId, proveedorId)` (Compra.estado != CANCELADA), `crearProveedorEnTx`, `actualizarProveedorEnTx` (optimistic lock: `UPDATE WHERE id AND empresaId AND version`), `listarProveedoresEnEmpresa` (paginated, buscar OR nombre/rnc, active-only default), `contarProveedoresEnEmpresa`, `desactivarProveedorEnTx` (UPDATE activo=false), `tieneRolPermitidoEnTx`, `registrarAuditProveedorEnTx`. All queries filter `empresaId`; all writes transactional.
- [x] 2.2 RED: Write `app/src/modules/proveedor/infrastructure/proveedor-repository.test.ts` — mock Prisma client; test `proveedorByIdEnEmpresa` returns null for wrong tenant; `existeRncEnEmpresa` returns true for active duplicate and false for null; `tieneComprasNoCanceladas` returns true when Compra.estado != CANCELADA; `registrarAuditProveedorEnTx` appends CREAR/ACTUALIZAR/CANCELAR.

## Phase 3: Application Layer (TDD)

- [x] 3.1 RED: Create `app/src/modules/proveedor/application/crear-proveedor.test.ts` — assert happy path returns `{ ok: true, data: { id, nombre, version: 1 } }` with audit INSERT; assert blank name → `VALIDATION_ERROR`; assert duplicate active RNC → `RNC_PROVEEDOR_DUPLICADO`; assert invalid RNC format → `RNC_FORMATO_INVALIDO`.
- [x] 3.2 GREEN: Create `app/src/modules/proveedor/application/crear-proveedor.ts` — `crearProveedor(tx, ctx, input)`: validate fields, normalize RNC, pre-check duplicate (skip null), `crearProveedorEnTx`, `registrarAuditProveedorEnTx(CREAR)`, return typed `ProveedorResult`.
- [x] 3.3 RED: Create `app/src/modules/proveedor/application/listar-proveedores.test.ts` — assert pagination returns `items/total/page`; assert `limit > 100` → `VALIDATION_ERROR`; assert `incluirInactivos: false` excludes inactive rows; assert `buscar` matches nombre or digits-only rnc.
- [x] 3.4 GREEN: Create `app/src/modules/proveedor/application/listar-proveedores.ts` — `listarProveedores(tx, ctx, query)`: validate pagination bounds, query with tenant filter, `buscar` OR filter over nombre/rnc, ordered by `nombre`, default active-only.
- [x] 3.5 RED: Create `app/src/modules/proveedor/application/actualizar-proveedor.test.ts` — assert stale version → `CONCURRENCIA_CONFLICTO`; assert duplicate RNC → `RNC_PROVEEDOR_DUPLICADO`; assert not found → `PROVEEDOR_NO_ENCONTRADO`; assert edit on inactive row → error; assert RNC null allowed; assert audit row contains old/new values.
- [x] 3.6 GREEN: Create `app/src/modules/proveedor/application/actualizar-proveedor.ts` — `actualizarProveedor(tx, ctx, input)`: normalize RNC, pre-check duplicate (skip null, exclude self), `UPDATE WHERE id AND empresaId AND version`, bump version, `registrarAuditProveedorEnTx(ACTUALIZAR)`.
- [x] 3.7 RED: Create `app/src/modules/proveedor/application/desactivar-proveedor.test.ts` — assert non-cancelled Compra → `PROVEEDOR_TIENE_COMPRAS`; assert already inactive → `PROVEEDOR_YA_INACTIVO`; assert successful deactivation appends `CANCELAR` audit; assert RNC reusable after deactivation.
- [x] 3.8 GREEN: Create `app/src/modules/proveedor/application/desactivar-proveedor.ts` — `desactivarProveedor(tx, ctx, input)`: guard `tieneComprasNoCanceladas`, check current `activo` state, `UPDATE activo=false`, `registrarAuditProveedorEnTx(CANCELAR)`.

## Phase 4: HTTP Layer

- [x] 4.1 Create `app/src/modules/proveedor/http/validations.ts` — Zod schemas: `zCrearProveedorInput` (nombre trim 1–255, rnc optional, tipoProveedor/tipoPersona enums), `zListarProveedoresQuery` (page, limit, buscar, incluirInactivos), `zActualizarProveedorInput` (id, version required; optional editable fields), `zDesactivarProveedorInput` (id). Mirror Categoria validation pattern.
- [x] 4.2 Create `app/src/modules/proveedor/http/actions.ts` — 4 Server Actions (`crearProveedorAction`, `listarProveedoresAction`, `actualizarProveedorAction`, `desactivarProveedorAction`): Zod parse → session → `withTenantTransaction` → role check → use case → typed `ActionResult`. Roles CRUD/list: `["Administrador","Operador"]`; deactivate: `["Administrador"]`.
- [x] 4.3 RED: Create `app/src/modules/proveedor/http/actions.test.ts` — mock Supabase session, tenant runtime, transaction wrapper, use cases, role helper; assert Zod rejection → `VALIDATION_ERROR`; assert invalid session → `SESION_INVALIDA`; assert forbidden role → `NO_AUTORIZADO`; assert use-case error forwarded; assert happy path returns mapped DTO.

## Phase 5: Regression & Final Verification

- [x] 5.1 Run `pnpm test -- --testPathPattern=proveedor` — confirm all 5 new test suites green.
- [x] 5.2 Run full `pnpm test` — confirm zero regressions across all existing modules.
- [x] 5.3 Verify ESLint: `npx eslint app/src/modules/proveedor/` — confirm server-action-must-wrap-tenant rule passes; zero `any` usage; strict TypeScript.
- [x] 5.4 Verify fiscal classification preservation: confirm `TipoProveedor` and `TipoPersona` enums frozen in domain, no loose strings in application/HTTP layers.
