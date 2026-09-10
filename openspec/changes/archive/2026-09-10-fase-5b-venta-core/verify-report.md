```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:c65a79a8909c35f8d86bd6108183983945378f59e25513987ed3afad3a5023a0
verdict: pass
blockers: 0
critical_findings: 0
requirements: 17/17
scenarios: 24/24
test_command: pnpm test; pnpm test:integration
test_exit_code: 0
test_output_hash: sha256:d2dc4a781b15fd64e18c1868ce1777c1cdb1550a8907efa0096c69c2f4973b87
build_command: pnpm lint; pnpm exec tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:1933b23f2d2990814412de3618deb8f101a6feaa990393e57d2c44aec57252d5
```

## Verification Report

**Change**: fase-5b-venta-core — Venta Draft Engine + First POS UI
**Version**: venta (R-V1…R-V14) + venta-config (R-C1…R-C3)
**Mode**: Standard (strict_tdd = false; Jest)
**Repo state**: branch `feat/fase-5b-venta-core`, HEAD `6955211` (matches expected), working tree clean (no drift).

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 30 |
| Tasks complete | 30 |
| Tasks incomplete | 0 |

### Build & Tests Execution
All commands run fresh from `C:\SystemFact\app`. Output digests are SHA256 over the captured evidence.

**Build / type / lint**: ✅ Passed
```text
pnpm lint                      → eslint, 0 problems, exit 0
pnpm exec tsc --noEmit         → 0 bytes output, exit 0 (no type errors)
build_output_hash = 1933b23f2d2990814412de3618deb8f101a6feaa990393e57d2c44aec57252d5 (lint+tsc)
```

**Tests**: ✅ 606 passed (529 unit + 77 real-DB integration), 0 failed, 0 skipped
```text
pnpm test            → Test Suites: 58 passed / Tests: 529 passed  (unit: domain pure, application mocked, ui jsdom, seed-config)
pnpm test:integration→ Test Suites: 21 passed / Tests: 77 passed   (real DB systemfact_test @ sf-postgres:5433, runInBand)
  venta suites green: venta-config, venta-resolver, venta-lifecycle, venta-tenant, venta-stock, venta-rates
test_output_hash = d2dc4a781b15fd64e18c1868ce1777c1cdb1550a8907efa0096c69c2f4973b87 (unit+integration)
```
**Coverage**: ➖ not measured (verification requires current passing evidence, not a coverage threshold; project has no enforced coverage gate).

### Spec Compliance Matrix
Statuses: ✅ COMPLIANT (covering test exists and passed at runtime).

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| R-V1 create draft, mandatory client | Contado sale materializes CF | `venta-service.test.ts` (crearVenta/CF) + `venta-resolver.integration.test.ts` + `venta-lifecycle.integration.test.ts` | ✅ COMPLIANT |
| R-V1 | Empty line list rejected (LINEAS_VACIAS) | `venta-service.test.ts::crearVenta` | ✅ COMPLIANT |
| R-V2 per-line ITBIS validity window | Expired rate window blocks save (TASA_ITBIS_VIGENCIA_FALTA) | `venta-rates.integration.test.ts` | ✅ COMPLIANT |
| R-V3 replace-all-lines + client swap | Client swapped while draft | `venta-lifecycle.integration.test.ts` | ✅ COMPLIANT |
| R-V3 | Concurrent editors (CONCURRENCIA_CONFLICTO) | `venta-lifecycle.integration.test.ts` (parallel updates) | ✅ COMPLIANT |
| R-V4 guarded cancel | Double-click cancel | `venta-lifecycle.integration.test.ts` | ✅ COMPLIANT |
| R-V5 frozen per-line order | Mixed rates + line discounts (F2) | `calculators.spec.ts` (F2) | ✅ COMPLIANT |
| R-V6 header proration pre-ITBIS | Clean proration gravado+exento (F1) | `calculators.spec.ts` (F1) | ✅ COMPLIANT |
| R-V6 | Rounding remainder to largest line (F3) | `calculators.spec.ts` (F3) | ✅ COMPLIANT |
| R-V7 discount storage semantics | Zero-discount PORCENTAJE/0.00 convention | `descuentos.spec.ts` + `venta-service.test.ts` | ✅ COMPLIANT |
| R-V8 admin + DESC_MAX caps | DGII 4% boundary (F4) | `calculators.spec.ts` (F4) | ✅ COMPLIANT |
| R-V8 | Non-admin submits discount (DESCUENTO_NO_AUTORIZADO) | `venta-config.integration.test.ts` | ✅ COMPLIANT |
| R-V9 stock WARN never block | Warning surfaces, draft persists | `venta-stock.integration.test.ts` | ✅ COMPLIANT |
| R-V10 venta client resolver | Cross-tenant client id (no PII leakage) | `venta-resolver.integration.test.ts` + `resolver-cliente-venta.test.ts` | ✅ COMPLIANT |
| R-V11 tenant/branch isolation | High-traffic draft isolation | `venta-tenant.integration.test.ts` + `tenant-isolation.integration.test.ts` | ✅ COMPLIANT |
| R-V12 paginated listing/detail | Pagination bounds rejected (>100) | `listar-paginado.integration.test.ts` + `venta-service.test.ts::listarVentas` | ✅ COMPLIANT |
| R-V13 pinned error catalog | Unknown stored state fails loud | `venta.spec.ts` (estadoVentaDesdeDb fail-loud + `toHaveLength(14)`) | ✅ COMPLIANT |
| R-V14 POS UI draft slice | Cart to draft, no confirm path | `venta-ui.spec.tsx` (no-confirm invariant + live totals) | ✅ COMPLIANT |
| R-V14 | Empty-cart guard | `venta-ui.spec.tsx` (save disabled empty cart) | ✅ COMPLIANT |
| R-C1 hard-fail DESC_MAX read | Missing key blocks discounted draft only | `venta-config.integration.test.ts` | ✅ COMPLIANT |
| R-C1 | Expired window treated as missing | `venta-config.integration.test.ts` | ✅ COMPLIANT |
| R-C2 idempotent seed | Seed re-run is idempotent | `seed-venta-config.test.ts` + `venta-config.integration.test.ts` | ✅ COMPLIANT |
| R-C2 | Seeded tenant discounts successfully | `venta-config.integration.test.ts` | ✅ COMPLIANT |
| R-C3 cap consumes config | Adjusted cap takes effect | `venta-config.integration.test.ts` | ✅ COMPLIANT |

