# Exploration: fase-3-4-inventario

**Date**: 2026-09-08
**Change**: fase-3-4-inventario
**Status**: exploration-complete

## Current State

### Schema (frozen ERD v4.7)
The Prisma schema already defines three inventory-related models:

- **`Inventario`** — stock per branch (`sucursalId`, `productoId`), `cantidad: Decimal(12,3)`, unique on `(sucursalId, productoId)`. This is the canonical stock record.
- **`MovimientoInventario`** — immutable audit trail of every stock change. References `inventarioId` (implies sucursal+product), optional FKs to `ventaId`, `compraId`, `notaCreditoId`. Fields: `tipoMovimiento`, `motivo`, `cantidadMovida`, `cantidadAnterior`, `cantidadNueva`, `usuarioId`, `fecha`.
- **`Producto.costoPromedio`** — `Decimal(12,2)`, updated when a purchase is received (doc `03` §6). Unique per product (enterprise-level, not per branch).
- **`Producto.precioCompra`** — `Decimal(12,2)`, stores last purchase price.

### Enums already defined
```
TipoMovimiento: ENTRADA_COMPRA, SALIDA_VENTA, ENTRADA_DEVOLUCION, SALIDA_MERMA, 
                AJUSTE, REPOSICION_CANCELACION, SALIDA_CANCELACION_COMPRA
TipoReposicion: VENDIBLE, DANADO
```

### No module exists yet
There is **no `src/modules/inventario/` directory**. The Prisma client types exist (generated), but zero application/domain/infrastructure code for inventory operations. The `Inventario` and `MovimientoInventario` models are referenced in generated Prisma code but never used in business logic.

### Existing modules that will consume inventory
- **Producto** (`src/modules/producto/`) — CRUD + listing, no inventory awareness yet.
- **Proveedor** (`src/modules/proveedor/`) — CRUD, no purchase flow yet.
- **Categoria** (`src/modules/categoria/`) — CRUD, independent.
- **Tenant** (`src/modules/tenant/`) — `withTenantTransaction` wrapper, `TenantCtx`.

### Patterns established (must follow)
- ADR-013 layering: `domain/` (pure TS), `application/` (use cases), `infrastructure/` (Prisma), `http/` (Server Actions).
- `withTenantTransaction(ctx, fn)` for all DB access. `PrismaTx` type from infrastructure.
- Domain errors: constants + union type + `DomainError` class (see `producto/domain/errors.ts`).
- Optimistic locking via `version` column (schema-level, enforced in update queries).
- Audit: append-only `MovimientoAuditoria` rows in same transaction.
- Money = `Decimal(12,2)`, quantities = `Decimal(12,3)`.
- Server Actions: thin adapters — validate input, build ctx, delegate to use case.

## Affected Areas

| Path | Why |
|------|-----|
| `app/src/modules/inventario/` (NEW) | Core inventory module — domain, application, infrastructure, http |
| `app/src/modules/producto/domain/producto.ts` | Domain entity may need `costoPromedio` exposure |
| `app/src/modules/producto/infrastructure/producto-repository.ts` | `crearProductoEnTx` sets `costoPromedio: 0` — stays as-is; update logic moves to inventario |
| `app/prisma/schema.prisma` | Schema already complete — no migration needed for core inventory |
| `openspec/specs/inventario/` (NEW) | Delta spec for inventory capabilities |
| `docs/03-reglasNegocioFact.md` §5/§6 | Business rules source of truth — already defined |

## Business Rules Summary (from `03` §5/§6)

1. **Stock per branch**: `Inventario` unique on `(sucursalId, productoId)`.
2. **Never edit inventory directly**: every change MUST produce a `MovimientoInventario` with `cantidadAnterior`, `cantidadMovida`, `cantidadNueva`.
3. **No negative stock**: sales are blocked when insufficient stock (no exceptions in V1).
4. **Movement types**: ENTRADA_COMPRA, SALIDA_VENTA, ENTRADA_DEVOLUCION, SALIDA_MERMA, AJUSTE, REPOSICION_CANCELACION, SALIDA_CANCELACION_COMPRA.
5. **Adjustments require motivo**: from a catalog (Dañado / Diferencia física / Error de registro — confirmed by business).
6. **Costo promedio**: updated when a purchase is RECIBIDA. Formula: weighted average across all receipts.
7. **Costo promedio unique per product** (enterprise-level, not per branch).
8. **Purchase receipt** (phase 4 dependency): `Compra.estado: RECIBIDA` triggers inventory entry + avg cost update.
9. **Sale confirmation** (phase 5 dependency): `Venta.estado: CONFIRMADA` triggers inventory exit.

## Approaches

### Approach 1: Standalone inventory module (independent of purchase/sale flows)

Build the inventory module as a self-contained capability that other modules (compras, ventas) call into.

| Aspect | Detail |
|--------|--------|
| **Pros** | Clean separation; inventory logic lives in one place; purchase/sale modules import and call inventory use cases; testable independently |
| **Cons** | Requires designing the inventory API contract before purchase/sale modules exist; risk of over-engineering the interface |
| **Effort** | Medium |

### Approach 2: Minimal inventory module + integration seams

Build only what's needed for standalone inventory operations (query stock, manual adjustments, movement history) and leave the purchase/sale integration points as clearly-defined interfaces (not yet wired).

| Aspect | Detail |
|--------|--------|
| **Pros** | Smaller scope; interfaces can be refined when purchase/sale modules arrive; follows YAGNI |
| **Cons** | May need rework when integrating with purchase/sale; seams must be designed well upfront |
| **Effort** | Low-Medium |

### Approach 3: Full inventory + purchase receipt integration

Build inventory AND the purchase-receipt flow (receive purchase → inventory entry + avg cost) in one change.

