# Tasks: fase-7b-reportes — Reportes Module (Slices A–E)

## Review Workload Forecast

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

| Slice | PR | Est. changed lines | >400 budget | >800 project budget |
|---|---|---|---|---|
| A dashboard+infra | 1 | ~950–1,300 | High | Borderline |
| B operational+CSV+migration | 2 | ~1,100–1,500 | High | Yes |
| C CxC/CxP/comparativa | 3 | ~1,000–1,300 | High | Borderline |
| D rentabilidad | 4 | ~600–900 | High | Borderline |
| E fiscal+DGII | 5 | ~1,000–1,500 | High | Yes |
| Total | 5 PRs | ~4,650–6,500 | High | — |
Chained PRs mandatory (bound input); A/B/E exceed the 800-line project budget — if a slice inflates beyond 800 in apply, split further intra-slice. Delivery = ask-on-risk → user must pick chain strategy (stacked-to-main vs feature-branch-chain) before apply.

### Work Units (per slice, one PR each)

| Unit | PR | Focused test | Harness | Rollback |
|---|---|---|---|---|
| A | PR1 | `pnpm jest src/modules/reportes/domain` | `/dashboard` + `/reportes` shell live | revert A slice files; restore placeholder |
| B | PR2 | `pnpm jest src/modules/reportes` | report screens + one CSV round-trip | additive migration; drop indexes |
| C | PR3 | `pnpm jest src/modules/reportes/application` | CxC/CxP screens vs cobros | revert slice C files |
| D | PR4 | `pnpm jest src/modules/reportes/domain margin` | rentabilidad screen/CSV | revert slice D files |
| E | PR5 | `pnpm jest src/modules/reportes/domain dgii` | DGII pre-validation tool U1–U5 | revert slice E files |

Threat-matrix: all rows `N/A` (no shell/VCS/PR automation) — category RED tests below cover the real-risk boundaries instead.

## Slice A — Dashboard + shared infra (PR 1)

- [x] 1.1 Create `app/src/modules/reportes/domain/` pure contracts: `reporte-filtro.ts` (SD→UTC window via ratified `Intl` seam, `desde>hasta` → `REPORTE_VALIDACION`, presets, clamp 25/100), `reporte-resultado.ts` (Pagina/ReportResult/error codes). Unit RED: invalid range, clamp, SD window. (DB-3, DB-5)
- [x] 1.2 RED→GREEN: admin widen helper `infrastructure/widen-sucursal-guc.ts` — clears ONLY `app.current_sucursal_id` inside pinned tx, restores in `finally`; RED test prove restore on success+failure and empresa GUC never cleared. (DB-4)
- [x] 1.3 RED→GREEN: `infrastructure/csv-writer.ts` dependency-free RFC4180 CSV (CRLF, UTF-8 no BOM, Decimal as text, deterministic bytes). (EXP-1)
- [x] 1.4 Create `app/src/app/reportes/page.tsx` + `ui/report-selector.tsx`: selector-first shell, searchParams deep links (`?reporte&desde&hasta&sucursalId&page&pageSize`). (EXP-5)
- [x] 1.5 RED→GREEN dashboard domain fns: SD day/month boundary math (unit). (DB-1)
- [x] 1.6 Create `application/` KPI use cases (ventas día/mes, top sellers via `DetalleVenta` groupBy, CxC canonical balance, inventory value/low/out) reusing report queries — no duplicated SQL. (DB-1, DB-3)
- [x] 1.7 Modify `app/src/app/dashboard/page.tsx`: role-aware KPIs + `/reportes` hub; server-side role gate (Cobrador → CxC tile own branch only; others → `REPORTE_NO_AUTORIZADO`). (DB-2)
- [x] 1.8 Integration tests: cross-tenant isolation, widen restore, clamp+combined filters, no-audit-writes. Verify: `pnpm lint && pnpm tsc --noEmit && pnpm jest reportes`. Commit `feat(reportes): shared contract + dashboard`. (DB-2..DB-6)

## Slice B — Operational reports + CSV live + index migration (PR 2)

- [x] 2.1 **Own isolated commit (Migration-only, never mixed)**: add `app/prisma/migrations/*_reportes_indexes/migration.sql` — indexes `VENTA(empresaId, fecha)`, `FACTURA(empresaId, fechaEmision)`, `COMPRA(empresaId, fecha)`; additive only. `pnpm prisma validate`. Commit `chore(db): reportes aggregation indexes`.
- [x] 2.2 RED→GREEN domain ranking: units-first, tie → descending monto. (OP-2)
- [x] 2.3 `infrastructure/` SQL repositories: ventas por período (CONFIRMADA only, SD day groups), productos vendidos, inventario valorizado per branch, estado de facturas (derived payment state via ADR-017, never materialized); `$queryRaw` groupBy, money as Decimal text. (OP-1, OP-3, OP-4, OP-5)
- [x] 2.4 Application use cases `consultarVentasPorPeriodo`, `consultarProductosVendidos`, `consultarInventarioValorizado`, `consultarEstadoFacturas` (tx, ctx, filtro) + thin `http/actions.ts` (Zod, role gate, invalid range rejected pre-query). (OP-6)
- [x] 2.5 CSV export action + EXP-2 totals-parity guard test (screen==CSV, page-independent). (EXP-2, EXP-3)
- [x] 2.6 Verify slice B: `pnpm lint && pnpm tsc --noEmit && pnpm jest`; commit `feat(reportes): operational reports + CSV`.

