# Reportes-Export Specification

## Purpose

Shared export seam (introduced slice A, live slice B, extended slice E): dependency-free server-generated CSV for every report and DGII TXT for fiscal reports, under the same authorization as on-screen consultation (UX decisions 2.5.2/2.5.3).

## Requirements

### Requirement: EXP-1 — Server-side dependency-free CSV

CSV MUST be generated server-side with zero new npm dependencies: RFC 4180 quoting (fields containing comma/quote/newline wrapped and doubled), CRLF line endings, UTF-8 without BOM, money serialized as `Decimal` text preserving full precision (never JS float), and byte-deterministic output for identical inputs and queries.

#### Scenario: Quoting and precision

- GIVEN a product name `Arroz, 5kg "premium"` and a Decimal amount 10.18
- WHEN the CSV is produced
- THEN the name is RFC-4180-quoted and the amount appears exactly as `10.18`
- TEST: unit

#### Scenario: Deterministic bytes

- GIVEN the same report run twice with unchanged data
- WHEN both CSV outputs are hashed
- THEN the hashes are identical
- TEST: unit

### Requirement: EXP-2 — Exports reuse the screen's canonical query

Each export MUST consume the exact same canonical use-case/query as its on-screen report — screen totals and CSV totals MUST match to the cent, enforced by a guard test per report family. The CSV contains the **full filtered dataset**, independent of screen pagination (25/100 pages never truncate an export).

#### Scenario: Totals parity guard

- GIVEN a period with 500 rows across 20 screen pages
- WHEN the CSV export runs with the same filters
- THEN the file has 500 detail rows and its totals equal the screen summary exactly
- TEST: integration

### Requirement: EXP-3 — Generation never blocks the UI

Export generation MUST run server-side (Server Action / route response streaming the file); no client-side loop over fetched pages, and no export may block interaction with the consultation screen.

#### Scenario: Screen stays interactive

- GIVEN a large export in progress
- WHEN the user navigates or changes filters on the report screen
- THEN screen consultation proceeds unaffected
- TEST: e2e

### Requirement: EXP-4 — Authorization identical to consultation

Export actions MUST apply the SAME server-side role gates as their on-screen consultation — an export bypass is a defect. Cobrador CSV exports are pinned to the CxC family and own branch exactly as FIN-3; anything else returns `REPORTE_NO_AUTORIZADO`. **Auditoría is NEVER exportable in V1**: no export path may reach audit models, even if its screen gate is passed.

#### Scenario: Cobrador export pinned

- GIVEN a Cobrador exporting the CxC report
- WHEN the CSV is generated
- THEN only their assignment branch's rows appear, and an attempted Ventas export is denied
- TEST: integration

#### Scenario: Audit export unreachable

- GIVEN any authenticated role, including Admin
- WHEN export paths are enumerated
- THEN no report/export code path queries `MovimientoAuditoria` for export
- TEST: integration

### Requirement: EXP-5 — Selector-first UX and fiscal format option

The `/reportes` UI MUST list available reports BEFORE offering export (decision 2.5.3): a report selector, then an "Exportar" action on the result, with searchParams deep links preserving filter state. Fiscal reports (606/607/608) additionally expose the DGII TXT format per decision 2.5.2 (FIS-6 rules).

#### Scenario: Deep link round-trip

- GIVEN a filtered CxC report URL
- WHEN it is opened directly and the user hits Exportar
- THEN the same filtered view renders and the CSV matches it
- TEST: e2e
