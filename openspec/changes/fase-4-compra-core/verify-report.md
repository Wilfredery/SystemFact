```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:76156392fdbfdf5f745400bcdda5e04443152ce98c6c35335363e42ba1cff8f8
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 13/13
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:76156392fdbfdf5f745400bcdda5e04443152ce98c6c35335363e42ba1cff8f8
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: fase-4-compra-core
**Version**: N/A (delta spec)
**Mode**: Standard (Strict TDD not active; AGENTS.md states TDD is not mandatory)
**Branch**: feat/fase-4-compra-core (verified HEAD = d45e97e, 6 work-unit commits over base 4721a95)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 23 |
| Tasks complete | 23 |
| Tasks incomplete | 0 |

### Build & Tests Execution (re-run independently, not trusting apply-progress)

- **Unit tests** — `pnpm test` → ✅ exit 0 — 36 suites, 302 tests passed. Integration excluded.
  `test_output_hash`: `sha256:76156392fdbfdf5f745400bcdda5e04443152ce98c6c35335363e42ba1cff8f8`
- **Integration tests** — `pnpm test:integration` (real DB `systemfact_test`, Docker `sf-postgres` healthy on :5433) → ✅ exit 0 — 9 suites, 23 tests passed, 31.4s. `compra-confirm`, `compra-concurrency`, `compra-config`, `compra-tenant`, `compra-cancel` all PASS.
  hash: `sha256:102a42eeb3d1b11f5eac6220bc85f6add5fad184435e56bfa7d0673ecf565d8d`
- **Lint** — `pnpm lint` → ✅ exit 0 — no ESLint problems; project-local `server-action-must-wrap-tenant` rule green (all compra actions wrap DB access in `withTenantTransaction`).
  hash: `sha256:1933b23f2d2990814412de3618deb8f101a6feaa990393e57d2c44aec57252d5`
- **Type-check (build)** — `npx tsc --noEmit` → ✅ exit 0 — zero errors, empty output.
  `build_output_hash`: `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- **Migration guard** — `git diff 4721a95..HEAD --name-only` → ✅ NO files under `app/prisma/` (34 changed files, all under `app/src/modules/compra/**`, `app/src/integration/**`, and `openspec/**`). No schema/migration changes.
- **Coverage**: ➖ not configured (no coverage threshold in project test config).

### Spec Compliance Matrix (13 scenarios / 8 requirements)

| # | Requirement | Scenario | Covering test (passing) | Result |
|---|---|---|---|---|
| R1 | Draft lifecycle, frozen per-line ITBIS | Valid draft saved | `compra-confirm`/`compra-tenant` integration create + `crear-compra.test.ts` | ✅ COMPLIANT |
| R1 | | Invalid line rejected (qty≤0, inactive/foreign product) | `domain/compra.test.ts` (validarLinea), `preparar-lineas` path | ✅ COMPLIANT |
| R1 | | Edit after confirm rejected (PENDIENTE immutable) | `actualizar-compra.test.ts` (COMPRA_INMUTABLE) + `compra-confirm` re-confirm idempotency | ✅ COMPLIANT |
| R2 | Mixed-rate fiscal totals | 18/16/0 mix; total = gross | `domain/calculators.test.ts` + confirm asserts gross `236.00` | ✅ COMPLIANT |
| R3 | Config-driven ISR/ITBIS retentions | Formal merchandise → zero retentions | `calculators.test.ts` matrix + confirm asserts retenciones `0.00` | ✅ COMPLIANT |
| R3 | | Missing key blocks confirm | `compra-config.integration.test.ts` (RET_ITBIS_100 absent → CONFIG_RETENCION_FALTANTE, stays BORRADOR) | ✅ COMPLIANT |
| R4 | Confirm BORRADOR→PENDIENTE, unique correlativo | Happy-path confirm | `compra-confirm.integration.test.ts` (PENDIENTE + CMP-000001 + one audit + zero inventory) | ✅ COMPLIANT |
| R4 | | Concurrent confirms (distinct sequential) | `compra-concurrency.integration.test.ts` (a: one winner + CMP-000001 count==1; b: distinct sequential CMP-000001/000002) | ✅ COMPLIANT |
| R5 | Cancel pre-receipt | Cancel with motivo (audit, no reversal, NCF slot retained) | `compra-cancel.integration.test.ts` | ✅ COMPLIANT |
| R5 | | Missing motivo rejected | `cancelar-compra.test.ts` (trim → VALIDATION_ERROR) | ✅ COMPLIANT |
| R6 | Paginated tenant list/detail | Bounds (500 rejected) + isolation | `compra-tenant.integration.test.ts` + `listar-compras.test.ts` | ✅ COMPLIANT |
| R7 | Administrador-only server-side | Non-admin invocation | `http/actions.test.ts` (unit-mocked `tieneRolPermitidoEnTx`) | ✅ COMPLIANT (see W-2) |
| R8 | 3.4b seams preserved | Unreachable states | `domain/compra.test.ts` (asserts no CONFIRMADA/RECIBIDA/PAGADA) + static grep (no inventory/costoPromedio writes) | ✅ COMPLIANT |