## Slice C — CxC/CxP/Comparativa (PR 3)

- [x] 3.1 RED→GREEN `domain/aging.ts` buckets (Al día/1–30/31–60/60+, `en-mora` reuse) and `domain/ventana-comparativa.ts` equal-length preceding SD window. (FIN-2, FIN-5)
- [x] 3.2 CxC report reusing `consultarSaldoCxcEnTx` — reuse guard test + branch-narrowing test proving NO widen when `Factura.sucursalId` filter active; company-wide = DB-4 pattern. (FIN-1)
- [x] 3.3 CxP report: `Compra` PENDIENTE/RECIBIDA − Σ`PagoProveedor`; PAGADA nets 0; derived at query time. (FIN-4)
- [x] 3.4 Comparativa current vs preceding window, variación monto/%, zero baseline → % 0, current-only Total row. (FIN-5)
- [x] 3.5 RED Cobrador cross-family test: CxP/others → `REPORTE_NO_AUTORIZADO` zero rows read. (FIN-3)
- [x] 3.6 Slice verify + commit `feat(reportes): financial reports (CxC aging, CxP, comparativa)`.

## Slice D — Rentabilidad (PR 4)

- [x] 4.1 RED→GREEN `domain/margen.ts`: weighted precio salida, Margen = ventas − Salida×costoPromedio, margen%. (REN-1)
- [x] 4.2 Infrastructure + use case: five metrics per product (`inv capital = stock×costoPromedio`), period+sucursal AND filters. (REN-1, REN-2)
- [x] 4.3 UI + visible cost-limitation disclaimer; CSV carries footer note. (REN-3)
- [x] 4.4 Slice verify + commit `feat(reportes): rentabilidad por producto`.

## Slice E — Fiscal + DGII TXT (PR 5)

- [x] 5.1 RED→GREEN `domain/dgii/`: fixed-width padding (alnum right-space, numeric zero-left), 607 payment cross-foot D17–D23 = gross incl ITBIS, B02 ≥ RD$250,000 inclusive boundary, en-cero file, deterministic cap splits (607≤65,000, 608≤4,999), filename `DGII_F_<code>_<RNC>_<AAAAMM>.TXT`. (FIS-3, FIS-6)
- [x] 5.2 RED→GREEN U3 backing: Tipo-Ingreso map stored in DB parameters (`ConfiguracionEmpresa`), never a constant; validated code table from Anexo B/pre-val tool. (FIS-3, U3)
- [x] 5.3 607 exporter: VIGENTE B01/B02≥250k/B03/B04 rows from canonical aggregates. (FIS-3)
- [x] 5.4 606 exporter: Compra RECIBIDA/PAGADA only; detail layout per FIS-4 (goods/services split, B11 no ITBIS credit). (FIS-4)
- [x] 5.5 608 exporter: `estadoFiscal=ANULADA` only; RED test — CANCELADA appears in neither 607 nor 608. (FIN/FIS-5)
- [x] 5.6 ITBIS summary + IT-1 casilla worksheet (débito/crédito/retenido checking = Σ606 retenido = casilla 60; neto; no TXT claimed). (FIS-1, FIS-2)
- [x] 5.7 DGII pre-validation loop (U1–U5 explicit gates, blocker to slice-E-ship): **U1** encoding/no-BOM/CRLF round-trip; **U2** byte offsets vs tool/Excel template; **U3** Tipo-Ingreso codes; **U4** Cancelada/never-issued → confirm not in 608; **U5** 606 current cap. Fixture-driven writer loop, record zero-error evidence.
- [x] 5.8 CSV/TXT actions with authorization parity RED: Cobrador export pinned CxC+own branch; no path touches `MovimientoAuditoria`. (EXP-4)
- [x] 5.9 Slice verify + commit `feat(reportes): fiscal reports + DGII TXT exporters` + attach pre-val evidence to PR.

## Verification (final)

- [x] 6.1 Coverage walk: DB-1..6, OP-1..6, FIN-1..5, REN-1..3, FIS-1..6, EXP-1..5 → passing tests map; `pnpm test` green. (104 suites / 911 tests green + 44 reportes integration tests; 29/31 reqs mapped, 3 documented gaps in verify-walk.md.)
- [x] 6.2 PRs A→E each green CI, own commits, index migration isolated; reverse-revert rehearsed. (Branches pushed 2026-09-17; PRs #48–#52 created stacked-to-main; `chore(db)` index migration isolated in 13de13a; reverse-revert rehearsed in verify-walk.md. CI runs on the new PRs — confirm green before merging.)
