# Proposal: fase-5b-venta-core — Venta Draft Engine + First POS UI

## Intent

SystemFact has no sale engine: `src/modules/venta/` does not exist, and the POS is the first client-interactive surface planned. Fase 5a shipped the cliente module and the race-safe `getOrCreateConsumidorFinalEnTx` seam explicitly reserved for 5b. This change builds the commercial heart: VENTA draft CRUD with mixed-ITBIS calculators (discount-before-ITBIS per ADR-018), the client resolver, and `DESC_MAX` config — draft-first mirroring compra so 5c's confirm/NCF/stock-debit lands on a proven foundation.

## Scope

### In Scope
- **Domain (PR-1)**: `venta/domain/` — `venta.ts` (EstadoVenta enum, fail-loud DB mapping, `VentaResult`, error catalog incl. `TASA_ITBIS_VIGENCIA_FALTA`, `VENTA_INMUTABLE`, `CONCURRENCIA_CONFLICTO`), `calculators.ts` (per-line contract: subtotalBruto → discount → base → ITBIS; header totals with gravado/exento split returned-not-stored, header discount prorated pre-ITBIS, round2 half-up), exhaustive unit tests incl. DGII mixed-rate matrix.
- **Application/Infra/HTTP (PR-2)**: `crearVenta`, `actualizarVenta` (full line replacement, guarded `updateMany` estado=BORRADOR), `cancelarVenta`, `listar/obtener`; `venta-repository`; `resolverClienteParaVentaEnTx` (null → CF via 5a seam; given → reject no-encontrado/inactivo); `leerConfigVentaEnTx` (hard-fail `DESC_MAX_FALTANTE`-style) + `tools/scripts/seed-venta-config.ts`; server actions with tenant tx wrapper; unit + tenant/concurrency integration tests.
- **POS UI slice (PR-3)**: minimal first interactive screen — ephemeral carrito (draft lines ±/qty), product search, client picker (CF default + inline registrar via existing `crearCliente`), discount panel (Admin-gated), totals, "Guardar borrador" + my-drafts list. **No confirm button.**

### Confirmed Decisions (RESOLVED)
1. `precioVenta` = **ITBIS-exclusive** (net base; total = price + per-line ITBIS; aligns with producto `calcular-itbis.ts` + compra; discount applies to net base). Document ADR-style note.
2. Discounts V1 = Admin-only; `descuentoAutorizadoPor` := applying admin actor (server-side role check; UI hiding ≠ security). No permission-table work.
3. Draft line with insufficient stock = **WARN (visual)**; hard block deferred to 5c confirm. Client changeable while BORRADOR.
4. POS UI included as chained PR-3.

### Out of Scope
- Confirm action, NCF consumption, invoice/Factura emission, SALIDA_VENTA inventory writes (5c; `InventoryExitPort` seam stays untouched).
- Returns B04 (5d); payment/Parcial/Pagada states (Fase 6); permission matrix (V1 Admin-only).
- Carrito persistence model: carrito = VENTA draft; UI uses ephemeral client state; abandoned drafts accepted (manual cleanup V1).

## Capabilities

### New Capabilities
- `venta`: draft lifecycle (create/update/cancel), line rules (rates + validity frozen from product, stock warn, client swap), calculators and totals contract.
- `venta-config`: `DESC_MAX` config read + seed (hard-fail read, no default). Convention matches `retencion-config` + `retencion-config-seeding` → dedicated capability, consistent precedent.

### Modified Capabilities
- None.

## Approach

Chain of 3 PRs sized to work units (delivery strategy ask-on-risk with chained path resolved): PR-1 pure domain calculators + entity + errors (~550–750 lines); PR-2 use cases + config reader/seed + http/actions + venta client resolver (~1,100–1,400); PR-3 POS UI slice (~900–1,300). Each slice: clear start/finish, autonomous verification, rollback = `git revert` of its merge commit; boundary between PRs is the domain/application/infra↔UI seam, enabling option-B re-slicing (drop PR-3, move UI to 5c) without rework.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Mixed 18/16/0 + pre-ITBIS discount rounding mis-reports ITBIS (DGII-visible) | Med | Freeze rounding order in spec; exhaustive domain matrix before DB wiring (compra precedent) |
| First interactive UI with no in-repo precedent | Med | Chained as PR-3; option-B fallback re-slices without backend rework |
| `DESC_MAX` missing at runtime → hard-fail blocks counter | Low | Seed script + runbook before deploy; explicit coded error |
| Abandoned BORRADOR drafts accumulate | Low | Accepted V1; "mis borradores" list, manual cleanup |
| Tenant leakage on highest-traffic new tables | Low | RLS already enabled+FORCED; app-layer filters; existing ESLint rule; tenant integration tests |

## Rollback Plan

Revert PR-3 (UI) independently — backend remains intact. Revert PR-2/PR-1 in reverse merge order; no schema migrations in 5b (ERD v4.7 frozen, RLS pre-applied), so rollback is purely code. Seeded `DESC_MAX` config rows are harmless if left after revert.

## Dependencies

- Fase 5a cliente module + `getOrCreateConsumidorFinalEnTx` (shipped).
- `retencion-config` patterns for config read/seed; compra calculators as inversion template.

## Success Criteria

- [ ] Venta draft CRUD with guarded transitions, tenant-isolated, idempotent-safe per compra conventions
- [ ] ITBIS totals DGII-verified by mixed-rate test matrix; discount applied per ADR-018 before ITBIS
- [ ] `DESC_MAX` seedable and hard-fail-readable; CF resolver wired via 5a seam
- [ ] POS screen renders cart, totals, client picker, saving drafts — no confirm path
- [ ] Review loops closed before merge (9 review/verify steps, green PRs only)