**Compliance summary**: 13/13 scenarios compliant (each has a passing covering test at runtime).

### Correctness (Static Evidence) — constraint audit
| Constraint | Status | Evidence |
|---|---|---|
| `domain/` pure (no Next/React/Prisma/Supabase) | ✅ | grep for forbidden imports in `domain/*.ts` → none; domain uses local `ESTADO_COMPRA` const + `decimal.js` (allowed pure lib) |
| Zero `any` | ✅ | grep `: any`/`as any`/`<any>` in `compra/**` → none (only safe enum-narrowing casts on infra reads) |
| Decimal-as-string money/qty across boundaries | ✅ | writes via `new Prisma.Decimal(string)`; reads via `.toString()`; outputs typed `string`; no float money |
| Tenant anchoring on COMPRA queries | ✅ | every Compra read/write pins `empresaId` (leer/update/confirm/cancel/list/detail/count) |
| Tenant anchoring on DETALLE queries | ✅ | `DETALLE_COMPRA` has no `empresaId` column by design; `reemplazarLineasEnTx` anchors by `compraId` only AFTER the guarded header update (id+empresaId+BORRADOR); enforced by `detallecompra_isolation` RLS policy |
| Guarded state transitions + affected-rows check | ✅ | `updateMany WHERE id AND empresaId AND estado=<expected>`, `result.count` checked → `CONCURRENCIA_CONFLICTO` on race loss |
| PENDIENTE immutable | ✅ | `transicionarConfirmar`/`transicionarCancelar` + `actualizar` rejects non-BORRADOR (COMPRA_INMUTABLE); real-DB re-confirm proves it |
| RECIBIDA/PAGADA/CONFIRMADA unreachable | ✅ | `ESTADO_COMPRA` exposes only 3 states; forbidden-state grep hits only doc-comments + an assert-absent test |
| No inventory / costoPromedio / MovimientoInventario writes | ✅ | grep across module → none; confirm + cancel integration assert `movimientoInventario.count==0` |
| Correlativo: EMPRESA row lock + MAX+1 + `CMP-%06d` | ✅ | `SELECT "id" FROM "EMPRESA" ... FOR UPDATE` then `MAX(...)+1` cast to int, `CMP-%06d`; serialized by concurrency test (b) |
| Sucursal GUC clear/restore under empresa lock — no corrupted session | ✅ | `asignarCorrelativoSiguienteEnTx` clears `app.current_sucursal_id` then restores, ALL via `set_config(..., true)` (is_local=TRUE). A failure between clear and restore aborts the transaction, which discards local GUCs automatically; even pooled-connection reuse cannot leak the cleared value. Restore cannot leave a corrupted session by construction |
| Config-driven rates, no legal-default fallback | ✅ | `leerTasasRetencionEnTx` reads RET_* keys; missing applicable key → `CONFIG_RETENCION_FALTANTE` thrown, caught in `confirmar-compra` |
| Audit rows in-transaction, append-only | ✅ | `registrarAuditCompraEnTx` uses frozen `AccionAuditoria` enum, same tx; confirm/cancel each append exactly one row (asserted) |
| Pagination default 25 / max 100 (reject >100, not clamp) | ✅ | `listar-compras.ts` `LIMITE_MAXIMO=100` rejects via VALIDATION_ERROR; tenant integration asserts size 500 rejected |
| No N+1 on list/lines | ✅ | `listarComprasEnTx` single `findMany` + `count` (Promise.all); `prepararLineas` one batched `findMany where id in [...]` |
| Administrador-only server-side enforcement | ✅ | every action resolves session then `tieneRolPermitidoEnTx(tx, usuarioId, empresaId, ["Administrador"])` inside the tx before the use case |

### Coherence (Design)
| Decision | Followed? | Notes |
|---|---|---|
| Internal correlativo via EMPRESA row lock + MAX(CAST suffix)+1, formatted `CMP-%06d` | ✅ Yes | matches design exactly; NcfSecuencia correctly NOT reused |
| Transition idempotency via single guarded `UPDATE ... WHERE estado=expected` + affected-rows | ✅ Yes | no version column, matches schema |
| Retention config read inside confirm tx, no hardcoded fallback | ✅ Yes | `leerTasasRetencionEnTx` inside transaction; validity uses absolute-instant `new Date()` compare (date-fns-tz is not a dependency; SDT day-granularity intentionally deferred/documented — acceptable per apply-progress) |
| Thin HTTP adapters (Zod + session + role + `withTenantTransaction` + delegate) | ✅ Yes | zero business logic in actions.ts |
| Seams (`InventoryEntryPort`, `INVENTORY_SOURCE.PURCHASE`, B11) declared-only, unconsumed | ✅ Yes | documented in README; `PagoProveedor`/`MovimientoInventario.compraId` untouched |

