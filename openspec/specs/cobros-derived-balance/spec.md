# Cobros Derived Balance Specification

## Purpose

The canonical derived CxC balance and payment state (ADR-017): one SQL aggregate source plus pure domain classifiers; balances are never materialized or cached.

## Requirements

### Requirement: Canonical derived-balance query (R-B1)

Per-invoice pending balance MUST equal `FACTURA.total` − Σ `PAGO.monto` where `tipo=COBRO` AND `estado=APLICADO` − Σ VIGENTE credit-note amounts + Σ VIGENTE debit-note amounts (the debit-note term is empty in V1; B03 deferred), counting only `FACTURA.estado=VIGENTE`. It MUST be one grouped SQL aggregate (no per-invoice queries, no N+1), MUST NOT be materialized or cached, and `consultarSaldoCxC` MUST be the only application entry point serving board, aging, mora and credit decisions.

#### Scenario: Mixed APLICADO/REVERTIDO payments (critical)

- GIVEN a 10,000.00 invoice with COBROs of 4,000.00 `APLICADO` and 3,000.00 `REVERTIDO`
- WHEN the balance derives
- THEN pending = 6,000.00 (the REVERTIDO cobro is excluded)
- TEST: integration

#### Scenario: Non-current invoices excluded

- GIVEN one VIGENTE and one ANULADA invoice for the same client
- WHEN the CxC listing runs
- THEN only the VIGENTE invoice appears
- TEST: integration

#### Scenario: Never stale after a new payment

- GIVEN a displayed CxC balance
- WHEN another COBRO commits and the query re-runs
- THEN the new balance reflects it immediately (no cache layer exists)

### Requirement: Pure payment-state classifier (R-B2)

`clasificarEstadoPago` MUST be pure domain code (no DB) mapping: applied cobros = 0 → `PENDIENTE`; 0 < applied < total → `PARCIAL`; applied ≥ total → `PAGADA`.

#### Scenario: Partial payment state

- GIVEN 5,000.00 applied APLICADO on a 15,000.00 invoice
- WHEN classified
- THEN the state is `PARCIAL`
- TEST: unit

### Requirement: Mora computed in Santo Domingo time (R-B3)

`enMora` MUST compute the due date (invoice date + client `plazoCreditoDias`) and "today" in `America/Santo_Domingo` via a timezone library — no manual hour arithmetic. A receivable is in mora at ≥ 1 full day past due.

#### Scenario: Timezone boundary day

- GIVEN an invoice due at the start of an SD calendar day
- WHEN evaluated at an instant that is still the previous day in SD but the next day in UTC
- THEN it is NOT yet in mora ("today" resolves in SD)
- TEST: unit

#### Scenario: Day past due

- GIVEN a receivable one full SD day past its due date
- WHEN evaluated
- THEN `enMora` returns true and the board shows it as En Mora
- TEST: unit
