# Reportes-Financieros Specification

## Purpose

Financial report fleet (slice C): CxC con aging/mora, CxP, and the basic analytical comparativa. Inherits the shared tenant/pagination contract from `reportes-dashboard`. Balances are always derived (ADR-017), never materialized.

## Requirements

### Requirement: FIN-1 — CxC aging reuses the canonical derived query

The CxC report MUST reuse the canonical balance query `consultarSaldoCxcEnTx` (total − Σpagos COBRO·APLICADO − ΣNC VIGENTE + ΣND VIGENTE over `Factura.estado='VIGENTE'`); re-implementing balance math in the report is a defect (ADR-017). The report defaults to company-wide consolidated (admin widen DB-4); an optional narrowing filter on `Factura.sucursalId` MUST be a plain WHERE predicate — the branch GUC stays pinned, never widened, when a branch filter is active.

#### Scenario: Canonical reuse guard

- GIVEN invoices with payments and credit notes in the period
- WHEN the CxC report runs
- THEN every per-invoice balance equals `consultarSaldoCxcEnTx` output exactly (shared-query guard test)
- TEST: integration

#### Scenario: Branch narrowing without widen

- GIVEN an admin filters CxC by branch S
- WHEN the query executes
- THEN a `Factura.sucursalId = S` WHERE is applied and the branch GUC is never emptied
- TEST: integration

### Requirement: FIN-2 — Aging buckets and due-date rule

The system MUST classify each open invoice into buckets **Al día / Vencido 1–30 / 31–60 / 60+ días** using the existing pure `en-mora` logic. Due date = `fechaEmision + Cliente.plazoCreditoDias`; when the client has no term, the default credit-term parameter MUST be read from DB (`ConfiguracionEmpresa` `PLAZO_CREDITO`), never hardcoded.

#### Scenario: Bucket assignment

- GIVEN a credit invoice due 15 days ago
- WHEN the aging report renders
- THEN it falls in Vencido 1–30 with amount and client breakdown
- TEST: unit (domain bucketing fn)

#### Scenario: Term fallback to DB parameter

- GIVEN a client with `plazoCreditoDias` null and company parameter PLAZO_CREDITO = 30
- WHEN the due date is computed
- THEN the 30-day DB parameter applies
- TEST: integration

### Requirement: FIN-3 — Cobrador restricted to CxC family, own branch

A Cobrador MUST be served ONLY CxC-family views (report + dashboard tile), pinned server-side to their assignment branch via the GUC context — no branch parameter accepted, no client-supplied override honored. Any other report family (CxP, comparativa, operational, fiscal, rentabilidad) MUST be rejected with `REPORTE_NO_AUTORIZADO` before data access. UI hiding is not the control.

#### Scenario: Cobrador cross-family denial

- GIVEN an authenticated Cobrador of branch S
- WHEN they invoke the CxP report action directly
- THEN `REPORTE_NO_AUTORIZADO` returns with zero rows read
- TEST: integration

### Requirement: FIN-4 — CxP derived unpaid balance

The CxP report MUST show, per purchase with `Compra.estado ∈ {PENDIENTE, RECIBIDA}`, the unpaid portion = total − Σ`PagoProveedor` applied; PAGADA purchases net to zero and openCxP MUST be derived at query time, never materialized.

#### Scenario: Partially paid purchase

- GIVEN a RECIBIDA purchase of 1,000 with a 400 supplier payment
- WHEN the CxP report renders
- THEN the purchase shows 600 outstanding and totals match
- TEST: integration

#### Scenario: PAGADA nets out

- GIVEN a purchase whose payments equal its total
- WHEN the CxP report renders
- THEN it contributes 0 to the outstanding total
- TEST: integration

### Requirement: FIN-5 — Comparativa período actual vs anterior

The comparativa MUST contrast the current filtered window against the **immediately-preceding equal-length SD window**, showing variación in monto and percentage. When the previous-window total is zero, percentage variation MUST render 0 (no division by zero). Invalid ranges return `REPORTE_VALIDACION` without executing a query. The Total row MUST show the current period only (wireframe decision 2.5.1).

#### Scenario: Equal-length preceding window

- GIVEN a query for SD range 2026-03-01..2026-03-31
- WHEN the comparativa runs
- THEN the baseline is exactly 2026-02-01..2026-02-28 and both montos plus variación % appear
- TEST: unit (domain window math)

#### Scenario: Zero baseline and Total row

- GIVEN no sales in the preceding window
- WHEN the report renders
- THEN variación % shows 0 and the Total row carries only the current-period figures
- TEST: integration
