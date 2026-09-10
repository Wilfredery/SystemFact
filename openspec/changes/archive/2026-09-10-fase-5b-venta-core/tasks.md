# Tasks: fase-5b-venta-core — Venta Draft Engine + First POS UI

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3,050 (PR-1 ~650 / PR-2 ~1,350 / PR-3 ~1,050) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR-1 domain → PR-2 application/config/http → PR-3 POS UI |
| Delivery strategy | exception-ok |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Each PR merges to main independently; size:exception accepted per slice; rollback = revert merge commits in reverse order. Dominant dependency is forward-only (domain → application → UI); no repository/schema changes (migration NONE expected).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pure venta domain: calculators, entity, errors, cap rule + unit tests | PR-1 | `pnpm jest src/modules/venta/domain --coverage=false` | N/A — domain is pure, no DB by directive | Revert PR-1 merge commit; no schema |
| 2 | Use cases + resolver + venta-config + seed + http/actions + integration tests + docs | PR-2 | `pnpm jest src/modules/venta app/tools/scripts` | Jest vs `sf-postgres:5433` tenant/product fixtures; seed re-run idempotency | Revert PR-2; seeded DESC_MAX rows harmless |
| 3 | POS UI slice (board-agnostic behind Penpot gate) + component tests | PR-3 | `pnpm jest src/modules/venta/ui` | Manual smoke checklist; Playwright deferred to 5c | Revert PR-3 only; backend intact |

## Phase 1: PR-1 — Domain (calculators + entity + errors + caps)

- [x] 1.1 Create `app/src/modules/venta/domain/errors.ts`: `VentaErrorCode` pinning exactly R-V13 codes (14 distinct business codes: 12 venta-owned + 2 re-emitted CLIENTE_*; `STOCK_INSUFICIENTE` as warning type, never error) and `VentaResult<T>` / `VentaSaveResult<T>` / `StockWarning` contracts per design Interfaces. (`DESC_MAX_FALTANTE` is intentionally NOT here — it is a `venta-config` code, composed in at the application save surface.) (~80 lines)
- [x] 1.2 Create `app/src/modules/venta/domain/venta.ts`: `EstadoVenta` (`BORRADOR/CANCELADA/CONFIRMADA`), exhaustive `estadoVentaDesdeDb` fail-loud mapping (R-V13 unknown-state → typed runtime error, never silent coercion). Freeze draft state set: no 5b path reaches `CONFIRMADA`. (~70 lines)
- [x] 1.3 RED unit `app/src/modules/venta/domain/__tests__/calculators.spec.ts`: fixture F2 exact assertions (R-V5) — net bases 18.31/20.13/25.80, ITBIS 3.30/3.22/0.00, stored 69.86/5.62/6.52/70.76. Write test first, then implement. (~60 lines test)
- [x] 1.4 Fixture F1 (R-V6): clean proration 3.00/4.00 shares, gravado 27.00 / exento 36.00, total 67.86. RED-first in same spec. (~30 lines)
- [x] 1.5 Fixture F3 (R-V6): remainder −0.01 to largest base (ties earliest): shares 2.62/1.75/2.63, ITBIS 7.85, total 80.85; identity `total = subtotal − descuento + itbis` holds exactly. (~35 lines)
- [x] 1.6 Fixture F4 (R-V8 boundary math, pure part): 100.00 @18% with 4% → base 96.00 / ITBIS 17.28 / total 113.28. (~20 lines)
- [x] 1.7 RED unit `__tests__/descuentos.spec.ts`: `validarDescuentosContraMaximo` triple-cap (line ≤ % of bruto, header % ≤ cap, total effective ≤ % of Σbruto) → `DESCUENTO_EXCEDE_MAXIMO`; over-base → `DESCUENTO_EXCEDE_BASE`; `DESCUENTO_INVALIDO` on MONTO 0.00 / shape mismatch; zero → `PORCENTAJE/0.00` + NULL autorizadoPor (R-V7). (~80 lines)
- [x] 1.8 Property-style rate/discount/line-order matrix (decimal.js strings, half-up 2dp, no floats) mixed 18/16/0 DGII matrix. (~60 lines)
- [x] 1.9 GREEN: implement `domain/calculators.ts` `calcularLineaVenta(input, tasa)` + `calcularTotalesVenta(lines, headerDiscount)` per R-V5 proration algorithm; return `subtotalGravado/subtotalExento` computed-never-stored. (~230 lines)
- [x] 1.10 Verify `pnpm jest src/modules/venta/domain` green; commit PR-1 (code+tests same commit). (~0 diff)

## Phase 2: PR-2 — Application, venta-config, HTTP, integration

