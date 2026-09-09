# Delta for compra (fase-3-4b-compra-inventario)

## ADDED Requirements

### Requirement: Receipt transition PENDIENTE to RECIBIDA

The system MUST allow an Administrador to receive a `PENDIENTE` purchase into `RECIBIDA` in exactly one `withTenantTransaction` (nested tenant transactions MUST NOT occur), delegating stock entry and cost update to the inventario `registrarEntradaCompra` use case for ALL lines (full receipt only — no per-line quantities). Compra MUST NOT itself write stock, movements, or `costoPromedio`. Receipt MUST run only when the session branch equals the purchase branch; mismatch MUST return a typed business error. `BORRADOR`/`CANCELADA` purchases MUST NOT be receivable, and cancel of a `RECIBIDA` purchase MUST remain `TRANSICION_INVALIDA` until the deferred reversal change.

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

## MODIFIED Requirements

### Requirement: 3.4b receipt/payment seams preserved

Purchase receipt MUST consume the `InventoryEntryPort` seam via inventario's exposed `registrarEntradaCompra` use case; compra MUST NOT compute or write inventory quantities, `MovimientoInventario`, or `Producto.costoPromedio` itself. A path to `RECIBIDA` is now opened solely through the receipt requirement above; `PAGADA` and B11 generation remain documented seams only, and no path to `PAGADA` or payment writes MUST exist.
(Previously: all seams were frozen — no `RECIBIDA`/`PAGADA` path and no inventory/cost writes at all.)

#### Scenario: Remaining frozen seams

- GIVEN all compra use cases
- WHEN exercised
- THEN only →`PENDIENTE`, →`RECIBIDA` (receipt), and →`CANCELADA` (pre-receipt) transitions occur; never →`PAGADA`, and no inventory or cost write originates in the compra module
