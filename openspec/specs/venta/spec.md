# Venta Specification

## Purpose

Draft-only sale engine (5b): `BORRADOR` lifecycle (create/update/cancel), DGII-safe mixed-rate ITBIS calculators with discount-before-ITBIS (ADR-018), venta client resolver with Consumidor Final default, stock WARN (never block) at draft save, admin-gated `DESC_MAX` discounts, tenant/branch-isolated drafts, and the first POS UI slice. Confirmation, NCF, inventory debit and payments are reserved for 5c.

## Task Notes (non-runtime)

- **precioVenta semantics (frozen decision)**: product/line prices are **ITBIS-exclusive** net bases; the customer pays `total = base + ITBIS`. This spec pins only the calculator behavior; the ADR-style note belongs in the design doc.
- **Carrito**: ephemeral client state; the persisted artifact IS the VENTA draft (erd-guia vocabulary). Abandoned `BORRADOR` drafts have **no auto-cleanup in V1** — manual, via the "mis borradores" list.
- **Reserved 5c seam (no stubs in 5b)**: `BORRADOR → CONFIRMADA`, NCF consumption, `SALIDA_VENTA` debit with the hard stock block, B01/B02 eligibility, credit-limit/mora blocking. `CONFIRMADA` is reachable in no 5b code path.

## Requirements

### Requirement: Create sale draft with mandatory client (R-V1)

`crearVenta` MUST persist a `BORRADOR` at the session `empresaId`+`sucursalId`, with a resolvable client (`clienteId` is NOT NULL — null input resolves to Consumidor Final via the 5a seam), ≥1 line (`productoId` owned by the tenant and active, `cantidad` Decimal(12,3) > 0, `precioUnitario` Decimal(12,2) ≥ 0), and structured discount metadata. Totals MUST be computed server-side by the calculators (never trusted from the client); all NOT NULL money columns and frozen per-line `tasaItbis` MUST persist; one audit row per create inside `withTenantTransaction`.

#### Scenario: Contado sale materializes CF

- GIVEN a create with `clienteId` null
- WHEN `crearVenta` runs
- THEN the draft persists referencing the empresa's single CF row from `getOrCreateConsumidorFinalEnTx`

#### Scenario: Empty line list rejected

- GIVEN zero lines submitted
- WHEN create runs
- THEN `LINEAS_VACIAS` returns and no row is written

### Requirement: Per-line ITBIS rate frozen with validity window (R-V2)

Each line MUST freeze `tasaItbis` (18/16/0) from the product at draft save. The rate's validity window MUST cover the sale date evaluated in `America/Santo_Domingo`; no valid rate row MUST fail the whole save with `TASA_ITBIS_VIGENCIA_FALTA` naming the product (config-style hard-fail parity with compra), zero writes.

#### Scenario: Expired rate window blocks save

- GIVEN a product whose ITBIS validity ended before the sale date (SD time)
- WHEN the draft saves
- THEN `TASA_ITBIS_VIGENCIA_FALTA` returns and no VENTA/DETALLE_VENTA row persists

### Requirement: Replace-all-lines update with client swap (R-V3)

`actualizarVenta` MUST run only while `BORRADOR` and MUST replace all lines (delete-and-reinsert) with recomputed totals; client re-selection MUST be allowed while draft through the resolver. A non-`BORRADOR` target MUST return `VENTA_INMUTABLE`; the guarded `UPDATE ... WHERE id AND empresaId AND estado='BORRADOR'` losing a race MUST return `CONCURRENCIA_CONFLICTO` with zero side effects (no `version` column exists — guarded predicate is the precedent).

#### Scenario: Client swapped while draft

- GIVEN a CF draft
- WHEN an update assigns an active named client of the same empresa
- THEN `clienteId` changes, totals recompute, exactly one audit row appends

#### Scenario: Concurrent editors

- GIVEN two parallel updates on one draft
- WHEN the guarded updates race
- THEN exactly one commits; the loser gets `CONCURRENCIA_CONFLICTO` and no mixed line-set persists

### Requirement: Guarded draft cancellation (R-V4)

`cancelarVenta` MUST transition `BORRADOR → CANCELADA` via one guarded `updateMany` with an affected-rows check; motivo MUST be optional (the draft never had fiscal effect); stock, NCF and payments MUST remain untouched; a second cancel MUST fail with stable `CONCURRENCIA_CONFLICTO` (guard matched zero rows) or `VENTA_INMUTABLE` (state read after commit) and MUST NOT append a second audit row.

