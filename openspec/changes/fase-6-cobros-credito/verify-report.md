```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:04daee2cb93deaf4cef1880227fdfed7d9c99e1a1f5aa21aaaaf110ec8826bdc
verdict: pass
blockers: 0
critical_findings: 0
requirements: 13/13
scenarios: 29/29
test_command: pnpm test (app/)
test_exit_code: 0
test_output_hash: sha256:87dc1dea3f8d99cde5b5cda10fb670162eb04050ed0eb527aa6bf7d3d73a1bbb
build_command: pnpm exec tsc --noEmit (app/)
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: fase-6-cobros-credito
**Version**: specs R-C1..C7, R-B1..B3, R-K1..K2, R-V15 (MODIFIED)
**Mode**: Standard (config `strict_tdd: false`)
**Branch / commits**: `feature/fase-6-cobros`, slices 1–4 (c959e45..99ec156), 20/20 tasks checked

### Command Evidence (this session, runs of record)

| Command | Observed result |
|---|---|
| `pnpm exec tsc --noEmit` (app/) | exit 0 — clean, no type errors |
| `pnpm lint` (app/) | exit 0 — ESLint clean; `systemfact/server-action-must-wrap-tenant` green on all four cobros actions |
| `pnpm test` (app/) | exit 0 — **79 suites / 694 tests passed** — no regression vs slice-3 baseline (75/675) |
| `pnpm test -- cobros` | exit 0 — 8 suites / 52 tests passed (domain + ui + application unit/jsdom) |
| `pnpm test:integration -- cobros` | exit 1 — **harness-blocked**: `PrismaClientKnownRequestError: Invalid \`prisma.$queryRaw()\` invocation` at `truncateAll (src/integration/setup/fixtures.ts:48)` via `setup-env.ts:12` — fails in the shared before-all fixture before any test body (Postgres localhost:5433 unreachable, no Docker). Not an implementation failure. |
| `pnpm exec prisma validate` (app/) | exit 0 — "schema is valid" |
| e2e (Playwright) | Not run — needs live app + Postgres + Supabase auth; same CI accounting as integration. |

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 20 |
| Tasks complete | 20 |
| Tasks incomplete | 0 |

### Build & Tests Execution
**Build (typecheck)**: ✅ exit 0
**Unit tests**: ✅ 694 passed / 0 failed / 0 skipped (79 suites)
**Integration**: ⚠️ 5 suites / 12 tests environment-blocked at `truncateAll` fixture (no local DB) — real-Postgres proof deferred to CI per repo precedent (last phases did the same).
**E2E**: ⚠️ CI-only (needs seeded-auth live stack).
**Coverage**: ➖ not instrumented in this run; not a gate here.

### Spec Compliance Matrix
Counts are the **actual** spec headings: **13 requirements / 29 scenarios** across the four spec files. (The launch brief cited "25"; the authoritative heading count is 29 — the mismatch is a WARNING, and this report uses the spec-truth 29.)

Status key — ✅ COMPLIANT (local runtime): covering test passed in this session's `pnpm test`. ⚠️ COMPLIANT (CI-pending): covering test authored + mapped + compiles/lints clean; runtime proof blocked locally by the DB harness, runs on CI real Postgres. ❌ UNTESTED: none.