- [x] 2.1 Create `application/venta-service.ts`: `crearVenta` / `actualizarVenta` (full line replace, guarded `updateMany estado=BORRADOR`) / `cancelarVenta` / `listarVentas` / `obtenerVenta` returning `VentaSaveResult` with `warnings[]`. Validate lines (`LINEAS_VACIAS`, `LINEA_INVALIDA`), freeze `tasaItbis` with SD-date validity window → `TASA_ITBIS_VIGENCIA_FALTA` names product, zero writes (R-V1, R-V2, R-V3, R-V4). (~350 lines)
- [x] 2.2 Create `application/resolver-cliente-venta.ts`: `resolverClienteParaVentaEnTx(tx, ctx, clienteId)` — null → `getOrCreateConsumidorFinalEnTx`; given id empresa-scoped: unknown/cross-tenant → `CLIENTE_NO_ENCONTRADO` (no leakage), inactive → `CLIENTE_INACTIVO`; no fiscal-id re-validation (R-V10). (~80 lines)
- [x] 2.3 Create `application/configuracion-venta.ts` (or infra `configuracion-repository.ts`): `leerConfigVentaEnTx` reads active `DESC_MAX` (empresaId + SD validity window) only when a positive discount exists; missing/expired → `DESC_MAX_FALTANTE`, zero writes, no legal-default fallback (R-C1). (~70 lines)
- [x] 2.4 Create `app/tools/scripts/seed-venta-config.ts` + `"seed:venta"` script in `app/package.json`: one active `DESC_MAX=4.00` row per empresa, wide vigencia, idempotent re-run mirroring `seedRetencionConfigParaEmpresa`. (~90 lines)
- [x] 2.5 Create `infrastructure/venta-repository.ts`: Prisma projections, tenant/branch filters (`empresaId`+`sucursalId`), guarded predicates, replace-lines, audit append, branch stock reads (R-V11). No migration file. (~250 lines)
- [x] 2.6 Create `http/validations.ts` + `http/actions.ts`: zod boundary, `withTenantTransaction` wrapper (ESLint rule applies), Roles Administrador+Operador; positive discounts Administrador-only server-side `DESCUENTO_NO_AUTORIZADO`, actor stored, `descuentoAutorizadoPor`; pagination clamp default 25/max 100, size >100 → stable validation error (R-V8, R-V12). Thin adapters only. (~250 lines)
- [x] 2.7 Integration `application/__tests__/` tenant isolation: cross-tenant/branch list/detail/update/cancel behave as not-found, zero leakage (R-V11 mandatory scenario). (~120 lines)
- [x] 2.8 Integration: resolver matrix (null→CF, foreign id, inactive id) + CF-draft client swap recomputes totals + one audit row (R-V3, R-V10). (~100 lines)
- [x] 2.9 Integration: guarded lifecycle races — parallel updates → exactly one commits, loser `CONCURRENCIA_CONFLICTO` no mixed line-set; double-cancel stable error, no second audit, stock/config untouched (R-V4). (~110 lines)
- [x] 2.10 Integration: DESC_MAX triple-cap with seeded value (`DESCUENTO_EXCEDE_MAXIMO` at 4.01 / `DESCUENTO_NO_AUTORIZADO` for Operador payload) + `DESC_MAX_FALTANTE` for undiscounted tenant while zero-discount saves; seed re-run idempotent — exactly one active row (R-C2, R-C3, R-V8). (~130 lines)
- [x] 2.11 Integration: `STOCK_INSUFICIENTE` WARN payload shape `{code, productoId, available, requested}` — save succeeds with warning (R-V9). (~60 lines)
- [x] 2.12 Docs: ADR-style note `precioVenta` ITBIS-exclusive (ADR-018 net base) in design doc + `app/SETUP-LOCAL.md` runbook for `pnpm seed:venta`. (~50 lines)
- [x] 2.13 Verify full `pnpm jest src/modules/venta` green; commit PR-2 incl. seed script unit. (~0 diff)

## Phase 3: PR-3 — POS UI slice

> **Gate note (3.1).** The Penpot `02-Venta` board is only referenced in
> `docs/17-plan_wireframes.md §3` (planning). No board export/design spec exists
> in-repo, and no live Penpot instance was connected to this apply session
> (MCP returned "No Penpot instance connected"). Per the design Open Question,
> PR-3 proceeded **board-agnostic** — the four-column POS layout follows design
> §6 (Technical Approach) with no pixel-level reference. Outcome documented in
> `app/src/modules/venta/README.md`.

- [x] 3.1 GATE: verify Penpot `02-Venta` board exists; if unavailable, proceed board-agnostic (no code path change). (~0 diff — outcome above)
- [x] 3.2 `app/src/app/venta/page.tsx` (server shell) + `modules/venta/ui/*` client components: ephemeral cart add/remove/qty/price edit, product search, live totals via the pure domain calculators (per-line ITBIS rate + gravado/exento breakdown). Availability surfaces through the save-time `STOCK_INSUFICIENTE` warning banner (no per-product stock read is exposed in 5b). 
- [x] 3.3 Client picker defaulting "Consumidor Final" (submits `clienteId: null`, resolved by the save pipeline's 5a seam), inline registration via existing `crearClienteAction`; admin-gated discount panel (UI hide only; server re-enforcement is R-V8). 
- [x] 3.4 Stock-warning banner fed by `STOCK_INSUFICIENTE` save payloads; "Save draft" disabled on an empty cart + "My drafts" list with edit/cancel; NO confirm/payment affordance rendered (R-V14, R-V9). In-place edit is gated to zero-discount drafts: a persisted `PORCENTAJE` discount stores only resolved money (R-V7/ADR-018) so the percentage is not recoverable and re-editing would silently collapse `descuentoTipo`; discounted drafts are view/cancel-only in 5b. State comes back through `estadoVentaDesdeDb` (fail-loud) and is compared against `ESTADO_VENTA`, never a free string.
- [x] 3.5 Component tests `modules/venta/ui/__tests__/venta-ui.spec.tsx`: jsdom + React Testing Library; cart totals update on add/qty-edit/remove, CF default submits `null`, discount panel hidden for non-admin, warning banner on triggered warning, empty-cart disabled save, no-confirm invariant. 
- [x] 3.6 Wire the component-test toolchain (added `@testing-library/*`, `jest-environment-jsdom`; tsx transform in `jest.config.js`) and document the manual smoke checklist in `app/SETUP-LOCAL.md`; Playwright E2E deferred to 5c. 
- [x] 3.7 Verify `pnpm jest src/modules/venta/ui` green; smoke checklist (save→list→cancel, keyboard-led deferred note) documented. (~0 diff)
