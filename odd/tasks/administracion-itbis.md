# Administración — ITBIS rates in use (Configuración tab)

Branch `feature/admin-itbis-tasas` · target v0.29.0 (feat → MINOR) · issue-first PR gate. Owner choice (2026-11-14): "Rates in use (recommended)".

## Specs

- S1 Replace the "No disponible aún" ITBIS note in the Configuración tab (`AdministracionScreen.tsx`) with a read-only table of the ITBIS rates the company's ACTIVE products actually use: Tasa (%), Vigente desde, Vigente hasta ("Sin fin" when open-ended), Productos (count), and a state badge "Vigente" / "No vigente" evaluated for TODAY in `America/Santo_Domingo`. Ordered by tasa descending then vigente desde. No create/edit/delete control for any role (read-only, deny-by-default via the existing Administración gate).
- S2 Source of truth: `PRODUCTO.tasaItbis`, `itbisVigenteDesde`, `itbisVigenteHasta` (`app/prisma/schema.prisma:398-400`), aggregated in SQL (`groupBy` / `$queryRaw GROUP BY`, never N+1, no per-product loop) over products with `activo = true`, pinned to `empresaId` of the session (plus RLS). Reuse the existing `consultarConfiguracion` read path and its `withTenantTransaction`; extend its DTO additively (`itbisEnUso`), do not change retentions/NCF behavior.
- S3 No hardcoded rate: the rates shown are whatever the data says (a rate such as 16 or 18 or 0 or any other stored value renders as stored, `Decimal` as a string, never `number` for the value). An empresa with no active products renders an explicit empty state "Sin productos activos: no hay tasas de ITBIS en uso." (never a fabricated rate or 0%).
- S4 "Vigente hoy" is a pure domain function (no DB, no Next/React/Prisma imports) taking the window and an instant, comparing instants like the existing sale line validation (`venta/application/preparar-lineas-venta.ts` `tasaVigenteEn`); today's instant and the SD business-day boundary come from the existing date helpers, no manual hour arithmetic, no new date library. Unit-tested with edge cases: before desde, exactly desde, open-ended hasta, after hasta, SD day boundary (03:59 UTC counts as the previous SD day when the helper says so).
- S5 Out of scope on purpose (separate decision): replacing the hardcoded `0/16/18` validation sets in producto/venta/devolucion with a DB-driven list, new TASA_ITBIS config keys, any migration, any RLS change, any write. The note under the table says the allowed rate set is fixed by the product rules until that decision.
- S6 Tests: domain unit; repository/use-case unit with the existing mocking style; integration against real Postgres (`systemfact_app` role): counts and windows match seeded products, inactive products excluded, another empresa's products never appear, empty state; RTL for the table, the empty state, the badge and "Sin fin"; the existing Configuración RTL/e2e assertions that expected "No disponible aún" are updated to the new contract; `e2e/administracion.spec.ts` asserts the ITBIS table headers and at least the seeded e2e product's rate row. No test may skip.
- S7 Version bump 0.29.0 (`app/package.json` + `.release-please-manifest.json` + `app/CHANGELOG.md`, UTF-8 no BOM) in the final commit; Conventional Commits; squash-merge with `Closes #N`; deploy only with the owner's explicit approval (read-only change: smoke is enough, demo lane not needed).

## Tasks

- T1 (S2-S4) domain function + repository aggregation + use-case/DTO + actions wiring + tests. Risk: none (read-only, no shared code changed except an additive DTO field).
- T2 (S1,S3,S6) UI table + empty state + RTL + e2e update.
- T3 (S7) docs, bump, tracker log.

## Log

- L1 (2026-11-14, owner, verbatim): "Go, first always do an check, recheck, evaluation and an audit, always its better before to start a work."
- L2 (2026-11-14, owner choice via ask_user_question): ITBIS = "Rates in use (recommended)"; Inventario = "Movement history".
- L3 (2026-11-14, audit + recheck evidence): production `CONFIGURACION_EMPRESA` for empresa 5 has NO `TASA_ITBIS*` key (only DESC_MAX, PLAZO_DEVOLUCION, RET_ISR_2/15, RET_ITBIS_30/100, RETROACTIVO_FECHA_VENTA_DIAS) and production products carry one rate (18.00, 1 product); no code reads a `TASA_ITBIS` config key; rates are per product with a validity window; RLS on `CONFIGURACION_EMPRESA` is empresa isolation (`20260902120000_enable_rls/migration.sql:240-249`, verified). Hardcoded rate sets exist in `producto/domain/producto.ts:21,82`, `producto/http/validations.ts:16,82`, `producto/ui/ProductoFormulario.tsx:47-49`, `venta/domain/calculators.ts:36`, `devolucion/domain/devolucion.ts:60` (out of scope, S5). The explorer's items A2 (prod migration `20261108200000`) and A3 (PR #199) were STALE and rejected: the migration is applied in production and #199 shipped.
