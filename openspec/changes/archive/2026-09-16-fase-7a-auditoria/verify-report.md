```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:8899730073aa351cc910d5d01de23d96b461b8e2dd212612d5337238abbe9445
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 18/18
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:33d31a8db6514c59ecbbe565cc523dffe536fe00ff70e090d39e893c60f765b0
build_command: pnpm exec tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verify Report — Phase 7A: Audit Consultation (`fase-7a-auditoria`)

- Branch: `feature/fase-7a-auditoria` (6 commits `563668f..026b087`)
- Mode: Standard (`strict_tdd: false`) — implementation proven against specs, design, tasks.
- Verified: 2026-09-15
- Verdict: **PASS** (with non-blocking warnings) → **ready-for-archive**

## Executive Summary

All 10 requirements and 18 scenarios across the four delta specs (`auditoria-consulta`
AC-1..AC-5, `auditoria` AU-1..AU-3, `cobros` R-C8, `auth` REQ-AUTH-AUD-001) are covered
by passing tests. The full verification battery is green: typecheck, `prisma validate`,
735/735 unit tests, 19/19 auditoria integration tests, and a clean regression firewall
around the live paths Slice C touched. The one failing integration test
(`cobros-reembolso` concurrent-first-submit race) is a **proven pre-existing fase-6
defect**, unrelated to fase-7a. The append-only + tenant-isolation invariants hold by
construction and are independently enforced at the DB (RLS) and via ESLint.

## Requirement → Test Mapping

| Req | Scenario (spec) | Layer | Proving test | Result |
|-----|-----------------|-------|--------------|--------|
| AC-1 | Non-admin denied server-side | integration | `auditoria-consulta.integration.test.ts` → "non-admin is refused with AUDITORIA_NO_AUTORIZADO before any read" | pass |
| AC-1 | Admin opens the screen (default newest-first, unfiltered) | UI / read-path *(spec carries no `TEST:` marker)* | `auditoria-ui.spec.tsx` → "renders the rows in the given order, shows the active-filter total..." + `auditoria-consulta` pagination default-order test | pass (informational) |
| AC-1 | (Server-side Admin gate + tenant-wrap) | static + lint | `http/actions.ts` `tieneRolPermitidoEnTx` gate inside `withTenantTransaction`; ESLint `server-action-must-wrap-tenant` exit 0 | pass |
| AC-2 | Page boundary and clamp | integration | `auditoria-consulta.integration.test.ts` → "pagination: 250 rows — page 2 = rows 26–50 (25/page); pageSize 500 → 100 clamp" | pass |
| AC-2 | Empty result set | integration | `auditoria-consulta.integration.test.ts` → "empty result → total 0, totalPages 0, no error" (+ "page past the end returns an empty page") | pass |
| AC-2 | Pagination math (clamp/offset/DTO) | unit | `domain/auditoria.test.ts` → "normalizarFiltro (AC-2 / AC-3)", "pagination math (AC-2)", "mapearAPagina (AC-2)" | pass |
| AC-3 | Combined filter narrows correctly | integration | `auditoria-consulta.integration.test.ts` → "combined filters (accion ∧ usuario ∧ SD-day) narrow to the exact subset" + "free text searches entidad/idEntidad/motivo ONLY — never the JSON payload" | pass |
| AC-3 | Free-text targets + SD→UTC | unit | `domain/auditoria.test.ts` → "free-text target fields (AC-3)"; `domain/zona-horaria.test.ts` → SD-day→UTC bounds | pass |
| AC-4 | Cross-tenant isolation | integration | `auditoria-consulta.integration.test.ts` → "empresa A never sees a single empresa-B row"; `auditoria-cobros` → "the new A PAGAR rows are invisible to empresa B"; `auditoria-auth` → "empresa A's admin sees its own LOGIN row; another company's admin sees none" | pass |
| AC-5 | No mutation surface exists (read-only) | unit + lint + static + integration | `auditoria-ui.spec.tsx` → "...exposes NO mutation control" (0 button/form/textbox); read repo = `findMany`+`count` only; module-wide grep = 0 update/delete/upsert; ESLint exit 0; `auditoria-consulta` → "append-only: an app-role UPDATE/DELETE is RLS-denied" | pass |
| AU-1 | Helper appends one scoped row | integration | `auditoria-auth.integration.test.ts` → "a successful LOGIN appends one company-wide (sucursalId NULL) row" (drives `registrarEventoAuditoriaEnTx`); `auditoria-cobros` → "committed cobro appends exactly one PAGAR row referencing the new Pago" | pass |
| AU-2 | Money flows appear in the log | integration | `auditoria-cobros.integration.test.ts` → "committed cobro appends exactly one PAGAR row..." | pass |
| AU-2 | Session flows produce LOGIN/LOGOUT | integration | `auditoria-auth.integration.test.ts` → LOGIN row + LOGOUT row (each `sucursalId` null) | pass |
| AU-3 | Rejected payment writes nothing | integration | `auditoria-cobros.integration.test.ts` → "rejected cobro (COBRO_EXCEDE_SALDO) leaves no Pago and no audit row" | pass |
| AU-3 | Refund replay stays audit-flat | integration | `auditoria-cobros.integration.test.ts` → "first refund audits once; replaying the key keeps the audit row count flat" | pass |
| R-C8 | Committed collection audited once | integration | `auditoria-cobros.integration.test.ts` → "committed cobro appends exactly one PAGAR row..." | pass |
| R-C8 | First refund audits; replay adds nothing (critical) | integration | `auditoria-cobros.integration.test.ts` → "first refund audits once; replaying the key keeps the audit row count flat" | pass |
| R-C8 | Failed collection writes no audit row | integration | `auditoria-cobros.integration.test.ts` → "rejected cobro (COBRO_EXCEDE_SALDO) leaves no Pago and no audit row" | pass |
| REQ-AUTH-AUD-001 | Successful login writes a LOGIN row | integration | `auditoria-auth.integration.test.ts` → "a successful LOGIN appends one company-wide (sucursalId NULL) row" | pass |
| REQ-AUTH-AUD-001 | Logout writes a LOGOUT row | integration | `auditoria-auth.integration.test.ts` → "a successful LOGOUT appends one company-wide row" | pass |
| REQ-AUTH-AUD-001 | Failed login writes nothing | integration | `auditoria-auth.integration.test.ts` → "resolving identity on the login-flow path ALONE writes no audit row" (+ "the standalone write CANNOT target a foreign company") | pass |

**Coverage: 10/10 requirements and 18/18 scenarios map to a passing test** — 17 spec-tagged
`TEST:` scenarios plus 1 informational scenario (AC-1 "Admin opens the screen", which carries
no `TEST:` marker in the spec and is covered by the read-path default-order test + the UI
suite). No requirement is uncovered.

## Verification Battery

| Command | Observed result | Exit |
|---------|-----------------|------|
| `pnpm exec tsc --noEmit` | clean | 0 |
| `pnpm exec prisma validate` | `The schema at prisma\schema.prisma is valid` | 0 |
| `pnpm test` (full unit suite) | `Test Suites: 83 passed, 83 total` / `Tests: 735 passed, 735 total` | 0 |
| `pnpm test:integration -- auditoria` | `3 suites passed` / `19 tests passed` (consulta 10, auth 5, cobros 4) | 0 |
| `pnpm test:integration -- cobros` | `5 suites passed, 1 failed` / `15 passed, 1 failed, 16` — failure is the pre-existing race (see below) | 1 (pre-existing) |
| `pnpm test:integration -- credito` | `1 suite passed` / `6 tests passed` | 0 |
| `pnpm test:integration -- venta` | `9 suites passed` / `45 tests passed` | 0 |
| `pnpm test:integration -- compra` | `9 suites passed` / `29 tests passed` | 0 |
| `pnpm exec eslint 'src/modules/auditoria/**/*'` | clean (incl. `systemfact/server-action-must-wrap-tenant`) | 0 |
| `pnpm exec prisma migrate deploy` (test DB) | `13 migrations found` / `No pending migrations to apply` (no-op post Slice C) | 0 |

Integration suites run against local `systemfact_test` (Docker `sf-postgres` @ 5433,
PostgreSQL 16, `systemfact_app` role, RLS enforced).

## Migration / Commit Isolation

- `git show --stat 563668f` → **only** `app/prisma/schema.prisma` (+7) and
  `app/prisma/migrations/.../migration.sql` (+30). Migration-only commit, 2 files, 37
  insertions. No feature code mixed in.
- All 6 commits `563668f..026b087` contain **zero** `openspec/**` paths
  (per-commit `git show --name-only` scan: each "clean (0 openspec)").
- Index presence on the test DB (`pg_indexes`, physical table `MOVIMIENTO_AUDITORIA`):

  | Index | Purpose (design.md) |
  |-------|---------------------|
  | `MOVIMIENTO_AUDITORIA_empresaId_fechaHora_id_idx` | default newest-first page |
  | `MOVIMIENTO_AUDITORIA_empresaId_sucursalId_fechaHora_id_idx` | branch/date filter |
  | `MOVIMIENTO_AUDITORIA_empresaId_accion_fechaHora_id_idx` | `accion` equality filter |
  | `MOVIMIENTO_AUDITORIA_empresaId_usuarioId_fechaHora_id_idx` | `usuarioId` equality filter |

  All 4 Slice-A indexes exist (+ `MOVIMIENTO_AUDITORIA_pkey`). ✅

## RLS / Tenancy & Append-Only Audit (source review)

- **Tenant pin (AC-4)**: `consultar-auditoria.repository.ts` builds the `where` from
  `tenantWhere(tenantFilter(ctx), /* omitSucursalId */ true)` — pins `empresaId`, never the
  caller's branch. The `app.current_sucursal_id` GUC is cleared with `SET LOCAL` for the
  company-wide admin read and **restored in `finally`**; the `app.current_empresa_id` GUC
  is never touched. The explicit `empresaId` pin + active RLS are two independent defenses.
- **Server Action (AC-1/AC-5)**: `http/actions.ts` is a thin 3-step adapter (Zod shape →
  session ctx → `withTenantTransaction`). The Admin gate `tieneRolPermitidoEnTx` runs
  **inside** the wrapper **before** the use case. There is no `prisma.*` access outside a
  transaction wrapper; ESLint `systemfact/server-action-must-wrap-tenant` passes. The
  `!ctx.esAdmin` short-circuit in `consultar-auditoria.ts` returns
  `AUDITORIA_NO_AUTORIZADO` before any DB call.
- **Append-only (ADR-016)**: the read repository exposes only `findMany`+`count`; the write
  adapter (`registrar-evento.repository.ts`) exposes only `.create`, runs inside the caller's
  transaction (never its own), and deliberately does not swallow audit-insert failures so a
  rollback also removes the audit row. A module-wide grep found **zero**
  `update`/`updateMany`/`delete`/`deleteMany`/`upsert` calls on `MovimientoAuditoria`. The DB
  has no `UPDATE`/`DELETE` audit policy, proven at runtime by the integration test showing
  app-role `updateMany`/`deleteMany` affect 0 rows while the row survives untouched.
- **Auth LOGIN single-tenant nuance**: `registrarAuditoriaSesion` uses the standalone
  login-flow path (`setLoginFlow` + pin `app.current_empresa_id` to the single resolved
  company, `sucursalId` null). The integration test proves a foreign-company anchor under a
  pinned session GUC is RLS-rejected — the login-flow exception is never widened.

## Pre-Existing Defect Classification

**Test:** `cobros-reembolso.integration.test.ts` → "two simultaneous first submits on one
key: exactly one row, loser stable code".
**Observed (with fase-7a):** `Expected: "fulfilled" / Received: "rejected"` (the concurrent
loser's unique violation propagates instead of resolving to the stable conflict code).
**Reproduction without fase-7a wiring:** the spec test file is byte-identical across the
branch base (`9ae3f22..HEAD` diff shows only `registrar-reembolso.ts` +22 audit lines; the
test file is unchanged). Checking out the pre-7a `registrar-reembolso.ts` from `9ae3f22` and
re-running the race test reproduces the **identical** `fulfilled`→`rejected` failure.

**Root cause (Engram #809):** fase-6 `esConflictoIdempotencia` reads `err.meta.target`, but
`@prisma/client` 7.10 + `@prisma/adapter-pg` deliver `P2002` with no `meta.target`, so the
concurrent loser's unique violation is not recognized as an idempotency conflict.

**Classification:** **PRE-EXISTING (fase-6), NOT caused by fase-7a.** Out of 7a scope
(R-C8 is purely additive; the audit row is proven to be written only after the idempotency
pre-check proves a fresh Pago — the fase-7a `first refund audits once; replay stays
audit-flat` test passes independently). Recommend a dedicated fase-6 hotfix. The working
tree was restored to `HEAD` after the reproduction (verified clean).

## Residual Risks / Warnings (non-blocking)

1. **AC-5 "guard test" form**: the spec phrases AC-5 as "infrastructure layer is inspected
   by a guard test". There is no dedicated source-scanning unit test that reads the repository
   file text. The guarantee is nonetheless fully proven by (a) the UI read-only unit test,
   (b) ESLint tenant-wrap passing, (c) the static grep confirming `findMany`/`count`-only +
   zero mutation API, and (d) the DB-level append-only integration test. Consider adding a
   lightweight source-scan guard in a follow-up if the phrasing is to be taken literally.
2. **AC-1 "Admin opens the screen"** carries no `TEST:` marker in the spec; it is covered
   indirectly (default newest-first read test + UI suite + `page.tsx` server-shell fetch on
   first render). Acceptable but untested as a single named scenario.
3. **E2E smoke for `/auditoria` (task 4.4) skipped** as optional — no `E2E_*` secrets and it
   would exceed the cost bar; UI behavior is covered by the Jest boundary suite.
4. **Pre-existing cobros race** remains red in CI until the fase-6 hotfix lands; it will
   surface on the `cobros` integration job but is unrelated to this change.

## Conclusion

Verdict **PASS**. Implementation matches spec acceptance criteria, design, and tasks.
Recommended next step: **archive** (sync delta specs). The single red test is a documented,
reproduced pre-existing defect and must not block 7A.
