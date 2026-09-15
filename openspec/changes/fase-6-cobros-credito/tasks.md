# Tasks: Fase 6 — Cobros y Crédito

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,600 total (S1 ~350, S2 ~500, S3 ~300, S4 ~450) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 (stacked) or single PR with size:exception |
| Delivery strategy | single-pr (cached) → requires size:exception decision |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

strict_tdd: OFF (Engram `sdd-init-calidad-precio/systemfact`) — tests ship inside their work-unit commit per repo rules. Migration commits stay separate and reviewable.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | cobros domain + canonical aggregate + idempotency migration | PR 1 | `pnpm test -- cobros` | `docker` Postgres 16 integration suite | Drop migration + delete `src/modules/cobros/{domain,infrastructure}` |
| 2 | Collections, refunds, receipts use cases | PR 2 | `pnpm test -- cobros integration` | Real Postgres + `withTenantTransaction` | Revert module application/http layers |
| 3 | Credit gate + venta retrofit | PR 3 | `pnpm test -- venta integration` | Real Postgres, R-V15 suite | Revert `confirmar-venta.ts` to fase-5 behavior |
| 4 | Cobros UI: board, payment form, estado de cuenta | PR 4 | `pnpm test -- cobros ui` + Playwright | Seeded auth E2E | Delete `cobros/http`+UI files |

## Phase 1: Domain, Aggregate & Migration (PR slice 1)

> Reconciliation (apply slice 3): 1.3–1.5 were implemented and committed in slice 1 (7d25df7
> pure domain incl. `pago.ts`/`clasificar-estado-pago.ts`/`en-mora.ts`; 45c8ca5 the
> `saldo-cxc.repository.ts` canonical aggregate + `cobros-saldo-cxc.integration.test.ts`).
> Only 1.1/1.2 had been ticked; 1.3–1.5 boxes corrected to match shipped reality.

- [x] 1.1 Modify `app/prisma/schema.prisma`: add `idempotencyKey String? @db.VarChar(255)` + `@@unique([empresaId, idempotencyKey])` on `Pago`; create `app/prisma/migrations/<ts>_pago_idempotency_key/` — **own reviewable commit** (R-C3).
- [x] 1.2 Create `app/src/modules/cobros/domain/errors.ts`: versioned 600-series catalog (`PAGO_IDEMPOTENCIA_CONFLICTO`, `COBRO_EXCEDE_SALDO`, `CLIENTE_EN_MORA`, `LIMITE_CREDITO_EXCEDIDO`, `CREDITO_NO_HABILITADO`, `FACTURA_COBRO_NO_VIGENTE`, `PAGO_NO_AUTORIZADO`, `PAGO_NO_ENCONTRADO`) with code+message+context (R-C5). Unit test: every rejection path returns catalog code, never stack traces.
- [x] 1.3 Create `cobros/domain/pago.ts` (types, `prisma.Decimal` money) + `cobros/domain/clasificar-estado-pago.ts` (R-B2) + `cobros/domain/en-mora.ts` using `date-fns-tz` for `America/Santo_Domingo` (R-B3). Unit tests: `PARCIAL` at 5,000/15,000; SD/UTC boundary day NOT in mora; 1 full SD day past due → mora.
- [x] 1.4 Create `cobros/infrastructure/saldo-cxc.repository.ts`: single grouped SQL aggregate — only `FACTURA.estado=VIGENTE`, `PAGO.tipo=COBRO AND estado=APLICADO`, −VIGENTE credit notes, +debit notes (empty in V1); no cache (R-B1).
- [x] 1.5 Integration test: mixed APLICADO/REVERTIDO → pending 6,000.00 on 10,000.00 invoice; ANULADA invoices excluded from listing (R-B1).

## Phase 2: Collections, Refunds, Receipts (PR slice 2)

