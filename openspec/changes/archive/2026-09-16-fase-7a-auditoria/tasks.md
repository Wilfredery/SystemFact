# Tasks: Phase 7A — Audit Consultation

## Review Workload Forecast

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High
```

| Field | Value |
|-------|-------|
| Estimated changed lines | ~890 (Slices A–D below) |
| 400-line budget risk | High (configured budget 800) |
| Chained PRs recommended | No |
| Suggested split | Single PR, four internal slices |
| Delivery strategy | single-pr + size:exception (maintainer-approved, like fase 6) |

- Slice A: ~180 lines (migration + domain + unit tests), own commit structure.
- Slice B: ~260 lines (use case + repository + integration tests).
- Slice C: ~280 lines (port + cobros/auth wiring + integration tests).
- Slice D: ~170 lines (UI page, form, tests).
- Decision needed before apply: No — `size:exception` already maintainer-approved.
- Chained PRs recommended: No.

### Threat-matrix RED tests
Design matrix: all rows `N/A` (Next.js page/action only; no shell, VCS, or PR boundaries). Nothing to stage.

## Slice A: Prisma indexes + auditoria domain (own commits)

- [x] 1.1 **Own commit (migration-only, never mixed)**: add 4 indexes to `app/prisma/schema.prisma` on `MovimientoAuditoria` — `(empresaId, fechaHora, id)`, `(empresaId, sucursalId, fechaHora, id)`, `(empresaId, accion, fechaHora, id)`, `(empresaId, usuarioId, fechaHora, id)` — and generate a separate Prisma migration. Verify `prisma validate`.
- [x] 1.2 Create `app/src/modules/auditoria/domain/`: `AuditoriaFiltro` (accion?, usuarioId?, sucursalId?, desde?, hasta?, texto?, page≥1, pageSize 25 default/max 100), `AccionAuditoria` usage from Prisma enums, date range in `America/Santo_Domingo` → UTC conversion helper.
- [x] 1.3 Domain pure functions: filter normalization, pageSize clamp to 100, page mapping (`fechaHora DESC, id DESC`), `AuditoriaPagina` DTO mapping (rows, total, page, pageSize, totalPages), free-text target fields = `entidad`/`idEntidad`/`motivo` only (never `valorAnterior`/`valorNuevo`).
- [x] 1.4 Error catalog: stable `AUDITORIA_NO_AUTORIZADO` + `AUDITORIA_VALIDACION` (code + user message + minimal context; no internals).
- [x] 1.5 Unit tests (Jest, no DB): normalization, clamp, DTO mapping, error codes, timezone conversion.
- [x] 1.6 Commit Slice A domain + tests (`feat(auditoria): ...`).

## Slice B: Read use case + repository + integration tests

- [x] 2.1 `application/consultarAuditoria.ts`: typed result/error use case, admin gate contract.
- [x] 2.2 `infrastructure/`: Prisma adapter `consultarAuditoriaEnTx` via `withTenantTransaction` (set GUCs, `tenantWhere(tenantFilter(ctx))` pinning `empresaId`), local clear + restore of `app.current_sucursal_id` in `finally` for company-wide read; ordered `findMany` + `count` only — NO create/update/delete.
- [x] 2.3 Integration tests (real Postgres 16, RLS, `systemfact_app`): cross-tenant isolation (A sees zero B rows); non-admin denial → `AUDITORIA_NO_AUTORIZADO`; combined filters (accion ∧ user ∧ SD-day range, no payload hit); 250-row pagination page 2 = 26–50, clamp 500→100, total 250; empty page 0-total; beyond-end page → empty, no error; append-only guard test.
- [x] 2.4 Commit Slice B (`feat(auditoria): read use case + RLS repository`).

## Slice C: Shared write port + cobros/auth wiring

- [x] 3.1 Export `AuditoriaWritePort` from `auditoria/application`; `infrastructure` adapter `registrarEventoAuditoriaEnTx(tx, ctx, event)` (runs inside caller's tx; enum accion, UTC `fechaHora`, optional sucursal/motivo/values).
- [x] 3.2 `cobros`: inject port — exactly one `PAGAR` row per committed cobro/refund, referencing the new Pago; write strictly after idempotency pre-check proves a new `Pago`; replay (`PAGO_IDEMPOTENCIA_CONFLICTO`) and `COBRO_EXCEDE_SALDO` paths write zero audit rows.
- [x] 3.3 `auth`: standalone-path LOGIN/LOGOUT writes (direct Prisma tx post-identity: set login-flow + `app.current_empresa_id`, insert with resolved ids, `sucursalId=null`, restore in `finally`, then complete session action). Failed/logout-only-success discipline: failed login writes nothing.
- [x] 3.4 Integration tests: helper appends one scoped row; committed cobro once; refund replay audit-flat; rejected payment writes nothing (Pago + audit both absent); login row, logout row, failed login silent (no row).
- [x] 3.5 Commit Slice C (`feat(auditoria): shared write port + cobros/auth wiring`).

## Slice D: UI page `/auditoria`

- [x] 4.1 `app/src/app/auditoria/page.tsx` server shell: redirect unauthenticated, pass admin ctx; thin Server Action in `auditoria/http` (Zod validate, `withTenantTransaction`, admin gate).
- [x] 4.2 `auditoria/ui`: server component table (newest-first, total, pagination identical to cobros board) + client filter form (accion, usuario, sucursal, date range, free text).
- [x] 4.3 UI test: filter submission, loading/error/table/page nav, no mutation controls. `pnpm lint` incl. `systemfact/server-action-must-wrap-tenant`.
- [~] 4.4 Optional cheap E2E smoke for `/auditoria` when `E2E_*` secrets exist (skips with notice otherwise). **SKIPPED (optional)** — a smoke test needs admin-login + seeded audit rows, exceeding the <40-line natural-cost bar; UI correctness is proven by the Jest boundary suite instead.
- [x] 4.5 Commit Slice D (`feat(auditoria): consultant UI`), final verify: typecheck + full Jest + Playwright-when-configured.

## Verification (Phase 5)

- [ ] 5.1 Spec coverage walk: AC-1…AC-5, AU-1…AU-3, R-C8, REQ-AUTH-AUD-001 scenarios each map to a passing test.
- [ ] 5.2 CI gate green on PR; confirm migration commit is isolated from feature commits.
