# Apply Progress: fase-3-1-producto (Edit & Deactivate Product)

Artifact store: `openspec`. Delivery: single PR, `size-exception` (user-authorized
budget reset — see verify-report WARNING-2). All 19 planned tasks are complete;
this artifact records cumulative state, ratified deviations, and the CRITICAL-1
focused remediation requested after the first verify.

## Cumulative task state

All tasks in `tasks.md` are `[x]`:

- Phase 1 (Foundation — errors & repository): 1.1–1.8 ✅
- Phase 2 (Use cases, TDD RED→GREEN): 2.1–2.4 ✅
- Phase 3 (Server actions, TDD RED→GREEN): 3.1–3.4 ✅
- Phase 4 (Verification): 4.1–4.3 ✅

## Ratified deviations from tasks/design

### DEV-1 — Audit action `ELIMINAR` → `CANCELAR` (task 1.7)

- **Task text**: 1.7 names `AccionAuditoria.ELIMINAR` for the deactivation audit row.
- **Implemented as**: `AccionAuditoria.CANCELAR` in
  `app/src/modules/producto/infrastructure/producto-repository.ts`
  (`registrarProductoDesactivadoEnTx`, referenced by the `DESIGN DEVIATION`
  comment near L426).
- **Reason**: the frozen DB enum `AccionAuditoria` (Prisma schema) has no
  `ELIMINAR` value, and adding one requires a migration — explicitly out of
  scope for this change. `CANCELAR` is the closest legal semantic (retire
  without destruction). Soft-delete semantics are preserved: the product row is
  never removed, only `activo=false`.
- **Identifiability**: the event stays distinguishable from a fiscal document
  cancellation via `entidad="Producto"` + `idEntidad=<productoId>` +
  `valorAnterior={activo:true}` / `valorNuevo={activo:false}` +
  `motivo="producto.desactivado"`.
- **Follow-up (optional)**: consider a dedicated enum value or an English event
  key in a later change (see verify-report SUGGESTION-1).

## CRITICAL-1 remediation — optimistic locking was inert

**Defect (verify-report CRITICAL-1):** `actualizarProducto` forwarded
`current.version` (the version just re-read inside the same transaction) to
`actualizarProductoEnTx` instead of the client-submitted `input.version`.
The resulting `UPDATE ... WHERE version = <value read from the same row>`
always matched, so a stale edit silently succeeded with last-write-wins data
loss, and `CONCURRENCIA_CONFLICTO` was reachable only on a microsecond race.
The PROD-011-B unit test masked this because it mocked
`actualizarProductoEnTx` to return `{updated:false}` unconditionally and never
asserted the forwarded version argument.

**Fix (task-bounded, no scope growth):**
- `app/src/modules/producto/application/actualizar-producto.ts` — the
  `actualizarProductoEnTx(...)` call now passes `input.version` (client version)
  as the expected-version argument, so the `UPDATE ... WHERE version` check is
  driven by the version the caller edited against. A stale submission yields
  `{updated:false}` → `CONCURRENCIA_CONFLICTO`. Chosen over an app-level
  read-compare to keep contention resolution inside the transaction via the
  verified `UPDATE ... WHERE` (AGENTS.md concurrency rule).
- `app/src/modules/producto/application/actualizar-producto.test.ts`:
  - PROD-011-B rewritten as a **faithful stub** of the real `WHERE version`
    clause: `actualizarProductoEnTx` returns `updated:true` only when the
    forwarded version equals the stored version (5), plus a direct assertion
    that the call receives `input.version` (2). This is the test that
    **failed against the pre-fix implementation** (received version 5).
  - PROD-011-A happy path now also pins the forwarded version (regression
    guard, verify-report SUGGESTION-3).
  - No tests were deleted.

### TDD evidence

| Test | RED (pre-fix) | GREEN (post-fix) |
|------|---------------|------------------|
| `PROD-011-B` (asserts forwarded version + faithful stale stub) | FAIL: `toHaveBeenCalledWith(..., 2, ...)` → received `..., 5, ...` | PASS |

### Focused test command & result

- `pnpm exec jest src/modules/producto/application/actualizar-producto.test.ts`
  → 13/13 passed.
- `pnpm exec jest --testPathPattern=producto` → 6 suites / 59 tests passed.
- `pnpm exec tsc --noEmit` → exit 0.
- `pnpm exec eslint` on the two changed files → exit 0.

### Files changed in this remediation

| File | Action | What changed |
|------|--------|--------------|
| `app/src/modules/producto/application/actualizar-producto.ts` | Modified | Forward `input.version` (not `current.version`) into the optimistic-lock UPDATE |
| `app/src/modules/producto/application/actualizar-producto.test.ts` | Modified | Faithful stale-version stub + version-forwarding assertions (RED→GREEN) |

Runtime remediation authority bound to failed evidence revision
`sha256:dd2a889a057e4e1d7554e03cae10f161b2e0aff3d8d5844a1b6e85a78c3fede9`.
Authored diff ≈ 1 production line + comment and ≈ 40 test lines — well under the
2000-line runtime cap. No commit/PR performed (per instruction).
