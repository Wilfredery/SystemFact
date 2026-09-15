# Tasks: fase-5d-devolucion-b04 — Devoluciones (Nota de Crédito B04)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 700-850 total across 3 PRs (per‑PR under 400) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Domain + application core + venta error codes | PR 1 | `pnpm test:unit -- --testPathPattern=devolucion.domain` | `withTenantTransaction` fixture | Pure function revert, no DB state change |
| 2 | HTTP action + config + seed + integration setup | PR 1 | `pnpm test:integration -- --testPathPattern=devolucion.crear` | `withTenantTransaction` with seeded B04 range | Revert PR 1 files, re-seed NCF if needed |
| 3 | UI return form + E2E happy path | PR 2 | `pnpm test:e2e -- --spec=returnHappyPath` | Playwright against test DB | UI revert only, backend unaffected |
| 4 | Cumulative quantity edge cases + concurrency tests | PR 3 | `pnpm test:integration -- --testPathPattern=concurrentReturns` | `withTenantTransaction` parallel fixture | Revert NC/inventory changes, re-run seed |

## Phase 1: Foundation / Infrastructure (PR Slice 1)

_Tasks 1.1–1.10 form PR slice 1 (domain + application + infrastructure + HTTP action + seed + tests, ~350–400 lines)_

- [x] 1.1 (PR #26, 55681b7) Create `app/src/modules/devolucion/domain/devolucion.ts` with pure functions `validarPlazoDevolucion`, `validarCantidadDevuelta`, `validarReturnType`, `calcularTotalesNotaCredito`; domain error code constants for the 4 return-related codes
- [x] 1.2 (PR #26, 55681b7) Create `app/src/modules/devolucion/application/crear-devolucion.ts` with `crearDevolucion(tx, ctx, input)` orchestration use case: guarded venta+factura read → return-window validation → B04 NCF atomic consume → NC + detail creation → inventory movement → audit, all inside `withTenantTransaction`, throw-on-reject
- [x] 1.3 (PR #26, 55681b7) [CRITICAL] Create `app/src/modules/devolucion/infrastructure/devolucion-repository.ts` with `leerPriorNCsPorFacturaProductoEnTx` (queries all prior NCs for same factura+product inside tx, sums prior returned qty + new qty, compares against original sold qty, enforces cumulative cap); `leerStockSucursalEnTx` (SELECT FOR UPDATE ascending productoId → NCF FOR UPDATE → NC write row-lock serialization); `crearNotaCreditoEnTx`, `crearDetalleNotaCreditoEnTx`, `registrarMovimientoDevolucionEnTx` (ENTRADA_DEVOLUCION / SALIDA_MERMA per tipoReposicion)
- [x] 1.4 (PR #26, 55681b7) Create `app/src/modules/devolucion/http/actions.ts` thin `devolverVentaAction` server action with Zod validation + `withTenantTransaction`; create `app/src/modules/devolucion/http/validations.ts` with Zod schema `zDevolverVentaInput`
- [x] 1.5 (PR #26, 55681b7) [CRITICAL] Add 4 stable error codes to `app/src/modules/venta/domain/errors.ts`: `DEVOLUCION_FUERA_DE_PLAZO` (code 601), `CANTIDAD_EXCEDE_ORIGINAL` (code 602), `FACTURA_NO_VIGENTE` (code 603), `VENTA_NO_CONFIRMADA` (code 604) with stable codes, user messages, minimal context; no stack traces/internal Prisma errors
- [x] 1.6 (PR #26, 55681b7) Modify `app/src/modules/venta/infrastructure/venta-repository.ts` to add `leerVentaParaDevolucionEnTx`, `leerPriorNCsPorFacturaProductoEnTx`, `leerStockSucursalEnTx` helpers
- [x] 1.7 (PR #26, 55681b7) Modify `app/src/modules/venta/infrastructure/config-repository.ts` to add `leerPlazoDevolucionEnTx` (reads from ConfiguracionEmpresa, default 15 days SD, same pattern as `leerConfigVentaEnTx`)
- [x] 1.8 (PR #26, 55681b7) Modify `app/tools/scripts/seed-ncf.ts` to add `{tipoNcf: "B04", rangoInicio: 201, rangoFin: 300}` to `NCF_RANGOS_SEED`
- [x] 1.9 (PR #26, 55681b7) Modify `app/tools/scripts/seed-venta-config.ts` to add `PLAZO_DEVOLUCION` config key (default 15 days)
- [x] 1.10 (PR #26, 55681b7) Unit tests for domain pure functions: `validarPlazoDevolucion`, `validarCantidadDevuelta`, `validarReturnType`, `calcularTotalesNotaCredito` — no DB, clock injection via parameter

## Phase 2: Core Implementation (PR Slice 2)

_Tasks 2.1–2.3 form PR slice 2 (UI + E2E, ~200–250 lines)_

- [x] 2.1 (PR #30, a05accc) Create `app/src/modules/devolucion/ui/DevolverButton.tsx` Server Component with first-click disable prop and return form integration, consuming `devolverVentaAction`
- [x] 2.2 (PR #30, a05accc) Create `app/src/modules/devolucion/ui/ReturnForm.tsx` with Zod validation, tipoReposicion selector (VENDIBLE/DANADO), branch match validation against original sale exit branch, and submit handler
- [x] 2.3 (PR #30, a05accc) [CRITICAL] E2E test: return happy path — CONFIRMADA sale with VIGENTE FACTURA → return → VIGENTE NC with correct B04 NCF → stock restored (VENDIBLE: ENTRADA_DEVOLUCION) / recorded as loss (DANADO: SALIDA_MERMA) → derived CxC balance reduced per ADR-017

## Phase 3: Integration / Verification (PR Slice 3)

_Tasks 3.1–3.3 form PR slice 3 (cumulative quantity edge cases + concurrency tests, ~150–200 lines)_

- [x] 3.1 (PR #33, a7eb2be) [CRITICAL] Integration test: cumulative quantity across 2+ NCs for same factura+product — GIVEN sale line of 5 units with 3 already returned across prior NCs, WHEN return of 1 more unit requested, THEN cumulative returned = 4 ≤ 5, return succeeds; AND GIVEN sale line of 5 units with 5 already returned, WHEN return of 1 more unit requested, THEN `CANTIDAD_EXCEDE_ORIGINAL` error returns and no row is written
- [x] 3.2 (PR #33, a7eb2be) [CRITICAL] Integration test: concurrent same-factura returns serialize — GIVEN stock 10 at branch, two parallel `crearDevolucion` calls on the same factura+product line inside the same transaction with row-lock serialization, THEN exactly one succeeds; the loser blocks/rejects without exceeding original quantity or causing negative stock, and no lost update occurs
- [x] 3.3 (PR #33, a7eb2be; approved R-D5 design deviation: gate implemented as exact-triple retry check with `DEVOLUCION_YA_REGISTRADA` / code 605) [CRITICAL] Integration test: idempotent NC retry — GIVEN a return already confirmed with a B04 NCF and VIGENTE NC, WHEN the same return request is retried, THEN `DEVOLUCION_YA_REGISTRADA` error returns and no second B04 NCF is burned, no double-consume of NCF, and no duplicate inventory movement

## Phase 4: Cleanup / Documentation

- [x] 4.1 Update module barrel exports in `app/src/modules/devolucion/index.ts` — **deviation (docs-only interpretation):** no module in this repo uses a barrel (`index.ts`); imports go straight to concrete files. Interpreted as: `devolucion` was the only module missing its `README.md` → created `app/src/modules/devolucion/README.md` (module map) per repo convention + YAGNI instead of introducing a one-off barrel.
- [x] 4.2 Add JSDoc comments and type documentation for all new domain/application interfaces; verify no unused imports across modified files (JSDoc verified present on every exported symbol of the new slice; `pnpm lint` clean → no unused imports)