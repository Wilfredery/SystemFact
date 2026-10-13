# Reportes-Rentabilidad Specification

## Purpose

Product profitability report (slice D) per AC docs/15 §8.9 "Rentabilidad por producto": what was sold (cost price, output price, quantity), purchases per product, and the inversión/entrada/salida/capital/margen metrics — with the frozen cost-basis limitation documented in-spec.

## Requirements

### Requirement: REN-1 — Per-product metrics with pinned formulas

The report MUST show, per product in the filtered window: units sold and units purchased; **precio costo** = `Producto.costoPromedio` (current); **precio salida** = cantidad-weighted mean of `DetalleVenta.precioUnitario` (Σ(cantidad × precioUnitario) ÷ Σcantidad sold). The metrics are pinned to: **Inversión** = Σ(cantidad × costoUnitario) over purchases; **Entrada** = Σ quantities purchased where purchase estado ∈ {RECIBIDA, PAGADA} (received goods only — user-confirmed 2026-09-16; `PENDIENTE` excluded); **Salida** = Σ quantities sold; **Capital** = current stock × `costoPromedio`; **Margen** = ventas − (Salida × `costoPromedio`), plus margen % of ventas. All math in `Decimal`.

#### Scenario: Weighted output price and margen

- GIVEN 10 units sold at 100 and 40 at 90 (50 total), costoPromedio 60
- WHEN the row renders
- THEN precio salida = 92 (weighted), ventas = 50×92 = 4,600, margen = 4,600 − 50×60 = 1,600 = 34.78% of ventas
- TEST: unit (domain margin fn)

#### Scenario: Five metrics computed per spec

- GIVEN a product with purchases, sales, and remaining stock in the window
- WHEN the rentabilidad row renders
- THEN Inversión/Entrada/Salida/Capital/Margen each equal their pinned formula over the same filtered data
- TEST: integration

### Requirement: REN-2 — Period and branch filtering

The report MUST be filterable by SD-date period and by sucursal, combined with AND under the shared DB-5 contract; branch filtering scopes sales/purchases via their `sucursalId` and stock via `Inventario.sucursalId`.

#### Scenario: Branch-scoped profitability

- GIVEN sales in branches S1 and S2
- WHEN the report is filtered to S1
- THEN only S1 sales/purchases and S1 stock contribute to the row metrics
- TEST: integration

### Requirement: REN-3 — Cost-basis limitation rendered in-report and in CSV

Because `DetalleVenta` stores no per-line cost snapshot, historical margins are NOT reproducible: figures use the **current** `costoPromedio` and shift when new purchases land. The system MUST render this limitation as a visible disclaimer on the report screen AND include it in every exported CSV of this report (footer note), so no consumer mistakes the numbers for frozen history.

#### Scenario: Disclaimer travels with the export

- GIVEN an admin exports the rentabilidad CSV
- WHEN the file is produced
- THEN a trailing note states margins use current average cost and are not historical
- TEST: integration
### Requirement: REN-4 — Data-layer pagination for interactive pages

The interactive rentabilidad screen MUST cut pages with `LIMIT`/`OFFSET` (or an equivalent keyset predicate) at the data layer inside `infrastructure/`; fetching the full filtered product set and slicing it in memory (`pagina<T>` / `slice`) for the interactive screen is a defect. The `ORDER BY` pushed into the paginated query MUST be identical to the ordering the current pre-slice sort produced, pinned by a domain unit test. Page size defaults to 25 with a hard clamp at 100 (shared DB-5 contract); the server computes pages and the filtered total. All row metrics stay governed by REN-1 pinned formulas computed under the same filters, and the exported CSV path (REN-3) MUST remain excluded from pagination — this requirement governs the interactive screen only.

#### Scenario: Page cut executes at the database

- GIVEN a filtered window containing 800 product rows
- WHEN an admin requests pageSize 25
- THEN the query plan shows `LIMIT`/`OFFSET` returning exactly one page, with the filtered total computed server-side
- TEST: integration

#### Scenario: Ordering pinned identical to the pre-slice sort

- GIVEN the paginated query replaces the former in-memory sort + slice
- WHEN page boundaries are walked
- THEN row order at every page equals the order the previous pre-slice sort produced (order-pinning unit test)
- TEST: unit

#### Scenario: Metrics unaffected by paging

- GIVEN the same filter over two different page sizes
- WHEN any row renders
- THEN each row's Inversión/Entrada/Salida/Capital/Margen values are identical to the unpinned-formula results over the same filtered data (REN-1 unchanged)
- TEST: integration
