# Tasks: backend-quality-polish â€” Backend Quality Polish (Stages 1aâ€“5b)

## Review Workload Forecast

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
```

| Slice | Est. lines | Under 400 gate |
|---|---|---|
| 1a producto+cliente | ~280 | Yes (splittable ~150/150 if inflated) |
| 1b proveedor+preparar-lineas | ~200 | Yes |
| 1c normalizers | ~140 | Yes |
| 1d reportes page registry | ~90 | Yes |
| 1e confirmar+devolucion + S3735 | ~150 | Yes |
| 2 probe relocation | ~40 | Yes |
| 3 sonar lcov wiring | ~60 | Yes |
| 4 deps + overrides | ~30 | Yes |
| 5a frontend mechanicals | ~200 | Yes |
| 5b backend batch + dedup | ~180 | Yes |

All slices pre-cleared under 400 â†’ one PR per slice; ask-on-risk NOT triggered. Sonar re-scan each stage end: `docker run --rm -e SONAR_HOST_URL=http://sonar-lab:9000 -v "C:\SystemFact\app:/usr/src" sonarsource/sonar-scanner-cli` (project key per lab; verify via API `localhost:9000/api/issues/search?severities=BLOCKER,CRITICAL` + `api/measures/component` dup<3%). Each slice: `pnpm test` (911+), `pnpm test:integration` (195+ vs sf-postgres), `pnpm exec tsc --noEmit`, `pnpm lint`, then semantic commit.

## Phase 1a â€” S3776 producto + cliente (PR 1a)

- [x] 1a.1 RED (collection â€” verify first): `app/src/modules/producto/application/actualizar-producto.test.ts` lacks undefined-vs-null golden cases â€” ADD: `{descripcion: undefined}` omits patch+audit diff; `{descripcion: null}` writes NULL and audits old/new. Keep existing PROD-011 assertions green. Verify: `pnpm jest actualizar-producto`.
- [x] 1a.2 RED (collection â€” verify first): `app/src/modules/cliente/application/actualizar-cliente.test.ts` has CLI-EDIT explicit-null case (line 211) but no undefined-skip case â€” ADD `{identificacionFiscal: undefined}` (and one field null) leaves field unchanged, no audit emission. Verify: `pnpm jest actualizar-cliente`.
- [x] 1a.3 Extract pure `construirPatchYDif(actual, input, fieldDescriptors): {data; antiguos; nuevos}` in `app/src/modules/producto/application/actualizar-producto.ts` (also resolves S6582@109); descriptors `{key, leerActual, leerInput, iguales, formatearAuditoria}`; iterate only `!== undefined`, assign data even if equal, audit only if unequal; null NOT coalesced. Verify: `pnpm jest actualizar-producto && pnpm exec tsc --noEmit`.
- [x] 1a.4 Apply same pattern in `actualizar-cliente.ts`: `construirPatchCliente(input): ClientePatch` + `calcularEstadoEfectivo(actual, patch): EstadoClienteEfectivo` called once. Verify: `pnpm jest actualizar-cliente`.
- [x] 1a.5 Verify slice: `pnpm lint && pnpm exec tsc --noEmit && pnpm test` green; Sonar 1a re-scan; commit `refactor(producto,cliente): table-driven patch + audit-diff extraction`.

## Phase 1b â€” S3776 proveedor + preparar-lineas (PR 1b)

- [x] 1b.1 `app/src/modules/proveedor/application/actualizar-proveedor.ts`: extract pure `construirPatchProveedor(input)` + `resolverRncFinal(input, actual): string|null`; duplicate probes stay async in the use case. Existing `PRV-RNC-C` null-clearing test stays green. Verify: `pnpm jest actualizar-proveedor`.
- [x] 1b.2 `app/src/modules/venta/application/preparar-lineas-venta.ts:117`: extract pure `validarPrecondicionesLineas(lineas, productos, fecha)`, async `validarDescuentosAutorizadosYTopes(tx,ctx,...)` returning Typed `ok/error` from existing catalogs, pure `construirLineasPersistibles(...)`, pure `colectarWarningsStock(lineas, stocks)`; add colocated discount-branch unit test. Verify: `pnpm jest venta-service preparar-lineas`.
- [x] 1b.3 Verify slice 1b: unit+integration green, tsc/lint, Sonar 1b re-scan; commit `refactor(venta,proveedor): decompose preparar-lineas + proveedor patch`.

## Phase 1c â€” S3776 normalizers (PR 1c)

- [x] 1c.1 `app/src/modules/reportes/application/reporte-filtro.ts:177`: extract pure `resolverRangoSD(entrada, now): {desde?; hasta?}`. Verify: `pnpm jest reporte-filtro`.
- [x] 1c.2 `app/src/modules/auditoria/application/auditoria.ts:156`: extract pure `normalizarAccion(value): AccionAuditoria|undefined` + trim helpers. Verify: `pnpm jest auditoria`.
- [x] 1c.3 Verify slice 1c + Sonar 1c re-scan; commit `refactor(reportes,auditoria): pure filter/accion normalizers`.

