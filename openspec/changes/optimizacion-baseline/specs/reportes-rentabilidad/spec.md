# Delta for reportes-rentabilidad

## ADDED Requirements

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
