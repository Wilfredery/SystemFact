# Tasks: fase-5c-ncf-confirm — NCF Engine + Sale Confirmation + SALIDA_VENTA

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,320 total (PR-1 ~420 / PR-2 ~620 / PR-3 ~520 / PR-4 ~760 incl. +15% UI carry, lockfile lines counted) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR-1 NCF engine → PR-2 confirm+FACTURA+catalog → PR-3 salidas+reposition+cancel → PR-4 UI+seed+E2E+DESC_MAX |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Slices 2–4 exceed the standard 400-line review budget (project review_budget_lines: 800 — slice 4 ~760 sits near it once the UI carry lands); chained stacked-to-main delivery is already chosen, so apply must surface the per-slice sizes before starting. Each PR merges to main independently; rollback = revert merge commits in reverse order; zero schema migrations ⇒ pure code revert. Runtime attempt ledger: one work-unit label per phase — `pr5c1`, `pr5c2`, `pr5c3`, `pr5c4` (mirrors 5b ledger `pr5b1..3`, `verify-5b-1`); the single E2E smoke runs under `verify-5c-1`.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 (`pr5c1`) | NCF module: pure rules + locked consume + integration tests | PR-1 | `pnpm jest src/modules/ncf` | Jest vs `sf-postgres:5433`; NCF_SECUENCIA fixtures | Revert PR-1 merge commit; no schema, no callers yet |
| 2 (`pr5c2`) | confirmarVenta through FACTURA + 19-code catalog | PR-2 | `pnpm jest src/modules/venta src/modules/ncf` | Integration: guarded flip, FAC concurrency, tenant/branch isolation | Revert PR-2; confirm unreachable from UI still |
| 3 (`pr5c3`) | registrarSalidasVenta + reposition + confirmed cancel | PR-3 | `pnpm jest src/modules/inventario src/modules/venta` | Integration: shortage rollback, row-lock serialization, 608 cancel | Revert PR-3; confirm loses only the salidas step |
| 4 (`pr5c4`) | UI controls, seed:ncf, DESC_MAX hardening, E2E smoke | PR-4 | `pnpm jest src/modules/venta/ui` + `pnpm e2e` | Playwright: seeded draft → confirm → invoice/NCF + DB assertion; seed idempotency | Revert PR-4 only; backend intact |

## Phase 1: PR-1 — NCF Engine (`pr5c1`)

Start: empty `modules/ncf/`. Finish: consume port green behind tests. Verification: `pnpm jest src/modules/ncf`. Rollback: revert PR-1; no schema, no callers.

- [x] 1.1 RED unit `app/src/modules/ncf/domain/__tests__/ncf-rules.spec.ts`: composition exactly `B02000000522` (11 chars, no RNC, prefix matches tipo) per R-N2 "11-char composition". Write test first.
- [x] 1.2 RED unit same spec: 90% threshold math — used ≥ 0.90 emits `NCF_UMBRAL_90` warning, never fails; <0.90 emits nothing (R-N3 "Threshold warning at 90%").
- [x] 1.3 RED unit same spec: SD calendar-day expiry via `date-fns-tz` injected clock — boundary day still valid (R-N5 "Boundary day still valid"), day-after blocks; never raw UTC compare.
- [x] 1.4 GREEN: create `app/src/modules/ncf/domain/ncf-rules.ts` — `componerNcf`, `calcularUmbral90`, `esRangoVencidoSD` (SD dates, D7 last-used semantics inputs). (~120 lines)
- [x] 1.5 RED integration `app/src/modules/ncf/infrastructure/__tests__/ncf-consume.spec.ts`: single consume advances 521→522 returning `B02000000522` (R-N1 "Single consume advances counter").
- [x] 1.6 RED integration: no active row → `NCF_SEC_INEXISTENTE` zero writes (R-N1 "Missing sequence hard-fails"); `secuenciaActual=rangoFin` → `NCF_AGOTADA`, no advance (R-N4 "Exhausted range blocks"); day-after expiry → `NCF_VENCIDA` (R-N5 "Day after expiry blocks").
- [x] 1.7 RED integration (concurrency fixture, mirrors compra-concurrency): two parallel consumes serialize to distinct sequentials, `@@unique([empresaId,tipoNcf])` never violated, aborted tx burns nothing (R-N1 "Concurrent consume never duplicates").
- [x] 1.8 GREEN: create `app/src/modules/ncf/infrastructure/ncf-repository.ts` + `app/src/modules/ncf/application/consumir-ncf.ts`: `consumirNcfEnTx(tx, ctx, tipo, opts)` — `SELECT ... FOR UPDATE` on active `empresaId+tipoNcf+activa=true`, `next=secuenciaActual+1`, exhaustion/expiry throws, 90% warning out-of-band; typed results, no Prisma internals leak (R-N1..N5). (~200 lines)
- [x] 1.9 Module README (`app/src/modules/ncf/README.md`): port contract, throw-after-consume convention, D7/D8 semantics. (~40 lines)
- [x] 1.10 Verify `pnpm jest src/modules/ncf` green; commit PR-1 (code+tests+docs one commit). (~0 diff)

