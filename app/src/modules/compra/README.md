# Compra module — fase 4 core

Four-layer modular-monolith feature (`domain / application / infrastructure /
http`) implementing the draft-first purchase core: create and edit a
`BORRADOR` purchase with per-line frozen ITBIS, mixed 18/16/0 fiscal totals,
config-driven ISR/ITBIS retentions, a guarded `BORRADOR → PENDIENTE` confirm
that assigns the internal `CMP-%06d` correlativo, cancel, and paginated
tenant-scoped listing/detail.

- **Domain is pure** (ADR-013): no Next.js / React / Prisma / Supabase imports.
  All money and quantities cross the boundary as `Decimal` strings.
- **Multi-tenancy**: every query pins `empresaId` (Compra's direct tenant
  anchor); `sucursalId` comes from the acting context. All DB work runs inside
  `withTenantTransaction`.
- **Access**: all Server Actions are Administrador-only, enforced server-side.

## State scope: `PENDIENTE` is the frontier

`compra-core` deliberately exposes only `BORRADOR → PENDIENTE → CANCELADA`.
The schema enum also carries `RECIBIDA` and `PAGADA`, but **no use case, route
or code path in this module can reach them** — confirming a purchase uses
`PENDIENTE` (never the `CONFIRMADA` vocabulary used by Ventas). Enforced by
`domain/compra.ts` (`ESTADO_COMPRA`) and locked by
`domain/compra.test.ts`.

## Declared-but-unconsumed seams (later phases only)

These contracts exist so future phases can build WITHOUT changing this core.
Nothing here wires them to a caller:

| Seam | Purpose | Consumed by |
|---|---|---|
| `InventoryEntryPort` (`domain/compra.ts`) | Atomic "add stock + append movement" when a purchase is received | Fase 3.4b (receipt) |
| `INVENTORY_SOURCE.PURCHASE` (`domain/compra.ts`, mirrors the inventario seam) | Movement-origin vocabulary for purchase entries | Fase 3.4b |
| `MovimientoInventario.compraId` (schema) | FK linking a stock entry to its originating purchase | Fase 3.4b |
| B11 NCF engine | Fiscal NCF generation for informal-supplier receipts (deferred product decision) | Later fiscal phase |

Confirm and cancel write **NO** `MovimientoInventario` and never touch
`Producto.costoPromedio`. A purchase receipt is therefore an additive future
phase, not a change to this module.

## Operational prerequisite — retention configuration

Confirm reads retention rates from `ConfiguracionEmpresa` keys
`RET_ISR_15`, `RET_ISR_2`, `RET_ITBIS_100`, `RET_ITBIS_30` (percent form, active
and within their validity window). A rate that is **applicable** to a purchase's
`tipoCompra × supplier class` but **missing or invalid** blocks confirm with
`CONFIG_RETENCION_FALTANTE` — there is intentionally **no legal-default
fallback** (product decision). Before go-live each tenant that will confirm
retention-bearing purchases must have the applicable keys seeded. Formal
merchandise (`MERCANCIA` from a `FORMAL` supplier) requires no keys.

See `openspec/changes/fase-4-compra-core/` (proposal, spec, design) for the full
contract and the correlativo/retention design rationale.
