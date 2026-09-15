# Cobros Specification

## Purpose

Payment lifecycle owned by the `cobros` module: collections (COBRO), refunds (REEMBOLSO) with idempotency key, receipt numbering, the 600-series error catalog, and the Cobros UI (board, payment form, receipt reprint, estado de cuenta).

## Requirements

### Requirement: Collection registration (R-C1)

`registrarCobro` MUST create a `Pago` with `tipo=COBRO`, `estado=APLICADO` at creation, `metodoPago=EFECTIVO` (only method in V1), `monto` Decimal(12,2) > 0, linked to exactly one `FACTURA` with `estado=VIGENTE`, entirely inside `withTenantTransaction` with RLS GUCs. Multiple partial payments (abonos) per invoice MUST be supported.

#### Scenario: Partial collection applies immediately

- GIVEN a VIGENTE invoice with an outstanding balance
- WHEN a smaller COBRO is registered
- THEN the Pago persists as `APLICADO`, one receipt number is issued, and the derived balance decreases

#### Scenario: Collection on non-current invoice rejected

- GIVEN an invoice in `CANCELADA` or `ANULADA` state
- WHEN a collection is attempted
- THEN `FACTURA_COBRO_NO_VIGENTE` returns and nothing persists
- TEST: integration

### Requirement: Over-payment rejected inside the transaction (R-C2)

`registrarCobro` MUST recompute the pending balance inside the transaction (invoice row-locked) and MUST reject with `COBRO_EXCEDE_SALDO` when the payment exceeds it. Concurrent collections MUST each be judged against the balance as of their own transaction.

#### Scenario: Concurrent over-payment (critical)

- GIVEN an invoice balance of 10,000.00 and two parallel 8,000.00 collections
- WHEN both transactions run
- THEN exactly one commits; the other returns `COBRO_EXCEDE_SALDO`; no negative balance exists
- TEST: integration

### Requirement: Refund idempotency with client-generated key (R-C3)

`registrarReembolso` MUST require a client-generated `idempotencyKey` (produced before first submit, mandatory at validation) enforced by a nullable unique `(empresaId, idempotencyKey)` constraint. The key MUST be checked inside the transaction BEFORE insert and BEFORE receipt burn; a duplicate MUST return `PAGO_IDEMPOTENCIA_CONFLICTO` with no row written and no receipt number consumed. A unique-violation race MUST be re-read and translated to the same stable code; Prisma errors MUST NOT cross HTTP. Every `REEMBOLSO` MUST record `autorizadoPor`.

#### Scenario: Replayed refund burns nothing (critical)

- GIVEN a registered refund (key K, receipt N)
- WHEN a replay of key K is submitted
- THEN `PAGO_IDEMPOTENCIA_CONFLICTO` returns, no second row exists, and no receipt number N+1 is burned
- TEST: integration

#### Scenario: First-submit race on same key

- GIVEN two simultaneous submissions carrying the same key
- WHEN the inserts race
- THEN exactly one row commits; the loser receives `PAGO_IDEMPOTENCIA_CONFLICTO`
- TEST: integration

#### Scenario: Legitimate repeat refund allowed

- GIVEN a refunded 500.00 on an invoice
- WHEN a second 500.00 refund arrives with a fresh key and valid authorization
- THEN it is accepted (keys, not amount identity, gate deduplication)

### Requirement: Company-serialized receipt number (R-C4)

Every Pago MUST carry a `correlativoRecibo` generated as `MAX+1` per empresa, serialized under a row lock so concurrent payments NEVER produce a duplicate. Receipts MUST be reprintable and MUST NOT be fiscal documents.

#### Scenario: Concurrent receipts stay unique (critical)

- GIVEN two simultaneous payments on different invoices
- WHEN both allocate receipt numbers
- THEN numbers are unique and consecutive per empresa with no duplicate-key abort
- TEST: integration

### Requirement: Cobros 600-series error catalog (R-C5)

The cobros domain MUST own one versioned stable-code catalog — `PAGO_IDEMPOTENCIA_CONFLICTO`, `COBRO_EXCEDE_SALDO`, `CLIENTE_EN_MORA`, `LIMITE_CREDITO_EXCEDIDO`, `CREDITO_NO_HABILITADO`, `FACTURA_COBRO_NO_VIGENTE`, `PAGO_NO_AUTORIZADO`, `PAGO_NO_ENCONTRADO` — each failure carrying code + user message + minimal context; no ad-hoc codes, no internal error exposure.

#### Scenario: Every rejection is catalog-coded

- GIVEN any cobros rejection path
- WHEN the result returns
- THEN it carries a catalog code and user message, never a stack trace
- TEST: unit

### Requirement: Role gating and tenant isolation (R-C6)

Collections and refunds MUST be authorized server-side (Despachador is denied Cobros; refunds require authorization → `PAGO_NO_AUTORIZADO`). Every read/write MUST be scoped to `empresaId` (+ `sucursalId` where applicable) under RLS GUCs; hiding UI controls is NOT the control.

#### Scenario: Unauthorized refund actor

- GIVEN an actor without refund authorization
- WHEN they submit a REEMBOLSO
- THEN `PAGO_NO_AUTORIZADO` returns before any write
- TEST: integration

### Requirement: Cobros UI — board, payment form, estado de cuenta (R-C7)

The Cobros UI MUST provide: the CxC board listing Pendiente / Parcial / En Mora; a payment form that MUST disable its submit control on first click (non-droppable requirement; the server still revalidates everything); receipt reprint; and an explicit customer estado de cuenta view listing the customer's VIGENTE invoices with derived totals and state. All views MUST consume only the canonical derived-balance query.

#### Scenario: Double-click on the payment form

- GIVEN a completed payment form
- WHEN the user clicks submit twice rapidly
- THEN the control is disabled after the first click and at most one collection persists (server revalidates)
- TEST: e2e

#### Scenario: Estado de cuenta renders derived facts

- GIVEN a customer with invoices in mixed payment states
- WHEN their estado de cuenta opens
- THEN each VIGENTE invoice shows total, applied cobros, pending balance and derived state from the canonical query
- TEST: e2e
