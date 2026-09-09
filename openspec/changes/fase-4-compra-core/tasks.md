# Tasks: Compra Core (fase-4-compra-core)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950–1,150 (module ~450, tests ~450, fixtures/docs ~80) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR, work-unit commits |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

User (maintainer) approved `size:exception` for a single PR. Commits stay grouped by work unit: domain → application → infrastructure → http → integration tests → docs. No migration; no UI in scope.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Domain: errors, guards, calculators + unit tests | PR 1 (all) | `pnpm --dir app jest src/modules/compra/domain` | N/A — pure TS, no DB | Delete `domain/` |
| 2 | Application use cases + mocked-tx tests | PR 1 (all) | `pnpm --dir app jest src/modules/compra/application` | N/A — mocked tx | Delete `application/` |
| 3 | Infrastructure + HTTP adapters | PR 1 (all) | `pnpm --dir app jest src/modules/compra` | N/A — covered by integration suite | Delete `infrastructure/ http/` |
| 4 | Integration tests + fixtures | PR 1 (all) | `pnpm --dir app jest src/integration/compra` | Real DB: seeded tenant fixtures | Remove `src/integration/compra-*`, revert fixtures |
| 5 | Docs/seams | PR 1 (all) | N/A — doc-only | N/A | Revert doc edits |

## Phase 1: Domain (pure TS, DB-free)

- [x] 1.1 Create `app/src/modules/compra/domain/errors.ts` — stable catalog: `VALIDATION_ERROR`, `COMPRA_NO_ENCONTRADA`, `PROVEEDOR_NO_ENCONTRADO`, `PRODUCTO_NO_ENCONTRADO`, `PROVEEDOR_INACTIVO`, `LINEA_INVALIDA`, `COMPRA_INMUTABLE`, `TRANSICION_INVALIDA`, `CONFIG_RETENCION_FALTANTE`, `CORRELATIVO_CONFLICTO`, `CONCURRENCIA_CONFLICTO`, `NFC_DUPLICADO`, `NO_AUTORIZADO`, `SESION_INVALIDA` (R: all error scenarios).
- [x] 1.2 Create `app/src/modules/compra/domain/compra.ts` — const-derived `EstadoCompra` (`BORRADOR/PENDIENTE/CANCELADA` only, no CONFIRMADA/RECIBIDA/PAGADA), draft/line/totals types, guarded transition rules (edit only BORRADOR; cancel from BORRADOR/PENDIENTE; confirm BORRADOR→PENDIENTE), typed seams `InventoryEntryPort` + `INVENTORY_SOURCE.PURCHASE` as declared-but-unconsumed contracts (R: unreachable-states, edit-after-confirm).
- [x] 1.3 Create `app/src/modules/compra/domain/calculators.ts` — Decimal-as-string line totals, per-line frozen-rate ITBIS sum (18/16/0), `subtotalGravado/itbis/subtotalExento/subtotal/total` (total = gross; payable derived, never stored) (R: 18/16/0 mix).
- [x] 1.4 Add retention calculators to `calculators.ts` — parameterized by `RetentionRates` (`isr15/isr2/itbis100/itbis30`), matrix tipoCompra × supplier class: ISR 15% pro/rental física, ISR 2% technical services, ITBIS 100% informal, ITBIS 30% pro services jurídica, none for formal merchandise (R: formal merchandise, config-driven).
- [x] 1.5 Domain unit tests `app/src/modules/compra/domain/*.test.ts` — mixed 18/16/0 totals, full retention matrix, invalid line (qty ≤ 0, inactive/foreign product), state guards, no DB import. Must pass before Phase 2 (R: invalid line, 18/16/0 mix).

## Phase 2: Application (mocked tx)

- [x] 2.1 Create `app/src/modules/compra/application/crear-compra.ts` — validate active supplier, date, branch, tipoCompra, ≥1 line (base-unit cantidad > 0, costoUnitario), optional `ncf/tipoNcf`; freeze per-line `tasaItbis`; return `CompraResult` (R: valid draft saved, invalid line).
- [x] 2.2 Create `application/actualizar-compra.ts` — edit allowed only while `BORRADOR` (line replacement); `PENDIENTE` → `COMPRA_INMUTABLE` (R: edit after confirm).
- [x] 2.3 Create `application/confirmar-compra.ts` — load draft + retention config from `configuracion-repository`; recalc totals from frozen lines; missing applicable key → `CONFIG_RETENCION_FALTANTE` (no legal-default fallback); delegate guarded transition + correlativo + audit to repo (R: missing key blocks confirm, happy-path confirm).
- [x] 2.4 Create `application/cancelar-compra.ts` — motivo mandatory (empty → `VALIDATION_ERROR`), cancel `BORRADOR/PENDIENTE` → `CANCELADA`, in-transaction audit, no inventory reversal, NCF slot not freed (R: cancel scenarios).
- [x] 2.5 Create `application/listar-compras.ts` + `obtener-compra.ts` — tenant filter, default 25/max 100 (reject >100), deterministic order; detail only same-empresa with supplier + lines (R: bounds and isolation).
- [x] 2.6 Application unit tests with mocked tx — draft CRUD, immutable PENDIENTE, guarded conflict → `CONCURRENCIA_CONFLICTO`, config failure blocks confirm, pagination bounds, typed error codes (R: all app scenarios).