### Task Traceability (spot-checked ≥6, incl. 4.3 & 4.4)
- 4.3 concurrency → `compra-concurrency.integration.test.ts`: (a) same-draft race = one winner, loser stable code, `CMP-000001` global count==1, audit==2, inventory==0; (b) two drafts → distinct sequential CMP-000001/000002. ✅ real artifact
- 4.4 config-block → `compra-config.integration.test.ts`: present→ITBIS 100% (retencionItbis `18.00`); absent→CONFIG_RETENCION_FALTANTE + stays BORRADOR + correlativo empty + audit==1. ✅ real artifact
- 4.2 confirm → `compra-confirm.integration.test.ts` ✅; 4.5 tenant → `compra-tenant.integration.test.ts` ✅; 4.6 cancel → `compra-cancel.integration.test.ts` (+ `desactivarProveedor` guard `PROVEEDOR_TIENE_COMPRAS` first coverage) ✅
- Phase 1 domain, Phase 2 application, Phase 3 infra/http files all present and exercised by the 302 unit + 23 integration tests. ✅
- 2.3 (config block in confirm) and 5.2 (no migration) verified directly. 23/23 checked tasks backed by real artifacts.

### Acceptance Criteria (issue-level contract)
- Gross-total semantics: `total` = subtotal + ITBIS (confirm asserts `236.00` on 2×100 @18%) ✅
- Derived payable never stored: no `pago`/`porPagar` column on `Compra`; retenciones stored, payable = total − retenciones computed on display only ✅
- NCF optional text only: `ncf String?`, `tipoNcf` optional; `NFC_DUPLICADO` via `(empresaId, ncf)` unique; B11 engine deferred ✅
- Quantities base units: `cantidad Decimal(12,3)`, no pack factor consumed ✅

### Issues Found

**CRITICAL**: None.

**WARNING**:
- **W-1 — Per-empresa correlativo is not integration-tested across two branches.** `compra-concurrency.integration.test.ts` exercises the "clear sucursal GUC so MAX spans the whole empresa" mechanism only with a single branch (`sucursalA1`). The spec's empresa-wide sequential property (a confirm at branch A1 and a confirm at branch A2 must draw from the same empresa counter, not per-branch counters) is proven only by static reading of `asignarCorrelativoSiguienteEnTx`, not by a runtime test. Uniqueness/serialization under concurrency IS proven; only the cross-branch span is uncovered. Not a correctness failure, but the highest-value remaining test to add.
- **W-2 — Administrador-only rejection is proven only via a mocked unit test, not a real-DB invocation.** `http/actions.test.ts` mocks `tieneRolPermitidoEnTx`; the non-admin path (`NO_AUTORIZADO`, no data/audit change) is never exercised against `systemfact_test`. The code path is statically verified and tenant-scoped, and the requirement's essence (server-side control, not hidden UI) is met; flagging as WARNING only because the spec scenario is demonstrated at the mocked layer rather than runtime.

**SUGGESTION**:
- **S-1** — `CompraListRow` and `asignarCorrelativoSiguienteEnTx` are flagged by the call-graph as having no direct covering test; both are transitively exercised by the confirm/concurrency integration suites, so this is bookkeeping only. Consider a focused unit assertion on the `CMP-%06d` padStart formatting for the 6-digit boundary (CMP-999999 → CMP-1000000 overflow behaviour) if the counter ever approaches the width.
- **S-2** — The retention-config validity window uses absolute-instant `new Date()` comparison rather than Santo-Domingo day-granularity; the design defers day-granularity (date-fns-tz not a dependency, manual hour math forbidden). This is documented and intentional; revisit when a retention key gets a same-day start/stop boundary.

### Verdict
**PASS WITH WARNINGS**

All 8 requirements / 13 scenarios have passing runtime-covering tests; unit (302), integration (23, real DB), lint, and type-check all exit 0; no migration/schema changes; and every AGENTS.md + design constraint (domain purity, no `any`, Decimal-as-string, tenant anchoring, guarded transitions with affected-rows, PENDIENTE immutability, unreachable RECIBIDA/PAGADA/CONFIRMADA, zero inventory/costoPromedio writes, correlativo via EMPRESA row lock with transaction-local GUC clear/restore, Administrador-only server-side enforcement, pagination bounds, no N+1) is verified against current code and tests. The two WARNINGs are coverage-depth gaps (cross-branch correlativo, real-DB non-admin rejection), not correctness defects; neither blocks archive, both are recommended follow-ups.
