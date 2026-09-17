# Proposal: fase-7b-reportes — Reportes Module (Fase 7, reports half)

## Intent

The dashboard is a placeholder and SystemFact has zero report/export capability: no aggregation
queries, no CSV/Excel export infrastructure, no fiscal (DGII) report files. Businesses cannot see
sales, CxC/CxP, inventory value, profitability, or produce DGII 606/607/608 filings. This change
delivers the **Reportes** half of roadmap Fase 7: a real dashboard, the operational/financial/
analytical/profitability report fleet, and DGII fiscal exports — reusing existing canonical data
(CxC derived query, SD-timezone seam, auditoria admin-widen pattern).

## Problem / Why

- `app/src/app/dashboard/page.tsx` renders a provisional panel with no data (AC §8.9 unmet).
- No export code exists anywhere in `app/src` (verified: zero CSV/blob hits; no CSV/date deps).
- CxC balances exist only as the cobros screen; no aging/mora report view.
- Fiscal reporting (606/607/608 TXT, IT-1 data) is a legal obligation with no implementation.

## Goals

- Replace the dashboard placeholder with real KPIs (AC §8.9): day/month sales, top sellers,
  pending invoices + CxC, inventory state.
- Ship report catalog across 5 chained PR slices (A–E) under ONE SDD change.
- Server-generated, dependency-free CSV export + DGII TXT exporters validated against U1–U5.
- Follow ADR-013 `src/modules/reportes/{domain,application,infrastructure,http,ui}` on the
  auditoria template; SQL aggregation only (no fetch-then-sum in JS); Decimal everywhere.

## Non-goals

- **Caja daily close** — deferred to a separate future change; 7b neither builds nor links it.
- Advanced analytics (tendencias, rotación), advanced financial reports, real e-CF submission.
- Auditoría export (decided non-exportable in V1). Excel `.xlsx` (CSV only in V1).

## Scope — 5 slices (chained PRs, one SDD change)

| Slice | PR | Ships | Reports |
|---|---|---|---|
| **A** | 1 | Module skeleton: shared filter DTO (SD→UTC windows), pagination (25/100), admin GUC-widen read infra (clear branch GUC only, restore in `finally`), CSV export seam, `/reportes` shell + selector + searchParams deep links | **Dashboard** (ventas día/mes SD-tz, top sellers via `DetalleVenta` groupBy, CxC via canonical saldo query, inventory KPIs + valor) |
| **B** | 2 | Operational reports + CSV export live + Prisma index migration (`VENTA(empresaId,fecha)`, `FACTURA(empresaId,fechaEmision)`, `COMPRA(empresaId,fecha)`) | Ventas por período; Productos más/menos vendidos; Inventario actual/valorizado; Estado de facturas |
| **C** | 3 | Financial reports + comparativa | CxC con aging/mora (reuses `consultarSaldoCxcEnTx` + `en-mora.ts`; company-wide + optional invoice-branch narrowing); CxP (`Compra` PENDIENTE/RECIBIDA − Σ `PagoProveedor`); Comparativa analítica (current vs immediately-preceding equal-length window, variación monto + %) |
| **D** | 4 | Rentabilidad por producto | Precio costo (`Producto.costoPromedio`), precio salida, cantidad, margen; **documented limitation: historic margins not reproducible** (no per-line cost snapshot) |
| **E** | 5 | Fiscal + DGII export | ITBIS por período; **IT-1 = data summary (NOT TXT)**; 606/607/608 TXT exporters with U1–U5 pre-validation-tool acceptance criteria (below) |

Routes: single `/reportes` page + report selector (list-before-export per UX 2.5.2/2.5.3) +
searchParams deep links (auditoria pattern). Dashboard doubles as nav hub.

## Capabilities

### New Capabilities
- `reportes-dashboard`: KPI screen replacing the placeholder (AC §8.9).
- `reportes-operacionales`: ventas por período, productos vendidos, inventario, estado facturas + CSV.
- `reportes-financieros`: CxC aging, CxP, comparativa analítica.
- `reportes-rentabilidad`: product profitability with cost-basis limitation.
- `reportes-fiscales`: ITBIS summary, IT-1 data summary, 606/607/608 screens + TXT export with
  DGII pre-validation acceptance criteria (U1 encoding; U2 byte offsets; U3 Tipo-Ingreso codes;
  U4 Cancelada→608 scope; U5 606 record cap).