#### Scenario: Double-click cancel

- GIVEN an already-cancelled draft
- WHEN the second cancel runs the guarded path
- THEN a stable typed error returns; state, audit count, stock and config are unchanged

### Requirement: Frozen per-line computation order (R-V5)

The pure calculator MUST process each line: `subtotalBruto = round2(cantidad × precioUnitario)` → resolve line discount by `descuentoTipo` (PORCENTAJE: `round2(bruto × valor/100)`; MONTO: `round2(valor)`) → net base = bruto − line discount → header proration (R-V6) → `itbisLinea = round2(base × tasa/100)` → totals are the **sums of per-line rounded values**. All arithmetic MUST be decimal strings with half-up 2dp rounding (decimal.js); floats MUST NOT appear. Persisted per-line `subtotalLinea`/`itbisLinea` MUST equal calculator output.

#### Scenario: Mixed rates with line discounts (fixture F2)

- GIVEN tenant `DESC_MAX` 25.00 (cap deliberately loose so fixtures exercise calculators) and lines, no header discount: 7 × 3.33 @18% disc MONTO 5.00; 5 × 4.15 @16% disc PORCENTAJE 3%; 2 × 12.90 @0%
- WHEN totals compute
- THEN net bases are 18.31 / 20.13 / 25.80 (line discounts 5.00 / 0.62) and ITBIS 3.30 / 3.22 / 0.00
- AND stored `subtotal` 69.86, `descuento` 5.62, `itbis` 6.52, `total` 70.76 (= Σbases 64.24 + ΣITBIS 6.52)

### Requirement: Header discount prorated before ITBIS across gravado/exento (R-V6)

The header discount MUST resolve to money and prorate **pro-rata by each line's net base** (after line discounts, denominator = Σ net bases over ALL lines, gravado and exento alike). Each share MUST be `round2` half-up; the aggregate remainder (`D − Σshares`) MUST be applied to the line with the **largest net base** (ties: earliest line position), so `Σshares = D` exactly. ITBIS is then computed on the reduced bases; 16%-lines count as gravado. The calculator MUST return `subtotalGravado`/`subtotalExento` — returned, never stored (no VENTA columns; 5c re-derives for Factura); the stored identity `total = subtotal − descuento + itbis` MUST hold exactly.

#### Scenario: Clean proration gravado + exento (fixture F1)

- GIVEN lines 3 × 10.00 @18% and 2 × 20.00 @0% (Σbruto 70.00) and header PORCENTAJE 10% (`DESC_MAX` 25.00)
- WHEN totals compute
- THEN shares are exactly 3.00/4.00, bases 27.00/36.00, ITBIS 4.86/0.00, gravado 27.00, exento 36.00, total 67.86

#### Scenario: Rounding remainder to largest line (fixture F3)

- GIVEN lines 30.00 @18%, 20.00 @16%, 30.00 @0% and header MONTO 7.00 (`DESC_MAX` 25.00)
- WHEN shares round half-up: 2.625/1.75/2.625 → 2.63/1.75/2.63 (Σ 7.01)
- THEN the −0.01 remainder lands on the first largest line → shares 2.62/1.75/2.63, Σ = 7.00
- AND bases 27.38/18.25/27.37, ITBIS 4.93/2.92/0.00, gravado 45.63, exento 27.37, `itbis` 7.85, total 80.85 (80.00 − 7.00 + 7.85)

### Requirement: Discount storage semantics (R-V7)

The persisted `descuento`/`descuentoLinea` columns MUST store the **resolved discount money** (2dp) — never the raw percentage input; `descuentoTipo` (NOT NULL) records the authorization form frozen at save and `descuentoAutorizadoPor` the admin actor. Zero discount MUST be stored as PORCENTAJE with 0.00; a MONTO 0.00 or any type/amount shape mismatch MUST be rejected with `DESCUENTO_INVALIDO`; no second money column MUST be introduced (ERD v4.7 frozen).

#### Scenario: Zero-discount convention

- GIVEN a draft saved without any discount
- WHEN the rows persist
- THEN header and every line store `descuentoTipo` PORCENTAJE with money 0.00 and NULL `descuentoAutorizadoPor`

