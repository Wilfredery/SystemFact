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
