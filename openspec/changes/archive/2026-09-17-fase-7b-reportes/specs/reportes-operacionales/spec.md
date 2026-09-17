# Reportes-Operacionales Specification

## Purpose

Operational report fleet (slice B): ventas por período, productos más/menos vendidos, inventario actual/valorizado, estado de facturas. All reads inherit the shared contract from `reportes-dashboard` (DB-3 tenant pinning, DB-4 admin widen, DB-5 pagination/filters). Satisfies AC docs/15 §8.9 "Filtro por empresa/sucursal".

## Requirements

### Requirement: OP-1 — Ventas por período

The system MUST report confirmed sales (`Venta.estado = CONFIRMADA`) grouped by day within the filtered range, with a summary row (total ventas, total monto); BORRADOR and CANCELADA rows MUST be excluded. Day boundaries MUST be Santo Domingo calendar days computed via the ratified SD→UTC seam, never raw UTC dates.

#### Scenario: Confirmed-only with SD day boundaries

- GIVEN a CONFIRMADA sale at 03:00 UTC (23:00 SD previous day) and a CANCELADA sale same UTC day
- WHEN admin requests the period report
- THEN the confirmed sale is grouped in its SD calendar day and the cancelled sale appears nowhere
- TEST: integration

### Requirement: OP-2 — Productos más/menos vendidos

The system MUST rank products by **units sold** (`DetalleVenta.cantidad` summed over CONFIRMADA sales in the window); total monto is a secondary displayed column. Ranking ties MUST be broken by descending monto.

#### Scenario: Units-first ranking

- GIVEN product X with 100 units at RD$5 each and product Y with 90 units at RD$50 each
- WHEN the top-sellers report renders
- THEN X ranks above Y (units decide) while Y's larger monto column is still shown
- TEST: unit (domain ranking fn)

#### Scenario: Tie broken by monto

- GIVEN two products with identical units sold but different montos
- WHEN the ranking is produced
- THEN the higher-monto product ranks first
- TEST: unit

### Requirement: OP-3 — Inventario actual y valorizado

The system MUST show current stock **per branch** (`Inventario.cantidad`, unique per sucursal+producto) with valorized amount = `Inventario.cantidad × Producto.costoPromedio`, plus low/out-of-stock flags from `stockMinimo`.

#### Scenario: Branch-scoped valuation

- GIVEN product P with 10 units in branch S1 (costoPromedio 4.00) and 5 in S2
- WHEN the inventory report is filtered to S1
- THEN only S1's 10 units / RD$40.00 valuation appear
- TEST: integration

### Requirement: OP-4 — Estado de facturas

The system MUST present a grid of `Factura.estado` (VIGENTE/CANCELADA/ANULADA) × `tipoNcf` counts and montos, with payment state (Pendiente/Parcial/Pagada) computed as the ADR-017 canonical derived balance (total − Σpagos − ΣNC + ΣND); payment state MUST NEVER be materialized or cached.

#### Scenario: Derived state, never stored

- GIVEN an invoice with a partial payment
- WHEN the estado-de-facturas grid renders
- THEN it shows Parcial computed live from the canonical query; no column in FACTURA stores this state
- TEST: integration

### Requirement: OP-5 — SQL-aggregation and Decimal discipline

Every operational report MUST aggregate in SQL (`GROUP BY`/`aggregate`) inside `infrastructure/`; fetching rows to sum in JS is a defect. All money results MUST be `Decimal` (text across SQL boundaries), never `number`/float.

#### Scenario: Aggregation pushdown

- GIVEN 10,000 sale rows in the period
- WHEN the period report runs
- THEN the query plan shows grouped aggregation returning one row per day, not per-sale rows into the app process
- TEST: integration

### Requirement: OP-6 — Filter combination and pagination

All four reports MUST accept empresa + sucursal + date-range filters combined with AND, default 25 rows/page with hard clamp at 100, and support both full-period presets and arbitrary SD-date ranges (shared DB-5 contract). Invalid ranges return `REPORTE_VALIDACION` without executing a query.

#### Scenario: Combined filters with clamp

- GIVEN a request for size 250 with sucursal S + arbitrary desde/hasta active
- WHEN the report serves a page
- THEN 100 rows return with the filtered total shown, all filters ANDed
- TEST: integration

#### Scenario: Invalid range rejected pre-query

- GIVEN `desde > hasta`
- WHEN any operational report action is invoked
- THEN `REPORTE_VALIDACION` returns and no Prisma query executes
- TEST: unit
