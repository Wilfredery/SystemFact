# Compra module — fase 4 core

Four-layer modular-monolith feature (`domain / application / infrastructure /
http`) implementing the draft-first purchase core: create and edit a
`BORRADOR` purchase with per-line frozen ITBIS, mixed 18/16/0 fiscal totals,
config-driven ISR/ITBIS retentions, a guarded `BORRADOR → PENDIENTE` confirm
that assigns the internal `CMP-%06d` correlativo, cancel, and paginated
tenant-scoped listing/detail. Since fase-3-4b it also performs the guarded
`PENDIENTE → RECIBIDA` **receipt** (CMP-RECEIVE), which enters stock, movements
and the company-wide average cost by DELEGATING to inventario (this module never
writes inventory or cost itself).

- **Domain is pure** (ADR-013): no Next.js / React / Prisma / Supabase imports.
  All money and quantities cross the boundary as `Decimal` strings.
- **Multi-tenancy**: every query pins `empresaId` (Compra's direct tenant
  anchor); `sucursalId` comes from the acting context. All DB work runs inside
  `withTenantTransaction`.
- **Access**: all Server Actions are Administrador-only, enforced server-side.

## State scope: `PENDIENTE → RECIBIDA` is reachable; `PAGADA` is not

Since fase-3-4b, `compra` exposes `BORRADOR → PENDIENTE → RECIBIDA` plus cancel
(`BORRADOR`/`PENDIENTE → CANCELADA`). The `RECIBIDA` state is reached ONLY
through the guarded receipt path below. The schema enum also carries `PAGADA`,
but **no use case, route or code path can reach it** — payments remain a frozen
later seam (confirm uses `PENDIENTE`, never the `CONFIRMADA` vocabulary used by
Ventas). Every persisted `EstadoCompra` value is mapped by an explicit total
mapper (`estadoCompraDesdeDb`): `RECIBIDA` maps; `PAGADA` fails loud; there is
no `as EstadoCompraCore` cast. Enforced by `domain/compra.ts` (`ESTADO_COMPRA`,
`transicionarRecibir`) and locked by `domain/compra.test.ts`.

## Receipt flow (CMP-RECEIVE)

`recibirCompraAction` (Admin-only) → Zod `{ id }` → one `withTenantTransaction`
→ `recibirCompra`:

1. **Branch guard**: `ctx.sucursalId` must equal the purchase's branch, else
   `COMPRA_SUCURSAL_INVALIDA` (zero writes; RLS independently hides other-branch
   rows as `COMPRA_NO_ENCONTRADA` — the guard is defense-in-depth).
2. **State guard**: only `PENDIENTE` is receivable; an already-`RECIBIDA`
   duplicate is reported as `CONCURRENCIA_CONFLICTO`, `BORRADOR`/`CANCELADA` as
   `TRANSICION_INVALIDA` (all zero writes).
3. **Idempotent guarded flip**: one
   `UPDATE ... SET estado='RECIBIDA' WHERE id AND empresaId AND estado='PENDIENTE'`
   with an affected-rows check; zero rows → `CONCURRENCIA_CONFLICTO` and NO
   inventory call. This is the concurrency/duplicate-click control (no `version`
   column — the `estado` predicate is the optimistic lock).
4. **Delegate stock/cost to inventario**: every persisted line is handed, once,
   to inventario's `registrarEntradasCompra` (application → application over the
   published `InventoryEntryPort` seam) — positive quantity at the session
   branch, one `ENTRADA_COMPRA` movement carrying `compraId`, and the
   company-wide `costoPromedio` update under a `PRODUCTO` row lock. **Compra
   never writes stock, movements or `costoPromedio` itself.** If inventario
   rejects, the whole transaction (including the flip) rolls back and the action
   surfaces the stable bridge code `INVENTARIO_ENTRADA_RECHAZADA` — no
   purchase is ever left `RECIBIDA` without its stock.
5. **Audit**: one append-only `Compra` audit row for the state change.

## Declared-but-unconsumed seams (later phases only)

These contracts exist so future phases can build WITHOUT changing this core.
Nothing here wires them to a caller:

| Seam | Purpose | Consumed by |
|---|---|---|
| `PAGADA` state / payments | Payable purchase states | Frozen — later payment phase (no →`PAGADA` path) |
| Cancel-of-`RECIBIDA` reversal (`SALIDA_CANCELACION_COMPRA` + cost re-adjust) | Undo a received purchase | Frozen — deferred follow-up change |
| Partial / per-line receipt | Receive some lines | Frozen — full receipt only (no per-line quantity column) |
| B11 NCF engine | Fiscal NCF for informal-supplier receipts | Frozen — later fiscal phase |

Confirm and cancel write **NO** `MovimientoInventario` and never touch
`Producto.costoPromedio`. Only the receipt path enters stock/cost, and it does so
by delegating to inventario — never by writing inventory directly from this
module.

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