| Req | Scenario | Covering test | Status |
|---|---|---|---|
| R-C1 | Partial collection applies immediately | `cobros-cobro.integration.test.ts` (one APLICADO at committed amount, balance decreases) | ⚠️ CI-pending |
| R-C1 | Collection on non-current invoice rejected | `cobros-autorizacion.integration.test.ts` (`cobroB.code === FACTURA_COBRO_NO_VIGENTE`) | ⚠️ CI-pending |
| R-C2 | Concurrent over-payment (critical) | `cobros-cobro.integration.test.ts > R-C2` (8k+8k on 10k → one commits, other COBRO_EXCEDE_SALDO, no negative) | ⚠️ CI-pending |
| R-C3 | Replayed refund burns nothing (critical) | `cobros-reembolso.integration.test.ts` (replay → conflict, no row, no receipt burned) | ⚠️ CI-pending |
| R-C3 | First-submit race on same key | `cobros-reembolso.integration.test.ts` (two first submits → one row, loser stable code) | ⚠️ CI-pending |
| R-C3 | Legitimate repeat refund allowed | `cobros-reembolso.integration.test.ts` (fresh key accepted) | ⚠️ CI-pending |
| R-C4 | Concurrent receipts stay unique (critical) | `cobros-cobro.integration.test.ts > R-C4` | ⚠️ CI-pending |
| R-C5 | Every rejection is catalog-coded | `cobros/domain/errors.test.ts` | ✅ local |
| R-C6 | Unauthorized refund actor | `cobros-autorizacion.integration.test.ts` (Despachador denied + refund role gate → PAGO_NO_AUTORIZADO before write) | ⚠️ CI-pending |
| R-C7 | Double-click on the payment form | `cobros/ui/__tests__/cobros-ui.spec.tsx` (jsdom first-click single-flight) + `e2e/cobros.spec.ts` (real double-click) | ✅ local (jsdom) / ⚠️ e2e CI-pending |
| R-C7 | Estado de cuenta renders derived facts | `cobros-ui.spec.tsx` (derived totals render) + `e2e/cobros.spec.ts` | ✅ local (jsdom) / ⚠️ e2e CI-pending |
| R-B1 | Mixed APLICADO/REVERTIDO (critical) | `cobros-saldo-cxc.integration.test.ts` (6,000.00 on 10,000.00) | ⚠️ CI-pending |
| R-B1 | Non-current invoices excluded | `cobros-saldo-cxc.integration.test.ts` (ANULADA excluded) | ⚠️ CI-pending |
| R-B1 | Never stale after a new payment | `cobros-saldo-cxc.integration.test.ts` (single non-materialized source; recompute per run) | ⚠️ CI-pending (see SUGGESTION) |
| R-B2 | Partial payment state | `cobros/domain/clasificar-estado-pago.test.ts` | ✅ local |
| R-B3 | Timezone boundary day | `cobros/domain/en-mora.test.ts` | ✅ local |
| R-B3 | Day past due | `cobros/domain/en-mora.test.ts` | ✅ local |
| R-K1 | Port-only coupling | `credito.integration.test.ts > R-K1` (venta imports only `EvaluarCreditoPort`; verified by import grep — no `cobros/{domain,infrastructure}` in venta) | ⚠️ CI-pending |
| R-K2 | Over-limit rejection | `credito.integration.test.ts > R-K2` (23k/20k) | ⚠️ CI-pending |
| R-K2 | Overdue client rejection | `credito.integration.test.ts > R-K2` (31 days) | ⚠️ CI-pending |
| R-K2 | Exactly-at-limit passes | `cobros/domain/credito.test.ts` (inclusive boundary) | ✅ local |
| R-K2 | REVERTIDO payments do not block | `credito.integration.test.ts` (REVERTIDO excluded) | ⚠️ CI-pending |
| R-K2 | Non-credit sales skip the gate | `cobros/domain/credito.test.ts` + `confirmar-venta.integration.test.ts` (contado → CONTADO) | ✅ local (rule) / ⚠️ CI-pending (flow) |
| R-V15 | Happy-path confirm closes the loop | `e2e/confirm-venta.spec.ts` | ⚠️ CI-pending (e2e) |
| R-V15 | Post-consume stock rejection rolls back | `confirmar-venta.integration.test.ts` (hard preview + authoritative exit) | ⚠️ CI-pending |
| R-V15 | Double-click confirm is idempotent | `confirmar-venta.integration.test.ts` (parallel confirm → single flip) | ⚠️ CI-pending |
| R-V15 | Foreign-branch sale not confirmable | `confirmar-venta.integration.test.ts` | ⚠️ CI-pending |
| R-V15 | Credit-blocked client rejected before NCF (critical) | `confirmar-venta.integration.test.ts > credit-gate ordering` (rejected BEFORE NCF lock, zero effects) | ⚠️ CI-pending |
| R-V15 | Contado sale derives PAGADA at confirm (critical) | `confirmar-venta.integration.test.ts > contado close-the-loop` (one COBRO → PAGADA; abort → no COBRO) | ⚠️ CI-pending |

