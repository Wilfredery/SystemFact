# Proposal: Backend Quality Polish

## Intent

SonarQube baseline (v0.11.4, lab at `localhost:9000`) reports 63 issues: 1 BLOCKER, 11 CRITICAL (9Ã— S3776 cognitive complexity, 2Ã— S3735), 13 MAJOR, 38 MINOR â€” duplication at 3.7% (103 blocks), with one file (`inventario-repository.ts`) at 12.8%. Goal: near-0 BLOCKER/CRITICAL, duplication <3%, maintainability-rating ratio unchanged, all quality-gate ratings stay A â€” via behavior-preserving refactors only. No feature work.

## Scope

### In Scope (5 stages, 10 PR slices, all â‰¤400-line gate)

| Stage | PR slice | Files | Strategy (behavior preservation) | Est. lines |
|---|---|---|---|---|
| 1a | S3776 producto+cliente | `src/modules/producto/application/actualizar-producto.ts` (+S6582@109), `src/modules/cliente/application/actualizar-cliente.ts` | Replace 9 patch+audit-diff blocks with pure table-driven `construirPatchYDif(actual, input, fieldDescriptors)`; `construirPatchCliente(input)` + `calcularEstadoEfectivo` used once (kills recompute dup). Green: actualizar-producto.test.ts, actualizar-cliente.test.ts | â‰ˆ280 (splittable â‰ˆ150/150) |
| 1b | S3776 proveedor+preparar-lineas | `actualizar-proveedor.ts`, `preparar-lineas-venta.ts:117` | Pure `construirPatchProveedor` + `resolverRncFinal`; decompose per the 5 phase comments (`validarPrecondicionesLineas`, `validarDescuentosAutorizadosYTopes`, `construirLineasPersistibles`, `collectarWarningsStock`) + new colocated discount-branch unit. Green: actualizar-proveedor.test.ts, venta-service.test.ts + integration | â‰ˆ200 |
| 1c | S3776 normalizers | `reportes/application/reporte-filtro.ts:177`, `auditoria/application/auditoria.ts:156` | Extract pure `resolverRangoSD(entrada, now)`; `normalizarAccion` + trim helpers. Green: reporte-filtro.test.ts, auditoria.test.ts | â‰ˆ140 |
| 1d | S3776 reportes page | `src/app/(app)/reportes/page.tsx` `PanelReporte:98` | `Record<REPORTE_ID, {consultar, Panel}>` registry + single dispatch; keep DASHBOARD/DGII-card/fallback branches; authorization STAYS in actions (DB-2) | â‰ˆ90 |
| 1e | S3776 confirmar+devolucion + S3735 voids | `confirmar-venta.ts:163`, `crear-devolucion.ts:156` (+S6582@167), 2Ã— S3735 | Extract pre-consume `verificarDisponibilidadPreNcf` and `resolverLineasContraVentaOriginal` ONLY; R-V15 throw-after-consume ordering untouched. Green: 4 confirmar integration files, 3 devolucion integration files | â‰ˆ150 |
| 2 | S2187 BLOCKER | `src/modules/tenant/infrastructure/withTenantTransaction.test.ts` â†’ `app/scripts/withTenantTransaction.probe.ts` | Move probe out of Sonar scope (S2187 out of sources); fix import â†’ `@/modules/...`, `probe:tenant` script, swipe `jest.config.js` exclusions; update sibling -options.test comment. NO `.itest.ts` rename (would re-enter Sonar scope). GUC behavior already covered by withTenantTransaction-options.test.ts + 195 integration tests | â‰ˆ40 |
| 3 | Honest integration coverage | `sonar.javascript.lcov.reportPaths` + test:integration `--coverage` (CI/lcov merge) | No app-code smells touched; Sonar lab sees jest.integration lcov | â‰ˆ60 |
| 4 | Dependencies | `app/package.json` (prisma/@prisma/client/@prisma/adapter-pg â†’ newest 7.x, `pnpm.overrides` lodashâ‰¥4.18.1, deepmerge-tsâ‰¥8.0.0, mysql2â‰¥3.22.0), lockfile | All advisories transit via prisma CLI bundles, none in app server path; smoke `prisma validate/generate` + full tests + `pnpm audit --prod` | â‰ˆ30 |
| 5a | Frontend mechanicals | S6759 (11 files, readonly props), carro.ts S8786 â†’ `Intl.NumberFormat` (+new `formatearMonto` lock test), S6772Ã—3 label spans, S3358Ã—4, mechanical minor batch | Mechanical/style only; no feature work | â‰ˆ200 |
| 5b | Backend batch + dedup | S4624Ã—4 (cxp/operacional repos â†’ named SQL-fragment helpers), S6606Ã—4, S6582 residual, `inventario-repository.ts` â†’ `guardarPertenenciaProductosEnTx` + single audit helper with `AccionAuditoria` param | Integration-protected; do NOT unify batch skeletons (fiscal risk) | â‰ˆ180 |

