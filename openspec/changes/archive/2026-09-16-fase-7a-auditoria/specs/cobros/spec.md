# Delta for cobros

## ADDED Requirements

### Requirement: Collections and refunds are audited (R-C8)

`registrarCobro` and `registrarReembolso` MUST append exactly one `MovimientoAuditoria` row (`accion=PAGAR`, `entidad`/`idEntidad` referencing the resulting Pago) inside the same `withTenantTransaction` that commits the payment. A rejected or rolled-back payment MUST produce no audit row; an idempotent replay returning `PAGO_IDEMPOTENCIA_CONFLICTO` MUST leave the audit row count flat. This is purely additive: R-C1…R-C7 behavior is unchanged.

#### Scenario: Committed collection audited once

- GIVEN a VIGENTE invoice and a valid partial collection
- WHEN `registrarCobro` commits
- THEN exactly one `PAGAR` audit row exists for the new Pago and it is visible in the tenant's audit consultation
- TEST: integration

#### Scenario: First refund audits; replay adds nothing (critical)

- GIVEN a refund with idempotency key K that committed and wrote its audit row
- WHEN K is replayed
- THEN `PAGO_IDEMPOTENCIA_CONFLICTO` returns and no second Pago, receipt, or audit row is written
- TEST: integration

#### Scenario: Failed collection writes no audit row

- GIVEN a collection exceeding the pending balance
- WHEN `COBRO_EXCEDE_SALDO` returns
- THEN the transaction leaves no Pago and no `MovimientoAuditoria` row
- TEST: integration