## Phase 2: PR-2 — Confirm + FACTURA + Catalog (`pr5c2`)

Start: engine merged. Finish: `confirmarVenta` runs preview→NCF→flip→FACTURA green; salidas step lands in PR-3. Verification: `pnpm jest src/modules/venta src/modules/ncf`. Rollback: revert PR-2; UI still has no confirm control.

- [x] 2.1 RED unit `app/src/modules/venta/domain/__tests__/errors.spec.ts`: extend `VentaErrorCode` to exactly 19 codes adding `NCF_AGOTADA`, `NCF_VENCIDA`, `NCF_SEC_INEXISTENTE`, `FACTURA_AUTOMATICA_FALTA`, `STOCK_INSUFICIENTE_BLOQUEO`; `STOCK_INSUFICIENTE`/`NCF_UMBRAL_90` stay warnings; update R-V13 catalog-length assertion 14→19 (R-V13 "Exhausted range surfaces stable code" covered by 2.6).
- [x] 2.2 RED unit `application/__tests__/elegibilidad-ncf.spec.ts`: valid 9-digit RNC + !consumidorFinal → B01; CF row or invalid RNC → B02, fail-closed on degenerate data, `fiscal-id.ts` untouched (R-F2 "Taxpayer client gets B01", "Consumidor final gets B02"). GREEN: pure `seleccionarTipoNcf` in venta application. (~40 lines)
- [x] 2.3 RED unit `domain/__tests__/transiciones-confirmar.spec.ts`: pure `transicionarConfirmar` accepts only `BORRADOR`; unknown DB state fails loud via exhaustive `estadoVentaDesdeDb` (R-V13 "Unknown stored state fails loud"; R-V16 "Draft-cancel path untouched").
- [x] 2.4 RED integration `application/__tests__/confirmar-venta.spec.ts`: `facturaAutomatica=false` → `FACTURA_AUTOMATICA_FALTA`, sale stays `BORRADOR`, zero NCF, no invoice (R-F1 "Non-automatic blocks confirm"); gate fires BEFORE NCF consume (design order).
- [x] 2.5 RED integration: stock preview rejects early before any NCF burn (hard preview, R-V15 pre-batch boundary); foreign-branch sale not confirmable — typed not-found, zero effects (R-V15 "Foreign-branch sale not confirmable").
- [x] 2.6 RED integration: absent range → `NCF_SEC_INEXISTENTE` typed error from confirm (no Prisma internals, R-N1 via R-V13); exhausted → `NCF_AGOTADA` (R-V13 "Exhausted range surfaces stable code").
- [x] 2.7 RED integration: guarded flip — retried `CONFIRMADA` returns `VENTA_INMUTABLE`/`CONCURRENCIA_CONFLICTO`, no second NCF/invoice (R-V15 "Double-click confirm is idempotent").
- [x] 2.8 RED integration: mixed 18/16/0% persisted lines + header discount → gravado/exento/itbis/total re-derived server-side, `total = subtotal − descuento + itbis` exact in Decimal; `FAC-%06d` assigned, never from payload (R-F3 "Mixed-rate invoice breakdown").
- [x] 2.9 RED integration (concurrency): two parallel confirms → distinct `FAC-%06d`; sucursal GUC restored in `finally` before branch-scoped FACTURA write (R-F3 "Correlativo allocation is atomic"; design RLS-restore risk).
- [x] 2.10 RED integration: emitted invoice is `VIGENTE`, 1:1 `ventaId`, correct branch, NO persisted paid/balance columns (R-F1 "Automatic invoice created on confirm"; R-F4 "No stored balance on emission").
- [x] 2.11 GREEN: extend `infrastructure/venta-repository.ts` — branch guard, persisted-line read, guarded `UPDATE ... WHERE estado='BORRADOR'` with affected-row check, FACTURA write, atomic FAC allocator (EMPRESA row lock, GUC clear/restore). (~180 lines)
- [x] 2.12 GREEN: create `application/confirmar-venta.ts` in fixed order: read+guard → `transicionarConfirmar` → revalidate lines/rates → hard stock preview → `consumirNcfEnTx` → guarded flip → FACTURA → (PR-3) salidas → warnings; throw-after-consume only. (~160 lines)
- [x] 2.13 Docs: catalog delta note in module README; confirm ordering convention (throw-after-flip / throw-on-reject). (~30 lines)
- [x] 2.14 Verify full `pnpm jest src/modules/venta src/modules/ncf` green; commit PR-2 (code+tests+docs one commit). (~0 diff)