### Out of Scope
- **S1874**: does NOT exist in the v0.11.4 scan (launch context stale). ProductSearch/ClienteSelector `FormEvent` not deprecated in React 19.
- **http/actions duplication** (`producto/actions.ts` 17.5%, `inventario/actions.ts` 27.4%): thin-adapter convention by design; a generic factory would hide the wrapper from the ESLint `server-action-must-wrap-tenant` rule. ACCEPT â€” floor is the <4% gate, not zero.
- Any frontend feature work beyond the mechanical smells above; cross-module helper sharing (ADR-013 per-module boundary).

## Capabilities

### New Capabilities
- `backend-code-quality`: quality-gate contract (S3776 <15, duplication <3%, ratings A) and behavior-preservation constraints for patch-based use case edits.

### Modified Capabilities
- None. All refactors preserve existing requirement behavior; specify requirements via the new capability only.

## Approach
Per stage: extract pure helpers named by business intent (domain purity, ADR-013), table-driven field descriptors for patch+audit-diff, registry tables for the reportes page, probe relocation to `app/scripts/`, Prisma patch bump + `pnpm.overrides`, batched readonly/mechanical fixes. Each PR keeps 911 unit + 195 integration tests green + ESLint tenant rule, then Sonar re-scan on the lab at stage end.

## Affected Areas

| Area | Impact |
|---|---|
| `src/modules/{producto,cliente,proveedor,venta,devolucion,auditoria,reportes}/application/*` | Modified (pure-helper extraction) |
| `src/modules/dgii/infrastructure/repos`, `src/modules/cxp|operacional/infrastructure/*-repository.ts` | Modified (SQL fragment helpers) |
| `src/modules/inventario/infrastructure/inventario-repository.ts` | Modified (guard/audit dedup) |
| `src/modules/tenant/infrastructure/withTenantTransaction.test.ts` â†’ `app/scripts/withTenantTransaction.probe.ts` | Moved + `jest.config.js`, `app/package.json` scripts |
| CI / sonar config (Stage 3) | Modified (lcov wiring) |
| `app/package.json` + lockfile (Stage 4) | Modified (deps/overrides) |
| `src/**/ui/*.tsx` (S6759/S6772/S8786/S3358) | Modified (mechanical) |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Null-vs-undefined patch semantics broken (identificacionFiscal clearing) | Med | Do NOT rewrite explicit `!==undefined` with `??`; per-site S6606 check; existing explicit-null golden assertions must stay green (PR 1a) |
| R-V15 consumeâ†’flipâ†’invoiceâ†’salidasâ†’cobro ordering violated | Med | Extract pre-consume/pure blocks only; 4 integration files + venta-service tests gate every change (PR 1e) |
| Registry moves authorization out of actions | Low | Page dispatches only; authorizations remain server-side; DB-2 tests green (PR 1d) |
| deepmerge-ts 7â†’8 breaks prisma CLI config parse | Med | CI `prisma validate` covers it; fallback pin to 7.x latest, await Prisma bump (Stage 4) |
| RLS/tenant patterns regress | Low | Never touch `withTenantTransaction` wrapping logic; ESLint rule runs per PR |
| WTT probe loses discoverability | Low | `pnpm probe:tenant` script + SETUP-LOCAL.md reference; never edit archived openspec docs |

## Rollback Plan
Revert the offending PR per stage (each stage is independently revertible); Stage 4 rollback = remove `pnpm.overrides` entries + repin previous prisma 7.x in lockfile. Sonar re-scan after revert confirms baseline restoration.

## Dependencies
- SonarQube lab at `localhost:9000` for re-scans.
- jest.integration coverage report wiring (Stage 3) before final gate verification.
- Upstream 7.x Prisma releases fixing transitive advisories (not required â€” overrides cover in-range).

## Success Criteria
- [ ] Sonar: 0 BLOCKER, 0 CRITICAL (S3776 functions all <15), duplication <3%
- [ ] All quality-gate ratings remain A; 911 unit + 195 integration tests green per PR
- [ ] ESLint `server-action-must-wrap-tenant` clean; `prisma validate/generate` pass on overridden deps
- [ ] `pnpm audit --prod` shows no HIGH/MODERATE from the 6 mapped advisories
- [ ] Zero behavior change proven by golden/null-semantics/None tests (acceptance criteria seeded for spec)
