# Delta: tenant

**Change**: foundational-patterns-fase-1-2
**Modified capabilities**: tenant

## MODIFIED Requirements

### REQ-TEN-CTX-001-MOD: `TenantCtx.sucursalId` SHALL be `number` (no null)

- Previous: `number | null` (dead code per doc 20 P6 decision)
- Migration: callers that passed null MUST be updated to pass a real sucursalId

### REQ-TEN-CTX-002-REMOVED: `scope: "company"` filter value SHALL be removed from `TenantFilter`

- Previous: `scope` allowed `"company" | "sucursal"` values
- New: `scope` is removed entirely; `tenantFilter(ctx)` always filters by both empresaId and sucursalId

### REQ-TEN-FLT-001-REMOVED: The null-branch in `tenantFilter()` SHALL be removed

- Previous: dead branch `if (filter.sucursalId === null) { return { empresaId: ctx.empresaId } }`
- New: branch is removed; `tenantFilter` always returns both empresaId and sucursalId in the where clause

## ADDED Requirements

(None — this change only narrows types and removes dead code)

## REMOVED Requirements

(None beyond the modified/removed entries above)
