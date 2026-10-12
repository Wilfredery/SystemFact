# Delta for reportes-operacionales

## MODIFIED Requirements

### Requirement: OP-6 — Filter combination and pagination

All four reports MUST accept empresa + sucursal + date-range filters combined with AND, default 25 rows/page with hard clamp at 100, and support both full-period presets and arbitrary SD-date ranges (shared DB-5 contract). Invalid ranges return `REPORTE_VALIDACION` without executing a query. The interactive page cut MUST be applied with `LIMIT`/`OFFSET` (or an equivalent keyset predicate) at the data layer inside `infrastructure/`; fetching the whole filtered set into the application and slicing it (`slice(offset, offset + pageSize)`) is a defect. The `ORDER BY` of each paginated query MUST be identical to the ordering the current pre-slice sort produced, pinned by domain unit tests. Summary/aggregate rows MUST remain SQL-aggregated per OP-5 and MUST NOT depend on the paged rows. Regulated fiscal/TXT/CSV export paths owned by `reportes-export` / `reportes-fiscales` MUST remain unbounded by design.
(Previously: interactive paging sliced the full in-memory result set after fetching all rows; the cut now happens at the data layer.)

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

#### Scenario: Page cut executes at the database

- GIVEN a filtered operational report set of 5,000 rows
- WHEN an interactive page is requested
- THEN the query plan shows `LIMIT`/`OFFSET` returning exactly one page and no full-set fetch into the application
- TEST: integration

#### Scenario: Ordering pinned identical to the pre-slice sort

- GIVEN the paginated query replaces the former in-memory sort + slice
- WHEN page boundaries are walked
- THEN row order at every page equals the order the previous pre-slice sort produced (order-pinning unit test)
- TEST: unit
