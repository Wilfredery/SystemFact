# Proposal: Edit & Deactivate Product (fase-3-1-producto)

## Intent

The `producto` spec explicitly defers "Full CRUD (update/delete)". Operators can create and list products but cannot correct prices, names, or ITBIS data, nor retire a product from the catalog. This change completes the module's core lifecycle with **partial edit guarded by optimistic locking** (`version` column) and **individual soft-deactivation** (`activo=false`), per AGENTS.md: master entities are never deleted.

## Scope

### In Scope
- `actualizarProducto` use case: partial update of editable fields (nombre, descripcion, precioVenta, ITBIS tasa/vigencia/retencion, codigo, categoria), guarded by `version`
- `desactivarProducto` use case: sets `activo=false`; releases `codigo` via the existing partial unique
- Two Server Actions + zod schemas; new error codes: `PRODUCTO_NO_ENCONTRADO`, `CONCURRENCIA_CONFLICTO`, `PRODUCTO_YA_INACTIVO`, `PRODUCTO_TIENE_MOVIMIENTOS`
- Audit events `producto.updated` (old/new values) and `producto.deactivated` written in-transaction
- Tests: application (both use cases) + http (both actions)

### Out of Scope
- Hard delete; bulk edit/deactivate; reactivate flow; category management
- Prisma migration — schema already has `version`, `activo`, partial unique on `(empresaId, codigo)`
- Refactoring `crear-producto.ts` to shared validation helpers (YAGNI)

## Capabilities

### New Capabilities
None — this change extends the existing `producto` capability only.

### Modified Capabilities
- `producto`: ADDED requirements — edit with optimistic locking, deactivate (soft-delete), their Server Actions, and audit events. Removes the "update/delete out of scope" note.

## Approach

**Approach 1 (exploration recommendation): two separate use cases**, matching the one-file-per-use-case pattern of `crear-producto.ts` / `listar-productos.ts`.

- **Edit**: domain input `Partial<Omit<Producto, 'id' | 'empresaId' | 'activo' | 'version'>>`; zod requires at least one field. Read current row (tenant-filtered), validate changed fields, then `UPDATE ... WHERE version = ?`; 0 rows affected → `CONCURRENCIA_CONFLICTO` (client refetches and retries). Codigo uniqueness checked only when codigo changes. Roles: Admin + Operador.
- **Deactivate**: `activo=false` inside `withTenantTransaction`; `PRODUCTO_YA_INACTIVO` no-op guard; Admin-only. **Nuance**: soft-delete never trips FK restrict, so the product-with-active-references guard must be an explicit business check mapped to `PRODUCTO_TIENE_MOVIMIENTOS` — not Prisma P2003 error mapping.
- Repository adds: `obtenerProductoPorId`, `actualizarProductoEnTx`, `desactivarProductoEnTx`, audit helpers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/producto/domain/errors.ts` | Modified | 4 new error codes + messages |
| `app/src/modules/producto/application/actualizar-producto.ts` | New | Edit use case |
| `app/src/modules/producto/application/desactivar-producto.ts` | New | Deactivate use case |
| `app/src/modules/producto/infrastructure/producto-repository.ts` | Modified | Fetch/update/deactivate + audit helpers |
| `app/src/modules/producto/http/actions.ts` | Modified | 2 new Server Actions |
| `app/src/modules/producto/http/validations.ts` | Modified | 2 new zod schemas |
| `app/src/modules/producto/**/*.test.ts` | New | Application + http tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Concurrent edits race | Medium | `version` + `UPDATE WHERE version = ?`; test the 0-rows path |
| Guard confusion (FK restrict never fires on soft-delete) | Low | Explicit reference check, documented above |
| Scope creep (bulk ops, shared-validation refactor) | Medium | Strict YAGNI; only edit + single deactivate |
| Budget: ~350 lines vs 400-line preflight budget | Low | Within budget; keep shared-validation refactor deferred |

## Rollback Plan

No migrations involved — pure code revert of the feature branch restores prior behavior. Deployed deactivations are reversible by setting `activo=true` (soft-delete is not destructive); append-only audit rows remain as record. If a defect ships in edit, actions can be reverted without data damage: partial updates only touch scalar columns inside transactions.

## Dependencies

- Existing: `withTenantTransaction`, `TenantCtx`, `ActionResult<T>`, `producto-repository.ts`, audit-log infrastructure, `Producto` model (already has `version`/`activo`)
- No new external dependencies

## Success Criteria

- [ ] `pnpm test` green: new application + http tests pass, existing suite unbroken
- [ ] Stale-version edit returns `CONCURRENCIA_CONFLICTO`; successful edit bumps `version`
- [ ] Deactivation sets `activo=false`; deactivated `codigo` becomes reusable; guard codes fire correctly
- [ ] Both audit events persisted in-transaction; all queries tenant-filtered
- [ ] Total authored diff within the 400-line preflight budget
