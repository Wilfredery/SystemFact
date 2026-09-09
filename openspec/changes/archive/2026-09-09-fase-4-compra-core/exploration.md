# Exploration: fase-4-compra-core

**Date**: 2026-09-08
**Change**: fase-4-compra-core
**Status**: exploration-complete

## Current State

### User-confirmed phasing decision
Fase 4 ships **Compra core FIRST, without inventory integration**. Sub-phase **3.4b** (purchase receipt → stock entry + `costoPromedio` update) ships on top afterwards, leaving clean typed seams — exactly as 3.4a left `InventoryEntryPort` / `InventoryExitPort` in the inventario domain.

### Schema (frozen ERD v4.7) — what Compra requires
`app/prisma/schema.prisma` fully supports compra-core **without any migration**:

- **`Compra`**: required — `empresaId`, `sucursalId`, `proveedorId`, `usuarioId`, `tipoCompra`, `estado`, `correlativoInterno` (String, NOT NULL, **no UK**), `fecha`, and seven NOT NULL `Decimal(12,2)` money columns: `subtotal`, `subtotalGravado`, `itbis`, `subtotalExento`, `retencionIsr`, `retencionItbis`, `total`. Optional — `tipoNcf` (`TipoNcfCompra`: B01/B11) and `ncf` (supplier/own comprobante; `@@unique([empresaId, ncf])`, NULLs allowed → multiple drafts OK). **No `version` column** → idempotency must come from guarded state-transition updates (`UPDATE ... WHERE estado = ...`), not optimistic locking.
- **`EstadoCompra` (frozen enum)**: `BORRADOR, PENDIENTE, RECIBIDA, PAGADA, CANCELADA`. There is **no CONFIRMADA state** — "confirming" a purchase means the transition `BORRADOR → PENDIENTE` (canonical per doc `03` §6: "Confirmar la compra NO recibe mercancía: se necesita un paso de recepción"). Note `EstadoVenta` DOES have CONFIRMADA; do not mix the vocabularies.
- **`DetalleCompra`**: `productoId` (required — services are modeled as products via `TipoCompra`), `cantidad Decimal(12,3)`, `costoUnitario Decimal(12,2)`, `tasaItbis Decimal(12,2)` frozen per line, `itbisLinea`, `subtotalLinea`. **No discount columns** → purchases have no discounts in V1.
- **`TipoCompra`**: `MERCANCIA, SERVICIO_PROFESIONAL, SERVICIO_TECNICO, ALQUILER` — the fiscal classification driving retentions (`03` §8).
- **`Proveedor`** (module EXISTS, shipped 3.3): `tipoProveedor` FORMAL/INFORMAL drives ITBIS 100% + B11; `tipoPersona` FISICA/JURIDICA drives ISR 15%. Deactivation is already guarded by `tieneComprasNoCanceladas()` (`proveedor-repository.ts:255`) counting non-CANCELADA compras — the first real Compra rows activate that existing forward-looking guard; no work needed.
- **`PagoProveedor`** (compraId FK, `EstadoPago` REGISTRADO/APLICADO/REVERTIDO): payments are a LATER sub-phase; `PAGADA` must not be reachable from compra-core use cases.
- **`ConfiguracionEmpresa`**: retention rates must be read from DB keys `RET_ISR_15`, `RET_ISR_2`, `RET_ITBIS_100`, `RET_ITBIS_30` with validity windows (AGENTS.md: never hardcode). **No module reads this table yet** — compra-core introduces the read path (with sensible missing-key behavior to be decided).

### 3.4b seams already available (do NOT build them now)
- `app/src/modules/inventario/domain/inventario.ts` reserves `INVENTORY_SOURCE.PURCHASE` and the typed `InventoryEntryPort.applyEntry(input)` — 3.4b's `recibir-compra` use case implements its consumer.
- `MovimientoInventario.compraId` (optional FK) + `TipoMovimiento.ENTRADA_COMPRA` / `SALIDA_CANCELACION_COMPRA` exist for receipt entries and cancel-after-receipt reversals.
- `Producto.costoPromedio Decimal(12,2)` is the weighted-average-cost target (`03` §6); `DetalleCompra.cantidad/costoUnitario` are the input contract.
- Cancel of a `RECIBIDA` purchase (reversal) belongs to 3.4b; compra-core cancels only `BORRADOR/PENDIENTE` (no inventory effect exists to revert).

### Business rules map (compra-core vs. deferred)
From `docs/03-reglasNegocioFact.md` §6/§8, `docs/15-criterios_de_aceptacion.md` §8.5, `docs/16-flujos_ux.md` §7, `docs/11-pendientes_y_decisiones_abiertas.md` §05-Compras (all wireframe answers CONFIRMED):

