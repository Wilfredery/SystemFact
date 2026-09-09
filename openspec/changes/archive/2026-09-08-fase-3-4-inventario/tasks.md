# Tasks: Inventory Core (3.4a)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650–750 |
| 800-line budget risk | Medium |
| Chained PRs recommended | No (single cohesive module) |
| Suggested split | Single PR with size:exception |
| Delivery strategy | ask-on-risk |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
800-line budget risk: Medium

> Scope is a single new module (~7 production files + ~4 test files). Splitting into chained PRs would fragment cohesive domain/application/infrastructure boundaries and require migration-like coordination. A size-exception PR is the cleanest path. The change is purely additive — no schema, no data migration, full code-revert rollback.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full 3.4a inventory module | PR 1 (size:exception) | `pnpm test -- inventario` | N/A — no runtime harness; domain tests are DB-free, integration tests use Prisma test DB | Delete `app/src/modules/inventario/` — zero data rollback |

## Phase 1: Domain Foundation

- [x] 1.1 Create `app/src/modules/inventario/domain/errors.ts` — stable error codes: `CANTIDAD_INVALIDA`, `MOTIVO_VACIO`, `STOCK_INSUFICIENTE`, `INVENTARIO_NO_ENCONTRADO`, `NO_AUTORIZADO`, `LIMITE_PAGINACION_INVALIDO`, `PAGINA_INVALIDA`; `InventarioDomainError` class with code + messageFor() following producto pattern.
- [x] 1.2 Create `app/src/modules/inventario/domain/inventario.ts` — `INVENTORY_SOURCE` const, `InventorySource`, `InventoryMovementInput`, `InventoryMovementResult`, `InventoryEntryPort`, `InventoryExitPort` (typed seams); `StockKpi` type (`"normal" | "bajo_stock" | "agotado"`); `classifyStockKpi(cantidad, stockMinimo)` pure function; `validateAdjustmentQuantity(qty)` and `validateMotivo(motivo)` pure validators.

## Phase 2: Application Layer

- [x] 2.1 Create `app/src/modules/inventario/application/listar-inventario.ts` — `listarInventario(tx, ctx, query)` returning paginated stock with KPI; validates page/limit; delegates to repository; returns `ListarInventarioResult` typed result.
- [x] 2.2 Create `app/src/modules/inventario/application/ajustar-inventario.ts` — `ajustarInventario(tx, ctx, input)` orchestrates: validates motivo + quantity → delegates atomic adjustment to repository → returns `AjustarInventarioResult` with before/after quantities.

## Phase 3: Infrastructure

- [x] 3.1 Create `app/src/modules/inventario/infrastructure/inventario-repository.ts` — `listarInventarioEnTx(tx, ctx, query)` with `sucursal.empresaId` filter, paginated + ordered; `contarInventarioEnTx(tx, ctx, query)` for total; `ajustarStockEnTx(tx, ctx, input)` with `SELECT ... FOR UPDATE` on inventario row, non-negative guard, `UPDATE` quantity, append `MovimientoInventario` (tipo `AJUSTE`), append `MovimientoAuditoria` — all inside single tx. `obtenerInventarioPorProductoEnTx(tx, ctx, productoId)` for existence check.

## Phase 4: HTTP Adapters

- [x] 4.1 Create `app/src/modules/inventario/http/validations.ts` — Zod schemas: `paginationSchema` (page ≥ 1, limit 1–100); `ajustarInventarioSchema` (productoId, quantity as bounded decimal string, motivo non-empty).
- [x] 4.2 Create `app/src/modules/inventario/http/actions.ts` — `"use client"` Server Actions: `listarInventarioAction` (resolve tenant, role gate any, call use case); `ajustarInventarioAction` (resolve tenant, gate Administrador/Operador, wrap in `withTenantTransaction`, call use case).

## Phase 5: Testing

- [x] 5.1 Create `app/src/modules/inventario/domain/inventario.test.ts` — unit tests DB-free: classifyStockKpi returns correct KPI for normal/bajo/agotado; validateAdjustmentQuantity rejects non-numeric and negative strings; validateMotivo rejects empty; InventorySource seam type-checks.
- [x] 5.2 Create `app/src/modules/inventario/domain/errors.test.ts` — unit tests: all error codes produce stable messages; InventarioDomainError carries code.
- [x] 5.3 Create `app/src/modules/inventario/application/listar-inventario.test.ts` — integration test: paginated query returns correct total and KPI; page 0 and limit > 100 return validation error without DB write.
- [x] 5.4 Create `app/src/modules/inventario/application/ajustar-inventario.test.ts` — integration test: positive adjustment updates stock + appends movement + audit; missing motivo returns error without mutation; insufficient stock returns error; cross-tenant inventory ID returns not-found.
- [x] 5.5 Create `app/src/modules/inventario/http/actions.test.ts` — authorization tests: unauthorized role rejected; missing session rejected; adjustment wraps in withTenantTransaction.
