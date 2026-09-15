# Credit Control Specification

## Purpose

Credit eligibility, limit and mora evaluation for credit sales, owned by cobros and consumed by venta through a narrow port backed by the canonical derived-balance query.

## Requirements

### Requirement: Thin cross-module credit port (R-K1)

The cobros module MUST expose `EvaluarCreditoPort` (`evaluarCreditoCliente(tx, ctx, { clienteId, totalVenta, fecha })`) with a `TenantCtx` + Decimal-string contract over the caller's tenant transaction. Venta MUST consume only this port — no cobros infrastructure imports, no ORM leakage, no duplicated balance rules in venta.

#### Scenario: Port-only coupling

- GIVEN the venta confirm flow evaluating credit
- WHEN the port is called
- THEN it receives the active tenant transaction and returns a typed allow/reject result with a stable code
- TEST: integration

### Requirement: Credit gate rules (R-K2)

For a credit sale the evaluation MUST reject with stable codes: client `creditoHabilitado=false` → `CREDITO_NO_HABILITADO`; pending balance + `totalVenta` exceeding `limiteCredito` → `LIMITE_CREDITO_EXCEDIDO`; any invoice overdue by more than 30 days (America/Santo_Domingo) → `CLIENTE_EN_MORA`. All decisions MUST reuse the canonical aggregate — no second balance source.

#### Scenario: Over-limit rejection

- GIVEN `limiteCredito` 20,000.00, pending 18,000.00, new sale 5,000.00
- WHEN credit is evaluated
- THEN `LIMITE_CREDITO_EXCEDIDO` is returned
- TEST: integration

#### Scenario: Overdue client rejection

- GIVEN a client with one unpaid invoice 31 days past due (SD time)
- WHEN credit is evaluated
- THEN `CLIENTE_EN_MORA` is returned
- TEST: integration

#### Scenario: Exactly-at-limit passes

- GIVEN pending + sale equals `limiteCredito` exactly
- WHEN evaluated
- THEN the sale is allowed (limit is inclusive)
- TEST: unit

#### Scenario: REVERTIDO payments do not block

- GIVEN a client whose apparent over-limit state disappears once `REVERTIDO` cobros are excluded
- WHEN credit is evaluated
- THEN the sale is allowed (the canonical filter governs)
- TEST: integration

#### Scenario: Non-credit sales skip the gate

- GIVEN a contado sale for any client
- WHEN confirmed
- THEN credit evaluation is not required to pass (only credit sales are gated)
