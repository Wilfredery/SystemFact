# Changelog

## [0.11.28](https://github.com/Wilfredery/SystemFact/compare/v0.11.27...v0.11.28) (2026-10-02)

### Code Refactoring

* **http:** split backend-pure Server Actions (auth, devolucion) into operation/shared files with barrel re-exports; behavior preserved. Fix Next.js build by making shared helpers async under Server Actions context. tsc --noEmit OK, production build OK.
## [0.11.27](https://github.com/Wilfredery/SystemFact/compare/v0.11.26...v0.11.27) (2026-10-01)

### Bug Fixes

* **auth:** close run-2 security audit finding `v2r-01` MEDIUM (ADR-014 binding hardening) -- the per-request identity no longer trusts the mutable synthetic email. `getCurrentTenantContext`, `getCurrentUser` and `resolverUsuarioDeSesion` previously decoded `nombreUsuario` back OUT of the JWT email and looked `USUARIO` up by it; because an Auth admin can change a user's email, whoever controls that attribute controlled which `USUARIO` row (and therefore which `empresa`) a request resolved to. Resolution is now keyed on the immutable Auth `sub`: bound lazily on first login by `enlazarAuthSub` (compare-and-set, idempotent, refuses both conflict directions without overwriting, translates the `P2002` violation to `AUTH_ENLACE_DUPLICADO`). `normalizarAuthSub` (pure, `auth/domain`) validates the claim is a canonical UUID before any query reaches Postgres, so a malformed claim returns `null` instead of surfacing as an opaque cast error. The synthetic email now survives only as the login-flow bootstrap, and even there it is not email-trusting: `buscarUsuarioPorNombreUsuario` receives `nombreUsuario` as an already-validated argument rather than decoding it from the session. Also removes `decodeNombreUsuario` -- the synthetic email is now built but never parsed -- and updates the module README to match the `sub`-keyed identity model. **Error taxonomy by inspection:** an absent row and a cross-tenant row are INDISTINGUISHABLE by construction (the `empresaId` filter plus RLS make both invisible), and that indistinguishability IS the defense, so both map to the single tenant-blind code `AUTH_ENLACE_NO_RESUELTO`; a row already held by a concurrent login under a different `sub` is NOT distinguishable from the different-`sub` case and stays `AUTH_ENLACE_CONFLICTO`. **`enlazarAuthSub` pins `app.current_empresa_id`** to the anchor's company before its UPDATE because the `usuario_modify` RLS policy does NOT honor `app.is_login_flow` (only `usuario_select` does), which is what makes the bind RLS-authorized for the pinned company alone. **Operational notes:** every session issued before this deploy is asked to log in exactly once (the binding is written at that login); this is not worked around with a silent email fallback, which is precisely the vulnerability being removed. A stale-session user who logs out BEFORE that re-login resolves no identity, so that single LOGOUT writes no audit row -- a transient, self-closing gap inside an already transient window, not a behavioural regression. Verified `tsc --noEmit` exit 0, lint 0 errors, `prisma validate` clean, 119/119 suites and 1154/1154 unit tests green (including the new `auth-sub`, `errors` and `auth-identity` suites, which assert the `REQ-AUTH-AUD-001` audit contract and the exact `app.current_empresa_id` GUC pin on the auth write path); CI applies the migration with `prisma migrate deploy` against real Postgres 16 before the integration suite.

## [0.11.26](https://github.com/Wilfredery/SystemFact/compare/v0.11.25...v0.11.26) (2026-10-01)

### Bug Fixes