- `reportes-export`: shared server CSV seam (dependency-free, deterministic, paginated-safe).

### Modified Capabilities
None — no existing spec's requirements change. (Nav hub wiring in dashboard is UI, not spec.)

## Approach (chosen: chained slices in one change)

Mirror `auditoria` module verbatim: domain/ pure (filters, margin/aging/comparison Decimal math,
stable codes `REPORTE_NO_AUTORIZADO`, `REPORTE_VALIDACION`); application/ one use case per report
family `(tx, ctx, filtro)`; infrastructure/ ONLY Prisma raw-SQL `GROUP BY` aggregates + export
builders; http/actions.ts thin (Zod → ctx → `withTenantTransaction` → `tieneRolPermitidoEnTx`).
Admin company-wide read = clear ONLY branch GUC inside pinned empresa, restore in `finally`
(ratified auditoria/inventario pattern; empresa GUC never cleared). CxC report reuses the canonical
derived-balance SQL (ADR-017), never re-implements.

**Alternatives rejected:** one monolithic PR set (~6–10k LOC, violates 800-line review budget);
separate SDD changes per family (fragments specs for one roadmap phase).

## Decisions (confirmed user inputs, 2026-09-16 — binding)

1. 5 chained PRs, one SDD change (A→B→C→D→E). 2. Dependency-free server CSV; DGII research lane
partial-approved; IT-1 = summary not TXT. 3. Rentabilidad = current `costoPromedio` + documented
limitation. 4. Comparativa = immediately-preceding equal-length window. 5. Roles: Cobrador =
CxC-family only, own branch (server-enforced); all else Admin-only. 6. CxC consolidated company-wide
+ optional invoice-branch filter. 7. Single `/reportes` + selector + searchParams. 8. Caja close
deferred to separate change.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `app/src/modules/reportes/**` | New | Full module, slices A–E |
| `app/src/app/reportes/page.tsx` | New | Server shell (auditoria pattern) |
| `app/src/app/dashboard/page.tsx` | Modified | Replace placeholder with real KPIs |
| `app/prisma/schema.prisma` + migration | Modified | Aggregation indexes only (no new tables) |
| `app/src/modules/cobros/infrastructure/saldo-cxc.repository.ts` | Read-only reuse | CxC report consumes canonical query |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Cross-tenant leak via admin widen | Low if pattern copied verbatim | Branch-GUC-only clear + `finally` restore; ESLint tenant rule; tests |
| DGII byte-exact layout wrong | Medium | U1–U5 pre-validation-tool acceptance criteria gate slice E |
| Rentabilidad mistrust (cost drift) | Medium | Limitation documented in spec + UI disclaimer |
| Slow aggregations (no indexes) | Medium | Index migration ships with slice B |
| Slice size > 800-line budget | Medium | One PR per slice, enforced at tasks phase |

## Rollback Plan

Each PR is independently revertible (chained order A→E; revert in reverse). Dashboard revert =
restore placeholder page (kept in git history). Index migration is additive-only (drop indexes on
rollback). No data mutations anywhere — reports are read-only — so rollback has no data-repair risk.

## Dependencies

- `fase-7a` auditoria shipped (template + patterns) — satisfied.
- Slice E gated on U1–U5 validation (DGII pre-validation tool) at implementation time.
- No new npm dependencies.

## Success Criteria

- [ ] Dashboard shows AC §8.9 KPIs (día/mes ventas, top sellers, CxC, inventario) per role matrix.
- [ ] Every report filters empresaId (+ branch where applicable); admin widen only via ratified GUC pattern.
- [ ] All aggregation via SQL groupBy/aggregate; zero fetch-then-sum in JS; Decimal-only money.
- [ ] CSV export matches on-screen totals exactly (same canonical query).
- [ ] 606/607/608 TXT pass U1–U5 criteria; IT-1 renders casilla summary (débito/crédito/neto), no TXT claimed.
- [ ] Cobrador role sees only CxC-family views, own-branch enforced server-side; others deny-by-default.
- [ ] AC docs/15 §8.9 (dashboard + reportes) and rentabilidad criteria satisfied; pnpm test green.