**In compra-core:**
1. Every purchase associated to an active supplier; supplier via dropdown (answer 2.3.2).
2. Lifecycle: create `BORRADOR` with lines → edit while draft → confirm to `PENDIENTE` (no inventory effect) → cancel (from BORRADOR/PENDIENTE) with mandatory motivo recorded in audit.
3. Line pricing: cantidad + costoUnitario, per-line ITBIS frozen from product rate; totals breakdown subtotal/subtotalGravado/itbis/subtotalExento.
4. Retentions calculated AND shown on the purchase from V1 (`03` §8, `11` "Retenciones"): ISR 15% (physical persons, professional services/rentals), 2% (technical services), 0% (merchandise from formals); ITBIS 100% (informal/physical — by law, business "no" noted but overridden), 30% (professional services between legal entities). Rates come from `ConfiguracionEmpresa`.
5. Roles: Compras is **Administrador-only** (`04-rolesPermisosFact.md` matrix line 178).
6. Audit: CREAR/ACTUALIZAR/CANCELAR `MovimientoAuditoria` rows appended inside the same tenant transaction (purchases are an audited action, `03` §13).
7. Multi-tenancy: every query filtered by `empresaId` (+ `sucursalId` on the document); all DB access wrapped in `withTenantTransaction`.
8. Lists paginated (default 25 / max 100), tenant-scoped.

**Deferred to 3.4b:** receiving (`PENDIENTE → RECIBIDA`), stock entry + movement, weighted-average cost update, cancel-after-receipt reversal (`SALIDA_CANCELACION_COMPRA`).
**Deferred to payments/CxP sub-phase:** `PagoProveedor`, `RECIBIDA → PAGADA`, accounts payable.
**Deferred per roadmap (`10` §Fase 5 Facturación includes B11):** NCF sequence machinery. `NcfSecuencia` includes B11 but **no code consumes sequences yet** — generating B11 in compra-core would ship the first row-locked sequence-consumption engine (90% warning, exhaustion block). Schema does NOT force this: `ncf`/`tipoNcf` are optional. Recommendation: record `tipoNcf`/`ncf` as optional text (UK dedupe per company works already), defer B11 *generation*.

### Module pattern reference (established by proveedor/producto/inventario)
- Four layers under `app/src/modules/compra/`: `domain/` (pure TS, decimal.js, Decimal-as-string), `application/` (use cases returning `{ ok: true, data } | { ok: false, code, message }`), `infrastructure/` (`…EnTx` repository functions taking `PrismaTx` + `TenantCtx`), `http/actions.ts` (thin adapters: zod parse → session ctx → `withTenantTransaction` → `tieneRolPermitidoEnTx`-style role gate → use case).
- Stable error-code catalog in `domain/errors.ts` (const + union + `messageFor` + `CompraDomainError`), mirroring `proveedor/domain/errors.ts`.
- Tests: per-file unit tests with mocked tx (use-case orchestration) + real-DB integration tests via `app/src/integration/setup/fixtures.ts` (`truncateAll` + `seedTenantFixture`; must be extended with proveedores/compras seeds). `concurrency.integration.test.ts` proves the guarded-update/row-lock style used for idempotency.
- ESLint rule `systemfact/server-action-must-wrap-tenant` enforces the wrapper on `src/**/actions.ts(x)`.

## Affected Areas

| Path | Why |
|------|-----|
| `app/src/modules/compra/**` (NEW) | domain, application, infrastructure, http for purchase documents |
| `app/prisma/schema.prisma` | **No migration required for compra-core** (verified against frozen ERD v4.7) |
| `app/src/modules/inventario/domain/inventario.ts` | 3.4b seam consumer lives here later; untouched now (PURCHASE source already reserved) |
| `app/src/modules/tenant/**` | reuse `withTenantTransaction`, `TenantCtx`, `getCurrentTenantContext` |
| `app/src/integration/setup/fixtures.ts` | extend with proveedores (+ compras) seed for integration tests |
| `openspec/specs/compra/` (NEW) | capability spec created at archive time |
| UI `app/src/app/**` (compras screens) | purchase list/detail/form for Administrador (scope TBD, see open decisions) |

## Approaches

