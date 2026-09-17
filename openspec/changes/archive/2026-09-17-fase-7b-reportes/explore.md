# Exploration — fase-7b-reportes (Reports module — Fase 7 reports half)

Scope: the **Reportes** half of roadmap Fase 7 ("Reportes y auditoría"). Dashboard, operational
and financial reports, the basic analytical comparison, profitability per product, fiscal reports
(IT-1, Formatos 606/607/608) and their export. Auditoría (`fase-7a`, shipped) is out of scope;
the daily cash close lives **only** in Caja and is NOT duplicated here.

Sources of truth read: `docs/10-roadmap_del_sistema.md` (Fase 7 + out-of-scope), `docs/05-modulosFact.md` §3/§16,
`docs/11-pendientes_y_decisiones_abiertas.md` (Reportes administrativos + 07-Reportes decided answers),
`docs/15-criterios_de_aceptacion.md` §8.9, `docs/16-flujos_ux.md` §11/§12, `docs/17-plan_wireframes.md`,
`docs/18-evaluacion_por_fases.md` (07a/07b accepted wireframe criteria), `docs/19-directivas_desarrollo.md` §(SQL aggregation),
`AGENTS.md`, `openspec/config.yaml`. Code read: `app/prisma/schema.prisma` (full), `app/src/modules/auditoria/**`
(template), `app/src/modules/tenant/**`, `app/src/modules/cobros/infrastructure/saldo-cxc.repository.ts`,
`app/src/modules/inventario/**` (KPIs + company-wide aggregate), `app/src/app/**` (routes), `app/package.json`.

---

## Current State

**The dashboard is a placeholder.** `app/src/app/dashboard/page.tsx` renders a "panel provisional"
that explicitly says it will be replaced in later phases. No KPIs, no data queries. The real dashboard
is therefore IN scope for 7b. There is no `/caja` route, no `caja` module and no `CIERRE_CAJA` table —
**the daily close and the "resumen del día con costo y margen" (roadmap Fase 6 / AC §8.9) were never
built** (archive shows `2026-09-15-fase-6-cobros-credito` delivered payments/credit only). The decided
rule stands: cierre lives only in Caja; 7b must not create a close report, but the gap is flagged
(open question Q8).

