# Proposal: Fase 6 — Cobros y Crédito (Collections & Credit)

## Intent

`PAGO` is schema-complete (ERD v4.7) but has **zero application code**. Prior fases deferred work here: the credit/mora/limit gate at sale confirm (fase-5 note in `resolver-cliente-venta.ts`), and REEMBOLSO processing with a **mandatory idempotency flag** (fase-5d). Cash ("contado") sales currently produce no `Pago`, so their derived balance equals the full total and the CxC view would misclassify them as PENDIENTE. Phase 6 builds the entire payment lifecycle from scratch.

## Scope

### In Scope
- New **`cobros` module** (ADR-013 layering) owning the `Pago` aggregate.
- **Collections**: `COBRO` created as `APLICADO` inside the transaction (per-invoice FK; YAGNI: no two-phase allocation); partial payments/abonos; in-tx over-payment rejection `COBRO_EXCEDE_SALDO` (docs/19 §10: recompute pending balance inside the tx).
- **Refunds**: `REEMBOLSO` with **Approach A2 idempotency** — *explicit task*: additive migration adding nullable unique `(empresaId, idempotencyKey)` on `PAGO`; client-generated key before first submit; stable rejection code `PAGO_IDEMPOTENCIA_CONFLICTO` in a new cobros 600-series catalog.
- **Receipt sequence**: lock-serialized `correlativoRecibo` (`MAX+1` under `EMPRESA FOR UPDATE`; reuse the `asignarCorrelativoSiguienteEnTx` pattern).
- **Derived balance/state (ADR-017)**: one canonical SQL aggregate query + pure domain classifier `clasificarEstadoPago` / `enMora`, computed in `America/Santo_Domingo`. Only `tipo=COBRO AND estado=APLICADO` counts; `REVERTIDO` excluded.
- **Credit gate** at `confirmarVenta`: eligibility, `limiteCredito`, overdue `plazoCreditoDias`/mora via a thin cross-module port with stable rejection codes.
- **Cash-sale retrofit**: register a `COBRO (APLICADO)` at `confirmarVenta` for contado sales, same transaction.
- **CxC board data** (Pendiente/Parcial/En Mora) + estado de cuenta; Cobros UI (payment form with first-click disable, receipt reprint).

### Out of Scope (deferred)
- **Daily cash close (cierre de caja)** → phase 7 reports.
- **Nota de Débito B03 emission** → separate future change (Σ NOTA_DEBITO term stays empty).
- **`MetodoPago` widening**: EFECTIVO only in V1 (frozen).

## Capabilities

### New Capabilities
- `cobros`: payment lifecycle — collections, refunds with A2 idempotency, receipt sequence, cobros error catalog.
- `cobros-derived-balance`: canonical CxC aggregate query + pure payment-state/mora classifier.
- `credit-control`: credit eligibility/limit/mora evaluation consumed by venta through a narrow port.

### Modified Capabilities
- `venta`: R-V15 confirm flow gains the credit gate call and contado `COBRO` registration; venta spec scenarios extended.

## Approach

Dedicated `cobros` module; payments written `APLICADO` inside `withTenantTransaction` with RLS GUCs; idempotency check **before insert and before receipt burn** (R-D5 pattern); Decimal end-to-end; canonical aggregate via SQL (`aggregate`/`groupBy`, no N+1) reused by board, mora, and blocking.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/cobros/**` | New | domain/application/infrastructure/http/ui |
| `app/prisma/schema.prisma` + migration | Modified | Additive nullable `idempotencyKey` (unique per empresa) |
| `venta/application/confirmar-venta.ts` | Modified | Credit gate + contado COBRO |
| `app/src/integration/*` | New | RLS-enforced integration tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| REEMBOLSO double-spend mints duplicate receipts (CRITICAL) | High | A2 key gate before insert + receipt burn |
| Wrong balance filter silently mis-states every receivable (CRITICAL) | High | Integration test with mixed APLICADO/REVERTIDO |
| Cash-sale seam → contado invoices look PENDIENTE (CRITICAL) | High | COBRO at confirm, same tx |
| Receipt duplicate-key under concurrent payments | Med | Row-lock MAX+1 generator |
| Credit gate coupling / ORM leak into venta | Med | Thin tenant-scoped port |
| Confirm-flow regression | Med | Extend R-V15 tests |

## Change-Size Forecast

**Large** — 4 module layers + migration + UI + integration tests; exceeds a single 400-line review slice. Plan **PR slices** (1: domain+infra+idempotency migration; 2: collections+refunds+receipts; 3: credit gate + venta retrofit; 4: UI/CxC board) or declare `size:exception`. Flag for delivery planning.

## Rollback Plan

Revert the PR series; the additive nullable column is backward-safe (drop-column follow-up migration). Reverting the venta retrofit PR restores fase-5 confirm behavior.

## Dependencies

- Fase-5 confirm flow (R-V15) shipped; `Cliente` credit fields present; `PLAZO_CREDITO` config row seeded per tenant.

## Success Criteria

- [ ] Over-payment rejected in-tx with `COBRO_EXCEDE_SALDO`; concurrent second collection recomputes inside its tx.
- [ ] Replayed REEMBOLSO (same idempotency key) returns a stable code, writes no row, burns no receipt.
- [ ] Derived balance counts only `COBRO AND APLICADO`; `REVERTIDO` excluded (integration-proven).
- [ ] Credit-blocked client rejected at confirm with stable code; contado sale derives PAGADA at confirm.
- [ ] `correlativoRecibo` stays unique per empresa under concurrency; all queries tenant-scoped.