## Phase 1d â€” S3776 reportes page registry (PR 1d)

- [x] 1d.1 `app/src/app/reportes/page.tsx` `PanelReporte:98` (note: no `(app)` prefix in repo): replace the 10 action+Panel conditionals with `Record<REPORTE_ID, {consultar, Panel}>` + single dispatch; DASHBOARD, DGII-card and fallback branches stay special cases. Verify: `pnpm exec tsc --noEmit && pnpm test`.
- [x] 1d.2 PRESERVATION: authorization stays in server actions (DB-2); the reportes/exportar route + action DB-2 authorization integration tests are NOT modified. Verify: `pnpm test:integration --testPathPattern reportes` green unchanged.
- [x] 1d.3 Verify slice 1d + Sonar 1d re-scan; commit `refactor(reportes): REPORTE_ID registry dispatch on page`.

## Phase 1e â€” S3776 confirmar + devolucion, S3735 (PR 1e)

- [x] 1e.1 `app/src/modules/venta/application/confirmar-venta.ts:163` (+S6582@167): extract ONLY pre-consume pure `verificarDisponibilidadPreNcf(demanda, stocks): StockWarning[]`; consumeâ†’flipâ†’invoiceâ†’salidas/cobro ordering and rollback untouched (R-V15). Verify: `pnpm test:integration --testPathPattern confirmar` (4 suites).
- [x] 1e.2 `app/src/modules/devolucion/application/crear-devolucion.ts:156` (+S6582): extract `resolverLineasContraVentaOriginal(inputLineas, ventaLineas)`; resolve S3735 voids. Verify: 3 devolucion integration suites.
- [x] 1e.3 Verify slice 1e (R-V15 suites pass UNMODIFIED except expectations if asserted counts/format changed) + Sonar 1e re-scan; commit `refactor(venta,devolucion): pre-consume extraction, void closes`.

## Phase 1f â€” S3776 pass-2: clear the â‰¤15 ceiling on 5 functions (PR 1f)

