# Delta for reportes-financieros

## ADDED Requirements

### Requirement: FIN-6 — Data-layer pagination for interactive pages

Interactive report pages — including CxC aging page serving — MUST cut pages with `LIMIT`/`OFFSET` (or an equivalent keyset predicate) at the data layer inside `infrastructure/`; fetching the full filtered set and slicing it in memory (`pagina<T>` / `slice(offset, offset + pageSize)`) for an interactive screen is a defect. The `ORDER BY` pushed into the paginated query MUST be identical to the ordering the current pre-slice sort produced, pinned by domain unit tests. Page size defaults to 25 with a hard clamp at 100 (shared DB-5 contract); the server computes pages and the filtered total. Regulated export paths (CSV/TXT owned by `reportes-export` / `reportes-fiscales`, including the TXT exports that are unbounded by fiscal design) MUST remain excluded from this pagination — this requirement governs interactive screens only. Report math (aging buckets, derived balances) MUST stay governed by FIN-1/FIN-2 unchanged.

#### Scenario: Page cut executes at the database

- GIVEN a filtered aging set of 3,000 open invoices
- WHEN an admin requests pageSize 25
- THEN the query plan shows `LIMIT`/`OFFSET` returning exactly one page, with the filtered total reported server-side
- TEST: integration

#### Scenario: Ordering pinned identical to the pre-slice sort

- GIVEN the paginated query replaces the former in-memory sort + slice
- WHEN page boundaries are walked
- THEN row order at every page equals the order the previous pre-slice sort produced (order-pinning unit test)
- TEST: unit

#### Scenario: Exports stay unbounded

- GIVEN a fiscal/TXT export of report data is requested
- WHEN the export runs
- THEN no page-size clamp or pagination is applied to the export path and the interactive-only pagination never affects fiscal completeness
- TEST: integration
