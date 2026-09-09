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

compra-core MUST NOT write inventory, `MovimientoInventario`, or `Producto.costoPromedio`, and MUST NOT expose any path to `RECIBIDA`/`PAGADA`. `InventoryEntryPort` consumption, `INVENTORY_SOURCE.PURCHASE`, and B11 generation remain documented seams only.

#### Scenario: Unreachable states

- GIVEN all compra use cases
- WHEN exercised
- THEN only →`PENDIENTE`/→`CANCELADA` transitions occur