* **db:** land the `USUARIO.authUserId` storage half of run-2 security audit finding `v2r-01` (ADR-014 binding hardening), schema only. Adds a nullable `USUARIO.authUserId UUID` column plus a hand-written `UNIQUE PARTIAL` index `usuario_auth_user_id_uk ... WHERE "authUserId" IS NOT NULL`; the Prisma DSL cannot express a partial index, and annotating `@unique` would misdescribe it as total. A second migration installs a `BEFORE UPDATE` trigger that raises when a row already carries an `authUserId` and the update tries to null it, so a bound identity can never be silently un-linked at the database level. The column is nullable and deliberately NOT backfilled: `sub` values live in Supabase Auth, not Postgres, so any offline backfill would have to fabricate UUIDs. **This PR carries no application code.** Nothing reads or writes `authUserId` yet, so the trigger is dormant and the column stays null for every existing row; the identity-resolution half that actually binds the session lands in the follow-up PR.

## [0.11.25](https://github.com/Wilfredery/SystemFact/compare/v0.11.24...v0.11.25) (2026-09-29)

### Documentation

* **schema:** document the `RETROACTIVO_FECHA_VENTA_DIAS` key in the `ConfiguracionEmpresa.clave` comment so the schema comment mirrors the full key catalog (`DESC_MAX`, `PLAZO_DEVOLUCION`, and the sale-date retroactivity horizon provisioned by migration `20260929120000_seed_retroactivo_fecha_venta_dias`); `prisma validate` clean

## [0.11.24](https://github.com/Wilfredery/SystemFact/compare/v0.11.23...v0.11.24) (2026-09-29)

### Bug Fixes

* **venta:** remove the manual `pnpm seed:venta` step as the only path for the sale-date band Ã¢â‚¬â€ new data migration `20260929120000_seed_retroactivo_fecha_venta_dias` provisions `RETROACTIVO_FECHA_VENTA_DIAS=7` (canonical window `2000-01-01Ã¢â‚¬Â¦2099-12-31`) for every existing empresa at `migrate deploy` time, so sales can no longer be blocked by a forgotten manual seed after deploy; idempotent by the frozen compound unique index `("empresaId","clave","vigenciaInicio")` via `ON CONFLICT DO NOTHING` (no-ops when the seed already ran, creates exactly the missing rows when it did not Ã¢â‚¬â€ verified `INSERT 0 0` / `INSERT 0 1` against real Postgres 16), values copied from the same constants `seed-venta-config.ts` uses (one source of truth); deliberately scoped to the new key only because `DESC_MAX`/`PLAZO_DEVOLUCION` keep the seed script's R-V17 demote + fail-fast repair that a plain INSERT cannot replicate safely; `SETUP-LOCAL.md` runbook and venta README updated; verified `tsc --noEmit` exit 0 and seed unit suite 7/7

## [0.11.23](https://github.com/Wilfredery/SystemFact/compare/v0.11.22...v0.11.23) (2026-09-29)

### Bug Fixes

* **reportes,dgii:** close run-2 security audit finding `v2r-07:reportes-export-unbounded` HIGH (Phase 6 remediation) Ã¢â‚¬â€ the DGII TXT fiscal exporters no longer allow unbounded or cross-month payloads: `generarTxt606`/`generarTxt607`/`generarTxt608` enforce a single calendar month in `America/Santo_Domingo` via the pure `periodoSdDeVentana`/`periodoAprobadoDeVentana` guard in `reportes/domain/dgii/ventana.ts`, so the `PERIODO=AAAAMM` header can never be filed under a period the guard did not approve (a 31-day window `2026-04-01..2026-05-01` could previously label April rows as `202605`); oversized exports fail fast with `REPORTE_DGII_VENTANA_EXCEDIDA` / `REPORTE_DGII_TAMANO_EXCEDIDO` (50 MiB UTF-8 byte cap `verificarTamanoExportacionDgii` shared by 606/607/608) before any query, with `ReportResult.details` carrying the concrete reason to export month by month; also aligned the 607 `tipo-ingreso` grammar with the official DGII instructivo (single digit 1Ã¢â‚¬â€œ6): `esCodigoTipoIngresoValido` pins `/^[1-6]$/`, `leerMapaTipoIngreso607EnTx` discards invalid configured values at the repository boundary, and the default stays `1`; verified 1104 unit tests green across 116 suites (including the new ventana/tipo-ingreso suites), `tsc --noEmit`, lint 0 errors, `prisma validate` clean, `lint:commits` clean; integration coverage runs in CI against real Postgres 16 (local run requires the out-of-band harness role password)

