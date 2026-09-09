# Delta for compra (fase-4-compra-core)

## ADDED Requirements

### Requirement: Draft lifecycle with frozen per-line ITBIS

An Administrador MUST create/edit `BORRADOR` purchases: active supplier, date, branch, tipoCompra, ≥1 line (productoId, base-unit `cantidad` Decimal(12,3) > 0, `costoUnitario` Decimal(12,2), product ITBIS rate 18/16/0 frozen per line). `ncf`/`tipoNcf` are optional text; non-null `ncf` MUST be unique per empresa. Editing MUST be allowed only while `BORRADOR` — `PENDIENTE` is immutable (cancel-and-recreate).

#### Scenario: Valid draft saved

- GIVEN an active supplier and mixed-rate lines
- WHEN create/edit runs
- THEN NOT NULL money columns and frozen per-line `tasaItbis` persist, tenant-scoped

#### Scenario: Invalid line rejected

- GIVEN quantity ≤ 0 or an inactive/foreign product
- WHEN saving
- THEN a stable validation error returns and nothing is written

#### Scenario: Edit after confirm rejected

- GIVEN a `PENDIENTE` purchase
- WHEN a line edit is submitted
- THEN a stable immutability error returns and rows are unchanged

### Requirement: Mixed-rate fiscal totals

Totals MUST come from pure domain functions over Decimal-as-string: `subtotalGravado`, `itbis` (per-line sum at each frozen rate), `subtotalExento`, `subtotal`, and `total` = gross billed. Payable (total − retentions) MUST be display-derived, never stored.

#### Scenario: 18/16/0 mix

- GIVEN lines at 18%, 16%, 0%
- WHEN totals compute
- THEN `itbis` equals the per-line sum and `total` is gross

### Requirement: Config-driven ISR/ITBIS retentions

Retentions MUST follow tipoCompra × supplier class: ISR 15% (professional/rental, physical persons), ISR 2% (technical services), ITBIS 100% (informal suppliers), ITBIS 30% (professional services, legal entities), none (merchandise from formals). Rates MUST be read from `ConfiguracionEmpresa` keys `RET_ISR_15`, `RET_ISR_2`, `RET_ITBIS_100`, `RET_ITBIS_30` — never hardcoded; a missing applicable key MUST block confirm with a stable business error, with no legal-default fallback.

#### Scenario: Formal merchandise

- GIVEN a FORMAL supplier, keys present
- WHEN totals compute
- THEN both retentions are zero

#### Scenario: Missing key blocks confirm

- GIVEN `RET_ITBIS_100` absent, informal supplier
- WHEN confirm is requested
- THEN the stable config error returns; state stays `BORRADOR`

### Requirement: Confirm BORRADOR→PENDIENTE with unique correlativo

Confirm MUST use `EstadoCompra.PENDIENTE` (never CONFIRMADA vocabulary) via one guarded `UPDATE ... WHERE estado='BORRADOR' AND id=... AND empresaId=...` with affected-rows check inside `withTenantTransaction`, assigning `correlativoInterno` `CMP-%06d` from a per-empresa counter incremented atomically in-transaction, and appending one audit row with no inventory change. Retries MUST NOT duplicate the transition or the number; concurrent confirms MUST yield distinct sequential correlativos.

#### Scenario: Happy-path confirm

- GIVEN a valid draft
- WHEN confirm runs
- THEN state is `PENDIENTE` with a CMP number, one audit row, no `MovimientoInventario`

#### Scenario: Concurrent confirms

- GIVEN one draft confirmed twice in parallel, and two drafts confirmed together
- WHEN guarded updates race
- THEN one transition per draft succeeds, losers get a stable error, correlativos are unique

### Requirement: Cancel pre-receipt purchases

`BORRADOR`/`PENDIENTE` purchases MUST be cancelable by an Administrador to terminal `CANCELADA` with mandatory motivo in an in-transaction audit row. Cancel MUST produce no fiscal/inventory reversal and MUST NOT free the `ncf` uniqueness slot.

#### Scenario: Cancel with motivo

- GIVEN a `PENDIENTE` purchase
- WHEN cancel includes a motivo
- THEN state is `CANCELADA`, motivo audited, inventory untouched

#### Scenario: Missing motivo rejected

- GIVEN an empty motivo
- WHEN cancel is requested
- THEN a stable validation error returns; state unchanged

### Requirement: Paginated tenant-scoped listing and detail

Lists MUST filter by `empresaId`, paginate (default 25, max 100), and order deterministically; no unbounded `findMany`. Detail MUST load only same-empresa purchases with supplier and lines.

