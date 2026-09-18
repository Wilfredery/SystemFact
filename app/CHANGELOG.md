# Changelog

## [0.11.9](https://github.com/Wilfredery/SystemFact/compare/v0.11.8...v0.11.9) (2026-09-18)

### Refactored

* **reportes:** dispatch-only `REPORTE_ID — {consultar, Panel}` registry + single dispatch in the `/reportes` page, replacing the 10 per-report action+Panel conditionals (SDD `backend-quality-polish` slice 1d — S3776 cognitive-complexity, behavior-preserving; authorization stays in the server actions, DB-2 integration suites untouched)

## [0.11.8](https://github.com/Wilfredery/SystemFact/compare/v0.11.7...v0.11.8) (2026-09-18)

### Refactored

* **reportes,auditoria:** extract pure `resolverRangoSD(entrada, now)` (SD-range resolve/preset/validate/UTC-convert) and pure `normalizarAccion`/`normalizarTexto` trim helpers out of the two `normalizarFiltro` functions (SDD `backend-quality-polish` slice 1c — S3776 cognitive-complexity, behavior-preserving; existing filter suites stay green, no test churn) (#62 pending)

## [0.11.7](https://github.com/Wilfredery/SystemFact/compare/v0.11.6...v0.11.7) (2026-09-18)

### Refactored

* **venta,proveedor:** decompose `prepararLineasVenta` into pure `validarPrecondicionesLineas`/`construirLineasPersistibles`/`colectarWarningsStock` + async `validarDescuentosAutorizadosYTopes`, and extract pure `construirPatchProveedor`/`resolverRncFinal` (SDD `backend-quality-polish` slice 1b — S3776 cognitive-complexity, behavior-preserving; colocated discount-branch unit tests added)

## [0.11.6](https://github.com/Wilfredery/SystemFact/compare/v0.11.5...v0.11.6) (2026-09-18)

### Chores

* **agents:** codify release conventions — every PR carries its own version bump, semver `refactor:`/`test:` → PATCH, UTF-8 BOM rule for machine-consumed files (#59 CI root cause)

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

* **sdd:** archive fase-7b-reportes â€” 6 canonical specs synced + chain close report (#54) ([v0.11.2](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.2))

## [0.11.1](https://github.com/Wilfredery/SystemFact/compare/v0.11.0...v0.11.1) (2026-09-17)

### Chores

* release 0.11.0 â€” package.json bump 0.5.0 â†’ 0.11.0, manifest and CHANGELOG backfill (#53) ([v0.11.1](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.1))

## [0.11.0](https://github.com/Wilfredery/SystemFact/compare/v0.10.0...v0.11.0) (2026-09-17)

### Features

* **reportes:** slice E â€” IT-1 fiscal summary + DGII 606/607/608 TXT exports (#52): signed per-period ITBIS summary + IT-1 casilla self-check; DGII fixed-width exporters 607/606/608 (DB-backed B02 threshold, deterministic cap split, en-cero, U1 encoding gates); `/reportes/exportar-txt` route, fiscal panel and actions (Fiscal Admin-only, no audit rows) ([v0.11.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.0))
* **reportes:** slice D â€” per-product rentabilidad report (#51): current-cost margin math, REN-3 limitation surfaced, rentabilidad panel + CSV ([v0.10.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.10.0))
* **reportes:** slice C â€” CxC aging, CxP and comparativa financiera (#50): ADR-017-derived balances, aging buckets, Cobrador branch-pin, cash-flow window deltas ([v0.9.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.9.0))
* **reportes:** slice B â€” operational reports + CSV export + aggregation indexes (#49): product ranking, stock state, sales by period, inventory valuation, invoice state ([v0.8.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.8.0))

## [0.7.0](https://github.com/Wilfredery/SystemFact/compare/v0.6.1...v0.7.0) (2026-09-17)

### Features

* **reportes:** slice A â€” shared reportes infra + role-aware dashboard (#48): filter/pagination/role-gate contracts, Santo-Domingo calendar boundaries, RFC4180 CSV writer seam, company-wide read widen, dashboard KPIs, selector-first `/reportes` shell ([#48](https://github.com/Wilfredery/SystemFact/pull/48))

## [0.6.1](https://github.com/Wilfredery/SystemFact/compare/v0.6.0...v0.6.1) (2026-09-17)

### Documentation

* **sdd:** archive fase-7a-auditoria â€” spec sync + archive report (#47)

## [0.6.0](https://github.com/Wilfredery/SystemFact/compare/v0.5.0...v0.6.0) (2026-09-17)

### Features

* **auditoria:** fase 7a â€” audit consultation screen, cobros/auth write backfill, append-only audit port (#46): admin `/auditoria` screen, `AuditoriaWritePort`, LOGIN/LOGOUT/PAGAR audit events, tenant read indexes

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