## Phase 3: PR-3 — Salidas + Reposition + Confirmed Cancel (`pr5c3`)

Start: confirm emits invoices. Finish: full R-V15 loop incl. post-consume rollback; R-V16 cancel. Verification: `pnpm jest src/modules/inventario src/modules/venta`. Rollback: revert PR-3; confirm loses only its final step.

- [ ] 3.1 RED integration `app/src/modules/inventario/application/__tests__/salidas-venta.spec.ts`: 2-product debit → branch rows debited once, exactly two `SALIDA_VENTA` movements with `ventaId` + before/after quantities (inventario "Batch debit with movements").
- [ ] 3.2 RED integration: line 2 of 3 exceeds availability → whole batch throws, no stock change/movement for ANY line, typed `STOCK_INSUFICIENTE_BLOQUEO` {productoId, available, requested} (inventario "Mid-batch shortage rolls back whole batch").
- [ ] 3.3 RED integration (row-lock fixture, entry-path three-phase precedent): stock 10, two parallel 6-unit batches → exactly one commits, loser blocked, stock never negative (inventario "Concurrent exits serialize").
- [ ] 3.4 RED integration: post-consume shortage (salidas throws after flip+FACTURA+NCF) → transaction aborts: no NCF advance, no invoice, no movement, sale stays `BORRADOR` (R-V15 "Post-consume stock rejection rolls everything back").
- [ ] 3.5 GREEN: create `app/src/modules/inventario/application/registrar-salidas-venta.ts` + infrastructure batch — dedupe IDs, ascending `productoId` lock order, ownership verify, upsert+lock branch row, throw-on-reject, one movement per line, audit; never touches `costoPromedio`. (~150 lines)
- [ ] 3.6 GREEN: wire `registrarSalidasVenta` as the FINAL step of `confirmarVenta` (after FACTURA, before warnings) per the fixed order; preview stays the early reject.
- [ ] 3.7 RED integration: reposition batch restores exact quantity via one `REPOSICION_CANCELACION` movement, non-empty reason, average cost unchanged (inventario "Reposition restores exact quantity"). GREEN: `registrarReposicionCancelacion` mirroring exit locks, positive delta. (~90 lines)
- [ ] 3.8 RED integration `application/__tests__/cancelar-confirmada.spec.ts`: confirmed sale (5 units, branch A1) → sale `CANCELADA`, invoice `VIGENTE→ANULADA` (never deleted), stock +5, `secuenciaActual` NOT rewound, audit rows for both states (R-V16 "Cancel restocks and annuls fiscally" — 608 semantics).
- [ ] 3.9 RED integration: repeated cancel of `CANCELADA` → guarded stable error, zero effects; draft cancel path unchanged (R-V16 via R-V4).
- [ ] 3.10 RED integration: cross-tenant inventory/movement access → not-found/forbidden without disclosure, no row changed (inventario "Cross-tenant access"); assert no migration exists and cost boundaries hold (inventario "Schema and cost boundary updated").
- [ ] 3.11 GREEN: extend `application/venta-service.ts` + repository — `cancelarVenta` confirmed branch: guarded `CONFIRMADA→CANCELADA`, invoice annul, reposition batch, audit. (~110 lines)
- [ ] 3.12 Docs: 608 cancel semantics note in venta README. (~20 lines)
- [ ] 3.13 Verify `pnpm jest src/modules/inventario src/modules/venta` green; commit PR-3 (code+tests+docs one commit). (~0 diff)

## Phase 4: PR-4 — UI + Seed + DESC_MAX + E2E (`pr5c4`)

