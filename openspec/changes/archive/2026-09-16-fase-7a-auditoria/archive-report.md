# Archive Report — Phase 7A: Audit Consultation (`fase-7a-auditoria`)

- **Change**: fase-7a-auditoria
- **Branch**: `feature/fase-7a-auditoria`
- **Status**: Archived 2026-09-16
- **Release**: v0.6.0 (tag at `317f7e0`)
- **PR**: #46 (merged to `master`)
- **Verdict**: PASS (with non-blocking warnings) → archived

## What Shipped

### New Module: `auditoria`

Full ADR-013 module (`domain/`, `application/`, `infrastructure/`, `http/`, `ui/`) for Admin-only audit log consultation and a shared write seam.

### New Capability: `auditoria-consulta`

Admin-only, paginated, filtered, read-only consultation over `MovimientoAuditoria` at `/auditoria`. Filters combinable: accion, usuario, sucursal, date range, free-text (entidad/idEntidad/motivo only). Company-wide view with optional branch filter. 25 default / max 100 page size.

### Modified Capabilities

- **cobros**: R-C8 — every committed cobro and refund appends exactly one `PAGAR` audit row inside the confirming transaction; idempotent replays must not double-audit.
- **auth**: REQ-AUTH-AUD-001 — successful login appends `LOGIN` row, logout appends `LOGOUT` row; failed logins write nothing.

## Commits

| Commit | Description |
|--------|-------------|
| `563668f` | `chore(prisma): add tenant read indexes on MOVIMIENTO_AUDITORIA` (migration-only, 2 files) |
| `af8fd62` | `feat(auditoria): pure audit domain` (domain errors, timezone, filter, pagination, 3 tests) |
| `1adac24` | `feat(auditoria): read use case + RLS repository` (consultarAuditoria, tenant-scoped query, 10 integration tests) |
| `5480431` | `feat(auditoria): shared append-only write port and Prisma adapter` (AuditoriaWritePort, registrarEventoAuditoriaEnTx) |
| `c050ff0` | `feat(cobros,auth): audit collections, refunds and login/logout via the shared port` (cobros PAGAR, auth LOGIN/LOGOUT, 9 integration tests) |
| `026b087` | `feat(auditoria): add /auditoria consultation screen with filters and pagination (fase-7a slice D)` (UI page, actions, table, filters, 9 UI tests) |
| `4e8e4a1` | `fix(cobros): recognize refund idempotency P2002 under Prisma 7 driver adapter` (**pre-existing race fix — see below**) |

## Verification

- **Verdict**: PASS (pass_with_warnings) — `verify-report.md` with valid `gentle-ai.verify-result/v1` envelope
- **Requirements covered**: 10/10 (AC-1..AC-5, AU-1..AU-3, R-C8, REQ-AUTH-AUD-001)
- **Scenarios covered**: 18/18 (17 TEST-tagged + 1 informational AC-1 "Admin opens the screen")
- **Battery**: tsc clean (0), prisma validate clean (0), `pnpm test` 83 suites / 735 tests (0), auditoria integration 3 suites / 19 tests (0), eslint auditoria module clean (0)
- **Migration isolated**: commit `563668f` is migration-only (schema.prisma + migration.sql, 2 files, 37 insertions)
- **4 indexes verified on test DB**: `(empresaId, fechaHora, id)`, `(empresaId, sucursalId, fechaHora, id)`, `(empresaId, accion, fechaHora, id)`, `(empresaId, usuarioId, fechaHora, id)`

### Pre-Existing Race Defect — FIXED

The `cobros-reembolso` concurrent-first-submit race test (`"two simultaneous first submits on one key: exactly one row, loser stable code"`) failed during verify. Root cause (Engram #809): `esConflictoIdempotencia` reads `err.meta.target`, but `@prisma/client` 7.10 + `@prisma/adapter-pg` deliver P2002 with no `meta.target`, so the concurrent loser's unique violation was not recognized as an idempotency conflict.

**Status: FIXED in commit `4e8e4a1`** (`fix(cobros): recognize refund idempotency P2002 under Prisma 7 driver adapter (read constraint from driverAdapterError.cause)`). This supersedes the `verify-report`'s residual-risk note about the race — the defect is resolved and the test now passes.

## Engram Observations Read

| Observation | Topic | ID |
|-------------|-------|----|
| apply-progress | `sdd/fase-7a-auditoria/apply-progress` | #808 |
| verify-report | `sdd/fase-7a-auditoria/verify-report` | #810 |

## Known Out-of-Scope Follow-Ups

These items are explicitly deferred and NOT part of this change:

| Item | Status | Notes |
|------|--------|-------|
| Event #5 (cierre-caja) | Not built | `caja` module does not exist yet |
| Event #10 (config-fiscal) | Deferred | No module writes it yet; deferred to owning phase |
| Event #12 (roles/permisos) | Deferred | No module writes it yet; deferred to owning phase |
| B03 Nota de Débito audit (#2 partial) | Deferred | V1 with cobros ledger design |
| Exporters | Out of scope | docs/16 §12: audit log never exported in V1 |
| Retention purge | Deferred | 3 years decided, no enforcement; ADR-016 append-only conflict requires explicit carve-out ruling before any DELETE code |
| Optional E2E smoke `/auditoria` (task 4.4) | Skipped | No E2E_* secrets; exceeds <40-line cost bar; UI correctness proven by Jest boundary suite |

## Residual Warnings (Non-Blocking)

1. **AC-5 source-scan guard**: spec phrases AC-5 as "infrastructure layer is inspected by a guard test". No dedicated source-scanning unit test exists. The guarantee is fully proven by (a) UI read-only unit test, (b) ESLint tenant-wrap, (c) static grep confirming findMany/count-only + zero mutation API, (d) DB-level append-only integration test. Consider adding a lightweight source-scan guard in a follow-up if the phrasing is to be taken literally.

2. **AC-1 "Admin opens the screen"**: carries no `TEST:` marker in the spec; covered indirectly by default newest-first read test + UI suite + `page.tsx` server-shell fetch.

3. **Shared audit-helper refactor**: the 8+ fragmented audit-write sites remain untouched (explicit non-goal). The new shared helper is available for future modules. A big-bang refactor is a documented follow-up risk.

## Specs Synced to Canonical

| Domain | Action | Details |
|--------|--------|---------|
| auditoria | Created | Full spec (write-side contract: AU-1, AU-2, AU-3) |
| auditoria-consulta | Created | Full spec (read-side contract: AC-1..AC-5) |
| cobros | Updated | R-C8 appended (collections/refunds audited) |
| auth | Updated | REQ-AUTH-AUD-001 appended (login/logout audited) |

## Archive Contents

```
openspec/changes/archive/2026-09-16-fase-7a-auditoria/
  explore.md
  proposal.md
  design.md
  tasks.md
  verify-report.md
  archive-report.md          ← this file
  specs/
    auditoria/spec.md
    auditoria-consulta/spec.md
    cobros/spec.md
    auth/spec.md
```

## Task Completion Gate

All implementation tasks (1.1–4.5) are marked `[x]` in `tasks.md`. Task 4.4 (optional E2E smoke) is marked `[~]` with documented skip reason. Verification tasks 5.1–5.2 are marked `[ ]` but are stale checkboxes — the verify-report proves spec-coverage walk (5.1) and CI gate (5.2) were completed. Per the orchestrator's explicit final-state facts, these are reconciled as done.

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
