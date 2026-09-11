# Delta for venta

## ADDED Requirements

### Requirement: Atomic sale confirmation (R-V15)

`confirmarVenta` MUST run inside one tenant transaction in this observable order: read + branch guard → pure `transicionarConfirmar` (`BORRADOR → CONFIRMADA` only) → revalidate lines/tax rates → HARD stock preview (reject before any NCF burn) → NCF lock+consume (ncf-engine) → guarded `UPDATE ... WHERE estado='BORRADOR'` flip with affected-rows check → FACTURA creation (factura-emision) → `registrarSalidasVenta` batch. Any failure AFTER consumption MUST throw (never return-after-consume) so the flip, invoice, debit and NCF all roll back. Exactly one NCF per sale; retries on `CONFIRMADA` MUST NOT consume a second one.

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

### Requirement: Confirmed-sale cancellation (R-V16)

Cancelling a `CONFIRMADA` sale MUST run guarded `CONFIRMADA → CANCELADA` in one tenant transaction with: the FACTURA flipping `VIGENTE → ANULADA` (never deleted — "unused" NCF keeps fiscal reporting via Formato 608, D4); the consumed NCF staying consumed (`secuenciaActual` MUST NOT rewind); one `REPOSICION_CANCELACION` movement restoring each line's branch stock; audit rows for both state changes. Cancelling an already-`CANCELADA` sale MUST fail with the guarded zero-row stable error.

#### Scenario: Cancel restocks and annuls fiscally

- GIVEN a confirmed sale that debited 5 units at branch A1
- WHEN `cancelarVenta` runs on the `CONFIRMADA` sale
- THEN the sale is `CANCELADA`, the invoice is `ANULADA`, stock returns +5 via `REPOSICION_CANCELACION`, and the sequence counter is unchanged
- TEST: integration

#### Scenario: Draft-cancel path untouched

- GIVEN a `BORRADOR` sale
- WHEN cancel runs
- THEN existing R-V4 behavior applies (no invoice, no movement, no NCF) — confirmed path is not reachable from draft
- TEST: unit (pure transition)

### Requirement: Deterministic DESC_MAX window reader (R-V17)

The venta-config reader MUST resolve overlapping `ConfiguracionEmpresa` validity windows deterministically by `orderBy vigenciaInicio desc` (latest wins), never arbitrarily (CodeRabbit F5). The seed MUST assert zero window overlap per key+empresa and fail fast on violation.

#### Scenario: Latest window wins

- GIVEN two `DESC_MAX` rows with overlapping windows
- WHEN a draft reads the cap
- THEN the row with the newest `vigenciaInicio` is used
- TEST: integration

## MODIFIED Requirements

### Requirement: Pinned venta error catalog (R-V13)

The domain MUST expose `VentaResult<T>` over one versioned stable-code catalog — **19 codes** — base: `VENTA_NO_ENCONTRADO`, `VENTA_INMUTABLE`, `CONCURRENCIA_CONFLICTO`, `LINEAS_VACIAS`, `LINEA_INVALIDA`, `PRODUCTO_NO_ENCONTRADO`, `PRODUCTO_INACTIVO`, `TASA_ITBIS_VIGENCIA_FALTA`, `DESCUENTO_EXCEDE_MAXIMO`, `DESCUENTO_EXCEDE_BASE`, `DESCUENTO_INVALIDO`, `DESCUENTO_NO_AUTORIZADO`, `CLIENTE_NO_ENCONTRADO`, `CLIENTE_INACTIVO`; NEW for 5c confirm (R-V15): `NCF_AGOTADA`, `NCF_VENCIDA`, `NCF_SEC_INEXISTENTE`, `FACTURA_AUTOMATICA_FALTA`, `STOCK_INSUFICIENTE_BLOQUEO` (hard block at confirm, distinct from the draft warning). `STOCK_INSUFICIENTE` and `NCF_UMBRAL_90` remain **warning codes, never errors**. Every failure MUST carry stable code + user message + minimal context; stack traces/internal Prisma errors MUST NOT surface; DB states outside `EstadoVenta` MUST fail loud via the exhaustive `estadoVentaDesdeDb` mapping.
(Previously: 14 codes; no NCF/factura/confirm-block codes existed because CONFIRMADA was unreachable.)

#### Scenario: Unknown stored state fails loud

- GIVEN a VENTA row holding a state value outside the enum mapping
- WHEN any load maps it
- THEN a typed runtime error occurs, never a silent coercion
- TEST: unit

#### Scenario: Exhausted range surfaces stable code

- GIVEN an empresa whose B02 sequence is exhausted
- WHEN confirm runs
- THEN `NCF_AGOTADA` returns as a typed business error with user message and no Prisma internals
- TEST: integration

### Requirement: POS UI draft slice — acceptance (R-V14)

The POS screen MUST provide: product search by name/code showing branch availability; an ephemeral cart with add/remove and quantity/price edit showing live totals including the per-line ITBIS rate and gravado/exento breakdown; a client picker defaulting "Consumidor Final" with inline registration; a discount panel gated to Administrador (server-side re-enforcement stays R-V8); a stock-warning banner fed by `STOCK_INSUFICIENTE` payloads; "Guardar borrador" plus a "mis borradores" list with cancel. The **confirm control MUST now be rendered** for `BORRADOR` sales (disabled on first click; server revalidates per R-V15), and stable confirm errors (`NCF_*`, `FACTURA_AUTOMATICA_FALTA`, `STOCK_INSUFICIENTE_BLOQUEO`) MUST surface to the operator; payment controls MUST NOT be rendered (Fase 6). With an empty cart the save control MUST be disabled. Keyboard-led operation MAY be deferred (documented V1 limitation).
(Previously: no confirm affordance was rendered; `CONFIRMADA` was unreachable from UI.)

#### Scenario: Cart to draft to confirm

- GIVEN an authorized user builds a cart and saves
- WHEN the draft appears in "mis borradores" and confirm is clicked
- THEN totals render with the ITBIS breakdown, the confirm control is present and single-shot, and the sale shows `CONFIRMADA` with its NCF
- TEST: e2e

#### Scenario: Empty-cart guard

- GIVEN a cart with zero lines
- WHEN the user inspects the save control
- THEN "Guardar borrador" is disabled
- TEST: e2e
