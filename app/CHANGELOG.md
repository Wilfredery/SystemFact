# Changelog

## [0.11.20](https://github.com/Wilfredery/SystemFact/compare/v0.11.19...v0.11.20) (2026-09-25)

### Bug Fixes

* **rls,env,ci:** close run-2 security audit finding `usuariorol_isolation.missing-is_login_flow-branch` MEDIUM (Phase 3 remediation) — new hand-written migration `20260925120000_fix_usuariorol_login_flow` recreates the `usuariorol_isolation` policy with the single added clause `OR COALESCE(NULLIF(current_setting('app.is_login_flow', true), ''), '') = 'true'` in USING (mirroring `usuario_select` at `20260902120000_enable_rls` line 108, per that migration's own header lines 18-20 which document the USUARIO + USUARIO_ROL `findUnique` auth pair): the policy created at lines 157-179 of the same migration never carried the exception, so the post-`signInWithPassword` lookup of the caller's own role rows could not read them before a tenant context exists; WITH CHECK is deliberately unchanged, so the exception grants login-flow READ only and never login-flow writes; `assertAppRoleUrl` in `src/lib/env.ts` replaces the `SUPERUSER_LIKE_ROLES` denylist with a `systemfact_app` ALLOWLIST that accepts only `systemfact_app` and the dotted transaction-pooler form `systemfact_app.<project-ref>`, because a denylist of superuser-looking names can never be exhaustive and in fact admitted `supabase_admin` plus every dotted pooler variant (`postgres.<project-ref>`, `supabase_admin.<project-ref>`), each of which silently disables every RLS policy; `isAppRoleUsername` and `assertAppRoleUrl` are exported for direct testing and covered by a new `src/lib/env.test.ts` (20 cases: plain, dotted and mixed-case app role accepted; `supabase_admin`, `postgres`, `postgresql`, `root`, `admin`, `dbo`, `sa` and their dotted pooler forms rejected — all of which the old denylist let through, verified red against it); the `integration` CI job now runs `pnpm rls:verify` between database provisioning and the RLS-enforced Jest suite, so the role-level guarantees that were only ever checked by hand (not `postgres`/`supabase_admin`, no BYPASSRLS, not the table owner) now gate every PR; verified 989 unit tests green (969 baseline + 20 new), `tsc --noEmit`, lint (0 errors) and `prisma validate` clean

## [0.11.19](https://github.com/Wilfredery/SystemFact/compare/v0.11.18...v0.11.19) (2026-09-25)

### Bug Fixes

* **cobros,venta,devolucion:** close run-2 security audit findings v2r-02 MEDIUM, v2r-09 MEDIUM, v2r-04 MEDIUM (Phase 2 remediation) — `registrarReembolso` now derives `cobrado = total − saldoPendiente` from the same `FOR UPDATE` locked facts used for the null-check and rejects `monto > cobrado` with the new stable code `REEMBOLSO_EXCEDE_SALDO` before writing the PAGO row (previously an unbounded REEMBOLSO/APLICADO could be committed verbatim against any VIGENTE invoice, even one with zero payments); `cancelarVentaConfirmada` now reverts every live `APLICADO` payment of the invoice to `REVERTIDO` inside the same transaction, BEFORE the ANULADA flip, with one append-only audit row per reverted payment (previously a paid CONTADO sale's single COBRO/APLICADO was orphaned: both refund sinks require FACTURA VIGENTE and the canonical CxC balance filters VIGENTE, so recorded cash vanished from every derived view); venta line input now rejects repeated `productoId` via a shared `zLineasUnicas` zod refine on both create/update schemas plus a defense-in-depth mirror gate in `prepararLineasVenta` (`LINEA_INVALIDA`), `DetalleVenta` gained `@@unique([ventaId,productoId])` (hand-written migration `20260925_detalle_venta_unique_venta_producto`, own commit, verified zero duplicates in dev+test DBs before applying) and `resolverLineasContraVentaOriginal` now groups ORIGINAL rows per productoId, SUMS quantities and throws `LINEA_INVALIDA` when `precioUnitario`/`tasaItbis` differ across rows of the same product (previously a duplicate-producto sale collapsed via `new Map` last-write-wins: first row's units became unreturnable and frozen NC money came from the wrong row); regression coverage via offline 2-case devolucion harness (2.000 and 6.000 of 7 sold units now pass, 8.000 still caps), boundary tests on both venta schemas, cancel-paid-sale integration (PAGO estado=REVERTIDO, derived balance pre-sale, stock restored), refund-bound integration (seed partial cobro then assert REEMBOLSO_EXCEDE_SALDO) and updated auditoria-cobros fixture; verified 969 unit + 199 integration tests green (sole integration failure is the pre-existing v2r-10 harness parking flake, reproduced at true baseline), `tsc --noEmit`, lint, `prisma validate` and production build clean

## [0.11.18](https://github.com/Wilfredery/SystemFact/compare/v0.11.17...v0.11.18) (2026-09-24)

### Bug Fixes

* **compra,venta:** close confirm TOCTOU races against concurrent draft edits (run-2 security audit v2r-03 HIGH, v2r-10 MEDIUM) — `confirmarCompra` now locks the `COMPRA` row (`SELECT ... FOR UPDATE`, `estado='BORRADOR'`) before re-deriving totals from a converged re-read under the held lock, so a draft edited mid-confirm can no longer persist stale header totals over its final lines (the 354.00 divergence repro); `confirmarVenta` now pins the guard `updatedAt` snapshot in `confirmarVentaFlipEnTx` (`WHERE ... estado='BORRADOR' AND updatedAt=<read value>`, mirroring `actualizarVentaBorradorEnTx`), so a draft edited between read and flip fails the flip (zero rows) and the transaction throws — un-burning its NCF consume — instead of emitting an invoice with stale totals; regression coverage via real-DB integration suites (`compra-concurrency.integration.test.ts`, `confirmar-venta.integration.test.ts`: 2-connection interleavings, pg_locks assertions, persisted-header==final-lines convergence check, NCF-unburn check 521 no-consumption) and updated unit tests; verified 951 unit + 197 integration tests green, `tsc --noEmit`, lint, `prisma validate` and production build clean

# [0.11.17](https://github.com/Wilfredery/SystemFact/compare/v0.11.16...v0.11.17) (2026-09-19)

### Documentation

* **sdd:** archive backend-quality-polish — canonical backend-code-quality spec + final gate report (8-PR chain, 63→28 issues, 0 BLOCKER/CRITICAL, dup 1.0%) (#71 pending)
## [0.11.16](https://github.com/Wilfredery/SystemFact/compare/v0.11.15...v0.11.16) (2026-09-19)

### Refactored

* **inventario,reportes:** backend quality-polish batch + dedup (SDD `backend-quality-polish` stage 5b, R-QC-02/R-QC-05) - `inventario-repository.ts`: extract the shared async `guardarPertenenciaProductosEnTx` Phase-A ownership read used by the ajustar/entrada-compra/salidas/reposicion/devolucion batches (each batch skeleton and lock/write ordering stays separate; entrances vs exits never merged) and unify the three per-path audit emitters into one `registrarAuditoriaStockEnTx` parameterized by `AccionAuditoria` (AJUSTAR/CREAR/ACTUALIZAR), removing the duplicated guard + audit blocks with zero behaviour change; `reportes/infrastructure/cxp-repository.ts` + `operacional-repository.ts`: replace the repeated raw SQL segments with business-intent named `Prisma.Sql` fragments (`joinPagosAplicadosEnTx`, `whereVentaConfirmadaEnTx`, `whereInventarioPorEmpresaSucursal`, shared `limitePaginaSql`) preserving bind order and byte-identical screen/CSV predicate parity (EXP-2); `reportes/domain/dgii/formato.ts`: `rellenarAlnum` nullish-guard ternary to `??` (S6606); no undefined-vs-null patch semantics touched; verified 945 unit + 195 integration tests green (all affected DB-backed suites unmodified), `tsc --noEmit` and lint clean

## [0.11.15](https://github.com/Wilfredery/SystemFact/compare/v0.11.14...v0.11.15) (2026-09-18)

### Refactored

* **ui:** mechanical quality-polish batch (SDD `backend-quality-polish` stage 5a) - `readonly` prop typing across the 11 venta/devolucion/login-layout component prop objects (S6759, type-only), `formatearMonto` thousands-grouping regex in `venta/ui/carro.ts` replaced with a pinned `en-US` `Intl.NumberFormat` plus a colocated `formatearMonto.test.ts` behavioural lock (S8786, presentation-only; the provably-redundant `dec === "00"` branch dropped), two nested ternaries flattened to an exhaustive `tono` badge lookup (`cobros/ui/CxcBoardScreen.tsx`) and a save-caption if/else (`venta/ui/PosScreen.tsx`) (S3358), and `venta/ui/DiscountPanel.tsx` label text wrapped in `<span>` to match the codebase's own label convention (S6772); no behaviour change - 945 unit tests green (937 baseline + 8 lock tests), `tsc --noEmit` and lint clean

## [0.11.14](https://github.com/Wilfredery/SystemFact/compare/v0.11.13...v0.11.14) (2026-09-18)

### Chores

* **deps:** override vulnerable prisma transitive bundles (SDD `backend-quality-polish` stage 4, R-QC-03) â€” `lodash` 4.17.21â†’4.18.1, `deepmerge-ts` 7.1.5â†’8.0.2 and `mysql2` 3.15.3â†’3.24.4 arrive only inside the `prisma@7.10.0` bundle and are pinned by prisma's own ranges, so they are forced to their GHSA-patched floors via `app/pnpm-workspace.yaml` `overrides` (pnpm 11+ ignores `package.json#pnpm.overrides`); Prisma is already at the newest compatible 7.x (8.x is RC-only) so no version bump applies; the open `mysql2 >=3.22.0` floor resolves to 3.24.4, which also clears the 3.23.1 decompression-bomb advisory; verified `prisma validate`/`generate` pass, `pnpm audit --prod` = 0, 937 unit + 195 integration tests green, tsc/lint clean

## [0.11.13](https://github.com/Wilfredery/SystemFact/compare/v0.11.12...v0.11.13) (2026-09-18)

### Tests

* **quality-polish:** wire honest real-database integration coverage into the Sonar lab (SDD `backend-quality-polish` slice 3) â€” add a `pnpm coverage:integration` script (`test:integration` + `--coverage --coverageReporters=lcov --coverageDirectory=coverage-integration`) and scope `jest.integration.config.js` `collectCoverageFrom` to backend `src/**` sources only (excluding the generated Prisma client, the integration/test-support harnesses and the Next.js `src/app/**` pages, which the `node`-env integration run cannot instrument), so the emitted `coverage-integration/lcov.info` merges with the unit lcov via a comma-separated `sonar.javascript.lcov.reportPaths` (documented in `app/README.md`); test-DB `DATABASE_URL` still comes from the git-ignored `app/.env.integration` (no secrets committed) and no application-code smell is touched (verified: 937 unit + 195 integration tests, `tsc --noEmit` and lint green)

## [0.11.12](https://github.com/Wilfredery/SystemFact/compare/v0.11.11...v0.11.12) (2026-09-18)

### Refactored

* **tenant:** relocate the `withTenantTransaction` GUC/RLS integration probe out of the Jest/Sonar source tree to `app/scripts/withTenantTransaction.probe.ts` (SDD `backend-quality-polish` slice 2) so the tsx-only probe is no longer flagged as a source-less test (S2187); imports rewritten to `@/modules/...`, `pnpm probe:tenant` script added, the now-redundant per-file Jest exclusion dropped (`scripts/` stays excluded), and the sibling `-options.test` header updated to the new path â€” no `.itest.ts` rename; GUC behavior coverage is unchanged (the mocked timeout/`set_config`-failure cases and the live-probe assertions both stay)

## [0.11.11](https://github.com/Wilfredery/SystemFact/compare/v0.11.10...v0.11.11) (2026-09-18)

### Refactored

* **quality-polish:** pass-2 complexity split of 5 updater/normalizer functions so every one clears the Sonar S3776 â‰¤15 cognitive-complexity ceiling â€” `actualizarProducto` 25â†’10 (pure `validarInvariantsFiscales` + async `sondarIntegridadReferencial`), `actualizarProveedor` 23â†’13 (pure `prepararPatchProveedor`/`resolverRncFinalSeguro` + async `sondaRncDuplicado` + `calcularDifAuditoria`, row guards inline to avoid non-null assertions), `actualizarCliente` 21â†’12 (pure `prepararValidacionCliente` + async `sondaFiscalDuplicada` + `calcularDifAuditoria`), `resolverRangoSD` 18â†’8 (`resolverPresetFechas` + `validarRangoPersonalizado` + `normalizarFechaCruda`, error precedence unchanged) and `confirmarVenta` 16â†’15 (PRE-consume pure `resolverRechazoCredito`; the consumeâ†’flipâ†’invoiceâ†’salidas/cobro R-V15 chain stays inline and ordered) (SDD `backend-quality-polish` slice 1f â€” behavior-preserving: the 937-test unit suite and the confirmar/cliente/reportes integration suites pass with zero golden or characterization churn)

## [0.11.10](https://github.com/Wilfredery/SystemFact/compare/v0.11.9...v0.11.10) (2026-09-18)

### Refactored

* **venta,devolucion:** extract pure pre-consume helpers `verificarDisponibilidadPreNcf` (R-V15 hard stock-preview predicate) and `resolverLineasContraVentaOriginal` (R-D5 original-line freeze) with colocated unit tests; close both S3735 `void` findings (drop the unused NCF `secuencial` capture in `confirmarVenta`; explicit if-and-return guard replaces the unreachable `void gate` dismissal in `cancelarVentaConfirmada`) and fix S6582 on the factura guard via optional chaining (SDD `backend-quality-polish` slice 1e â€” behavior-preserving; the consumeâ†’flipâ†’invoiceâ†’salidas/cobro ordering stays inline and ordered, the confirmar/devolucion and cancelar-confirmada integration suites pass unmodified)

## [0.11.9](https://github.com/Wilfredery/SystemFact/compare/v0.11.8...v0.11.9) (2026-09-18)

### Refactored

* **reportes:** dispatch-only `REPORTE_ID â€” {consultar, Panel}` registry + single dispatch in the `/reportes` page, replacing the 10 per-report action+Panel conditionals (SDD `backend-quality-polish` slice 1d â€” S3776 cognitive-complexity, behavior-preserving; authorization stays in the server actions, DB-2 integration suites untouched)

## [0.11.8](https://github.com/Wilfredery/SystemFact/compare/v0.11.7...v0.11.8) (2026-09-18)

### Refactored

* **reportes,auditoria:** extract pure `resolverRangoSD(entrada, now)` (SD-range resolve/preset/validate/UTC-convert) and pure `normalizarAccion`/`normalizarTexto` trim helpers out of the two `normalizarFiltro` functions (SDD `backend-quality-polish` slice 1c â€” S3776 cognitive-complexity, behavior-preserving; existing filter suites stay green, no test churn) (#62 pending)

## [0.11.7](https://github.com/Wilfredery/SystemFact/compare/v0.11.6...v0.11.7) (2026-09-18)

### Refactored

* **venta,proveedor:** decompose `prepararLineasVenta` into pure `validarPrecondicionesLineas`/`construirLineasPersistibles`/`colectarWarningsStock` + async `validarDescuentosAutorizadosYTopes`, and extract pure `construirPatchProveedor`/`resolverRncFinal` (SDD `backend-quality-polish` slice 1b â€” S3776 cognitive-complexity, behavior-preserving; colocated discount-branch unit tests added)

## [0.11.6](https://github.com/Wilfredery/SystemFact/compare/v0.11.5...v0.11.6) (2026-09-18)

### Chores

* **agents:** codify release conventions â€” every PR carries its own version bump, semver `refactor:`/`test:` â†’ PATCH, UTF-8 BOM rule for machine-consumed files (#59 CI root cause)

## [0.11.5](https://github.com/Wilfredery/SystemFact/compare/v0.11.4...v0.11.5) (2026-09-18)

### Refactored

* **producto,cliente:** table-driven patch + audit-diff builder, undefined-vs-null goldens pinned (SDD slice 1a) (#58) ([v0.11.5](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.5))

## [0.11.4](https://github.com/Wilfredery/SystemFact/compare/v0.11.3...v0.11.4) (2026-09-18)

### Fixed

* **db:** unconditional append-only audit trigger (AUDITORIA_INMUTABLE) + schema credit-defaults sync (#57) ([v0.11.4](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.4))
## [0.11.3](https://github.com/Wilfredery/SystemFact/compare/v0.11.2...v0.11.3) (2026-09-18)

### Fixed / Maintenance

* **test:** replace `Math.random` test-data suffixes with `crypto.randomUUID` integration fixtures (#55) ([v0.11.3](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.3))

## [0.11.2](https://github.com/Wilfredery/SystemFact/compare/v0.11.1...v0.11.2) (2026-09-18)

### Documentation

* **sdd:** archive fase-7b-reportes Ã¢â‚¬â€ 6 canonical specs synced + chain close report (#54) ([v0.11.2](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.2))

## [0.11.1](https://github.com/Wilfredery/SystemFact/compare/v0.11.0...v0.11.1) (2026-09-17)

### Chores

* release 0.11.0 Ã¢â‚¬â€ package.json bump 0.5.0 Ã¢â€ â€™ 0.11.0, manifest and CHANGELOG backfill (#53) ([v0.11.1](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.1))

## [0.11.0](https://github.com/Wilfredery/SystemFact/compare/v0.10.0...v0.11.0) (2026-09-17)

### Features

* **reportes:** slice E Ã¢â‚¬â€ IT-1 fiscal summary + DGII 606/607/608 TXT exports (#52): signed per-period ITBIS summary + IT-1 casilla self-check; DGII fixed-width exporters 607/606/608 (DB-backed B02 threshold, deterministic cap split, en-cero, U1 encoding gates); `/reportes/exportar-txt` route, fiscal panel and actions (Fiscal Admin-only, no audit rows) ([v0.11.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.0))
* **reportes:** slice D Ã¢â‚¬â€ per-product rentabilidad report (#51): current-cost margin math, REN-3 limitation surfaced, rentabilidad panel + CSV ([v0.10.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.10.0))
* **reportes:** slice C Ã¢â‚¬â€ CxC aging, CxP and comparativa financiera (#50): ADR-017-derived balances, aging buckets, Cobrador branch-pin, cash-flow window deltas ([v0.9.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.9.0))
* **reportes:** slice B Ã¢â‚¬â€ operational reports + CSV export + aggregation indexes (#49): product ranking, stock state, sales by period, inventory valuation, invoice state ([v0.8.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.8.0))

## [0.7.0](https://github.com/Wilfredery/SystemFact/compare/v0.6.1...v0.7.0) (2026-09-17)

### Features

* **reportes:** slice A Ã¢â‚¬â€ shared reportes infra + role-aware dashboard (#48): filter/pagination/role-gate contracts, Santo-Domingo calendar boundaries, RFC4180 CSV writer seam, company-wide read widen, dashboard KPIs, selector-first `/reportes` shell ([#48](https://github.com/Wilfredery/SystemFact/pull/48))

## [0.6.1](https://github.com/Wilfredery/SystemFact/compare/v0.6.0...v0.6.1) (2026-09-17)

### Documentation

* **sdd:** archive fase-7a-auditoria Ã¢â‚¬â€ spec sync + archive report (#47)

## [0.6.0](https://github.com/Wilfredery/SystemFact/compare/v0.5.0...v0.6.0) (2026-09-17)

### Features

* **auditoria:** fase 7a Ã¢â‚¬â€ audit consultation screen, cobros/auth write backfill, append-only audit port (#46): admin `/auditoria` screen, `AuditoriaWritePort`, LOGIN/LOGOUT/PAGAR audit events, tenant read indexes

## [0.5.0](https://github.com/Wilfredery/SystemFact/compare/v0.4.2...v0.5.0) (2026-09-15)


### Features

* **devolucion:** B04 nota de credito use case, repository seam and http action ([5a01df1](https://github.com/Wilfredery/SystemFact/commit/5a01df1f52e070071305313c00c89508a48b2518))
* **venta,devolucion:** B04 credit-note returns core (fase-5d slice 1) ([55681b7](https://github.com/Wilfredery/SystemFact/commit/55681b7325644331f94c8144dbe2378aadd50882))
* **venta,devolucion:** idempotent retry gate + critical integration tests (fase-5d slice 3) ([#33](https://github.com/Wilfredery/SystemFact/issues/33)) ([a7eb2be](https://github.com/Wilfredery/SystemFact/commit/a7eb2be4f843e43c58b051a8f9b864e63f3025ae))
* **venta,devolucion:** return UI + E2E B04 happy path (fase-5d slice 2) ([#30](https://github.com/Wilfredery/SystemFact/issues/30)) ([a05accc](https://github.com/Wilfredery/SystemFact/commit/a05accc143659f43851e6efe43155e6be03b7aad))
* **venta:** return error codes 601-604, plazo-devolucion reader and NCF B04 seed ([9a6fdda](https://github.com/Wilfredery/SystemFact/commit/9a6fddacad5c4f691d0191d40b20186cbdccd5a9))


### Bug Fixes

* **ncf:** compute seed vigencia year on the Santo Domingo business calendar ([85f86b2](https://github.com/Wilfredery/SystemFact/commit/85f86b202b00ef8635ed04d9ffc66eeb785981e1))


### Documentation

* **devolucion:** module README + JSDoc pass (fase-5d pr5d4 closure) ([#36](https://github.com/Wilfredery/SystemFact/issues/36)) ([6d20bfe](https://github.com/Wilfredery/SystemFact/commit/6d20bfe571a7bd767e7bed890637b1ea8fe6c45a))

## [0.4.2](https://github.com/Wilfredery/SystemFact/compare/v0.4.1...v0.4.2) (2026-09-15)


### Documentation

* **sdd:** archive fase-5d-devolucion-b04 (spec sync + verify envelope) ([#40](https://github.com/Wilfredery/SystemFact/issues/40)) ([ef8ff84](https://github.com/Wilfredery/SystemFact/commit/ef8ff84a2678c57191925dcd7603b175b611586b))
* **sdd:** reconcile apply-progress + verify-report (fase-5d lifecycle closure) ([#38](https://github.com/Wilfredery/SystemFact/issues/38)) ([aa08311](https://github.com/Wilfredery/SystemFact/commit/aa083111e756c9d1eaed1cf4c62459280da31846))

## [0.4.1](https://github.com/Wilfredery/SystemFact/compare/v0.4.0...v0.4.1) (2026-09-15)


### Documentation

* **devolucion:** module README + JSDoc pass (fase-5d pr5d4 closure) ([#36](https://github.com/Wilfredery/SystemFact/issues/36)) ([6d20bfe](https://github.com/Wilfredery/SystemFact/commit/6d20bfe571a7bd767e7bed890637b1ea8fe6c45a))

## [0.4.0](https://github.com/Wilfredery/SystemFact/compare/v0.3.0...v0.4.0) (2026-09-15)


### Features

* **venta,devolucion:** idempotent retry gate + critical integration tests (fase-5d slice 3) ([#33](https://github.com/Wilfredery/SystemFact/issues/33)) ([a7eb2be](https://github.com/Wilfredery/SystemFact/commit/a7eb2be4f843e43c58b051a8f9b864e63f3025ae))

## [0.3.0](https://github.com/Wilfredery/SystemFact/compare/v0.2.0...v0.3.0) (2026-09-14)


### Features

* **venta,devolucion:** return UI + E2E B04 happy path (fase-5d slice 2) ([#30](https://github.com/Wilfredery/SystemFact/issues/30)) ([a05accc](https://github.com/Wilfredery/SystemFact/commit/a05accc143659f43851e6efe43155e6be03b7aad))

## [0.2.0](https://github.com/Wilfredery/SystemFact/compare/v0.1.0...v0.2.0) (2026-09-14)


### Features

* **devolucion:** B04 nota de credito use case, repository seam and http action ([5a01df1](https://github.com/Wilfredery/SystemFact/commit/5a01df1f52e070071305313c00c89508a48b2518))
* **venta,devolucion:** B04 credit-note returns core (fase-5d slice 1) ([55681b7](https://github.com/Wilfredery/SystemFact/commit/55681b7325644331f94c8144dbe2378aadd50882))
* **venta:** return error codes 601-604, plazo-devolucion reader and NCF B04 seed ([9a6fdda](https://github.com/Wilfredery/SystemFact/commit/9a6fddacad5c4f691d0191d40b20186cbdccd5a9))


### Bug Fixes

* **ncf:** compute seed vigencia year on the Santo Domingo business calendar ([85f86b2](https://github.com/Wilfredery/SystemFact/commit/85f86b202b00ef8635ed04d9ffc66eeb785981e1))
