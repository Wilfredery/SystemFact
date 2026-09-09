# Proposal: Inventory Core — Stock, Adjustments & Movements (3.4a)

## Intent

The Prisma schema already models `Inventario` (per-branch stock) and `MovimientoInventario` (immutable movements), but no inventory module exists: stock is invisible and corrections unauditable. This ships the standalone inventory core (sub-phase 3.4a) with clean seams so purchase integration (3.4b) plugs in after the Compra module (Phase 4).

## Scope

### In Scope
- `src/modules/inventario/` module (domain/application/infrastructure/http) per ADR-013.
- Paginated per-branch stock query (default 25, max 100) with `stockMinimo` KPI indicator.
- Manual adjustments (Administrador + Operador) with mandatory `motivo`.
- Immutable append-only movement log with before/after quantities.
- Decoupled entry/exit seams: typed interfaces with no purchase/sale callers yet.
- Non-negative stock enforced in domain + row-locked persistence; stock update + movement insert atomic.
- Jest domain tests (no DB) + tenant-leak integration tests.

### Out of Scope
- Purchase receipts and `costoPromedio` updates (3.4b; needs Compra, Phase 4).
- Cost reversal on purchase cancellation (deferred with purchase integration).
- Sales/returns/transfers and `TipoReposicion` flows. No Prisma migration (schema complete).

## Capabilities

### New Capabilities
- `inventario`: branch-scoped stock query with minimum-stock KPI, adjustments with mandatory reason, immutable movement history, decoupled entry/exit seams.

### Modified Capabilities
None — `producto`, `auth`, `tenant` consumed unchanged.

## Approach

Exploration Approach 2: minimal standalone core + seams. Pure domain (stock math, non-negative invariant, adjustment/pagination validation, typed error codes per `producto` pattern). Application use cases invoked from thin Server Actions, all wrapped in `withTenantTransaction`. Infrastructure anchors `Inventario` via `sucursal` navigation (`where: { sucursal: { empresaId } }`) and `MovimientoInventario` via relation navigation; stock update uses verified/locked `UPDATE` to serialize concurrency; audit written in the same transaction. Seams stay minimal typed interfaces (YAGNI); 3.4b implements them without touching core.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/inventario/` | New | domain, application, infrastructure, http |
| `openspec/specs/inventario/` | New | capability spec (lives at archive) |
| `app/prisma/schema.prisma` | None | no migration needed |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Concurrent adjustment race (same product+branch) | Medium | Row-locked/verified update inside tenant tx |
| Cross-tenant leak on `MovimientoInventario` | Low | Relation filter + RLS integration tests |
| Seam drift vs. future purchase needs | Medium | Minimal interfaces; 3.4b evolves them |
| Adjustment without `motivo` (audit gap) | Low | Domain rejects empty reason |

## Rollback Plan

Single feature commit; no migrations, no data changes. Revert commit / delete module + change folder — zero data rollback cost.

## Dependencies

- `tenant` (`TenantCtx`, `withTenantTransaction`), `producto` (existence check), `auth` (server-side roles). No external research (confirmed).

## Success Criteria

- [ ] Per-branch stock queryable, paginated, with `stockMinimo` KPI indicator.
- [ ] Adjustment: Administrador/Operador + non-empty `motivo`, immutable movement, atomic.
- [ ] Stock never negative; concurrent adjustments serialize.
- [ ] Domain tests DB-free; tenant-leak tests pass.
- [ ] `costoPromedio` and purchase flows untouched.