- [x] 2.1 Create `cobros/application/registrar-cobro.ts`: validate tenant/VIGENTE invoice (`FACTURA_COBRO_NO_VIGENTE`), row-lock invoice, recompute balance in-tx, reject `COBRO_EXCEDE_SALDO`, insert `COBRO/APLICADO`, EFECTIVO only, Decimal end-to-end, multiple abonos (R-C1, R-C2).
- [x] 2.2 Create `cobros/infrastructure/recibo.repository.ts`: `correlativoRecibo` = `MAX+1` per empresa under `EMPRESA FOR UPDATE`, reuse `asignarCorrelativoSiguienteEnTx` pattern (R-C4).
- [x] 2.3 Integration test (critical, R-C2): two parallel 8,000.00 COBROs on 10,000.00 balance — exactly one commits, other gets `COBRO_EXCEDE_SALDO`, no negative balance.
- [x] 2.4 Integration test (critical, R-C4): concurrent payments on different invoices → unique consecutive receipts, no duplicate-key abort.
- [x] 2.5 Create `cobros/application/registrar-reembolso.ts`: require client `idempotencyKey` (Zod mandatory), check inside tx **BEFORE insert AND BEFORE receipt burn**, duplicate → `PAGO_IDEMPOTENCIA_CONFLICTO`; unique-violation race re-read → same code; Prisma errors never cross HTTP; record `autorizadoPor` (R-C3).
- [x] 2.6 Integration test (critical, R-C3): replay of key K → conflict, no row, receipt N+1 not burned; same-key race → one row, loser gets stable code; fresh-key second 500.00 refund accepted.
- [x] 2.7 Create `cobros/application/consultar-saldo-cxc.ts` (sole entry point for board/aging/mora/credit) + `cobros/http/actions.ts` thin Server Actions in `withTenantTransaction`; server-side role gating: Despachador denied, unauthorized refund → `PAGO_NO_AUTORIZADO` before any write (R-C6, R-B1).
- [x] 2.8 Integration test (R-C6): unauthorized refund actor rejected pre-write; all reads/writes tenant-scoped under RLS GUCs.

## Phase 3: Credit Gate + Venta Retrofit (PR slice 3)

- [x] 3.1 Create `cobros/application/credit-port.ts` exposing `EvaluarCreditoPort` (TenantCtx + Decimal-string over caller's tx); `venta` consumes only the port — no ORM/cobros infrastructure imports (R-K1). Integration test: port-only coupling, typed allow/reject.
- [x] 3.2 Implement credit rules on canonical aggregate: `creditoHabilitado=false` → `CREDITO_NO_HABILITADO`; pending+totalVenta > limite → `LIMITE_CREDITO_EXCEDIDO`; >30 days overdue (SD) → `CLIENTE_EN_MORA` (R-K2). Unit test (R-K2 boundary): pending+sale exactly equals limit → allowed (inclusive). Integration test: over-limit 23,000/20,000 rejected; 31-days-overdue rejected; REVERTIDO cobros excluded so sale passes.
- [x] 3.3 Modify `app/src/modules/venta/application/confirmar-venta.ts`: call port after stock preview and **BEFORE NCF lock/consumption**; after invoice+stock writes, register exactly one full-total `COBRO/APLICADO` for contado before commit (R-V15).
- [x] 3.4 Integration test (critical, R-V15 ordering): credit-blocked client → stable code returns before NCF lock; sale stays `BORRADOR`, no NCF/invoice/debit/COBRO. Integration test: contado confirm → one COBRO = total, derived state `PAGADA`; later abort → no COBRO persists.
- [x] 3.5 Extend existing R-V15 regression suite (happy path, post-consume rollback, double-confirm, foreign branch) still green.

## Phase 4: UI — Board, Payment, Estado de Cuenta (PR slice 4)

- [ ] 4.1 Create `cobros/http/cxc-board/` page: Pendiente/Parcial/En Mora lists, paginated 25/page, consuming only `consultarSaldoCxC` (R-C7, R-B1).
- [ ] 4.2 Create payment form: submit control **disabled on first click (non-droppable line — do not omit)**, server revalidates all; e2e test: rapid double-click → at most one collection persists (R-C7).
- [ ] 4.3 Create estado de cuenta view: customer's VIGENTE invoices with total, applied cobros, pending balance, derived state from canonical query; e2e test with mixed-state customer (R-C7).
- [ ] 4.4 Create receipt reprint page (non-fiscal document) (R-C4).
- [ ] 4.5 Update module docs (`docs/` fase-6 section) with cobros lifecycle and error catalog reference.