**Compliance summary**: 24/24 scenarios compliant; 17/17 requirements covered by ≥1 passing runtime test.

### Focused claim re-verification (independent, not trusted from apply)
- **F2/F4/F5 calculator pinning**: `calculators.spec.ts` asserts F2 (R-V5 bases 18.31/20.13/25.80), F4 (100.00 @18% −4% → 96.00/17.28/113.28), and F5 (combined line-% + header-%, gross/net basis → total 274.52). All pass in the unit run (exit 0). Confirmed `precioVenta` is ITBIS-exclusive (base + ITBIS). ✅
- **14-code catalog reconciliation**: `domain/errors.ts` defines exactly 14 distinct stable codes (12 venta-owned + 2 re-emitted `CLIENTE_*`); `venta.spec.ts:90` asserts `toHaveLength(14)` at runtime. `DESC_MAX_FALTANTE` is correctly owned by the venta-config read path, NOT the domain catalog. Matches spec R-V13. ✅
- **Draft-with-discount edit narrowing**: `PosScreen.tsx:154` (`if (d.descuento !== "0.00")` → blocks re-edit, message "percentage is not recoverable") and `DraftList.tsx:53` (`editable = d.descuento === DESCUENTO_CERO_MONEY`, Edit disabled otherwise); covered by `venta-ui.spec.tsx` "disables in-place edit for a discounted draft" (passes). ✅
- **Consumidor Final resolver savepoint fix**: `getOrCreateConsumidorFinalEnTx` (consumidor-final.ts:57) wraps the CF insert in `abrirSavepoint`/`revertarSavepoint` (tenant/infrastructure/savepoint.ts) to recover the aborted PG transaction (SQLSTATE 25P02) before the winner-refetch; seam signature `(tx, empresaId)` unchanged; resolver calls `(tx, ctx, clienteId)` per design. Real-DB `venta-resolver.integration.test.ts` + `savepoint.test.ts` pass. ✅
- **Tenant scoping + wrapper**: all 5 venta actions (`crearVentaAction`/`actualizarVentaAction`/`cancelarVentaAction`/`listarVentasAction`/`obtenerVentaAction`) open DB access inside `withTenantTransaction`; ESLint rule `server-action-must-wrap-tenant` passes (tooling unit + repo lint clean); cross-tenant/branch isolation verified by `venta-tenant` + `tenant-isolation` integration suites. ✅

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| R-V1…R-V14 | ✅ Implemented | Four-layer `venta` module (domain/application/infrastructure/http/ui) present; pure domain has no DB/Next/Prisma imports. |
| R-C1…R-C3 | ✅ Implemented | Hard-fail in-transaction `DESC_MAX` read, idempotent `seed:venta`, cap consumed from config (no hardcoded default). |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| `precioVenta` ITBIS-exclusive (ADR-018 net base) | ✅ Yes | Calculator returns base + ITBIS; design ADR note present. |
| Decimal-string math, no floats, half-up 2dp | ✅ Yes | F1–F5 pinned in `calculators.spec.ts`. |
| Header proration, remainder→largest base (ties earliest) | ✅ Yes | F3. |
| Resolver composition over 5a seam, stable signature | ✅ Yes | `resolver-cliente-venta.ts`; savepoint self-probing guard for non-tx seed path. |
| Returned-not-stored `subtotalGravado`/`subtotalExento` | ✅ Yes | No VENTA columns; 5c re-derives. |
| 14-code catalog (design's historical "13") | ✅ Yes | design.md §Interfaces explicitly reconciles to 14; domain frozen at 14. |
| Chained PR-1/PR-2/PR-3 with rollback boundaries | ✅ Yes | Commit history: domain → app/config/http → UI. |

### Issues Found
**CRITICAL**: None.
**WARNING**: None blocking. (Two informational notes promoted to SUGGESTION below; neither violates a spec acceptance criterion.)
**SUGGESTION**:
1. Design Open Question "PR-3 must verify the live Penpot `02-Venta` board" remains unresolved: no Penpot instance was connected, so PR-3 proceeded board-agnostic (tasks 3.1 gate, documented in `venta/README.md`). Spec R-V14 is layout-agnostic and its scenarios pass via component tests, so this is an accepted V1 scope decision — flag for visual review before 5c if a board later lands.
2. Environment precondition: the integration DB (`sf-postgres:5433`) was not running at verification start; Docker Desktop and the existing container were brought up to obtain real-DB evidence (harness reused, no cleanup required). CI must keep the Postgres service available for `pnpm test:integration`.

### Verdict
**PASS** — 17/17 requirements and 24/24 scenarios are covered by passing runtime tests (529 unit + 77 real-DB integration, exit 0), with lint and type-check gates green; implementation matches specs, design decisions, and tasks with no critical or blocking findings.
