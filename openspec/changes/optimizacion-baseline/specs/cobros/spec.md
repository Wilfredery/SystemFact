# Delta for cobros

## ADDED Requirements

### Requirement: Server-side pagination of the CxC board (R-C9)

The CxC board MUST be paginated server-side: the data layer serving board listings MUST apply the page cut (`LIMIT`/`OFFSET`, or an equivalent keyset predicate the repository supports) inside the query and MUST NOT transfer the full VIGENTE invoice set to the application layer to slice in memory. Ordering MUST be explicitly pinned to the current behavior (newest invoice emission first) and MUST NOT depend on in-memory re-sorting. Page size MUST default to 25 and clamp to a hard maximum of 100; the server MUST compute page boundaries and the filtered total count. The response MUST carry typed pagination metadata. Requests outside the clamp MUST be normalized or rejected with a stable validation error before any data access.

**Serving-strategy invariant:** the canonical derived-balance aggregate defined in capability `cobros-derived-balance` (R-B1) MUST remain byte-identical — pagination changes only how the page is served, never the balance formula, its VIGENTE-only filter, or its grouped single-aggregate shape. Any diff of the canonical aggregate block is a defect.

#### Scenario: Default page and filtered total

- GIVEN a tenant with 70 VIGENTE invoices carrying outstanding derived balances
- WHEN the CxC board requests page 1 with defaults
- THEN the server returns at most 25 invoices, the filtered total of 70, and typed pagination metadata
- TEST: integration

#### Scenario: Page-size clamp at 100

- GIVEN a board request with pageSize 250
- WHEN the page is served
- THEN the clamp caps the result at 100 rows, and no more than one page of invoice data leaves the database per request
- TEST: integration

#### Scenario: Newest-emission-first ordering preserved

- GIVEN invoices emitted across distinct dates in the tenant
- WHEN consecutive board pages are served
- THEN page 1 contains the newest-emission invoices first and subsequent pages continue the same ordering with no overlap or gap
- TEST: integration

#### Scenario: Derived-balance aggregate stays byte-identical (invariant)

- GIVEN the server-pagination change is deployed
- WHEN the canonical ADR-017 aggregate block is diffed against the baseline commit
- THEN no character differs (the page cut lives only in the outward page query, never inside the balance math)
- TEST: integration (grep-diff guard + business-rule suite unchanged)