## [0.11.22](https://github.com/Wilfredery/SystemFact/compare/v0.11.21...v0.11.22) (2026-09-28)

### Bug Fixes

* **venta:** close run-2 security audit finding `v2r-11:fecha-venta-unbounded` MEDIUM (Phase 5 remediation) Ã¢â‚¬â€ the sale date is now bounded at the application boundary against the server clock: pure `validarFechaVenta` in `venta/domain/fecha-venta.ts` accepts only `[hoy_SD Ã¢Ë†â€™ horizonte, hoy_SD]` inclusive (America/Santo_Domingo calendar days via ICU `en-CA` compare) and always rejects the future, with the per-empresa horizon read from the DB (`RETROACTIVO_FECHA_VENTA_DIAS`, seeded default `7`, may be `0`, newest-`vigenciaInicio` tie-break); a missing config row fails loud (`RETROACTIVO_FECHA_VENTA_FALTANTE`) instead of silently widening the window; `crearVenta` and `actualizarVenta` both gate through `validarFechaVentaEnTx` (create before the client resolver, update after the existence read so a foreign id stays `VENTA_NO_ENCONTRADO`), and rejections surface stable codes `FECHA_VENTA_FUTURA` / `FECHA_VENTA_RETROACTIVA_EXCEDIDA` as typed errors without touching CF/NCF/audit/stock; integration `venta-retroactivo` replay proves the harness horizon `999` is confined to fixtures while production runs at `7` (sale exactly at max is accepted, one day beyond throws before any write); deploy-time integrity guard `pnpm config:verify` (`tools/scripts/verify-venta-config.ts`) audits every empresa for `DESC_MAX`, `PLAZO_DEVOLUCION` and `RETROACTIVO_FECHA_VENTA_DIAS` active and in force, exiting 1 with all missing pairs Ã¢â‚¬â€ it reads through `DIRECT_URL` (the app role outside a tenant transaction sees zero rows because `CONFIGURACION_EMPRESA` has RLS ENABLE+FORCE keyed on `app.current_empresa_id` default `'0'`) and runs in CI only inside the E2E seed step, never in the Jest integration job whose fixtures create empresas without business seeds; verified 1073 unit + 207 integration tests green (including the new fecha-venta, config-repository, venta-service suites), `tsc --noEmit`, lint 0 errors, `pnpm config:verify` exit 0 against the seeded DB, `git diff --check` clean

## [0.11.21](https://github.com/Wilfredery/SystemFact/compare/v0.11.20...v0.11.21) (2026-09-26)

### Bug Fixes

* **compra,reportes,dgii:** close run-2 security audit finding `dgii-606:compra-ncf-free-text-control-chars` HIGH (Phase 4 remediation) Ã¢â‚¬â€ the purchase NCF input is no longer free text: `validarNcf` in `compra/http/validations.ts` enforces the frozen grammar `/^B(?:01|11)\d{8}$/` (11 chars) plus a Decimal(12,2) unit-cost bound at the wire, `crearCompra`/`actualizarCompra` re-enforce the same grammar and the tenant scope (`empresaId`/`sucursalId`) below the transport, and the domain shares one single-source quantity/cost width rule; the DGII exporters stop emitting attacker-influenced bytes: `ensamblarDetalle607`/`ensamblarDetalle606` normalize via that grammar, compose zero-fill before sanitize (never fabricating plausible NCFs), validate the composed text instead of the raw DB text, and fail loud Ã¢â‚¬â€ `formatearMonto` rejects non-finite values and scale > 2, `validarPeriodoAAAAMM` rejects non-`AAAAMM` periods, `ensamblarEncabezado5` asserts the `codigoInformacion` is 606/607, and every width overflow throws `ReporteDomainError` with one of the stable codes (`REPORTE_DGII_ANCHO_EXCEDIDO`, `REPORTE_DGII_PERIODO_INVALIDO`, `REPORTE_DGII_MONTO_INVALIDO`, `REPORTE_DGII_CODIGO_INVALIDO`); `TIPOS_NCF` (runtime list with derived `TipoNcf` union) is pinned against the generated Prisma `TipoNcfSecuencia` enum by a parity test, and the compra tests were typed honestly with `jest.mocked`; verified 322 unit tests green (reportes + compra + ncf modules), `tsc --noEmit`, lint 0 errors