Start: backend loop complete. Finish: operator can confirm from POS; seed + F5 hardening merged. Verification: `pnpm jest src/modules/venta/ui` + Playwright smoke `verify-5c-1`. Rollback: revert PR-4 only; backend intact.

- [ ] 4.1 RED integration `app/tools/scripts/__tests__/seed-ncf.spec.ts`: seed upserts active independent B01+B02 ranges per empresa/tipo, idempotent re-run, fail-fast on window overlap (R-N6 "Seed provisions B01 and B02").
- [ ] 4.2 GREEN: create `app/tools/scripts/seed-ncf.ts` + `"seed:ncf"` in `app/package.json`: compound-upsert `{empresaId,tipoNcf,rangoInicio,rangoFin,vigenciaInicio,vigenciaFin,activa}`, documented dev range 100000000–100000999, overlap assertions. (~120 lines)
- [ ] 4.3 RED integration: overlapping `DESC_MAX` windows resolve by `orderBy vigenciaInicio desc` — newest wins (R-V17 "Latest window wins"). GREEN: harden venta-config reader; seed-time overlap assertion fail-fast. (~60 lines)
- [ ] 4.4 RED component test `modules/venta/ui/__tests__/confirm-ui.spec.tsx`: confirm control rendered for `BORRADOR`, disabled on first click, no payment controls (R-V14 "Cart to draft to confirm"; "Empty-cart guard" re-asserted).
- [ ] 4.5 GREEN: extend `ui/PosScreen.tsx` + `ui/DraftList.tsx` + `http/actions.ts` — thin confirm/cancel Server Actions in `withTenantTransaction`; surface `NCF_AGOTADA`, `NCF_VENCIDA`, `NCF_SEC_INEXISTENTE`, `FACTURA_AUTOMATICA_FALTA`, `STOCK_INSUFICIENTE_BLOQUEO`; `NCF_UMBRAL_90` banner in POS status/warning area; no stack traces. (~220 lines + lockfile)
- [ ] 4.6 Playwright E2E `app/e2e/confirm-venta.spec.ts` (only E2E in 5c): seeded draft → confirm → invoice/NCF visible + DB assertion of one NCF, one VIGENTE FACTURA, SALIDA_VENTA rows (R-V15 "Happy-path confirm closes the loop", D9). Prereq: `pnpm seed:ncf` run first.
- [ ] 4.7 Docs: `app/SETUP-LOCAL.md` runbook for `pnpm seed:ncf` + E2E prerequisites; B01 local-validation limitation (D2/D6) noted. (~50 lines)
- [ ] 4.8 Verify UI tests + full suite green; run Playwright smoke; commit PR-4 (code+tests+docs one commit). (~0 diff)
- [ ] 4.9 Final verification: zero-migration check (`git diff --stat` — no `prisma/migrations`), success-criteria checklist vs proposal, tag `verify-5c-1` ledger entry.

## Traceability

| Requirement | Scenarios | Tasks |
|---|---|---|
| R-N1 consume | advances / missing / concurrent | 1.5, 1.6, 1.7, 1.8 |
| R-N2 composition | 11-char | 1.1, 1.4 |
| R-N3 90% warning | threshold | 1.2, 1.4 |
| R-N4 exhaustion | exhausted blocks | 1.6, 1.8 |
| R-N5 SD expiry | boundary / day-after | 1.3, 1.6, 1.8 |
| R-N6 seed | provisions B01/B02 | 4.1, 4.2 |
| R-F1 gated emission | created / non-automatic | 2.4, 2.10, 2.12 |
| R-F2 B01/B02 | taxpayer / CF | 2.2 |
| R-F3 recomputed amounts | mixed-rate / correlativo atomic | 2.8, 2.9, 2.11 |
| R-F4 derived payment | no stored balance | 2.10 |
| R-V13 catalog | unknown state / stable code / 19 codes | 2.1, 2.3, 2.6 |
| R-V15 confirm | happy path / rollback / idempotent / foreign branch | 2.4, 2.5, 2.7, 3.4, 3.6, 4.6 |
| R-V16 cancel | restock+annul / draft untouched / repeat | 3.8, 3.9, 3.11 |
| R-V17 DESC_MAX | latest wins | 4.3 |
| R-V14 POS UI | confirm control / empty cart | 4.4, 4.5 |
| Inventario salidas | batch / shortage / concurrent / reposition / isolation / boundaries | 3.1–3.5, 3.7, 3.10 |
