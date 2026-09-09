# Tasks: Purchase Receipt Wiring (Compra → Inventario)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,400–1,800 (≈550 code, ≈900 tests, ≈150 seed/docs) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR-1 inventario entry + cost + RET seed → PR-2 compra receive wiring |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `registrarEntradaCompra` (port realization) + weighted-cost domain fn + `RET_*` idempotent seed | PR 1 (base: main or tracker) | `pnpm -C app test -- inventario compra domain` | `pnpm -C app test:integration` (container `sf-postgres:5433`, db `systemfact_test`) | Revert inventario infra/application + seed script; compra module untouched |
| 2 | `recibirCompra` use case + `RECIBIDA` mapper + http action + full receive integration | PR 2 (base: PR 1 branch under feature-branch-chain) | `pnpm -C app test -- compra` | `pnpm -C app test:integration` | Revert compra domain/application/http; PR-1 inventory behavior unaffected |

PR-1 is independently mergeable: inventario side has no compile-time dependency on compra wiring (port types are already published in compra domain).

## Phase 1: PR-1 — Inventario entry path (RED tests first)

- [x] 1.1 RED unit `app/src/modules/inventario/domain/`: cost function `calcularNuevoCostoPromedio` (Decimal half-up 2dp) — R1 mixed ITBIS 18/16/0 with ITBIS-exclusive costs; R2 all-branch denominator (10@A + 40@B, receive 50 @ 100, CP 80 ⇒ 90.00). Pure, no DB. *(Note: the original spec/task example printed `86.67` in error; the correct all-branch result for those inputs is `90.00` ((50×80 + 50×100)/100) — spec and task reconciled against the normative formula after independent verification.)*
- [x] 1.2 RED integration `app/src/integration/` (real DB): entry for unseen product creates branch row + one `ENTRADA_COMPRA` movement with `compraId`; cross-tenant `productoId` ⇒ typed forbidden, zero changes (tenant isolation). *(Authored; runtime verification blocked-environment: `sf-postgres:5433` container unavailable in this run.)*
- [x] 1.3 Create `app/src/modules/inventario/application/registrar-entrada-compra.ts`: implement `InventoryEntryPort.applyEntry` — per-line tenant ownership guard, branch inventory upsert + `SELECT ... FOR UPDATE`, positive quantity add, movement `{ ENTRADA_COMPRA, compraId, antes/después }`, audit; uses caller's `PrismaTx`.
- [x] 1.4 Extend `app/src/modules/inventario/infrastructure/inventario-repository.ts`: purchase-entry stock write + company-wide `costoPromedio` update via product row lock in ascending product-id order; duplicate product lines → one cost update, one movement per line.
- [x] 1.5 Wire cost function into 1.3/1.4 (GREEN 1.1, 1.2). Manual-adjustment path (`ajustarStockEnTx`) must NOT touch `costoPromedio` (assert existing tests).
- [x] 1.6 Seed script `app/tools/scripts/seed-retencion-config.ts` + `app/package.json` script + `app/SETUP-LOCAL.md`: upsert one active row per `(empresaId, clave)` for `RET_ISR_15/2`, `RET_ITBIS_100/30` with validity windows; idempotent re-run. Fixtures unchanged. Integration test: re-run creates no duplicates; unseeded tenant ⇒ `CONFIG_RETENCION_FALTANTE`, state `BORRADOR`, receipt unreachable. *(Seed code + docs done; integration test authored; runtime verification blocked-environment: no DB container.)*
- [x] 1.7 PR-1 docs: update `app/src/modules/inventario/README.md` (implemented purchase entry, cost boundary).

## Phase 2: PR-2 — Compra receive wiring (RED tests first)

- [ ] 2.1 RED unit `app/src/modules/compra/domain/compra.test.ts`: add `RECIBIDA` to `ESTADO_COMPRA`; `transicionarRecibir` (PENDIENTE→RECIBIDA only); cancel-of-RECIBIDA ⇒ `TRANSICION_INVALIDA`; exhaustive mapper with `assertNever` — unknown state fails loud, no `as EstadoCompraCore` cast remains.
- [ ] 2.2 Modify `app/src/modules/compra/domain/compra.ts` + `errors.ts`: add `RECIBIDA`, receipt transition, exact `InventoryEntryInput`/port types, bridge code `INVENTARIO_ENTRADA_RECHAZADA`. Retire 3.4b seam comment block.
- [ ] 2.3 Modify `app/src/modules/compra/infrastructure/compra-repository.ts`: select `sucursalId` in `leerCompraEnTx`; exhaustive 5-state mapper; guarded receive update `updateMany WHERE estado='PENDIENTE' AND empresaId`.
- [ ] 2.4 Create `app/src/modules/compra/application/recibir-compra.ts` (GREEN): branch guard (`ctx.sucursalId` = compra branch ⇒ typed error otherwise), guarded update (0 rows ⇒ `CONCURRENCIA_CONFLICTO`, zero inventory calls), per-line `applyEntry`, map Inventario failures to bridge code, audit, result `{ id, estado: "RECIBIDA" }`.
- [ ] 2.5 Modify `app/src/modules/compra/http/{validations,actions}.ts`: `recibirCompraAction` — zod `{ id: positive int }`, ctx, one `withTenantTransaction`, `tieneRolPermitidoEnTx(["Administrador"])`; no nested tenant tx.
- [ ] 2.6 RED→GREEN integration (real DB): R4 duplicate click ⇒ conflict, stock/movements/cost unchanged; concurrent receipts race ⇒ exactly one commits; wrong state/branch ⇒ typed error, zero writes; happy path ⇒ RECIBIDA, stock only at session branch, movement `compraId`, cost updated exactly once, one audit row.
- [ ] 2.7 PR-2 docs: update `app/src/modules/compra/README.md` (receipt flow, remaining frozen seams: no `PAGADA`/B11).

## Phase 3: Verification

- [ ] 3.1 Full gates: `pnpm -C app lint`, `tsc --noEmit`, unit + integration suites green; grep confirms no `as EstadoCompraCore`, no compra-module stock/cost writes.
- [ ] 3.2 Verify every spec scenario above has a passing named test; verify no Prisma migration added.