Experimentally derived follow-up outside the original phase plan: after slices 1aâ€“1e, the stage-close Sonar analysis (5b559bea, memory #850) still reported 5 functions above the S3776 â‰¤15 gate. This slice applies the same behavior-preserving pure-extraction pattern a second time (pass-2), verified locally with a throwaway `eslint-plugin-sonarjs` cognitive-complexity harness. Zero behavior change; no golden/characterization test was modified.

- [x] 1f.1 `reportes/domain/reporte-filtro.ts` `resolverRangoSD` (18â†’8): split preset resolution (`resolverPresetFechas`) from custom-window shape/inversion validation (`validarRangoPersonalizado`), plus `normalizarFechaCruda`; parseâ†’presetâ†’range error precedence unchanged. Verify: `pnpm jest reporte-filtro` (17).
- [x] 1f.2 `producto/application/actualizar-producto.ts` `actualizarProducto` (25â†’10): extract pure `validarInvariantsFiscales` (tasa/precio/vigencia try/catch, rethrow rule intact) + async `sondarIntegridadReferencial` (codigo+categoria probes, codigoâ†’categoria order); `construirPatchYDif` loop and null-vs-undefined goldens untouched. Verify: `pnpm jest actualizar-producto` (15).
- [x] 1f.3 `cliente/application/actualizar-cliente.ts` `actualizarCliente` (21â†’12): extract pure `prepararValidacionCliente` (patch+estado+credit rules, single try/catch incl. DecimalError mapping), async `sondaFiscalDuplicada`, pure `calcularDifAuditoria`; `construirPatchCliente` (already 14) NOT modified. Verify: `pnpm jest actualizar-cliente` (15).
- [x] 1f.4 `proveedor/application/actualizar-proveedor.ts` `actualizarProveedor` (23â†’13): extract pure `prepararPatchProveedor` + `resolverRncFinalSeguro`, async `sondaRncDuplicado`, pure `calcularDifAuditoria`; row guards kept inline for TS narrowing (no `!` assertion); patch-before-read ordering and null-clear semantics preserved. Verify: `pnpm jest actualizar-proveedor` (9).
- [x] 1f.5 `venta/application/confirmar-venta.ts` `confirmarVenta` (16â†’15): extract pure PRE-consume `resolverRechazoCredito` (credit gate; the `forma === "CREDITO" && !permitido` branch); consumeâ†’flipâ†’invoiceâ†’salidas/cobro and throw-after-consume R-V15 chain untouched. 15 is the pre-consume-only floor (remaining guards are single-`if`s over interleaved async reads); S3776 flags >15 so 15 clears the gate. Verify: `pnpm jest confirmar-venta` unit (6) + `pnpm test:integration --testPathPattern "confirmar|cliente"` and `"reportes"` UNMODIFIED.
- [x] 1f.6 Verify slice 1f: `pnpm test` 937/0 (no golden churn), affected integration green unmodified, `tsc --noEmit` + `pnpm lint` EXIT 0; local sonarjs harness: MAX per file â‰¤15; commit `refactor(quality-polish): pass-2 splits to clear S3776 ceiling (5 functions â‰¤15)`.

## Phase 2 â€” S2187 BLOCKER probe relocation (PR 2)

- [x] 2.1 Move `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts` â†’ `app/scripts/withTenantTransaction.probe.ts`; imports â†’ `@/modules/...`; update sibling `withTenantTransaction-options.test.ts` comment (NO `.itest.ts` rename). Verify: `pnpm jest --listTests | findstr withTenantTransaction.unit` empty; `pnpm test` still 911+ suites (the moved file is no longer collected).
- [x] 2.2 Add `probe:tenant` script in `app/package.json` (tsx, caller-provided DB env, non-zero on failure); remove its `jest.config.js` exclusion; retain `/scripts/` exclusion; RED smoke/exit + CI-command test per threat matrix. Verify: `pnpm probe:tenant` fails cleanly with bad env, succeeds with sf-postgres.
- [x] 2.3 Verify Sonar 2 re-scan: S2187 absent from sources; commit `refactor(tenant): relocate WTT probe outside sonar sources`.

## Phase 3 â€” Honest integration coverage (PR 3)

- [x] 3.1 Wire `test:integration` with `--coverage` and merge unit+integration LCOV via multiple `sonar.javascript.lcov.reportPaths` entries in the lab scan config; pass `DATABASE_URL`/test-DB env without committing secrets. Verify: merged lcov exists with ~100% on integration-covered files after scan.
- [x] 3.2 Verify Sonar 3 re-scan shows integration-only coverage; commit `chore(ci): merge unit+integration lcov for sonar`. (Wiring committed as `test(quality-polish): wire integration coverage for sonar scan` per orchestrator git policy; lcov verified locally: 195 integration tests â†’ `coverage-integration/lcov.info`, backend `src/**` only, no `src/app`/generated/test leakage; Sonar lab re-scan runs at orchestrator â€” docker scanner skipped by instruction.)

## Phase 4 â€” Dependencies (PR 4)

- [x] 4.1 `app/package.json`: bump `prisma`, `@prisma/client`, `@prisma/adapter-pg` â†’ newest compatible 7.x (record resolved version); add `pnpm.overrides` `lodash >=4.18.1`, `deepmerge-ts >=8.0.0`, `mysql2 >=3.22.0`; lockfile update. Verify: `pnpm exec prisma validate && pnpm exec prisma generate && pnpm test && pnpm test:integration && pnpm audit --prod` (zero mapped advisories). Rollback: remove overrides, repin 7.10.x.
- [x] 4.2 Verify Sonar 4 re-scan; commit `fix(deps): prisma 7.x bump + transitive advisory overrides`.

## Phase 5a â€” Frontend mechanicals (PR 5a)

- [x] 5a.1 S6759 readonly props across 11 `src/**/ui/*.tsx` files; S6772Ã—3 label spans; S3358Ã—4 â€” mechanical only. Verify: `pnpm exec tsc --noEmit && pnpm test`. (Done on branch `refac/quality-polish-5a`: 11 component prop objects â†’ `readonly`; 2 nested ternaries actually present in master flattened â€” `CxcBoardScreen` `badge` map, `PosScreen` save-caption if/else â€” the "Ã—4" was stale vs current master, only 2 remain; `DiscountPanel` two bare-text labels wrapped in `<span>` to match the repo's own label convention, other ambiguous spacers already use `{" "}`. 945 unit green, tsc 0, lint 0 errors.)
- [x] 5a.2 `carro.ts` S8786 â†’ `Intl.NumberFormat` helper + new lock `.00` formatting unit test. Verify: `pnpm jest carro`. (Done: `formatearMonto` thousands-grouping regex replaced with pinned `en-US` `Intl.NumberFormat`, guard kept, provably-redundant `dec === "00"` branch dropped; colocated `formatearMonto.test.ts` locks 8 behavioural cases incl. `"1234.5"â†’"1,234.50"`, `"0.00"â†’"0.00"`, untrimmed passthrough. Green before+after swap.)
- [x] 5a.3 Verify Sonar 5a re-scan; commit `style(ui): readonly props, Intl monto format, mechanical minors`.

## Phase 5b â€” Backend batch + dedup (PR 5b)

- [x] 5b.1 S4624Ã—4: named SQL-fragment helpers in `app/src/modules/cxp`/`operacional` repositories; S6606Ã—4 + residual S6582. Verify: `pnpm test` + cxp/operacional integration. (Done on `refac/quality-polish-5b`: the "cxp/operacional" repos are `reportes/infrastructure/cxp-repository.ts` + `operacional-repository.ts`; extracted the repeated raw SQL segments into named `Prisma.Sql` fragments by business intent â€” `joinPagosAplicadosEnTx` (PAGO_PROVEEDOR sub-join, 3Ã—), `whereVentaConfirmadaEnTx` (VENTA confirmed+window WHERE, 5Ã—), `whereInventarioPorEmpresaSucursal` (INVENTARIO/sucursal WHERE, 2Ã—) and a shared `limitePaginaSql` (LIMIT/OFFSET tail, used by both files) â€” preserving bind order and the byte-identical screen/CSV predicate (EXP-2). Both repos were ALREADY nullish-coalesced/optional-chained (`fila?.total ?? 0`, `?? null`), so NO S6606/S6582 sites remain inside cxp/operacional themselves; the single genuinely-legit residual S6606 in the reportes module was `reportes/domain/dgii/formato.ts:49` `valor === null || valor === undefined ? "" : valor` â†’ `valor ?? ""` (type is `string|null|undefined`, provably identical). Residual S6606/S6582 `&&`/ternary sites that live OUTSIDE the 5b repo scope (`venta-service.ts` motivo coalesce, `venta`/`devolucion` http `warnings && warnings.length>0`) were left untouched â€” they touch money/adapter semantics and the fixed commit scope; they are reported for the stage-close Sonar scan. Verified: 945 unit + full 195 integration green.)
- [x] 5b.2 `app/src/modules/inventario/infrastructure/inventario-repository.ts`: `guardarPertenenciaProductosEnTx` + one `AccionAuditoria`-parameterized audit helper; batch skeletons stay SEPARATE (R-QC-05). Verify: `pnpm test:integration --testPathPattern inventario` + duplication <3% via Sonar. (Done: extracted the shared async Phase-A `guardarPertenenciaProductosEnTx` (read-only ownership guard reusing `productoExisteEnEmpresa`) called by all five batches â€” ajustar(single-element list, throw context byte-identical), entrada-compra, salidas-venta, reposiciÃ³n-cancelaciÃ³n, devoluciÃ³n â€” each batch KEEPS its own skeleton/lock ordering, entrances vs exits NOT merged (R-QC-05); unified `registrarAjusteEnAuditoria`/`registrarEntradaEnAuditoria`/`registrarMovimientoEnAuditoria` into ONE `registrarAuditoriaStockEnTx(..., accion: AccionAuditoria)` (AJUSTAR/CREAR/ACTUALIZAR â€” bodies were identical except the enum). inventario-repository net âˆ’41 lines. `pnpm test:integration` inventario/ajustar/entrada/salida suites + full 195 integration pass UNMODIFIED.)
- [x] 5b.3 Verify Sonar 5b re-scan (duplication <3%, 0 CRITICAL/BLOCKER); commit `refactor(inventario,cxp,operacional): sql fragments + guard/audit dedup`. (Commit made as `refactor(inventario,reportes): ownership guard dedup + accion-auditoria audit helper + named SQL fragments` (stage-4 style, exact orchestrator subject) + `chore(release): version bump 0.11.16`; local gates: 945 unit / 195 integration green, `tsc --noEmit` EXIT 0, `pnpm lint` 0 errors, `pnpm lint:commits` OK. Sonar lab re-scan (duplication <3%, S4624/S6606/S6582 counts, 0 CRITICAL/BLOCKER) is DEFERRED to the orchestrator stage-close scan â€” the local sonar-scanner container is skipped by instruction, so the <3% duplication density is NOT verifiable in this slice and must be confirmed by the stage-close Sonar run; the dedup removes ~69 duplicated inventario lines and 5Ã—2Ã—3 duplicated SQL segments in the reportes repos.)

## Phase 6 â€” Final: SDD verify + Sonar gate + merge dynamics

- [ ] 6.1 Full walk: all 911+ unit + 195+ integration green; `pnpm lint` (tenant rule clean); `pnpm exec prisma validate`; `pnpm audit --prod` zero.
- [ ] 6.2 Final Sonar re-scan on lab; API check: 0 BLOCKER, 0 CRITICAL, all S3776 <15, duplication <3%, ratings A; record S1874/actions-adapter accepted exclusions (R-QC-06).
- [ ] 6.3 PR merge order 1aâ†’1e, 2, 3, 4, 5a, 5b: user squash-merges each PR when CI is green; agent runs sdd-verify (spec coverage walk R-QC-01..06) between slices when requested; final tag/release per manual protocol.
