# Reportes-Dashboard Specification

## Purpose

Real KPI dashboard replacing the placeholder at `/dashboard`, plus the shared report-access contract (tenant pinning, admin company-wide read widen, pagination, error codes) every `reportes` use case inherits. Satisfies AC docs/15 §8.9 "Dashboard".

## Requirements

### Requirement: DB-1 — KPI content (AC §8.9)

The dashboard MUST show, for the pinned company: sales of the day and sales of the month (Santo Domingo calendar boundaries computed via the ratified `Intl` SD→UTC seam, no new dependency), top-selling products, pending fiscal invoices count + total, total CxC balance (canonical derived query), and general inventory state (units, low-stock and out-of-stock counts, inventory value). Confirmed sales (`Venta.estado=CONFIRMADA`) only; draft/cancelled excluded.

#### Scenario: Admin sees full KPI set

- GIVEN an admin with data across two branches
- WHEN they open `/dashboard`
- THEN all six KPI groups render with company-wide totals equal to the same canonical report queries the `/reportes` screens use
- TEST: integration

#### Scenario: Day/month boundaries follow SD time

- GIVEN a sale confirmed at 21:00 UTC (17:00 SD same day) and another at 03:00 UTC (23:00 SD previous day)
- WHEN the dashboard renders "ventas del día"
- THEN each sale counts in its Santo Domingo calendar day, never by raw UTC date
- TEST: unit (domain date-math fn)

### Requirement: DB-2 — Role gating on the dashboard

Admin sees all KPIs. Cobrador sees ONLY the CxC-family tile (own branch, pinned server-side to the assignment branch — no branch parameter accepted). Despachador and any other role see no report KPIs; their data queries MUST be rejected server-side with `REPORTE_NO_AUTORIZADO`. UI hiding is not the control.

#### Scenario: Cobrador limited view

- GIVEN an authenticated Cobrador assigned to branch S
- WHEN their dashboard loads and they invoke the CxC KPI action
- THEN only branch-S CxC figures return; invoking any other KPI action returns `REPORTE_NO_AUTORIZADO`
- TEST: integration

### Requirement: DB-3 — Shared tenant isolation for all report reads

Every report/dashboard use case MUST pin `empresaId` inside `withTenantTransaction` with RLS GUCs active; a code path without an `empresaId` scope is a defect. Money aggregations return `Decimal` (text across SQL boundaries); all totals come from SQL `GROUP BY`/`aggregate`, never fetch-then-sum in JS.

#### Scenario: Cross-tenant isolation

- GIVEN companies A and B with sales in the same period
- WHEN an A admin runs any report query
- THEN only A's rows aggregate, enforced by both query scope and RLS
- TEST: integration

### Requirement: DB-4 — Admin company-wide widen (read-only)

Company-wide reads by an admin MUST widen exactly like the ratified auditoria/inventario pattern: inside the transaction already pinned to `empresaId`, set the branch GUC `app.current_sucursal_id` to empty, and restore it in a `finally` block. The empresa GUC MUST NEVER be cleared. The widen is read-only; no mutation path may use it.

#### Scenario: Widen and restore

- GIVEN an admin requests a company-wide report
- WHEN the query executes
- THEN the branch GUC is empty only for the duration of that read and is restored afterward, verifiable in a session-state test; a failed read still restores via `finally`
- TEST: integration

### Requirement: DB-5 — Shared pagination and filter contract

Every list report defaults to 25 rows/page, hard-clamps requested size to 100, and shows the filtered total. Date filters MUST support both full calendar periods (day/week/month presets) and arbitrary SD-date ranges (wireframe answer 2.5.5); filters empresa + sucursal + date range MUST be combinable with AND (AC §8.9 "Filtro por empresa/sucursal"). Invalid filter input (e.g. `desde > hasta`) returns stable code `REPORTE_VALIDACION` without executing a query.

#### Scenario: Clamp and combine

- GIVEN 250 matching rows and a request for size 500 with sucursal + date filters active
- WHEN the page is served
- THEN 100 rows return with total 250, all filters applied as AND
- TEST: integration

### Requirement: DB-6 — Consultation writes no audit events

Report/dashboard screen consultation MUST NOT write `MovimientoAuditoria` rows in V1, matching the auditoria catalog scope (fiscal-report `LEER` events explicitly out of the 7a catalog and not added here).

#### Scenario: No audit side effects

- GIVEN an admin consults `/reportes` screens repeatedly
- WHEN the queries complete
- THEN the audit table row count is unchanged
- TEST: integration
