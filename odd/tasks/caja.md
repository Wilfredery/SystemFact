# Caja screen (Step 8, frontend-screens-plan) — daily cash close, domain first

Branch `feature/screens-caja` · target v0.27.0 · issue-first PR gate. Owner asked for a careful, checked-and-rechecked build: a dedicated recheck pass (full suites + differential checks + blind dual review) precedes the PR.

## Specs

- S1 Wireframe 06a-Cierre-Caja (extracted verbatim 2026-11-10, roles label Administrador): title "Cierre diario de caja", date subtitle = today (America/Santo_Domingo, NO retroactive date selector), KPIs Total facturado / Total cobrado / Efectivo esperado / Diferencia, table Método|Ventas|Cobros|Total with rows Efectivo and Total, panel "Corte de caja" showing the formula "Efectivo esperado = Cobros en efectivo − Devoluciones en efectivo" and the values Cobros / Devoluciones / Esperado, note "Cierre informativo: no bloquea las operaciones del día.", buttons Cerrar caja + Exportar PDF.
- S2 Wireframe 06b-Resumen-Dia (roles Administrador): "Resumen del día — Ventas, costo y margen bruto": KPIs Ventas del día / Costo de lo vendido / Margen bruto / Margen %; link "Ver cierre de caja →"; NO duplicated KPIs; shown separately from the close (never mixed).
- S3 Cerrar caja button: DISABLED with "Próximamente" hint (owner asked my recommendation 2026-11-10; ERD C2/C3 deliberately eliminated CIERRE_CAJA — the close is a derived report; physical cash count stays external per docs/11). No persistence this PR; NO migration, NO schema change.
- S4 Exportar PDF: server-side PDF generation (docs/19:167) of the day's close via a route handler; deliberate dependency: `pdfkit` (light, node-runtime, no client JS), pinned in one reviewed commit with its release notes quoted in the PR. Layout mirrors 06a (KPIs, método table, corte, diferencia).
- S5 Domain (pure, app/src/modules/caja/domain/, no DB/Next imports): SD day-boundary helpers (America/Santo_Domingo "today" → UTC window; edge: 03:59 UTC belongs to the previous SD day), calcularEfectivoEsperado (ΣCOBRO EFECTIVO APLICADO − ΣREEMBOLSO EFECTIVO APLICADO), calcularDiferencia (total cobrado − total facturado, kept separate from KPIs per docs, not merged into esperado), margen calculations for 06b (ventas, costo de lo vendido from costoPromedio at sale, margen bruto, margen %), all with decimal.js/BigInt strings, never JS float. Stable error-code catalog (domain/errors.ts).
- S6 Backend additive (no new tables, RLS untouched): repository via $queryRaw GROUP BY aggregation over PAGO (tipo, estado=APLICADO, metodoPago=EFECTIVO, SD day window, empresaId + sucursalId pinned; Admin company-wide via conSucursalAmpliadaEnTx) and VENTA (CONFIRMADA, SD day) for facturado; margin joins DetalleVenta/Producto costoPromedio; money crosses SQL as COALESCE(SUM(...),0)::numeric(12,2)::text (Decimal strings), counts ::int. Use cases consultarCierreDiario + consultarResumenDia. Roles: ROLES_VER_CAJA = ["Administrador"] per the wireframe's "Roles que la ven: Administrador" (both boards), deny-by-default, literal names only in http/shared.ts.
- S7 Screen /caja: server page (tenant ctx → /login; permisos deny-by-default; non-admin gets the access message), client island showing 06a KPIs + método table + corte panel + disabled Cerrar caja + Exportar PDF button (link to the PDF route), and 06b as a separate section with the "Ver cierre de caja →" anchor relationship; empresa/sucursal shown read-only from the context header; today's date subtitle formatted in America/Santo_Domingo; no date selector. Empty-day state shows RD$ 0.00 like the wireframe. Nav entry "Caja" enabled in the same PR (nav-routes guard).
- S8 Tests: exhaustive domain unit tests (day-boundary edges incl. midnight and 04:00 UTC crossover, rounding half-up, zero-day, negative deviation); use-case + action unit tests (mock repos); integration tests (tenant isolation: another empresa's payments never counted; sucursal widening for admin); RTL specs for the screen (KPIs, table, corte values, disabled button, PDF link, access message); one local E2E spec app/e2e/caja.spec.ts (admin sees today's close reflecting seeded cobros; non-admin denied; no skips); /caja auto-covered by csp-authenticated.spec.ts.
- S9 PDF route test: unit-level (route handler renders a non-empty %PDF buffer with the day's totals for a mocked use case) + e2e checks the button hits a route returning content-type application/pdf.
- S10 Version bump 0.27.0 in the final patch commit (package.json + manifest + CHANGELOG, UTF-8 no BOM); conventional commits; squash-merge with Closes #N.

## Tasks

- T1 (S5) caja domain pure module + error catalog + exhaustive unit tests (own commit)
- T2 (S6) repositories + use cases + http actions/validations + role group (own commit)
- T3 (S7) screen + nav enable + RTL specs
- T4 (S4,S9) PDF route + dependency + tests
- T5 (S8) E2E spec + integration tests complete
- T6 (S10) recheck pass: full unit+integration suites, differential check on touched shared code, blind dual review (jd-judge-a/b), version bump + tracker log

## Log

- L1 (2026-11-11): "In this one, I'd like to build it careful, check and recheck to get a good job, so go." — original request verbatim (careful, double-checked build of Step 8).
- L2: Explorer handoff: no Caja backend exists; close is derived from PAGO (COBRO/REEMBOLSO, EFECTIVO-only MetodoPago, APLICADO) and VENTA (CONFIRMADA); ERD C2/C3 eliminated CIERRE_CAJA (no migration); clone reportes aggregation style (raw GROUP BY, Decimal-as-text, SD day via AT TIME ZONE), cobros 3-step action pattern, compra screen pattern.
- L3: Wireframe 06-Caja extracted verbatim (06a/06b) — labels recorded in S1/S2; roles Administrador on both; drawn filters Empresa/Sucursal/Fecha resolved as context-read-only + today-only per docs/11 2.4.4.
- L4 (owner decisions 2026-11-10/11): PDF IN this PR (server-side, pdfkit); Cerrar caja = my recommendation accepted: disabled "Próximamente" (no persistence, ERD-faithful).
- L5 (T3, S7): /caja screen built test-first (caja-formato helpers, CajaScreen island, server page, nav enabled). 06a/06b render as separate sections, Diferencia signed + red when negative, Cerrar caja disabled with the hint, Exportar PDF is a plain link to /api/caja/cierre-pdf (route lands in T4), no date selector (today-only, DTO fechaSD). RTL: 34 specs (formato/screen/page) + shell nav spec green; tsc and eslint clean.