1. **Draft-first core, receipts behind the state seam (recommended)** — compra-core ships create/edit-draft (with lines + fiscal math + retentions), confirm `BORRADOR→PENDIENTE`, cancel pre-receipt, list/detail. `RECIBIDA`/`PAGADA` are deliberately unreachable; 3.4b adds a `recibir-compra` use case implementing the existing `InventoryEntryPort` contract plus a `CostoPromedio` update in `producto` infrastructure.
   - Pros: zero migration; every deferred concern already has a schema-level home; mirrors 3.4a's proven seam discipline; reviewable in ≤800-line slices.
   - Cons: purchase list shows "not yet receivable" UI until 3.4b; requires explicit state-guard tests.
   - Effort: Medium.

2. **Full lifecycle now, inventory as no-op adapter** — implement `recibir` with a stubbed entry port (state reaches RECIBIDA without stock).
   - Pros: UI complete.
   - Cons: violates "inventory changes always produce a movement" (AGENTS.md), creates a lying state, makes 3.4b a behavior-changing patch instead of an additive slice. Rejected.

3. **compra-core + B11 emission now** — also consume `NcfSecuencia` (B11) with row locks for informal purchases.
   - Pros: fiscal-complete informal purchases.
   - Cons: first-ever sequence machinery, roadmap places B11 in Fase 5, schema keeps `ncf` optional → not forced. Rejected for this change (keep optional `ncf` recording only).

## Recommendation
**Approach 1.** Build `app/src/modules/compra/` on the proveedor/inventario template: pure domain (totals, per-line ITBIS 18/16/0, ISR/ITBIS retention calculators parameterized by `ConfiguracionEmpresa` values read in infrastructure), application use cases with typed results, guarded-transition confirm/cancel for idempotency (no `version` column exists on documents), admin-only thin actions, audit rows in-transaction, unit + real-DB integration tests. Leave 3.4b the receipt seam (`PENDIENTE→RECIBIDA` + `InventoryEntryPort` + `costoPromedio` + reversal path), and leave payments/CxP to a later sub-phase.

## Open product decisions (user must confirm before/at proposal)
1. **NCF for purchases**: confirm deferral of B11 generation (record optional `tipoNcf`/`ncf` text only). Also confirm cancelled-purchase `ncf` semantics under the per-company UK (cancel does NOT free the number).
2. **`total` semantics**: `total = subtotal + itbis` gross, with cash-payable = total − retenciones derived? Or total net of retentions? Fiscal-grade; needs accountant/user confirmation.
3. **`correlativoInterno` format/generation** (e.g. `CMP-000001`; per-company counter vs. id-derived; no schema UK supports duplicates today).
4. **Box→unit conversion deferred**: frozen schema has no numeric pack factor (`unidadEmpaque` is a string). Confirm V1 compra-core takes quantities in base units (conversion becomes a later UX/schema topic).
5. **State vocabulary**: confirm that "confirmada" in the roadmap sense == `PENDIENTE` transition; UI labels must not invent a CONFIRMADA purchase state.
6. **Roles**: Administrador-only for compras (per `04` matrix) — confirm Operador stays out.
7. **Editing after confirm**: PENDIENTE purchases immutable (cancel & recreate)? Assumed yes.
8. **Missing retention config**: fallback to legal defaults (15/2/100/30) when `ConfiguracionEmpresa` keys are absent, or block? (Fallback-in-domain with audit note is the pragmatic option; needs a decision.)

## Risks
- **No blocking migration for compra-core** — schema verified complete (non-CRITICAL). The only schema gap is the pack-factor column (box conversion), which we propose to defer, not migrate.
- Retention math is fiscal correctness (IR-17 reporting downstream): wrong `total`/retention composition (decision #2) is the highest-impact risk; cover with domain tests on mixed 18/16/0 lines and formal/informal × física/jurídica matrices.
- `CONFIRMADA` vs `PENDIENTE` vocabulary confusion between `EstadoVenta`/`EstadoCompra` could leak into UI/tests; keep enum usage centralized.
- Cancel path without `version`: concurrent confirm+cancel races must be resolved by single guarded UPDATEs; requires an integration concurrency test (pattern exists in `concurrency.integration.test.ts`).
- New `ConfiguracionEmpresa` read path is first-of-kind; if Fase 2 config UI never seeded the keys, all compras rely on the chosen missing-key policy (decision #8).
- First activation of the proveedor `tieneComprasNoCanceladas` guard: expect behavioral change in proveedor deactivation once compras exist (covered by that module's tests; add one integration case).

## Ready for Proposal
**Yes.** Schema, rules, patterns, and seams are fully mapped; no migration blocks the change. The orchestrator should surface the 8 open product decisions (especially NCF deferral, `total` semantics, correlativo format, base-unit-only quantities) for user confirmation before `sdd-propose`.
