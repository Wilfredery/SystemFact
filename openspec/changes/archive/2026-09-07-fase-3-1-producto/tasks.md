# Tasks: Edit & Deactivate Product

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 280–320 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full change — errors, repository, use cases, actions, tests | Single PR | `pnpm test -- --testPathPattern=producto` | N/A — no UI or runtime scenario in scope | Pure code revert of the feature branch |

## Phase 1: Foundation — Errors & Repository

- [x] 1.1 Add error codes `PRODUCTO_NO_ENCONTRADO`, `CONCURRENCIA_CONFLICTO`, `PRODUCTO_YA_INACTIVO`, `PRODUCTO_TIENE_MOVIMIENTOS` to `app/src/modules/producto/domain/errors.ts` — extend `ProductoErrorCode` union and `MESSAGES` map
- [x] 1.2 Add `obtenerProductoPorId(tx, empresaId, id)` returning `ProductoRow | null` (tenant-filtered) to `app/src/modules/producto/infrastructure/producto-repository.ts`
- [x] 1.3 Add `actualizarProductoEnTx(tx, empresaId, id, version, data)` performing `UPDATE ... WHERE id=? AND empresaId=? AND version=?`, returning `{updated: boolean, newVersion: number}` — zero rows = conflict
- [x] 1.4 Add `desactivarProductoEnTx(tx, empresaId, id)` performing `UPDATE activo=false` returning `{deactivated: boolean}`
- [x] 1.5 Add `tieneMovimientosActivos(tx, empresaId, productoId)` querying `DetalleVenta` + `DetalleCompra` for active references — returns boolean
- [x] 1.6 Add `registrarProductoActualizadoEnTx(tx, ctx, productoId, oldVals, newVals)` audit helper (APPEND-ONLY, `AccionAuditoria.ACTUALIZAR`)
- [x] 1.7 Add `registrarProductoDesactivadoEnTx(tx, ctx, productoId)` audit helper (APPEND-ONLY, `AccionAuditoria.ELIMINAR`)
- [x] 1.8 Add zod schemas `zActualizarProductoInput` (id, version required; at least one editable field) and `zDesactivarProductoInput` (id required) to `app/src/modules/producto/http/validations.ts`

## Phase 2: Core Implementation — Use Cases

- [x] 2.1 RED: Write `app/src/modules/producto/application/actualizar-producto.test.ts` — tests: happy path (partial price edit, version bump), stale version → `CONCURRENCIA_CONFLICTO`, not found → `PRODUCTO_NO_ENCONTRADO`, duplicate code → `PRODUCTO_YA_DUPLICADO`, invalid ITBIS/price/vigencia, category cross-tenant
- [x] 2.2 GREEN: Create `app/src/modules/producto/application/actualizar-producto.ts` — domain validation, category/code checks, optimistic lock orchestration, audit call. Return `{ ok: true, producto } | { ok: false; code; message }`
- [x] 2.3 RED: Write `app/src/modules/producto/application/desactivar-producto.test.ts` — tests: happy path (activo=false, code reusable), already inactive → `PRODUCTO_YA_INACTIVO`, has movements → `PRODUCTO_TIENE_MOVIMIENTOS`, not found → `PRODUCTO_NO_ENCONTRADO`
- [x] 2.4 GREEN: Create `app/src/modules/producto/application/desactivar-producto.ts` — active-state/reference guards, soft-deactivation orchestration, audit call. Admin-only enforced at action layer

## Phase 3: Integration — Server Actions

- [x] 3.1 RED: Add test cases to `app/src/modules/producto/http/actions.test.ts` for `actualizarProductoAction` — PROD-011-A (happy), PROD-011-B (stale version), PROD-011-C (duplicate code), PROD-013-B (cross-tenant not found), PROD-015-A (invalid input), PROD-013-A (unauthorized role)
- [x] 3.2 GREEN: Add `actualizarProductoAction` to `app/src/modules/producto/http/actions.ts` — thin adapter: zod → tenant ctx → auth check (Admin + Operador) → `withTenantTransaction` → `actualizarProducto` → result
- [x] 3.3 RED: Add test cases to `app/src/modules/producto/http/actions.test.ts` for `desactivarProductoAction` — PROD-012-A (happy), PROD-012-B (has movements), PROD-013-A (Operador forbidden), repeated deactivation → `PRODUCTO_YA_INACTIVO`
- [x] 3.4 GREEN: Add `desactivarProductoAction` to `app/src/modules/producto/http/actions.ts` — thin adapter: zod → tenant ctx → auth check (Admin only) → `withTenantTransaction` → `desactivarProducto` → result

## Phase 4: Verification

- [x] 4.1 Run `pnpm test -- --testPathPattern=producto` — all new + existing tests green
- [x] 4.2 Verify audit events: confirm `producto.updated` and `producto.deactivated` tests assert append-only writes inside the transaction boundary
- [x] 4.3 Verify rollback: confirm failed mutations produce neither product change nor audit event (test: PROD-014-B)