### Requirement: Admin-only, DESC_MAX-capped discounts (R-V8)

Any positive discount (header or line) MUST pass a server-side Administrador check inside the tenant transaction (UI hiding MUST NOT be the control) or fail with `DESCUENTO_NO_AUTORIZADO`, recording `descuentoAutorizadoPor :=` the acting admin. The cap MUST come from DB `DESC_MAX` (venta-config), measured on gross bases: each line discount ≤ `DESC_MAX`% of its `subtotalBruto`; header percentage input ≤ `DESC_MAX`; total effective discount (line + header resolved) ≤ `DESC_MAX`% of Σ`subtotalBruto`. Any violation → `DESCUENTO_EXCEDE_MAXIMO`, zero writes. A resolved discount exceeding its base → `DESCUENTO_EXCEDE_BASE`. Post-invoice discounts MUST NOT use these paths (B04 is 5d).

#### Scenario: DGII 4% boundary (fixture F4)

- GIVEN `DESC_MAX` 4.00 and one line 100.00 @18%
- WHEN the header discount is PORCENTAJE 4.00
- THEN the draft stores base 96.00, ITBIS 17.28, total 113.28
- AND at PORCENTAJE 4.01 the save fails `DESCUENTO_EXCEDE_MAXIMO` with zero writes

#### Scenario: Non-admin submits discount

- GIVEN an Operador payload carrying any positive discount
- WHEN the action runs
- THEN `DESCUENTO_NO_AUTORIZADO` returns before any write

### Requirement: Stock shortage is a draft-save WARN, never a block (R-V9)

Draft save MUST NOT hard-block on insufficient sucursal stock: when a line quantity exceeds branch availability, the result payload MUST carry a structured `STOCK_INSUFICIENTE` warning (productoId, available, requested) while the save succeeds. No reservations exist in 5b; the authoritative block runs at 5c confirm inside the transaction with row locks (reserved seam note).

#### Scenario: Warning surfaces, draft persists

- GIVEN stock 2 at the session branch and a draft line quantity 5
- WHEN create runs
- THEN the draft saves AND the result payload includes exactly one `STOCK_INSUFICIENTE` warning

### Requirement: Venta client resolver (R-V10)

`resolverClienteParaVentaEnTx` MUST map null input → CF via the race-safe 5a seam; a given id MUST be loaded empresa-scoped: unknown or cross-tenant → `CLIENTE_NO_ENCONTRADO` with no existence leakage (PII parity), inactive → `CLIENTE_INACTIVO`. Fiscal ID MUST NOT be re-validated at sale time (validated at client create); credit-bearing clients MUST be allowed at draft while B01/NCF eligibility and credit/mora blocking are deferred to 5c/Fase 6. Inline new-client registration reuses the existing `crearCliente` action — no venta code.

#### Scenario: Cross-tenant client id

- GIVEN empresa A context and a client id owned by empresa B
- WHEN a draft references it
- THEN `CLIENTE_NO_ENCONTRADO` returns, indistinguishable from a never-existing id

### Requirement: Tenant and branch isolation of venta (R-V11)

Every VENTA/DETALLE_VENTA read and write MUST be scoped to session `empresaId` (+ `sucursalId` where applicable) inside `withTenantTransaction` with RLS GUCs set (existing `systemfact/server-action-must-wrap-tenant` ESLint rule); RLS enable+FORCE already covers both tables — no DB work in 5b. Cross-tenant/branch mutations MUST behave as not-found with zero effects.

#### Scenario: High-traffic draft isolation (mandatory)

- GIVEN drafts across empresa A/B and branches A1/A2
- WHEN any list/detail/update/cancel runs in another tenant or branch context
- THEN results contain only the session tenant+branch rows; foreign drafts are typed not-found with no leakage

### Requirement: Paginated listing and detail (R-V12)

`listarVentas` MUST filter by `empresaId` and session branch, support estado and `usuarioId` filters (the "mis borradores" view), paginate with default 25 / maximum 100, and order deterministically; unbounded `findMany` MUST NOT exist. Detail MUST load lines only for same-tenant drafts.

#### Scenario: Pagination bounds rejected

- GIVEN a page size of 500
- WHEN listing runs
- THEN a stable validation error returns and no unbounded query executes

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