**No export infrastructure exists anywhere.** Grep across `app/src` for `text/csv|Blob(|download` →
zero hits. `package.json` has no spreadsheet/CSV/date library (no `date-fns-tz`, no `exceljs`/`xlsx`,
no `papaparse`). Money handling is `decimal.js` + Prisma `Decimal` + `::text` casts across raw SQL.
Every export (CSV/Excel and the DGII fiscal layout) is greenfield, server-side per AGENTS ("server-side
generation, never blocks UI" spirit — nothing today blocks or exports).

**Tenant/report shape: company-wide admin reads already have a ratified pattern.** `TenantCtx` pins
`empresaId + sucursalId` (P6 closed company-wide operating mode), but two shipped reads legitimately
widen for admins/reports: `auditoria/infrastructure/consultar-auditoria.repository.ts` and
`inventario` `stockTotalEmpresaEnTx` issue `SET LOCAL set_config('app.current_sucursal_id','',true)`
(the RLS policies deliberately treat an EMPTY branch GUC as all-branches-within-the-pinned-empresa),
then restore it in `finally`. Reports will follow exactly this read-only widen + optional
`sucursalId` narrowing. The empresa GUC is NEVER cleared.

**Derived CxC is a single canonical SQL.** `cobros/infrastructure/saldo-cxc.repository.ts` computes
per-invoice balance `total − Σpagos(COBRO·APLICADO) − ΣNC(VIGENTE) + ΣND(VIGENTE)` over
`FACTURA.estado='VIGENTE'` (ADR-017, never materialized, company-wide by design). The CxC/aging
report MUST reuse this query, not re-implement balances. Mora/aging rules exist as pure domain fns
(`cobros/domain/en-mora.ts`).

**SD-timezone date math exists and is reusable.** `auditoria/domain/zona-horaria.ts` converts SD
calendar dates to UTC bracket instants via `Intl` (the ratified equivalent of date-fns-tz — the project
ships none). Period filters ("today", "this month", arbitrary ranges) must be built on this, ideally
extracted to a shared seam or replicated.

**The proven module template is auditoria (ADR-013).** `domain/` (pure filter/page/DTO + stable error
codes), `application/` (use case: admin gate → normalize → delegate → typed result), `infrastructure/`
(ONLY Prisma surface; explicit `select`; `findMany`+`count` in one `Promise.all`; ordered page),
`http/actions.ts` (thin: Zod → `getCurrentTenantContext` → `withTenantTransaction` → role gate
`tieneRolPermitidoEnTx(tx, usuarioId, empresaId, ["Administrador"])` before any read → delegate),
`ui/` (server shell page + client filter form pushing onto URL searchParams). Pagination contract:
default 25, hard clamp max 100 (`TAMANO_PAGINA_MAXIMO`). ESLint rule `systemfact/server-action-must-wrap-tenant`
applies to all `src/**/actions.ts(x)`.

**No global navigation.** Routes are standalone pages with their own headers; cross-links are ad hoc
(cobros screens link to `/cobros/cxc-board`; `/auditoria` is reached by URL). 7b adds `/reportes` and
should make the new dashboard the navigation hub (or introduce a minimal shared header — small decision).

---

## Prisma model inventory (verified against `app/prisma/schema.prisma`)

Aggregation-relevant fields, exact names. Money `Decimal(12,2)`, quantities `Decimal(12,3)`,
timestamps `timestamptz` (UTC).

| Model (table) | Fields usable for reports |
|---|---|
| `Venta` (VENTA) | `empresaId, sucursalId, usuarioId, clienteId, fecha, estado(EstadoVenta BORRADOR/CONFIRMADA/CANCELADA), subtotal, descuento, descuentoTipo, itbis, total` |
| `DetalleVenta` (DETALLE_VENTA) | `ventaId, productoId, cantidad, precioUnitario, descuentoLinea, tasaItbis (frozen at sale), itbisLinea, subtotalLinea` — **no cost snapshot per line** |
| `Factura` (FACTURA) | `ventaId?, empresaId, sucursalId, clienteId, usuarioId, tipoNcf(B01/B02), ncf, correlativoInterno, estado(EstadoDocumento VIGENTE/CANCELADA/ANULADA), subtotalGravado, itbis, subtotalExento, descuento, total, fechaEmision`; `@@unique([empresaId, ncf])`; sale payment state PENDIENTE/PARCIAL/PAGADA is DERIVED (ADR-017), not stored |
| `NotaCredito` / `DetalleNotaCredito` | `facturaOriginalId, empresaId, sucursalId, clienteId, ncf, estado, motivo, monto, itbis, fechaEmision`; details add `productoId, cantidad, precioUnitario, tasaItbis, itbis, subtotalLinea, tipoReposicion` |
| `NotaDebito` | same fiscal shape, always B03 (deferred in V1 — table empty) |
| `Pago` (PAGO) | `facturaId, empresaId, sucursalId, usuarioId, metodoPago(EFECTIVO only), monto, fecha, estado(REGISTRADO/APLICADO/REVERTIDO), tipo(COBRO/REEMBOLSO), correlativoRecibo` |
| `Compra` (COMPRA) | `empresaId, sucursalId, proveedorId, usuarioId, tipoNcf?(B01/B11), ncf?, correlativoInterno, tipoCompra(MERCANCIA/SERVICIO_*/ALQUILER), estado(EstadoCompra BORRADOR/PENDIENTE/RECIBIDA/PAGADA/CANCELADA), subtotal, subtotalGravado, itbis, subtotalExento, retencionIsr, retencionItbis, total, fecha` |
| `DetalleCompra` | `compraId, productoId, cantidad, costoUnitario, tasaItbis, itbisLinea, subtotalLinea` |
| `PagoProveedor` | `compraId, empresaId, sucursalId, usuarioId, metodoPago, monto, fecha, estado` |
| `Producto` | `empresaId, categoriaId, nombre, codigo, stockMinimo, precioCompra, precioVenta, costoPromedio (company-wide, updated on receipt), tasaItbis, itbisVigenteDesde/Hasta, activo` |
| `Inventario` | `sucursalId, productoId, cantidad`; `@@unique([sucursalId, productoId])` — stock is per branch |
| `MovimientoInventario` | `inventarioId (→ sucursal+producto), ventaId?, compraId?, notaCreditoId?, tipoMovimiento(ENTRADA_COMPRA/SALIDA_VENTA/ENTRADA_DEVOLUCION/SALIDA_MERMA/AJUSTE/REPOSICION_CANCELACION/SALIDA_CANCELACION_COMPRA), motivo, cantidadMovida (delta), cantidadAnterior, cantidadNueva, usuarioId, fecha` — full history for inventory movement reports |
| `NcfSecuencia` | `empresaId, tipoNcf, rangoInicio/Fin, secuenciaActual, vigencia*, activa` (range-usage report possible, not in catalog) |
| `Anulacion` | `empresaId, tipoDocumento, documentoId, motivo, anuladaPor, autorizadaPor?, fechaHora` — pairs with `estado=ANULADA` docs for Formato 608 |
| `ConfiguracionEmpresa` | key/value with validity: `TASA_ITBIS, RET_ISR_15, RET_ISR_2, RET_ITBIS_100, RET_ITBIS_30, DESC_MAX, PLAZO_DEVOLUCION, PLAZO_CREDITO` |
| `Cliente` | `tipoCliente, esConsumidorFinal, creditoHabilitado, limiteCredito, plazoCreditoDias` (aging due-date base) |
| `Proveedor` | `tipoProveedor FORMAL/INFORMAL, tipoPersona FISICA/JURIDICA` (606 classification) |
| `Empresa` | `rnc, razonSocial, regimenFiscal` (fiscal report headers) |

Schema gaps that shape the design:
1. **No per-line cost at sale time** → historical margin can only be computed with the CURRENT
   `Producto.costoPromedio` (or reconstructed via `MovimientoInventario`+`DetalleCompra`, heavy). Decision needed (Q3).
2. **No `CierreCaja`/resumen entity** — close is a Fase-6 gap owned by Caja, not 7b.
3. **No ITBIS-retention fields on `Factura`** (retentions live on `Compra` as buyer-side withholdings) —
   IT-1/607 scope must confirm which DGII columns map to existing fields (research lane).
4. `DetalleVenta`/`DetalleCompra`/`MovimientoInventario` have **no direct `empresaId`** — tenant pinning
   goes through relation navigation (`where: { venta: { empresaId } }`) per `tenant.ts` doc.
5. No indexes on time-range aggregations (`VENTA(empresaId, fecha)`, `FACTURA(empresaId, fechaEmision)`,
   `COMPRA(empresaId, fecha)`) — report queries over history will need a migration or accept scans.

---

## Report catalog (decided scope) with data sources

Fleet decided by `docs/05` §16, `docs/16` §11, `docs/11` (07-Reportes answers), AC §8.9, and the
accepted Penpot evaluation (`docs/18` FASE 3):

| Report | Primary data source | Decided UX / rule |
|---|---|---|
| Dashboard (replaces placeholder) | Ventas day/month (SD-day via zona-horaria), top sellers (`DetalleVenta` groupBy producto), facturas pendientes + CxC (canonical saldo query), inventory state (inventario KPIs: total/bajo/agotado + valor) | AC §8.9: shows day sales, month sales, top sellers, pending invoices, CxC, general inventory state. Admin full; Despachador none; Cobrador limited (role matrix 04:170-181) |
| Ventas por período | `Venta(CONFIRMADA)` group by period, empresa/sucursal pinned | all reports filter empresa+sucursal+dates |
| Productos más/menos vendidos | `DetalleVenta`→`Venta` windowed groupBy producto | 05 §16 lists both |
| Inventario actual / valorizado | `Inventario` × `Producto.costoPromedio` (valorizado), per-branch | wireframe KPIs incl. "Valor de inventario" (2.2.3, exists in consulta) |
| Estado de facturas | `Factura` group by `estado` × `tipoNcf`; payment state derived | 16 §11 |
| CxC con aging y mora | reuse `consultarSaldoCxcEnTx` + `en-mora.ts` + `plazoCreditoDias`/`PLAZO_CREDITO` | CxC is company-wide by design — branch-filter semantics = Q6 |
| CxP (compras pendientes) | `Compra` estado ∈ {PENDIENTE, RECIBIDA} − Σ `PagoProveedor APLICADO` | derived, same discipline as CxC (never materialized) |
| Analítico básico (comparativa período actual vs anterior, variación monto + %) | Ventas aggregated over two windows | DECIDED: Total row = current period only (2.5.1); dates support BOTH full periods and arbitrary ranges (2.5.5) |
| Rentabilidad por producto (07b) | Ventas (precio costo, precio salida, cantidad) + Compras por producto + métricas inversión/entrada/salida/capital/margen | filterable período + sucursal; formulas need confirmation (Q3) |
| ITBIS por período (base del IT-1) | `Factura`(VIGENTE) `itbis/subtotalGravado/subtotalExento` + NC/ND + `Compra.itbis`/retenciones | 16 §11 |
| Fiscal IT-1 (monthly, due day 20) | ITBIS collected vs paid, retenciones | **column layout NOT documented in repo** — research lane |
| Fiscal 606 (compras) | `Compra` + Proveedor (tipoProveedor FORMAL), ncf, montos, retenciones | 606-card fee question deferred to V2 (11:222) |
| Fiscal 607 (ventas) | `Factura` VIGENTE (+NC/ND); **Cancelada excluded**, Anulada → 608 | rule confirmed 03 §, 05 §11 |
| Fiscal 608 (anulados) | docs `estado=ANULADA` + `Anulacion` (motivo, fechaHora, NCF consumed) | confirmed |
| Export CSV/Excel + DGII fiscal format | server-side generation from the same canonical reads | DECIDED 2.5.2: fiscal ALSO export DGII format; selector shows list BEFORE export (2.5.3); auditoría NEVER exportable in V1 (§11/§12) |
| Cierre diario de caja | — | **NOT in 7b** — lives only in Caja (2.5.4), module unbuilt (Q8) |

Out of roadmap scope (must stay out): advanced analytics (tendencias, rotación), advanced financial
reports, real e-CF submission, auditoría export.

---

## Module structure proposal (mirror `auditoria`, ADR-013)

```
app/src/modules/reportes/
  domain/          # pure: ReporteTipo catalog, filter DTO (fechas SD→UTC window math),
                   # page/total DTO, comparison + margin + aging math as pure Decimal functions,
                   # errors.ts (stable codes: REPORTE_NO_AUTORIZADO, REPORTE_VALIDACION, ...)
  application/     # one use case per report family: consultarVentasPorPeriodo,
                   # consultarProductosVendidos, consultarInventarioReporte, consultarEstadoFacturas,
                   # consultarCxc/Cxp, consultarComparativa, consultarRentabilidad,
                   # consultarItbis/consultarFiscal(606/607/608) — all receive (tx, ctx, filtro)
  infrastructure/  # the ONLY Prisma surface: $queryRaw GROUP BY aggregations per report
                   # (empresaId pinned; admin widen pattern: clear branch GUC + restore in finally);
                   # export/ builders (CSV string assembly; DGII layout — after research)
  http/actions.ts  # thin adapters: Zod → ctx → withTenantTransaction → role gate → use case
  ui/              # report selector (list-previous), shared filter bar (empresa/sucursal/fechas),
                   # one result table per report, Exportar ▾ (CSV/Excel · Formato DGII for fiscal)
app/src/app/reportes/page.tsx    # server shell like /auditoria (searchParams → first render)
app/src/app/dashboard/page.tsx   # REPLACE placeholder with real KPI screen (reuse reportes reads)
```

Plus: `prisma/` index migration for report access paths; no new tables expected (all data exists).

---

## Approaches

1. **Single monolithic change (all reports + exports in one PR set)** — matches the roadmap line-item
   completeness but is ~6–10k LOC (12+ screens × module+UI+tests). Effort: High. Violates any review budget.
2. **Chained slices inside one change (RECOMMENDED)** — one SDD change (`fase-7b-reportes`), tasks split
   into independently-reviewable PR slices ordered by dependency: (A) module skeleton + shared filter/
   pagination/admin-widen read infra + Dashboard; (B) operational reports (ventas, productos, inventario,
   estado facturas) + CSV export seam; (C) financial reports (CxC/aging, CxP) + analítico comparativo;
   (D) rentabilidad por producto; (E) fiscal ITBIS/IT-1/606/607/608 + DGII export (gated on research lane).
   Each slice has start/finish/verification per the review-workload guard. Effort: High total, Medium per PR.
3. **Split into separate SDD changes (7b-ops, 7b-financial, 7b-fiscal)** — cleaner budgets but fragments
   specs and archive trail for one roadmap phase; the project convention so far is one change per
   roadmap half (5a–5d precedent used sub-changes; fase-6 was one). Given precedent both ways, slice-in-one-change (2) keeps spec cohesion.

---

## Recommendation

**Approach 2.** Build `src/modules/reportes` on the auditoria template with one canonical raw-SQL
aggregate per report (AGENTS: no findMany-and-sum-in-JS; Decimal as text across boundaries), reuse the
canonical CxC query, the SD-timezone seam, and the read-only admin GUC-widen pattern. Ship a
Prisma index migration with slice B. Defer all DGII layout guessing behind a research lane.
Dashboard replaces the placeholder and doubles as the nav entry to `/reportes`.

---

## Open questions (user decisions before/spec phase)

1. **Slice delivery**: confirm the 5-PR chained breakdown (A dashboard+infra → B operational → C
   financial+comparativa → D rentabilidad → E fiscal+exports) and that all slices stay under one
   SDD change. `delivery_strategy=ask-on-risk` → user must sign the split.
2. **Excel vs CSV**: "CSV/Excel" export — ship dependency-free server-generated CSV (recommended V1)
   or add a real `.xlsx` library (exceljs etc.)? And for the DGII fiscal format: the exact record
   layout is NOT defined anywhere in docs — authorize an `sdd-research` lane for DGII 606/607/608/IT-1
   specs (file layout, encodings, column-by-column mapping) or hand it the official spec?
3. **Rentabilidad formulas**: (a) cost basis = current `Producto.costoPromedio` (documented limitation:
   historical margins shift when new purchases arrive) or reconstruct cost-at-sale (heavy); (b) exact
   definitions of inversión / entrada / salida / capital / margen as the business expects them
   (wireframe 07b labels only — confirm against Penpot or business owner).
4. **Comparativa "período anterior" semantics** for arbitrary ranges: automatically the immediately
   preceding equal-length window? (Preset month/quarter comparisons imply it; ranges need the rule.)
5. **Role visibility per report**: Admin full (company-wide). What exactly is "Cobrador: acceso
   limitado" (04:170/181) — which subset of reports, and forced to own branch? Suggested default:
   Cobrador sees only CxC/cobros-related views scoped to own branch; everything else Admin-only. Needs confirmation.
6. **CxC branch filter**: canonical CxC is company-wide by design (customer owes the empresa). Keep
   the report company-wide (Admin) with an optional invoice-branch narrowing filter (technically
   possible via `Factura.sucursalId`), or per-branch only? Confirm.
7. **Route shape**: single `/reportes` page with the decided selector (list-previous) + searchParams
   deep links (auditoria pattern, recommended) vs per-report routes.
8. **Caja gap ownership**: daily close + "resumen del día" (roadmap Fase 6, AC §8.9) were never built
   and are explicitly NOT to be duplicated in Reportes. Confirm they are deferred to a separate
   `caja` change (7b will not link-export a close that doesn't exist).
9. **Dashboard KPI "hoy/mes"** boundaries: SD-timezone day via the ratified `Intl` pattern (no new
   dep) — confirm acceptable (technical default, listed for completeness).

---

## Risks

- **HIGH — DGII format under-specification**: no column definitions for IT-1/606/607/608 exist in the
  repo. Building an exporter from guesses produces fiscal-grade wrong output. Mitigation: research
  lane gates slice E; screen-only tabular rendering can proceed independent of the DGII file layout.
- **HIGH (if mishandled) — tenant widening**: the admin company-wide read must only ever clear the
  branch GUC, inside the pinned empresa, restored in `finally`, read-only; any deviation is a
  cross-tenant leak (AGENTS #1 risk). Copy the ratified auditoria pattern verbatim.
- **MEDIUM — non-reproducible profitability** (costoPromedio drift) — visible trust issue; decide Q3a explicitly.
- **MEDIUM — no aggregation indexes**: windowed group-bys over VENTA/FACTURA/COMPRA grow linearly;
  ship index migration with slice B (measure before deeper optimization).
- **MEDIUM — size**: ~6–10k LOC total; even the project's 800-line review budget (config.yaml) is
  exceeded per slice if slices are merged — enforce one PR per slice.
- **LOW — empty data sources in V1**: `NotaDebito` deferred (607/608 will show NC-only adjustments);
  B11 purchases (informal) feed 606 with no ITBIS credit — expected, document in specs.

---

## Effort forecast

| Slice | Est. LOC (code+tests) | >400? | >800 (project budget)? |
|---|---|---|---|
| A dashboard+shared infra | 900–1200 | Yes | Yes (tight) |
| B operational reports + CSV | 1200–1600 | Yes | Yes |
| C CxC/CxP + comparativa | 800–1100 | Yes | borderline |
| D rentabilidad | 500–800 | Yes | borderline |
| E fiscal + DGII export | 1200–1800 | Yes | Yes |

**Chained PRs: Yes. 400-line budget risk: High.** Decision needed before apply: Yes (Q1, plus Q2/Q3/Q5).

## Readiness for Proposal

**Yes** — no blockers for the proposal. Slice E's DGII export spec depends on Q2 (research lane); the
proposal should treat the fiscal FILE FORMAT as deferred-research while the fiscal SCREENS proceed from
the verified data model. The orchestrator should put Q1–Q8 to the user before `sdd-spec`.
