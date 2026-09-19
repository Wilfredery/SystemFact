# Design: Backend Quality Polish

## Technical Approach

Apply behavior-preserving, module-local pure extraction to the nine S3776 functions, then isolate the Sonar probe, make integration coverage honest, update Prisma transitive dependencies, and finish mechanical/duplication cleanup. Existing transaction, authorization, fiscal, and tenant seams remain unchanged (R-QC-01..06).

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Patch refactors | Module-local pure builders in `domain/` or application-local pure helpers | Shared cross-module utility | Preserves ADR-013 boundaries and null semantics. |
| Report dispatch | `Record<REPORTE_ID,{consultar,Panel}>` | More conditionals or auth in page | One dispatch lowers complexity; actions remain security authority. |
| Critical flows | Extract reads/calculations only before NCF consumption | Reorder transaction stages | R-V15 and rollback behavior are preserved. |

## Refactor Patterns and Data Flow

`actualizarProducto`: `construirPatchYDif(actual: Producto, input: ActualizarProductoInput, fieldDescriptors): {data: ActualizarProductoData; antiguos: Record<string,unknown>; nuevos: Record<string,unknown>}`. Descriptors are `{key, leerActual, leerInput, iguales, formatearAuditoria}`; iterate only when input value `!== undefined`, assign `data` even when equal, and emit audit only when unequal. The same pattern is used by `actualizarCliente` via `construirPatchCliente(input): ClientePatch` and `calcularEstadoEfectivo(actual: Cliente, patch: ClientePatch): EstadoClienteEfectivo`, called once. `actualizarProveedor` uses `construirPatchProveedor(input): Patch` and `resolverRncFinal(input, actual): string|null`; duplicate probes stay async in the use case.

`prepararLineasVenta` becomes pure `validarPrecondicionesLineas(lineas, productos, fecha): VentaErrorCode|null`, async orchestration `validarDescuentosAutorizadosYTopes(tx,ctx,lineas,header,productos,fecha): Promise<Result<{actor:number|null}>>`, pure `construirLineasPersistibles(...)`, and pure `colectarWarningsStock(lineas, stocks): StockWarning[]`. Typed `ok/error` results use the existing stable catalogs; no Prisma/Next imports enter helpers.

`reporte-filtro`: pure `resolverRangoSD(entrada, now): {desde?:Date;hasta?:Date}`; `auditoria`: `normalizarAccion(value): AccionAuditoria|undefined` plus trim helpers. `confirmar-venta`: `verificarDisponibilidadPreNcf(demanda: ReadonlyMap<number,Decimal>, stocks): StockWarning[]`; `crear-devolucion`: `resolverLineasContraVentaOriginal(inputLineas, ventaLineas): {lineas: DetalleNotaCreditoInput[]; cantidades: Decimal[]; originales: Decimal[]}`. These helpers perform only reads/calculation and run before `consumirNcfEnTx`; consumeâ†’flipâ†’invoiceâ†’salidas/cobro remains inline and ordered.

The report registry maps operational/financial/fiscal IDs to action and panel. Dispatch calls `consultar`, renders typed success/error, while DASHBOARD, DGII card, and fallback remain special cases. Nothing moves from server actions: role/company/branch checks and DB-2 authorization stay there.

## Interfaces / Contracts

`fieldDescriptors` must preserve `undefined` (omit from Prisma patch) versus `null` (write SQL NULL); `leerInput` is not null-coalesced. Golden tests assert `{descripcion: undefined}` omits both patch and diff, while `{descripcion: null}` applies null and records old/new null. Decimal/date equality and audit formatting remain descriptor-specific.

## File Changes

Modify the nine listed application/domain/page files and colocated tests; add no cross-module helpers. Move `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts` to `app/scripts/withTenantTransaction.probe.ts`, change imports to `@/modules/...`, add `probe:tenant`, remove its Jest exclusion, retain `/scripts/` exclusion, and update the sibling comment. Stage 3 modifies CI/scripts/Sonar settings to run `jest.integration --coverage`, merge unit+integration LCOV through multiple `sonar.javascript.lcov.reportPaths` entries, and pass `DATABASE_URL`/test-DB env without committing secrets. Stage 4 modifies `app/package.json` and lockfile: bump `prisma`, `@prisma/client`, `@prisma/adapter-pg` to newest compatible 7.x; add overrides `lodash >=4.18.1`, `deepmerge-ts >=8.0.0`, `mysql2 >=3.22.0`. Stage 5 modifies readonly props, `carro.ts` (`Intl.NumberFormat`, lock `.00` test), named SQL-fragment helpers in CxP/operacional repositories, and inventory dedup (`guardarPertenenciaProductosEnTx` plus one `AccionAuditoria`-parameterized audit helper); batch skeletons stay separate.

## Testing, Rollout, and Threat Matrix

PR order is 1aâ†’1e, 2, 3, 4, 5a, 5b; each is a semantic conventional commit and ships unit/integration tests. Stage 4 order is bumpâ†’overridesâ†’`prisma generate`/`validate`â†’full testsâ†’`pnpm audit --prod`; rollback removes overrides and repins 7.10.x if Prisma CLI parsing fails. Verify each slice with `pnpm test`, `pnpm test:integration` against `sf-postgres`, `tsc`, lint, then Sonar lab re-scan/API measures; Stage 3 additionally verifies merged LCOV and Stage 5b duplication <3%. No E2E feature behavior changes.

Threat matrix: Documentation-like paths N/A (probe is TypeScript, not classified documentation); Git repository selection, commit state, push state, and PR commands N/A (no VCS/PR automation). The applicable process boundary is the `tsx` probe and Jest subprocess: safe behavior is explicit `pnpm probe:tenant`/coverage commands with caller-provided DB env; failure is non-zero exit and no source-test inclusion. RED coverage: probe smoke/exit test and CI command test; no shell interpolation or secret logging.

## Open Questions

- [ ] Resolve the exact newest 7.x Prisma patch at implementation time, then record the lockfile version.
