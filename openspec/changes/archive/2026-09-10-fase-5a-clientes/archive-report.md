# Archive Report: fase-5a-clientes

**Date**: 2026-09-10
**Branch**: `feat/fase-5a-clientes`
**Verdict**: PASS
**Status**: Closed

## Executive Summary

Implemented the `cliente` (customer) module for SystemFact: pure domain entity with fiscal ID validation (RNC + cédula, mod-11 weighted), credit rules, CRUD use cases (create, update, list, get, deactivate), multi-tenant repository with optimistic locking, HTTP action adapters (Admin/Operador role-gated), consumidor final (CF) seed + race-safe get-or-create, and a full integration test suite against a live Postgres database with RLS enabled. The change closes the Fase 5a planning phase for the client domain.

## Verification Summary

- **Requirements**: 16/16 compliant (heading-count authoritative: 12 in `cliente/spec.md`, 4 in `client-validators/spec.md`)
- **Scenarios**: 23/23 runtime-covered (heading-count authoritative: 15 in `cliente/spec.md`, 8 in `client-validators/spec.md`)
- **Unit tests**: 460/460 passed, 0 failed
- **Integration tests**: 55/55 passed (real DB `sf-postgres:5433`, RLS on)
- **Lint**: 0 findings
- **TSC**: 0 diagnostics (program-wide `--noEmit`)
- **verify-commit**: `700cbee` fixed stale prose counting (13/20 → 16/23)

Source of truth for counts: heading count from the two delta specs (16 `### Requirement:` + 23 `#### Scenario:`), not the proposal-phase prose.

## Delivery Decision

**Single PR** with all commits — the original 2-PR split plan was collapsed per user confirmation. Size:exception (~4,100 lines total including docs). The `review_budget_lines: 800` threshold was exceeded; delivery strategy resolved to `exception-ok`.

## Ledger Events

1. **GA-hook index corruption crash**: recovered via mixed reset + line-by-line re-verification of all files.
2. **Maintainer-authorized resets ×2**: archive-phase overshoots — `[304/200 precedent apart]` and `pr5a2 2788/2500`. Both authorized by maintainer.

## Applied Decisions of Record

| Decision | Status | Notes |
|----------|--------|-------|
| ADR-014 not applicable to clients | Correction of phase map | No auth-user/synthetic-email creation in the module; session read for tenant context only |
| Credit ⇒ RNC cross-field rule | Added post-decision | `CREDITO_REQUIERE_FISCAL_IDENTIDAD` error when credit enabled without valid fiscal ID |
| CF seed + get-or-create | get-or-create RESERVED 5b seam | `getOrCreateConsumidorFinalEnTx` exports with `tx` param; NO venta logic |
| Admin-only audited credit edits | Enforced server-side | Role gate inside `withTenantTransaction`; zod NOT authoritative for role check |
| Dual defaults | Use case + DDL 0.00/30 | Migration `20260909000000_cliente_credit_defaults` own commit; use-case layer also enforces |
| CF hidden from list/detail | CLIENTE_NO_ENCONTRADO for CF detail | CF protected on mutation: CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO on update/deactivate |
| schema.prisma @@unique drift | DB partial-UK authoritative | Prisma cannot express partial predicate `WHERE (activo = true)`; drift documented in README |

## Deferred / Open of Record

| Item | Phase | Rationale |
|------|-------|-----------|
| 11-digit corporate RNC DV variant | 5b/5c | Requires accountant confirmation of DV algorithm for 11-digit branch codes |
| get-or-create consumption at venta path | 5b | CF seam reserved; venta module consumes in Fase 5b |
| CF excluded from regular CRUD boundary | Traveled by CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO code | Protection proven in integration (b), (e) |
| `docs/13` example anomaly (`131-04567-1`) | Future docs-fix | Example digit inconsistency in glossary documentation |
| Fase 6 CxC (cuentas por cobrar) | Fase 6 | Credit fields storage-only now; CxC module consumes credit limits |

## Artifacts Archived

| Artifact | Path | Size |
|----------|------|------|
| proposal.md | `archive/2026-09-10-fase-5a-clientes/proposal.md` | — |
| design.md | `archive/2026-09-10-fase-5a-clientes/design.md` | — |
| specs/cliente/spec.md | `archive/2026-09-10-fase-5a-clientes/specs/cliente/spec.md` | — |
| specs/client-validators/spec.md | `archive/2026-09-10-fase-5a-clientes/specs/client-validators/spec.md` | — |
| tasks.md | `archive/2026-09-10-fase-5a-clientes/tasks.md` | 17/17 tasks complete |
| verify-report.md | `archive/2026-09-10-fase-5a-clientes/verify-report.md` | Untracked ON PURPOSE; travels with archive commit |
| exploration.md | `archive/2026-09-10-fase-5a-clientes/exploration.md` | — |

## Canonical Specs Created

| Domain | Path | Action |
|--------|------|--------|
| cliente | `openspec/specs/cliente/spec.md` | New canonical (full spec copy; no existing to merge) |
| client-validators | `openspec/specs/client-validators/spec.md` | New canonical (full spec copy; no existing to merge) |

## Engram References

- apply-progress: #712
- verify-report: #715
- decisions: #705, #714
- archive-report: saved as `sdd/fase-5a-clientes/archive-report`

## Archive Verification

- [x] Main specs updated correctly (MD5-verified mechanical copy)
- [x] Change folder moved to archive (byte-identical readback: 7 files, 0 mismatches)
- [x] Archive contains all artifacts (proposal, specs, design, tasks, verify-report, exploration)
- [x] Archived tasks.md has 0 unchecked implementation tasks
- [x] Active changes directory no longer has fase-5a-clientes
- [x] Verbatim readback output included in phase result — PASSED

## Evidence Revision

- verify-report evidence_revision: `sha256:da20525e560a53785000c132e2ddd3b666669fde62678790339f14b1bf35339e`
- Delta range: `d53edc4..700cbee` (HEAD)
- verify-commit: `700cbee` — doc-only remediation of stale 13/20 prose counts to authoritative 16/23 heading counts

## Archive Commit

Conventional `docs(sdd)` archive commit — `--no-verify` per ratified GA defect. Includes verify-report (untracked on purpose, travels with archive commit).
