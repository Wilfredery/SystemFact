# Delta for venta

## MODIFIED Requirements

### Requirement: Atomic sale confirmation (R-V15)

`confirmarVenta` MUST run inside one tenant transaction in this observable order: read + branch guard → pure `transicionarConfirmar` (`BORRADOR → CONFIRMADA` only) → revalidate lines/tax rates → HARD stock preview (reject before any NCF burn) → **credit gate for credit sales via `EvaluarCreditoPort` — rejection MUST occur before the NCF lock/consumption** → NCF lock+consume (ncf-engine) → guarded `UPDATE ... WHERE estado='BORRADOR'` flip with affected-rows check → FACTURA creation (factura-emision) → `registrarSalidasVenta` batch → **for contado sales, register exactly one `COBRO/APLICADO` for the full invoice total in the same transaction**. Any failure AFTER consumption MUST throw (never return-after-consume) so the flip, invoice, debit, NCF and the contado COBRO all roll back. Exactly one NCF per sale; retries on `CONFIRMADA` MUST NOT consume a second one.
(Previously: no credit gate and no COBRO registration — cash invoices surfaced as PENDIENTE in CxC.)

#### Scenario: Happy-path confirm closes the loop

- GIVEN a `BORRADOR` with sufficient branch stock on an `facturaAutomatica=true` empresa with an active range
- WHEN `confirmarVenta` runs
- THEN the sale is `CONFIRMADA`, exactly one NCF is consumed, one `VIGENTE` FACTURA exists, and one `SALIDA_VENTA` per line debits branch stock
- TEST: e2e (Playwright POS confirm smoke, D9)

#### Scenario: Post-consume stock rejection rolls everything back

- GIVEN stock passes the preview but the salidas batch throws (concurrent drain)
- WHEN the transaction aborts
- THEN no NCF advance, no invoice, no movement persist and the sale remains `BORRADOR`
- TEST: integration

#### Scenario: Double-click confirm is idempotent

- GIVEN a sale already `CONFIRMADA`
- WHEN confirm runs again (or races a second click)
- THEN `VENTA_INMUTABLE`/`CONCURRENCIA_CONFLICTO` returns and no second NCF/invoice/debit exists
- TEST: integration

#### Scenario: Foreign-branch sale not confirmable

- GIVEN a sale owned by branch A1
- WHEN a session bound to A2 confirms it
- THEN typed not-found with zero effects
- TEST: integration

#### Scenario: Credit-blocked client rejected before NCF consumption (critical)

- GIVEN a credit sale whose client is over limit or overdue > 30 days
- WHEN confirm runs
- THEN the stable code (`LIMITE_CREDITO_EXCEDIDO` / `CLIENTE_EN_MORA` / `CREDITO_NO_HABILITADO`) returns before the NCF lock, and the sale remains `BORRADOR` with no NCF, invoice, debit or COBRO
- TEST: integration

#### Scenario: Contado sale derives PAGADA at confirm (critical)

- GIVEN a contado sale confirmed successfully
- WHEN the transaction commits
- THEN exactly one `COBRO/APLICADO` equal to the invoice total exists and the derived payment state is `PAGADA`
- AND if the transaction later aborts, no COBRO row persists
- TEST: integration
