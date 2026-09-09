# Design: Inventory Core (3.4a)

## Technical Approach

Create `app/src/modules/inventario/` using the existing four-layer modular-monolith pattern. Domain code owns quantity validation, adjustment deltas, non-negative stock, KPI classification, pagination rules, and stable error codes. Application use cases orchestrate tenant-scoped queries and adjustments. Infrastructure uses Prisma through `PrismaTx`; HTTP adapters validate DTOs, resolve the tenant session, authorize `Administrador`/`Operador`, and run all database work inside `withTenantTransaction`.

The existing `Inventario`, `MovimientoInventario`, `Producto.stockMinimo`, and `MovimientoAuditoria` tables are sufficient. No Prisma migration is required. Purchase receipt, sales, returns, and `costoPromedio` remain untouched.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Branch isolation | Filter inventory through `sucursal.empresaId` and the current `sucursalId`; filter movements through their inventory relation. | Trusting `inventarioId` or adding `empresaId` to `Inventario`. | Matches the frozen schema and prevents cross-tenant disclosure without migration. |
| Concurrent mutation | In one transaction, ensure the zero row exists, lock the `(sucursalId, productoId)` row, apply a verified non-negative update, then insert movement and audit rows. | Read-then-write; optimistic version only. | A read-then-write race can create negative stock; row serialization makes before/after quantities authoritative. |
| Movement immutability | Expose creation only through the adjustment/movement repository; never update or delete movement rows. | Reconstructing history from current stock. | The movement record is the append-only operational history and carries before/after quantities. |
| Future integrations | Define typed entry and exit ports in the application layer, with source metadata and a movement result; ship no purchase/sale callers. | Generic `unknown` callbacks or coupling to Compra/Venta. | Gives 3.4b a stable seam while keeping 3.4a YAGNI-compliant and independently testable. |

## Data Flow

```text
Server Action → Zod DTO → tenant/session + role gate
             → withTenantTransaction
             → application use case
             → Prisma repository (tenant filter + row lock/update)
             → Inventario + MovimientoInventario + MovimientoAuditoria
```

Manual adjustment computes `delta` from direction and quantity. The repository obtains the locked current quantity, rejects an exit that would go below zero, updates stock, and appends one `AJUSTE` movement with `cantidadAnterior`, `cantidadMovida`, and `cantidadNueva`. The audit row records the actor, branch, entity, before/after values, and mandatory reason. All writes commit or roll back together.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/inventario/domain/inventario.ts` | Create | Pure quantity, adjustment, KPI, pagination, and typed port contracts; use `Decimal`-compatible string values at boundaries. |
| `app/src/modules/inventario/domain/errors.ts` | Create | Stable inventory error codes/messages, including invalid quantity/reason, insufficient stock, not found, unauthorized, and pagination errors. |
| `app/src/modules/inventario/application/listar-inventario.ts` | Create | Paginated branch stock query and `stockMinimo` KPI projection. |
| `app/src/modules/inventario/application/ajustar-inventario.ts` | Create | Orchestrates validation and atomic adjustment. |
| `app/src/modules/inventario/infrastructure/inventario-repository.ts` | Create | Tenant-safe inventory/product lookups, row creation/locking, verified update, movement append, audit append, and paginated queries. |
| `app/src/modules/inventario/http/validations.ts` | Create | Zod schemas for page/limit and adjustment input; quantity uses bounded decimal text. |
| `app/src/modules/inventario/http/actions.ts` | Create | Thin Server Actions for listing and adjustment, role checks, result mapping, and transaction boundary. |
| `app/src/modules/inventario/**/*.test.ts` | Create | Domain, application/repository contract, action authorization, and tenant-isolation tests. |
| `app/prisma/schema.prisma` | Unchanged | Existing inventory schema is reused; no migration. |

## Interfaces / Contracts

```typescript
const INVENTORY_SOURCE = {
  MANUAL: "manual",
  PURCHASE: "purchase",
  SALE: "sale",
  RETURN: "return",
} as const;

type InventorySource = (typeof INVENTORY_SOURCE)[keyof typeof INVENTORY_SOURCE];

interface InventoryMovementInput {
  readonly branchId: number;
  readonly productId: number;
  readonly quantity: string;
  readonly reason: string;
  readonly source: InventorySource;
}

interface InventoryMovementResult {
  readonly inventoryId: number;
  readonly previousQuantity: string;
  readonly newQuantity: string;
}

export interface InventoryEntryPort {
  applyEntry(input: InventoryMovementInput): Promise<InventoryMovementResult>;
}

export interface InventoryExitPort {
  applyExit(input: InventoryMovementInput): Promise<InventoryMovementResult>;
}
```

3.4a implements the manual adjustment path internally; `purchase` and `sale` values are reserved seam metadata only and have no callers yet.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Decimal quantity rules, mandatory reason, non-negative invariant, KPI states, pagination, port contracts | Jest, database-free pure domain tests. |
| Integration | Tenant/branch filtering, atomic movement and audit, concurrent exits, immutable history | Jest with Prisma test database; race tests prove one concurrent exit fails safely. |
| E2E | Authorized adjustment and stock listing; unauthorized role; low/out-of-stock indicators | Playwright only for the critical user journey. |

## Threat Matrix

`N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary is changed.` Server Actions are existing HTTP adapters, not a new routing or process boundary.

## Migration / Rollout

No migration required. Deploy as a standalone module; rollback is a code revert with no schema or data rollback.

## Open Questions

- [ ] Confirm the UI consumer that will render stock KPI labels; the backend contract is independent of presentation.