## [0.11.20](https://github.com/Wilfredery/SystemFact/compare/v0.11.19...v0.11.20) (2026-09-25)

### Bug Fixes

* **rls,env,ci:** close run-2 security audit finding `usuariorol_isolation.missing-is_login_flow-branch` MEDIUM (Phase 3 remediation) Ã¢â‚¬â€ new hand-written migration `20260925120000_fix_usuariorol_login_flow` recreates the `usuariorol_isolation` policy with the single added clause `OR COALESCE(NULLIF(current_setting('app.is_login_flow', true), ''), '') = 'true'` in USING (mirroring `usuario_select` at `20260902120000_enable_rls` line 108, per that migration's own header lines 18-20 which document the USUARIO + USUARIO_ROL `findUnique` auth pair): the policy created at lines 157-179 of the same migration never carried the exception, so the post-`signInWithPassword` lookup of the caller's own role rows could not read them before a tenant context exists; WITH CHECK is deliberately unchanged, so the exception grants login-flow READ only and never login-flow writes; `assertAppRoleUrl` in `src/lib/env.ts` replaces the `SUPERUSER_LIKE_ROLES` denylist with a `systemfact_app` ALLOWLIST that accepts only `systemfact_app` and the dotted transaction-pooler form `systemfact_app.<project-ref>`, because a denylist of superuser-looking names can never be exhaustive and in fact admitted `supabase_admin` plus every dotted pooler variant (`postgres.<project-ref>`, `supabase_admin.<project-ref>`), each of which silently disables every RLS policy; `isAppRoleUsername` and `assertAppRoleUrl` are exported for direct testing and covered by a new `src/lib/env.test.ts` (20 cases: plain, dotted and mixed-case app role accepted; `supabase_admin`, `postgres`, `postgresql`, `root`, `admin`, `dbo`, `sa` and their dotted pooler forms rejected Ã¢â‚¬â€ all of which the old denylist let through, verified red against it); the `integration` CI job now runs `pnpm rls:verify` between database provisioning and the RLS-enforced Jest suite, so the role-level guarantees that were only ever checked by hand (not `postgres`/`supabase_admin`, no BYPASSRLS, not the table owner) now gate every PR; verified 989 unit tests green (969 baseline + 20 new), `tsc --noEmit`, lint (0 errors) and `prisma validate` clean

## [0.11.19](https://github.com/Wilfredery/SystemFact/compare/v0.11.18...v0.11.19) (2026-09-25)

### Bug Fixes

* **cobros,venta,devolucion:** close run-2 security audit findings v2r-02 MEDIUM, v2r-09 MEDIUM, v2r-04 MEDIUM (Phase 2 remediation) Ã¢â‚¬â€ `registrarReembolso` now derives `cobrado = total Ã¢Ë†â€™ saldoPendiente` from the same `FOR UPDATE` locked facts used for the null-check and rejects `monto > cobrado` with the new stable code `REEMBOLSO_EXCEDE_SALDO` before writing the PAGO row (previously an unbounded REEMBOLSO/APLICADO could be committed verbatim against any VIGENTE invoice, even one with zero payments); `cancelarVentaConfirmada` now reverts every live `APLICADO` payment of the invoice to `REVERTIDO` inside the same transaction, BEFORE the ANULADA flip, with one append-only audit row per reverted payment (previously a paid CONTADO sale's single COBRO/APLICADO was orphaned: both refund sinks require FACTURA VIGENTE and the canonical CxC balance filters VIGENTE, so recorded cash vanished from every derived view); venta line input now rejects repeated `productoId` via a shared `zLineasUnicas` zod refine on both create/update schemas plus a defense-in-depth mirror gate in `prepararLineasVenta` (`LINEA_INVALIDA`), `DetalleVenta` gained `@@unique([ventaId,productoId])` (hand-written migration `20260925_detalle_venta_unique_venta_producto`, own commit, verified zero duplicates in dev+test DBs before applying) and `resolverLineasContraVentaOriginal` now groups ORIGINAL rows per productoId, SUMS quantities and throws `LINEA_INVALIDA` when `precioUnitario`/`tasaItbis` differ across rows of the same product (previously a duplicate-producto sale collapsed via `new Map` last-write-wins: first row's units became unreturnable and frozen NC money came from the wrong row); regression coverage via offline 2-case devolucion harness (2.000 and 6.000 of 7 sold units now pass, 8.000 still caps), boundary tests on both venta schemas, cancel-paid-sale integration (PAGO estado=REVERTIDO, derived balance pre-sale, stock restored), refund-bound integration (seed partial cobro then assert REEMBOLSO_EXCEDE_SALDO) and updated auditoria-cobros fixture; verified 969 unit + 199 integration tests green (sole integration failure is the pre-existing v2r-10 harness parking flake, reproduced at true baseline), `tsc --noEmit`, lint, `prisma validate` and production build clean

## [0.11.18](https://github.com/Wilfredery/SystemFact/compare/v0.11.17...v0.11.18) (2026-09-24)

### Bug Fixes

* **compra,venta:** close confirm TOCTOU races against concurrent draft edits (run-2 security audit v2r-03 HIGH, v2r-10 MEDIUM) Ã¢â‚¬â€ `confirmarCompra` now locks the `COMPRA` row (`SELECT ... FOR UPDATE`, `estado='BORRADOR'`) before re-deriving totals from a converged re-read under the held lock, so a draft edited mid-confirm can no longer persist stale header totals over its final lines (the 354.00 divergence repro); `confirmarVenta` now pins the guard `updatedAt` snapshot in `confirmarVentaFlipEnTx` (`WHERE ... estado='BORRADOR' AND updatedAt=<read value>`, mirroring `actualizarVentaBorradorEnTx`), so a draft edited between read and flip fails the flip (zero rows) and the transaction throws Ã¢â‚¬â€ un-burning its NCF consume Ã¢â‚¬â€ instead of emitting an invoice with stale totals; regression coverage via real-DB integration suites (`compra-concurrency.integration.test.ts`, `confirmar-venta.integration.test.ts`: 2-connection interleavings, pg_locks assertions, persisted-header==final-lines convergence check, NCF-unburn check 521 no-consumption) and updated unit tests; verified 951 unit + 197 integration tests green, `tsc --noEmit`, lint, `prisma validate` and production build clean

# [0.11.17](https://github.com/Wilfredery/SystemFact/compare/v0.11.16...v0.11.17) (2026-09-19)

### Documentation

* **sdd:** archive backend-quality-polish Ã¢â‚¬â€ canonical backend-code-quality spec + final gate report (8-PR chain, 63Ã¢â€ â€™28 issues, 0 BLOCKER/CRITICAL, dup 1.0%) (#71 pending)
## [0.11.16](https://github.com/Wilfredery/SystemFact/compare/v0.11.15...v0.11.16) (2026-09-19)

### Refactored

* **inventario,reportes:** backend quality-polish batch + dedup (SDD `backend-quality-polish` stage 5b, R-QC-02/R-QC-05) - `inventario-repository.ts`: extract the shared async `guardarPertenenciaProductosEnTx` Phase-A ownership read used by the ajustar/entrada-compra/salidas/reposicion/devolucion batches (each batch skeleton and lock/write ordering stays separate; entrances vs exits never merged) and unify the three per-path audit emitters into one `registrarAuditoriaStockEnTx` parameterized by `AccionAuditoria` (AJUSTAR/CREAR/ACTUALIZAR), removing the duplicated guard + audit blocks with zero behaviour change; `reportes/infrastructure/cxp-repository.ts` + `operacional-repository.ts`: replace the repeated raw SQL segments with business-intent named `Prisma.Sql` fragments (`joinPagosAplicadosEnTx`, `whereVentaConfirmadaEnTx`, `whereInventarioPorEmpresaSucursal`, shared `limitePaginaSql`) preserving bind order and byte-identical screen/CSV predicate parity (EXP-2); `reportes/domain/dgii/formato.ts`: `rellenarAlnum` nullish-guard ternary to `??` (S6606); no undefined-vs-null patch semantics touched; verified 945 unit + 195 integration tests green (all affected DB-backed suites unmodified), `tsc --noEmit` and lint clean

## [0.11.15](https://github.com/Wilfredery/SystemFact/compare/v0.11.14...v0.11.15) (2026-09-18)

### Refactored

* **ui:** mechanical quality-polish batch (SDD `backend-quality-polish` stage 5a) - `readonly` prop typing across the 11 venta/devolucion/login-layout component prop objects (S6759, type-only), `formatearMonto` thousands-grouping regex in `venta/ui/carro.ts` replaced with a pinned `en-US` `Intl.NumberFormat` plus a colocated `formatearMonto.test.ts` behavioural lock (S8786, presentation-only; the provably-redundant `dec === "00"` branch dropped), two nested ternaries flattened to an exhaustive `tono` badge lookup (`cobros/ui/CxcBoardScreen.tsx`) and a save-caption if/else (`venta/ui/PosScreen.tsx`) (S3358), and `venta/ui/DiscountPanel.tsx` label text wrapped in `<span>` to match the codebase's own label convention (S6772); no behaviour change - 945 unit tests green (937 baseline + 8 lock tests), `tsc --noEmit` and lint clean

## [0.11.14](https://github.com/Wilfredery/SystemFact/compare/v0.11.13...v0.11.14) (2026-09-18)

### Chores

* **deps:** override vulnerable prisma transitive bundles (SDD `backend-quality-polish` stage 4, R-QC-03) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `lodash` 4.17.21ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢4.18.1, `deepmerge-ts` 7.1.5ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢8.0.2 and `mysql2` 3.15.3ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢3.24.4 arrive only inside the `prisma@7.10.0` bundle and are pinned by prisma's own ranges, so they are forced to their GHSA-patched floors via `app/pnpm-workspace.yaml` `overrides` (pnpm 11+ ignores `package.json#pnpm.overrides`); Prisma is already at the newest compatible 7.x (8.x is RC-only) so no version bump applies; the open `mysql2 >=3.22.0` floor resolves to 3.24.4, which also clears the 3.23.1 decompression-bomb advisory; verified `prisma validate`/`generate` pass, `pnpm audit --prod` = 0, 937 unit + 195 integration tests green, tsc/lint clean

## [0.11.13](https://github.com/Wilfredery/SystemFact/compare/v0.11.12...v0.11.13) (2026-09-18)

### Tests

* **quality-polish:** wire honest real-database integration coverage into the Sonar lab (SDD `backend-quality-polish` slice 3) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â add a `pnpm coverage:integration` script (`test:integration` + `--coverage --coverageReporters=lcov --coverageDirectory=coverage-integration`) and scope `jest.integration.config.js` `collectCoverageFrom` to backend `src/**` sources only (excluding the generated Prisma client, the integration/test-support harnesses and the Next.js `src/app/**` pages, which the `node`-env integration run cannot instrument), so the emitted `coverage-integration/lcov.info` merges with the unit lcov via a comma-separated `sonar.javascript.lcov.reportPaths` (documented in `app/README.md`); test-DB `DATABASE_URL` still comes from the git-ignored `app/.env.integration` (no secrets committed) and no application-code smell is touched (verified: 937 unit + 195 integration tests, `tsc --noEmit` and lint green)

## [0.11.12](https://github.com/Wilfredery/SystemFact/compare/v0.11.11...v0.11.12) (2026-09-18)

### Refactored

* **tenant:** relocate the `withTenantTransaction` GUC/RLS integration probe out of the Jest/Sonar source tree to `app/scripts/withTenantTransaction.probe.ts` (SDD `backend-quality-polish` slice 2) so the tsx-only probe is no longer flagged as a source-less test (S2187); imports rewritten to `@/modules/...`, `pnpm probe:tenant` script added, the now-redundant per-file Jest exclusion dropped (`scripts/` stays excluded), and the sibling `-options.test` header updated to the new path ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â no `.itest.ts` rename; GUC behavior coverage is unchanged (the mocked timeout/`set_config`-failure cases and the live-probe assertions both stay)

## [0.11.11](https://github.com/Wilfredery/SystemFact/compare/v0.11.10...v0.11.11) (2026-09-18)

### Refactored

* **quality-polish:** pass-2 complexity split of 5 updater/normalizer functions so every one clears the Sonar S3776 ÃƒÂ¢Ã¢â‚¬Â°Ã‚Â¤15 cognitive-complexity ceiling ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â `actualizarProducto` 25ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢10 (pure `validarInvariantsFiscales` + async `sondarIntegridadReferencial`), `actualizarProveedor` 23ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢13 (pure `prepararPatchProveedor`/`resolverRncFinalSeguro` + async `sondaRncDuplicado` + `calcularDifAuditoria`, row guards inline to avoid non-null assertions), `actualizarCliente` 21ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢12 (pure `prepararValidacionCliente` + async `sondaFiscalDuplicada` + `calcularDifAuditoria`), `resolverRangoSD` 18ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢8 (`resolverPresetFechas` + `validarRangoPersonalizado` + `normalizarFechaCruda`, error precedence unchanged) and `confirmarVenta` 16ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢15 (PRE-consume pure `resolverRechazoCredito`; the consumeÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢flipÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢invoiceÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢salidas/cobro R-V15 chain stays inline and ordered) (SDD `backend-quality-polish` slice 1f ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â behavior-preserving: the 937-test unit suite and the confirmar/cliente/reportes integration suites pass with zero golden or characterization churn)

## [0.11.10](https://github.com/Wilfredery/SystemFact/compare/v0.11.9...v0.11.10) (2026-09-18)

### Refactored

* **venta,devolucion:** extract pure pre-consume helpers `verificarDisponibilidadPreNcf` (R-V15 hard stock-preview predicate) and `resolverLineasContraVentaOriginal` (R-D5 original-line freeze) with colocated unit tests; close both S3735 `void` findings (drop the unused NCF `secuencial` capture in `confirmarVenta`; explicit if-and-return guard replaces the unreachable `void gate` dismissal in `cancelarVentaConfirmada`) and fix S6582 on the factura guard via optional chaining (SDD `backend-quality-polish` slice 1e ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â behavior-preserving; the consumeÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢flipÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢invoiceÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢salidas/cobro ordering stays inline and ordered, the confirmar/devolucion and cancelar-confirmada integration suites pass unmodified)

## [0.11.9](https://github.com/Wilfredery/SystemFact/compare/v0.11.8...v0.11.9) (2026-09-18)

### Refactored

* **reportes:** dispatch-only `REPORTE_ID ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â {consultar, Panel}` registry + single dispatch in the `/reportes` page, replacing the 10 per-report action+Panel conditionals (SDD `backend-quality-polish` slice 1d ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â S3776 cognitive-complexity, behavior-preserving; authorization stays in the server actions, DB-2 integration suites untouched)

## [0.11.8](https://github.com/Wilfredery/SystemFact/compare/v0.11.7...v0.11.8) (2026-09-18)

### Refactored

* **reportes,auditoria:** extract pure `resolverRangoSD(entrada, now)` (SD-range resolve/preset/validate/UTC-convert) and pure `normalizarAccion`/`normalizarTexto` trim helpers out of the two `normalizarFiltro` functions (SDD `backend-quality-polish` slice 1c ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â S3776 cognitive-complexity, behavior-preserving; existing filter suites stay green, no test churn) (#62 pending)

## [0.11.7](https://github.com/Wilfredery/SystemFact/compare/v0.11.6...v0.11.7) (2026-09-18)

### Refactored

* **venta,proveedor:** decompose `prepararLineasVenta` into pure `validarPrecondicionesLineas`/`construirLineasPersistibles`/`colectarWarningsStock` + async `validarDescuentosAutorizadosYTopes`, and extract pure `construirPatchProveedor`/`resolverRncFinal` (SDD `backend-quality-polish` slice 1b ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â S3776 cognitive-complexity, behavior-preserving; colocated discount-branch unit tests added)

## [0.11.6](https://github.com/Wilfredery/SystemFact/compare/v0.11.5...v0.11.6) (2026-09-18)

### Chores

* **agents:** codify release conventions ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â every PR carries its own version bump, semver `refactor:`/`test:` ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ PATCH, UTF-8 BOM rule for machine-consumed files (#59 CI root cause)

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

* **sdd:** archive fase-7b-reportes ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â 6 canonical specs synced + chain close report (#54) ([v0.11.2](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.2))

## [0.11.1](https://github.com/Wilfredery/SystemFact/compare/v0.11.0...v0.11.1) (2026-09-17)

### Chores

* release 0.11.0 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â package.json bump 0.5.0 ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ 0.11.0, manifest and CHANGELOG backfill (#53) ([v0.11.1](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.1))

## [0.11.0](https://github.com/Wilfredery/SystemFact/compare/v0.10.0...v0.11.0) (2026-09-17)

### Features

* **reportes:** slice E ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â IT-1 fiscal summary + DGII 606/607/608 TXT exports (#52): signed per-period ITBIS summary + IT-1 casilla self-check; DGII fixed-width exporters 607/606/608 (DB-backed B02 threshold, deterministic cap split, en-cero, U1 encoding gates); `/reportes/exportar-txt` route, fiscal panel and actions (Fiscal Admin-only, no audit rows) ([v0.11.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.0))
* **reportes:** slice D ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â per-product rentabilidad report (#51): current-cost margin math, REN-3 limitation surfaced, rentabilidad panel + CSV ([v0.10.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.10.0))
* **reportes:** slice C ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â CxC aging, CxP and comparativa financiera (#50): ADR-017-derived balances, aging buckets, Cobrador branch-pin, cash-flow window deltas ([v0.9.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.9.0))
* **reportes:** slice B ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â operational reports + CSV export + aggregation indexes (#49): product ranking, stock state, sales by period, inventory valuation, invoice state ([v0.8.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.8.0))

## [0.7.0](https://github.com/Wilfredery/SystemFact/compare/v0.6.1...v0.7.0) (2026-09-17)

### Features

* **reportes:** slice A ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â shared reportes infra + role-aware dashboard (#48): filter/pagination/role-gate contracts, Santo-Domingo calendar boundaries, RFC4180 CSV writer seam, company-wide read widen, dashboard KPIs, selector-first `/reportes` shell ([#48](https://github.com/Wilfredery/SystemFact/pull/48))

## [0.6.1](https://github.com/Wilfredery/SystemFact/compare/v0.6.0...v0.6.1) (2026-09-17)

### Documentation

* **sdd:** archive fase-7a-auditoria ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â spec sync + archive report (#47)

## [0.6.0](https://github.com/Wilfredery/SystemFact/compare/v0.5.0...v0.6.0) (2026-09-17)

### Features

* **auditoria:** fase 7a ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â audit consultation screen, cobros/auth write backfill, append-only audit port (#46): admin `/auditoria` screen, `AuditoriaWritePort`, LOGIN/LOGOUT/PAGAR audit events, tenant read indexes

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