#### Scenario: Bounds and isolation

- GIVEN size 500, or another empresa's id
- WHEN list/detail run
- THEN size is rejected/bounded and cross-tenant reads return not-found

### Requirement: Administrador-only server-side access

Every compra Server Action MUST verify the Administrador role server-side within `withTenantTransaction`; hidden UI MUST NOT be the control.

#### Scenario: Non-admin invocation

- GIVEN an Operador calls any action directly
- WHEN authorization runs
- THEN the call is rejected with no data or audit change

### Requirement: 3.4b receipt/payment seams preserved

Purchase receipt MUST consume the `InventoryEntryPort` seam via inventario's exposed `registrarEntradaCompra` use case; compra MUST NOT compute or write inventory quantities, `MovimientoInventario`, or `Producto.costoPromedio` itself. A path to `RECIBIDA` is now opened solely through the receipt requirement above; `PAGADA` and B11 generation remain documented seams only, and no path to `PAGADA` or payment writes MUST exist.
(Previously: all seams were frozen â€” no `RECIBIDA`/`PAGADA` path and no inventory/cost writes at all.)

#### Scenario: Remaining frozen seams

- GIVEN all compra use cases
- WHEN exercised
- THEN only â†’`PENDIENTE`, â†’`RECIBIDA` (receipt), and â†’`CANCELADA` (pre-receipt) transitions occur; never â†’`PAGADA`, and no inventory or cost write originates in the compra module
### Requirement: Receipt transition PENDIENTE to RECIBIDA

The system MUST allow an Administrador to receive a `PENDIENTE` purchase into `RECIBIDA` in exactly one `withTenantTransaction` (nested tenant transactions MUST NOT occur), delegating stock entry and cost update to the inventario `registrarEntradaCompra` use case for ALL lines (full receipt only â€” no per-line quantities). Compra MUST NOT itself write stock, movements, or `costoPromedio`. Receipt MUST run only when the session branch equals the purchase branch; mismatch MUST return a typed business error. `BORRADOR`/`CANCELADA` purchases MUST NOT be receivable, and cancel of a `RECIBIDA` purchase MUST remain `TRANSICION_INVALIDA` until the deferred reversal change.

#### Scenario: Happy-path receipt

- GIVEN a `PENDIENTE` purchase at the session branch
- WHEN an Administrador receives it
- THEN state is `RECIBIDA`, stock increased only at that branch, `ENTRADA_COMPRA` movements carry `compraId`, `costoPromedio` updated exactly once, one audit row appended

#### Scenario: Wrong state or branch rejected

- GIVEN a `BORRADOR`, `CANCELADA`, or other-branch purchase
- WHEN receipt is requested
- THEN a typed state/branch error returns with zero writes

#### Scenario: Cancel after receipt still frozen

- GIVEN a `RECIBIDA` purchase
- WHEN cancel is attempted
- THEN `TRANSICION_INVALIDA` returns; no reversal exists yet

### Requirement: Idempotent receipt under retry

Receipt MUST first apply one guarded `UPDATE ... SET estado='RECIBIDA' WHERE estado='PENDIENTE' AND id=... AND empresaId=...` with an affected-rows check inside the transaction; zero affected rows MUST return the stable concurrency-conflict business error with zero inventory side effects. Retries and duplicate clicks MUST NOT duplicate entries, movements, or cost updates.

#### Scenario: Duplicate click

- GIVEN a purchase already received
- WHEN a second receipt arrives
- THEN the stable conflict error returns and stock, movements, and cost are unchanged

#### Scenario: Concurrent receipts race

- GIVEN two parallel receipts of one purchase
- WHEN both transactions run
- THEN exactly one commits with effects; the loser has zero side effects

### Requirement: Exhaustive purchase state mapping

Every DB `EstadoCompra` enum value (all five, including `RECIBIDA`) MUST be mapped to the domain type by an explicit total mapper; unchecked casts (e.g. `as EstadoCompraCore`) MUST NOT remain. An unmappable value MUST fail loudly via a typed runtime error or be rejected at compile time, never silently.

#### Scenario: RECIBIDA reads correctly

- GIVEN a stored `RECIBIDA` row
- WHEN list/detail loads it
- THEN it maps to domain `RECIBIDA` without error

#### Scenario: Unknown state fails loud

- GIVEN a state value outside the mapper
- WHEN a purchase is loaded
- THEN an explicit typed error occurs, not a silent coercion

