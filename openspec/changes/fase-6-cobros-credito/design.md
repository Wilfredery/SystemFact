# Design: Phase 6 — Collections and Credit

## Technical Approach

Add an ADR-013 `cobros` module owning `Pago`, derived CxC, credit decisions, receipts, and payment errors. Collections and refunds are direct `APLICADO` writes inside `withTenantTransaction`; money remains Prisma `Decimal`. Reuse R-D5, the purchase allocator, and thin Server Actions. Retrofit `confirmarVenta` through a narrow credit port and register contado COBRO in the same transaction.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Refund idempotency | Client-generated key, nullable unique `(empresaId,idempotencyKey)` | Identity-only or state-machine deduplication | Allows equal legitimate refunds and satisfies §10; gate precedes receipt burn. |
| Payment state | Create directly as `APLICADO` | Two-phase allocation | `Pago.facturaId` is single-invoice; YAGNI and no intermediate API is required. |
| CxC source | One tenant-scoped SQL aggregate, then pure classifiers | Per-screen queries or cached balances | Preserves ADR-017 and prevents divergent balance/mora decisions. |
| Cross-module credit | `venta` imports a cobros application port, never infrastructure | ORM access or duplicated rules in venta | Keeps dependency direction and the canonical query in one owner. |

## Data Flow

`Server Action → withTenantTransaction → use case → repository/domain → Pago/aggregate`

`confirmarVenta → evaluateCredit(port) → emit invoice/stock → register contado COBRO → commit`

The aggregate counts only `FACTURA.estado=VIGENTE` and `PAGO.tipo=COBRO AND estado=APLICADO`, subtracts valid credit notes, adds valid debit notes, and returns total, applied cobros, adjustments, and pending balance. `clasificarEstadoPago` maps zero/partial/full to `PENDIENTE/PARCIAL/PAGADA`; `enMora` compares Santo Domingo dates using `date-fns-tz`.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/prisma/schema.prisma` | Modify | Add `idempotencyKey String? @db.VarChar(255)` to `Pago` and `@@unique([empresaId,idempotencyKey])`; nullable unique semantics permit multiple legacy NULLs. |
| `app/prisma/migrations/<timestamp>_pago_idempotency_key/migration.sql` | Create | `ALTER TABLE "PAGO" ADD COLUMN "idempotencyKey" VARCHAR(255); CREATE UNIQUE INDEX ... ON "PAGO" ("empresaId","idempotencyKey");` (Postgres permits multiple NULLs). |
| `app/src/modules/cobros/{domain,application,infrastructure,http}/**` | Create | Pure domain, use cases, repository/aggregate, validations/actions, and UI for board, payment, and reprint. |
| `app/src/modules/venta/application/confirmar-venta.ts` | Modify | After stock preview and before NCF lock, call the credit port; after invoice/stock writes, register contado COBRO before commit. |
| `app/src/modules/venta/application/credit-port.ts` | Create/modify | Narrow `TenantCtx` + Decimal-string contract over a tenant-owned transaction handle; cobros implements it, with no generated Prisma model in venta. |
| `app/src/integration/{cobros,credito,confirmar-venta}.integration.test.ts` | Create/modify | RLS, concurrency, replay, mixed-state, and R-V15 regressions. |

## Interfaces / Contracts

```ts
interface EvaluarCreditoPort {
  evaluarCreditoCliente(tx: TenantTransaction, ctx: TenantCtx, input: {
    clienteId: number; totalVenta: string; fecha: Date;
  }): Promise<CreditResult>;
}
```

`registrarCobro` validates tenant/invoice, locks the invoice, recomputes pending balance, rejects excess with `COBRO_EXCEDE_SALDO`, allocates the company-wide receipt, then inserts `COBRO/APLICADO`. `registrarReembolso` requires the client key and checks it inside the transaction **before insert and receipt allocation**, then inserts `REEMBOLSO/APLICADO` with `autorizadoPor`. A unique-violation race is re-read and translated to `PAGO_IDEMPOTENCIA_CONFLICTO`; Prisma errors never cross HTTP. The client adapter generates the key before submit and Zod requires it.

The 600-series catalog in `cobros/domain/errors.ts` includes `PAGO_IDEMPOTENCIA_CONFLICTO`, `COBRO_EXCEDE_SALDO`, `CLIENTE_EN_MORA`, `LIMITE_CREDITO_EXCEDIDO`, `CREDITO_NO_HABILITADO`, `FACTURA_COBRO_NO_VIGENTE`, `PAGO_NO_AUTORIZADO`, and `PAGO_NO_ENCONTRADO`. Credit evaluation uses the aggregate and client terms (`creditoHabilitado`, limit, `plazoCreditoDias`); the port maps stable failures to venta without ORM or catalog coupling.

`consultarSaldoCxC` is the only application entry point for board, aging, mora, and credit blocking; its repository performs the single grouped SQL aggregate, not a query per invoice.

The receipt allocator locks `EMPRESA FOR UPDATE`, clears only the sucursal GUC, computes `MAX(correlativoRecibo)+1`, restores the GUC, and inserts under the existing unique constraint.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Classifier, mora timezone boundaries, Decimal balances, credit decisions | Jest, pure domain, no DB. |
| Integration | RLS/tenant isolation; mixed APLICADO/REVERTIDO; refund replay/no burn; concurrent over-payment; credit blocks; receipt serialization | Real Postgres and `withTenantTransaction`; extend R-V15 for credit rejection and contado PAGADA. |
| E2E | Credit sale → collection, blocked sale, cash sale, receipt/reprint, board states | Playwright, existing seeded auth; no daily close or B03. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

Run Prisma migration before application deployment. Existing rows receive NULL and remain valid; only non-NULL keys participate in uniqueness. Deploy application gate and client key generation together. No feature flag; rollback is application revert followed by a separate drop-column migration if required.

## Open Questions

None; daily cash close and B03 remain explicitly deferred.
