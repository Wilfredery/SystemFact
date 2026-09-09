# Exploration: fase-3-4b-compra-inventario — Purchase Receipt (Compra → Inventario)

> SDD exploration artifact. Generated 2026-09-09 against merged master (PR #7 inventario 3.4a, PR #9 compra-core). No code was modified.

## Current State

### Compra module (fase-4-compra-core, merged)
- Four-layer module at `app/src/modules/compra/` (domain / application / infrastructure / http).
- Domain vocabulary is intentionally **3 states**: `ESTADO_COMPRA = { BORRADOR, PENDIENTE, CANCELADA }` (`domain/compra.ts`). `transicionarConfirmar` guards `BORRADOR → PENDIENTE`; cancel reaches `CANCELADA` only from `BORRADOR`/`PENDIENTE`.
- **`RECIBIDA` is NOT in the domain type — but the reserved seam is explicit**: `domain/compra.ts:200-241` declares "3.4b seams — DECLARED ONLY": `INVENTORY_SOURCE.PURCHASE`, `InventoryEntryInput`, `InventoryEntryPort`. The canonical spec freezes this: *"Requirement: 3.4b receipt/payment seams preserved — compra-core MUST NOT write inventory, `MovimientoInventario`, or `Producto.costoPromedio`, and MUST NOT expose any path to `RECIBIDA`/`PAGADA`."* This change is the one that legitimately opens that path.
- **No DB migration is needed for the state**: the frozen ERD v4.7 Prisma enum already has `EstadoCompra { BORRADOR, PENDIENTE, RECIBIDA, PAGADA, CANCELADA }` (`schema.prisma:75`).
- Gotcha: `leerCompraEnTx` casts `row.estado as EstadoCompraCore` (`compra-repository.ts:248`) — an unchecked cast that is truthful today only because nothing writes `RECIBIDA`. 3.4b must extend the domain enum and replace the cast with explicit mapping.
- `leerCompraEnTx` does **not** select `sucursalId`; the receipt flow needs the compra's branch (entries go to the branch of the compra, per scope item 2).
- Confirm pattern to mirror for receipt: recompute from stored lines, read config from `ConfiguracionEmpresa` in-tx, guarded `updateMany` on current state (idempotency), atomic `CMP-%06d` correlativo with the W-1 GUC-clear/restore precedent (`set_config(..., is_local=true)`), audit via `registrarAuditCompraEnTx`.
- All http actions are thin adapters: zod validate → resolve ctx → `withTenantTransaction` → `tieneRolPermitidoEnTx(["Administrador"])` → use case. Product decision 7 keeps compra Admin-only; receipt should follow.

### Inventario module (3.4a, merged)
- Stock is **per branch**: `INVENTARIO` with `@@unique([sucursalId, productoId])`, `cantidad Decimal(12,3)`.
- Mutation today goes through `ajustarStockEnTx` (`inventario-repository.ts:199-286`): tenant product-ownership guard → inventory-row upsert (zero row) → `SELECT ... FOR UPDATE` → non-negative invariant → update → append `MovimientoInventario` → append-only audit. It **hardcodes `TipoMovimiento.AJUSTE`**, uses signed `delta`, anchors the branch at `ctx.sucursalId`, and never touches `costoPromedio` (3.4a boundary, by design).
- The module already publishes the **typed 3.4b seams**: `InventoryEntryPort.applyEntry(InventoryMovementInput)` where the input carries `branchId` explicitly (the seam was designed for the entry to go to the *compra's* branch, not necessarily the session branch). `ajustarStockEnTx` is *not* directly reusable as-is for receipts (wrong movement type, no `compraId`, branch anchor, no cost math) — a new repository path is required, mirroring the locking discipline.
- RLS: `inventario_isolation` `USING` requires the row's branch to match `app.current_sucursal_id` whenever that GUC is non-empty (WITH CHECK is empresa-only). So writing a **different branch's** inventory row from a session bound to another branch will fail RLS unless the GUC is temporarily cleared (W-1 precedent) or the action is restricted to the session branch.

### Schema facts for receipt
- `PRODUCTO.costoPromedio Decimal(12,2)` — **one value per product per company** (not per branch); schema comment: *"único por producto (empresa); se actualiza al recibir compra (03, §6)"*.
- `MOVIMIENTO_INVENTARIO` already has `compraId Int?` (*"opcional: causa entrada"*) and `TipoMovimiento` includes `ENTRADA_COMPRA` **and** `SALIDA_CANCELACION_COMPRA` (cancel-reversal) — no enum changes needed.
- Line quantities arrive as `Decimal(12,3)` (`DETALLE_COMPRA.cantidad`), money as `Decimal(12,2)`; domain math uses `decimal.js` half-up rounding.

### Configuration seeding (prerequisite gap)
- `leerTasasRetencionEnTx` (`configuracion-repository.ts`) reads `RET_ISR_15`, `RET_ISR_2`, `RET_ITBIS_100`, `RET_ITBIS_30` from `ConfiguracionEmpresa` (active + validity window); missing/invalid required key ⇒ `CONFIG_RETENCION_FALTANTE` **blocks confirmation** (product decision 6: no legal-default fallback).
- **No production seed path exists**: `configuracionEmpresa.create` appears only in `app/src/integration/setup/fixtures.ts` (test empresaA). There is no empresa-onboarding flow yet (no `empresa.create` outside fixtures). Real tenants will be blocked on confirm — and consequently on receipt — until keys are seeded. This is the flagged prerequisite.

### Business rules (canonical docs)
- `docs/03` §6: *"Confirmar NO recibe mercancía: se necesita un paso de recepción"*. `RECIBIDA` ⇒ increase stock + generate movement + update average cost. *"Cancelar una compra recibida revierte el movimiento de entrada y ajusta el costo promedio."*
- `docs/06`, `docs/16`: lifecycle `Borrador → Pendiente → Recibida → Pagada`; `Cancelada` reverts what was received.
- **The weighted-average formula is NOT specified anywhere in docs** — it must be decided in design (see Risks).

## Answers to Key Questions

1. **Does the compra state contract allow RECIBIDA?** Not in the current domain type (3-state `EstadoCompraCore`), but the DB enum has it and both modules froze explicit 3.4b seams (`InventoryEntryPort`, `INVENTORY_SOURCE.PURCHASE`, `MovimientoInventario.compraId`). This change consumes those seams — it is the sanctioned extension point, confirmed by `openspec/specs/compra/spec.md`.
2. **How does inventario mutate stock today / is it reusable?** Only `ajustarStockEnTx` (manual path): upsert + `FOR UPDATE` + non-negative guard + `AJUSTE` movement + audit. Not reusable as-is for receipts; the receipt path must be a new repository/use-case function mirroring the same locking discipline, with `ENTRADA_COMPRA` + `compraId` + explicit `branchId`.
3. **Where does CostoPromedio live?** `PRODUCTO.costoPromedio Decimal(12,2)` — company-wide per product (not per branch, not on `INVENTARIO`). Canonical weighted-average formula is undefined in docs; the natural reading given the schema comment is: `nuevoCP = (stockTotalEmpresa × CP + cantidadRecibida × costoUnitarioLibreDeITBIS) / (stockTotalEmpresa + cantidadRecibida)` — requires a product decision in design.
4. **Config seeding state?** Read path and error contract exist and are integration-tested (`compra-config.integration.test.ts`); fixtures seed the four `RET_*` keys for test empresaA only. **Missing: any production seeding mechanism** (seed script or bootstrap). Must be a task in this change (prerequisite confirmed at close of the previous session).
5. **Multi-tenancy?** Every read/write is `tx`-scoped with `empresaId` (+ `sucursalId` on inventory). `withTenantTransaction` is mandatory at the http layer (ESLint `server-action-must-wrap-tenant`), nesting is a hard error (`NestedTenantTransactionError`) — so receipt MUST be a single transaction composing compra + inventario writes, never two top-level calls.
6. **Cross-module rule — how should compra drive inventario?** See Approaches; recommendation is B (inventario exposes the entry use case; compra orchestrates within one transaction).

## Approaches

1. **A — Compra application layer calls inventario infrastructure directly** (`recibir-compra.ts` imports `inventario-repository` functions).
   - Pros: fewest new types; trivially same-`tx`.
   - Cons: imports another module's **infrastructure** (breaks the layer contract that `application/` talks to its own ports); inventory invariants (lock, non-negative, movement append, average cost) split across two modules; the published seams stay fictional.
   - Effort: Low
2. **B — Inventario implements the reserved `InventoryEntryPort` as an exposed receiving use case; Compra's `recibirCompra` use case orchestrates both in one transaction** (recommended).
   - Pros: realizes the documented design ("3.4b purchase-receipt flow will implement this ... WITHOUT touching the core"); stock+cost invariants stay 100% inside inventario; compra remains state-machine + fiscal concerns; cross-module dependency is `application → application` over domain-published types (the tenant precedent); independently unit/integration testable; sale/return (later phases) reuse the same entry/exit ports.
   - Cons: requires defining the exact port signature + error catalog bridging (inventario error codes surfaced through a compra result); branch parameter must flow through (the seam already models `branchId`).
   - Effort: Medium
3. **C — HTTP-layer orchestration with two `withTenantTransaction` calls.**
   - Rejected outright: non-atomic (stock without state, or vice versa) and the wrapper rejects nesting. Not viable under AGENTS.md "Escrituras multi-tabla SIEMPRE en transacción".

## Recommendation

**Approach B.** Concrete shape:

- **compra/domain**: extend `ESTADO_COMPRA` with `RECIBIDA`; add `puedeRecibir` / `transicionarRecibir` (`PENDIENTE → RECIBIDA` only; `RECIBIDA`→cancel remains `TRANSICION_INVALIDA` until the follow-up reversal change); replace the `as EstadoCompraCore` cast with explicit mapping; the 3.4b seam comment block gets consumed/retired.
- **inventario**: new application use case `registrarEntradaCompra(tx, ctx, input)` (or `aplicarEntradasEnTx` repository function) implementing the `applyEntry` contract: per line — ownership guard, upsert+`FOR UPDATE` on the *compra's branch* row, positive delta, `MovimientoInventario { tipoMovimiento: ENTRADA_COMPRA, compraId, cantidadMovida/Anterior/Nueva }`, audit; then update `PRODUCTO.costoPromedio` under a row lock.
- **compra/application `recibirCompra`**: one guarded `updateMany` (`estado = PENDIENTE` → `RECIBIDA`) for idempotency → per-line inventario entry calls → cost math → audit → typed result.
- **http**: `recibirCompraAction` thin adapter (zod + ctx + `withTenantTransaction` + Administrador).
- **Prerequisite task**: production seeding of `RET_ISR_15/2`, `RET_ITBIS_100/30` (+ `TASA_ITBIS` housekeeping) — seed script under `tools/scripts` or Prisma seed convention, documented in SETUP-LOCAL; extend integration fixtures as needed.
- **Explicit scope cuts** (to confirm with user):
  1. **Full receipt only** — no partial/per-line receipt (`DETALLE_COMPRA` has no received-quantity column; adding one contradicts "no migration expected").
  2. **Cancel-of-RECIBIDA reversal (`SALIDA_CANCELACION_COMPRA` + cost re-adjustment) is deferred** to a follow-up change. The previous session's close notes listed it under 3.4b, but it doubles the surface (state table change to cancel, reversal math, tests) and the canonical compra spec currently freezes cancel as pre-receipt. Decide at proposal time.
  3. **Session-branch restriction**: receipt only allowed when `ctx.sucursalId === compra.sucursalId` (reject otherwise) — avoids touching the RLS GUC dance; the W-1 clear/restore pattern remains available if multi-branch admins require cross-branch receipt.
- Average-cost formula: adopt the weighted average above with `costoUnitario` (ITBIS-exclusive, since formal-purchase ITBIS is fiscal credit) and company-wide stock denominator — **as an explicit design decision with product sign-off**, computed with `decimal.js`, half-up to 2 dp.

## Risks

- **Average-cost denominator/base is unspecified in canonical docs** (company-wide vs branch-weighted; ITBIS-exclusive vs gross). Wrong choice silently poisons margin/KPI data. Mitigation: explicit design decision + domain unit tests with mixed 18/16/0 lines.
- **`EstadoCompraCore` cast becomes a lie** the moment any `RECIBIDA` row exists — any domain function that switches on state must handle it or fail loudly; listing/detail read paths must map 5 DB states. Mitigation: explicit mapper + exhaustive switch as part of this change.
- **Production config seeding missing**: without it, real tenants block on `CONFIG_RETENCION_FALTANTE` before receipt is even reachable. Mitigation: prerequisite task ships in this change.
- **Concurrency on `costoPromedio`**: two receipts (or a receipt vs. a product edit) touching the same product can interleave; `Producto.version` exists but `ajustar`-style flows bypass it. Mitigation: `SELECT ... FOR UPDATE` on the PRODUCTO row inside the receipt transaction (same discipline as INVENTARIO).
- **RLS cross-branch write**: if receipt is ever allowed outside the session branch, `inventario_isolation`'s `USING` rejects the update; needs the W-1 `set_config(is_local=true)` override. Mitigation: v1 restricts to the compra's branch.
- **Idempotency regression**: receipt must follow the guarded-state-update pattern; a naive read-check-write would double-enter stock on retry (AGENTS.md concurrency rules). The guard `estado='PENDIENTE'` makes retries return `CONCURRENCIA_CONFLICTO` with zero side effects.
- **Budget**: seam consumption touches both modules + seeding + tests; likely > 400 lines → tasks phase should forecast and consider chained PRs (inventory side first, then compra wiring).

## Ready for Proposal

**Yes.** Proceed to `sdd-propose` scoped to: receipt state transition + per-branch stock entry (`ENTRADA_COMPRA` with `compraId`) + company-wide `costoPromedio` update + retention-config seeding prerequisite. Two decisions to surface to the user at proposal time:
1. Confirm the average-cost formula/base (weighted, ITBIS-exclusive cost, company-wide stock).
2. Confirm scope cuts: full-receipt-only, session-branch restriction, and whether cancel-of-RECIBIDA reversal joins 3.4b or ships as a follow-up change.
