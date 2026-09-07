# Archive Report: fase-3-1-producto

**Change**: fase-3-1-producto (Edit & Deactivate Product)
**Archived**: 2026-09-07
**Mode**: hybrid (openspec + engram)
**Verdict**: PASS — CRITICAL-1 remediated and independently confirmed

## Final State

| Metric | Value | Source |
|--------|-------|--------|
| Tasks complete | 19/19 | tasks.md (all `[x]`) |
| Requirements | 5/5 | verify-report |
| Scenarios | 11/11 | verify-report |
| Tests (full suite) | 97/97 | verify-report (fresh run) |
| Tests (focused producto) | 59/59 (6 suites) | verify-report (fresh run) |
| tsc --noEmit | PASS | verify-report (fresh run) |
| eslint | PASS | verify-report (fresh run) |
| CRITICAL findings | 0 | verify-report |
| Blockers | 0 | verify-report |

## What Shipped

- `actualizarProducto` use case: partial edit of nombre, descripcion, precioVenta, ITBIS tasa/vigencia/retencion, codigo, categoria — guarded by optimistic locking (`version` column)
- `desactivarProducto` use case: soft deactivation (`activo=false`), admin-only, with explicit active-reference guard (`PRODUCTO_TIENE_MOVIMIENTOS`)
- Two Server Actions (`actualizarProductoAction`, `desactivarProductoAction`) + zod schemas
- Four new error codes: `PRODUCTO_NO_ENCONTRADO`, `CONCURRENCIA_CONFLICTO`, `PRODUCTO_YA_INACTIVO`, `PRODUCTO_TIENE_MOVIMIENTOS`
- Audit events `producto.updated` (old/new values) and `producto.deactivated` written in-transaction
- Application + HTTP test suites for both use cases

## Deviations from Original Plan

### 1. AccionAuditoria.ELIMINAR → CANCELAR

**What**: The deactivation audit event uses `AccionAuditoria.CANCELAR` as the action type, with `motivo: 'producto.desactivado'` to distinguish soft-deactivation from fiscal-document cancellation.

**Why**: The frozen `AccionAuditoria` enum does not include an `ELIMINAR` value, while `CANCELAR` is already available. Using `CANCELAR` with the structured `motivo` field preserves the soft-deactivation intent without adding a migration or expanding the enum.

**Impact**: None — audit semantics are preserved. The `motivo` field carries the business intent.

### 2. Size Exception (400-line budget)

**What**: The authored diff exceeded the 400-line preflight budget (WARNING-2 in verify-report).

**Why**: User explicitly authorized ignoring the initial 400-line limit to prioritize quality over fragmented PRs. The original forecast was 280–320 lines (Low risk), but the CRITICAL-1 remediation and comprehensive test coverage expanded the diff. Single-PR delivery was retained.

**Impact**: None — reviewer cognitive load was managed through clear file separation and test organization.

### 3. Optimistic Locking Correction (CRITICAL-1)

**What**: `actualizarProducto` was forwarding the freshly-read DB version to `actualizarProductoEnTx` instead of the client-submitted `input.version`, causing stale edits to silently succeed.

**Why**: The initial implementation read the current row's version and passed it to the UPDATE, meaning `WHERE version = <current>` always matched regardless of what the client thought the version was.

**Fix**: `input.version` (client-submitted, validated by zod) now drives the `UPDATE ... WHERE version = ?` end-to-end: HTTP action → application use case → repository. Verified with RED→GREEN empirical proof: the stale-version test fails against the previous implementation and passes against the fixed code.

**Files affected**:
- `app/src/modules/producto/application/actualizar-producto.ts` L240-250
- `app/src/modules/producto/infrastructure/producto-repository.ts` L160-200

**Evidence**: verify-report empirical RED→GREEN proof section; test PROD-011-B.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| producto | Updated | 5 added requirements (REQ-PROD-011 through REQ-PROD-015), 11 scenarios; removed "Full CRUD (update/delete)" from out-of-scope |

### Source of Truth Updated

The following spec now reflects the new behavior:
- `openspec/specs/producto/spec.md`

## Archive Contents

- proposal.md ✅
- specs/ ✅ (producto/spec.md — delta)
- design.md ✅
- tasks.md ✅ (19/19 tasks complete, 0 unchecked)
- verify-report.md ✅ (PASS, CRITICAL-1 remediated)
- apply-progress.md ✅
- exploration.md ✅

## Verification Checklist

- [x] Task Completion Gate passed (19/19 `[x]`)
- [x] CRITICAL-1 in verify-report remediated — independently confirmed with empirical RED→GREEN proof
- [x] Main specs updated correctly (5 new requirements, out-of-scope note removed)
- [x] Change folder moved to archive
- [x] Archive contains all artifacts
- [x] Archived tasks.md has 0 unchecked implementation tasks
- [x] Active changes directory no longer has fase-3-1-producto
- [x] Robocopy byte-identity readback: exit 0 (identical)

## Engram Traceability

- Archive report persisted to Engram: `sdd/fase-3-1-producto/archive-report`
- Artifact observation IDs recorded from Engram reads: N/A (openspec mode — filesystem reads)