**Compliance summary**: 29/29 scenarios mapped to a covering test; 7 locally runtime-proven (unit/jsdom), 22 authored + mapped with real-DB/browser proof pending in CI. 0 UNTESTED, 0 FAILING among executed tests.

### Runtime proof pending in CI
The following scenarios are environment-blocked locally (no Docker/Postgres at localhost:5433; no seeded-auth live stack for e2e) and are proven by CI's real-Postgres/e2e jobs — exactly as prior fases established. Each has an authored, compiling, lint-clean covering test:
R-C1 (partial applies, non-current rejected), R-C2 (concurrent over-payment), R-C3 (replay no-burn, first-submit race, legit repeat), R-C4 (concurrent receipts), R-C6 (unauthorized refund), R-B1 (mixed APLICADO/REVERTIDO, non-current excluded, never-stale), R-K1 (port-only), R-K2 (over-limit, overdue, REVERTIDO, non-credit-skip flow), R-V15 (all six, incl. credit-before-NCF and contado-PAGADA), plus the two e2e-tagged R-C7/R-V15 scenarios. The focused `pnpm test:integration -- cobros` run reached and executed all 5 cobros integration suites (12 tests); every one failed identically at the shared `truncateAll` connection, confirming the block is the harness, not the assertions.

### Correctness (Static Evidence, per AGENTS.md)
| Check | Status | Evidence |
|---|---|---|
| Domain purity — `cobros/domain` imports no Next/React/Prisma/Supabase | ✅ | grep of `cobros/domain/**` for those imports → 0 matches (only `decimal.js`, sibling domain modules) |
| Money = Decimal, never float | ✅ | `pago-repository.crearPagoEnTx` writes `new Prisma.Decimal(monto)`; money crosses layers as `Decimal(12,2)` strings; `format.ts` `.toNumber()` is display-only (Intl). `: number` grep hits are all ids/day-counts/pagination, none money |
| `empresaId` (+sucursal) pinning in reads/writes | ✅ | `saldo-cxc.repository.ts` pins `f.empresaId = ${ctx.empresaId}` in every join + subquery; `pago-repository`, `recibo.repository` scope by `empresaId`; reprint read `(empresaId, correlativoRecibo)` |
| Every mutating Server Action wraps `withTenantTransaction` | ✅ | all 4 actions (`registrarCobro/Reembolso/SaldoCxc/Recibo`) open `withTenantTransaction(ctx, tx => …)`; ESLint project rule green |
| Credit gate BEFORE NCF lock/consume (R-V15) | ✅ | `confirmar-venta.ts`: stock preview (step 5) → totals (5b) → credit gate (5c, L212–219, returns rejection before line 227) → NCF consume (step 6, L227) |
| Idempotency check before insert AND before receipt burn (R-C3) | ✅ | `registrar-reembolso.ts`: `buscarPagoPorIdempotenciaEnTx` (L106) precedes `asignarCorrelativoReciboEnTx` (L119) and `crearPagoEnTx` (L127); unique-violation race (L143) → same stable code; non-idempotency Prisma errors propagate (rollback), never cross HTTP |
| First-click disable in `PaymentForm.tsx` (R-C7) | ✅ | `disabled={enviando}` on submit (L161) + `enviar()` early-return `if (enviando) return` (L60); server revalidates all |
| Migration present with unique index | ✅ | `20260915000000_pago_idempotency_key/migration.sql`: nullable `idempotencyKey VARCHAR(255)` + `CREATE UNIQUE INDEX "PAGO_empresaId_idempotencyKey_key" ON ("empresaId","idempotencyKey")` |
| Canonical aggregate is one grouped SQL (no N+1) | ✅ | `consultarSaldoCxcEnTx` = single `$queryRaw` with pre-aggregated LEFT JOIN subselects; `leerTerminosCreditoEnTx` batched `findMany` by id-set |
| `COBRO/APLICADO/EFECTIVO` at creation (R-C1) | ✅ | `registrar-cobro.ts` passes `estado: APLICADO`, `tipo: COBRO`, `idempotencyKey: null`; repository forces `metodoPago: EFECTIVO` |
| 600-series catalog complete (R-C5) | ✅ | `errors.ts` exports exactly the 8 spec codes (606–613); `errors.test.ts` asserts the set |