| Aspect | Detail |
|--------|--------|
| **Pros** | End-to-end testable for the most common flow; no orphaned inventory module |
| **Cons** | Blows up scope significantly; purchase module doesn't exist yet; conflates two roadmap phases |
| **Effort** | High |

## Recommendation

**Approach 2: Minimal inventory + integration seams.**

Rationale:
- The roadmap places inventory in Phase 3, purchases in Phase 4, and sales in Phase 5. Building purchase/sale integration now violates the phase boundary.
- The schema is already complete — no migration needed. The module can be built against existing Prisma types.
- Define clean interfaces (`InventoryService` with `entrada()`, `salida()`, `ajustar()`, `consultarStock()`) that the purchase and sale modules will call later.
- Focus the change on: (a) domain logic (stock math, avg cost, movement recording), (b) standalone Server Actions (query stock by branch, manual adjustments, movement history), (c) comprehensive domain tests.

## Open Decisions

| Decision | Options | Recommendation |
|----------|---------|----------------|
| Should `costoPromedio` be updated on AJUSTE? | Yes (revalúa) / No (solo entradas de compra) | **No** — only on purchase receipt per `03` §6 |
| Adjustment authorization | Admin only / Admin + Operator | **Admin + Operator** (consistent with product edit) |
| Stock query scope | Per branch / Cross-branch rollup | **Per branch** (primary); cross-branch as report in Phase 7 |
| Idempotency of movements | Dedup by (compraId+productoId+sucursalId) / Client-side guard | **Server-side**: if movement already exists for this compra+producto+sucursal, skip (prevents double-receipt) |
| `stockMinimo` alert | KPI in inventory query / Separate notification | **KPI in listing** (confirmed by business: `11` 2.2.3) |

## Dependencies

| Dependency | Status | Risk |
|------------|--------|------|
| **Producto module** | ✅ Exists — CRUD working | Low — inventory references `productoId` |
| **Proveedor module** | ✅ Exists — CRUD working | Low — purchase module will use it |
| **Tenant transaction** | ✅ Exists — `withTenantTransaction` | Low — standard pattern |
| **Compra module (Phase 4)** | ❌ Does not exist | Medium — inventory entry on purchase receipt is the primary trigger; module must define clear seams |
| **Venta module (Phase 5)** | ❌ Does not exist | Medium — inventory exit on sale confirmation; same seam approach |
| **NotaCredito module** | ❌ Does not exist | Low — ENTRADA_DEVOLUCION and REPOSICION_CANCELACION depend on it; can be added later |

## Sub-phase Recommendation

**Fase 3.4 SHOULD be divided into 2 sub-phases:**

### Sub-phase 3.4a: Core Inventory Domain + Stock Operations
- Domain entities: `Inventario`, `MovimientoInventario`, `TipoMovimiento` (pure TS)
- Domain functions: `calcularCostoPromedio()`, `aplicarMovimiento()`, `validarStockSuficiente()`
- Domain errors: `STOCK_INSUFICIENTE`, `MOVIMIENTO_DUPLICADO`, `AJUSTE_SIN_MOTIVO`, etc.
- Infrastructure: repository functions (get/create inventario, create movimiento, update cantidad)
- Application: `consultarStock()`, `realizarAjuste()`, `listarMovimientos()`
- HTTP: Server Actions for query + manual adjustment
- **Tests**: domain pure functions (no DB), infrastructure integration, HTTP actions
- **Scope boundary**: No purchase or sale integration yet

### Sub-phase 3.4b: Purchase Receipt Integration
- Application: `recibirCompra()` use case — iterates `DetalleCompra`, creates ENTRADA_COMPRA movements, updates `costoPromedio`
- Idempotency: dedup guard on (compraId, productoId, sucursalId)
- Domain: `recalcularCostoPromedio(costoActual, stockActual, cantidadNueva, costoUnitario)` pure function
- Infrastructure: wire into Compra state transition (PENDIENTE → RECIBIDA)
- **Tests**: purchase receipt → inventory + avg cost, idempotency, concurrent receipt
- **Scope boundary**: Sale integration deferred to Phase 5

**Why split?**
1. The review budget is 800 lines. Core inventory + purchase integration together would likely exceed it.
2. 3.4a is fully testable and deployable independently — users can query stock and make manual adjustments immediately.
3. 3.4b depends on the Compra module (Phase 4), which doesn't exist yet. Splitting lets 3.4a ship while 3.4b waits for Compra.
4. Each sub-phase has a clear start, finish, and verification gate.

## Risks

1. **Costo promedio formula**: Weighted average math must be precise with Decimals. Edge case: first receipt (stock=0) sets the initial avg cost. Subsequent receipts: `newAvg = ((currentStock * currentAvg) + (newQty * unitCost)) / (currentStock + newQty)`. Must handle zero-division.
2. **Race condition on stock debit**: Two concurrent sales for the same product+branch could both read sufficient stock and both debit, causing negative stock. Must use row-level locking or `UPDATE ... WHERE cantidad >= requested` inside the transaction.
3. **Movement atomicity**: `Inventario.cantidad` update + `MovimientoInventario` insert must be in the same transaction. A failure in either must roll back both.
4. **Cross-phase integration**: When Phase 4 (purchases) and Phase 5 (sales) arrive, they must call inventory seams correctly. Poor interface design now = rework later.
5. **Costo promedio on cancellation**: When a purchase is cancelled after receipt, the avg cost must be reversed. This is complex and should be explicitly scoped (or deferred).

## Ready for Proposal

**Yes.** The exploration is complete. The orchestrator should:
1. Present the sub-phase split recommendation to the user.
2. Confirm whether to proceed with 3.4a only, or both sub-phases.
3. If approved, launch `sdd-propose` for the confirmed scope.