## Phase 3: Infrastructure + HTTP

- [x] 3.1 Create `app/src/modules/compra/infrastructure/compra-repository.ts` — tenant-scoped CRUD via `PrismaTx`, line replacement, guarded `UPDATE ... WHERE id AND empresaId AND estado=<expected>` with affected-rows check, `EMPRESA` row lock (`SELECT ... FOR UPDATE`) then `MAX(cast numeric suffix)+1` formatted `CMP-%06d` per empresa, in-transaction audit writes, paginated list/detail (R: happy-path confirm, concurrent confirms).
- [x] 3.2 Create `infrastructure/configuracion-repository.ts` — read `RET_ISR_15`, `RET_ISR_2`, `RET_ITBIS_100`, `RET_ITBIS_30` by empresa with `America/Santo_Domingo` validity window; missing/invalid applicable key → stable config error (R: missing key blocks confirm).
- [ ] 3.3 Create `app/src/modules/compra/http/validations.ts` — Zod schemas mirroring draft/cancel/list inputs (R: invalid line, missing motivo).
- [ ] 3.4 Create `http/actions.ts` — thin admin-only Server Actions: resolve session, verify Administrador server-side, `withTenantTransaction`, delegate to use cases; unique-`ncf` violation → `NFC_DUPLICADO`; pass ESLint `server-action-must-wrap-tenant` (R: non-admin invocation, valid draft saved).

## Phase 4: Integration tests (real DB)

- [ ] 4.1 Extend `app/src/integration/setup/fixtures.ts` — seed active suppliers (formal/informal × física/jurídica), retention config keys, purchase-ready products; expose via `TenantFixture` (R: valid draft saved).
- [ ] 4.2 Create `src/integration/compra-confirm.integration.test.ts` — confirm → `PENDIENTE` + CMP number + exactly one audit row + zero `MovimientoInventario`; retry does not duplicate (R: happy-path confirm).
- [ ] 4.3 Create `src/integration/compra-concurrency.integration.test.ts` — same draft confirmed twice in parallel (one succeeds, loser stable error, no duplicate effects); two drafts concurrent → distinct sequential correlativos (R: concurrent confirms).
- [ ] 4.4 Create `src/integration/compra-config.integration.test.ts` — `RET_ITBIS_100` absent + informal supplier → confirm blocked, state stays `BORRADOR` (R: missing key blocks confirm).
- [ ] 4.5 Create `src/integration/compra-tenant.integration.test.ts` — size 500 rejected, cross-empresa detail/list → not-found, deterministic order (R: bounds and isolation).
- [ ] 4.6 Create `src/integration/compra-cancel.integration.test.ts` — motivo audited, inventory untouched, NCF slot retained; proveedor deactivation guard `tieneComprasNoCanceladas` first coverage (R: cancel scenarios).

## Phase 5: Docs / cleanup

- [ ] 5.1 Document seams (`InventoryEntryPort`, `INVENTORY_SOURCE.PURCHASE`, B11, `MovimientoInventario.compraId`) as later-phase-only in module header comment; note retention-config seeding as operational prerequisite in docs (R: 3.4b seams).
- [ ] 5.2 Verify success criteria: no migration in commit, ESLint tenant rule green, `RECIBIDA/PAGADA` unreachable from use cases (grep domain/application for forbidden states).

## Traceability

- Requirement draft lifecycle → 1.1–1.5, 2.1–2.2, 3.3–3.4, 4.1; totals → 1.3; retentions → 1.4, 2.3, 3.2, 4.4; confirm/correlativo → 1.2, 2.3, 3.1, 4.2–4.3; cancel → 2.4, 3.1, 4.6; listing → 2.5, 3.1, 4.5; admin-only → 3.4, 4.5; seams → 1.2, 5.1.