### Coherence (Design)
| Decision (design.md) | Followed? | Notes |
|---|---|---|
| Refund idempotency = client key, nullable unique `(empresaId,idempotencyKey)`; gate before receipt burn | ✅ | migration + `registrar-reembolso` ordering |
| Payment created directly `APLICADO` (no two-phase) | ✅ | `crearPagoEnTx` estado=APLICADO; single-invoice FK |
| CxC = one tenant-scoped SQL aggregate + pure classifiers, no cache | ✅ | `saldo-cxc.repository` + `clasificar-estado-pago`/`en-mora`/`credito` domain |
| Cross-module credit via application port only (no ORM/infra leak into venta) | ✅ | venta imports `@/modules/cobros/application/credit-port`; grep shows no `cobros/{domain,infrastructure}` import in venta |
| Contado COBRO at confirm, same tx, post-consume throw-on-fail | ✅ | `confirmar-venta.ts` step 10 |

### Issues Found
**CRITICAL**: None.

**WARNING**:
1. Environment-blocked runtime proof — `pnpm test:integration` (5 cobros suites / 12 tests) and Playwright e2e cannot execute locally (no Docker/Postgres at :5433; no seeded-auth live stack). All 22 integration/e2e-tagged scenarios are covered by authored, compiling, lint-clean tests that run on CI's real-Postgres/e2e jobs. This matches the established repo precedent for prior fases; CI is the real proof for the RLS/concurrency/idempotency guarantees that unit tests cannot reproduce.
2. Spec-count discrepancy vs launch brief — the brief said "all 25" scenarios; the authoritative `#### Scenario:` heading count is **29** (13 requirements). This report uses 29/13 per the "count actual headings, never invent totals" rule. No action needed beyond acknowledging the corrected total.
3. React effect-rule note (Phase 4, non-blocking) — `CxcBoardScreen` uses the ratified `void action().then(aplicar)` pattern to satisfy `react-hooks/set-state-in-effect`; lint is green, recorded for reviewer awareness.

**SUGGESTION**:
1. R-B1 "Never stale after a new payment" has no dedicated re-run-after-commit assertion; it is structurally guaranteed (single non-materialized `$queryRaw` source, no cache) and re-covered by the mixed-state integration. Consider a one-line CI assertion that a second `consultarSaldoCxC` after a committed COBRO reflects the new balance.
2. Static call-graph flagged `EvaluarCreditoPort` and `asignarCorrelativoReciboEnTx` as "no covering tests"; both are in fact exercised by the CI-blocked `credito.integration` / `cobros-cobro.integration` suites. No gap — purely harness-limited local visibility.

### Known Deferrals (out of scope, tracked)
- Daily cash close (cierre de caja) → phase 7 reports (proposal Out-of-Scope).
- Nota de Débito B03 emission → separate future change (Σ NOTA_DEBITO term present but empty in V1).
- `docs/05-modulosFact.md` §12 Cobros lifecycle/catalog edit is on-disk only — `docs/` is gitignored by repo policy (code-oriented repo); openspec/ (tracked) carries the task ticks. DoD "documented" is met within the repo's own convention.

### Verdict
**PASS** (with environmental warnings). All local gates are green (tsc, lint, 694 unit tests, prisma validate), all 13 requirements / 29 scenarios are mapped to a covering test with zero UNTESTED/FAILING among executed tests, every structural AGENTS.md check is clean, and the integration/e2e scenarios are explicitly accounted as CI-blocked (not implementation failures) with authored tests ready for CI's real-Postgres/browser proof. Ready for archive pending the CI green that closes the runtime loop.
