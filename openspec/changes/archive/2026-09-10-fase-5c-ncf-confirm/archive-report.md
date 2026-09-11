# Archive Report: fase-5c-ncf-confirm

**Change**: fase-5c-ncf-confirm — NCF Engine + Sale Confirmation + SALIDA_VENTA
**Archived at**: 2026-09-10 → `openspec/changes/archive/2026-09-10-fase-5c-ncf-confirm/`
**Git ref at close**: `feat/fase-5c-ncf-confirm` @ `9561aa7` (test(venta): fix E2E login label to Spanish UI)
**Artifact store**: openspec (file-based); Engram mirror per hybrid persistence declaration in `openspec/config.yaml`
**Phase**: sdd-archive — terminal record of the cycle

## Status

success — complete archive with zero warnings requiring reconciliation. No CRITICAL verification findings existed at close; no stale unchecked tasks; no intentional partial archive.

## Executive Summary

The change closed the confirm loop for fase-5c: an atomic `confirmarVenta` (branch guard → pure transition → hard stock preview → NCF lock/consume → guarded flip → VIGENTE FACTURA → `SALIDA_VENTA` debits), confirmed-sale cancellation with 608 fiscal semantics (invoice `ANULADA`, stock repositioned, NCF never rewound), B01/B02 eligibility, `pnpm seed:ncf` provisioning, DESC_MAX deterministic reader, and the POS confirm/cancel UI. The four delta specs were merged into the canonical `openspec/specs/*` sources of truth, and the change folder was moved byte-identically to the archive. Final gates at close, all green: unit 66 suites / 585 pass, integration 26 suites / 108 pass (real docker Postgres :5433), `tsc --noEmit` exit 0, `lint` 0 problems, E2E smoke 1/1 passed.

## Final-State Facts (state at close)

Source hierarchy per the Final-State Authority: orchestrator launch prompt (most recent account) > verify-report.md (intermediate snapshot, persisted before the final E2E smoke).

1. **E2E smoke passed live at close** — `confirm-venta.spec.ts` PASSED 1/1 (`pnpm e2e`, 10.3s) on 2026-09-11: login against REAL remote Supabase Auth (project `tcyxwkcrmontkrtbyxfm`, user `e2e@users.systemfact.internal`) + local docker Postgres; draft → confirm → `CONFIRMADA` with NCF; DB observable chain verified (VENTA `CONFIRMADA`, 1 FACTURA `VIGENTE` with ncf matching UI, `NCF_SECUENCIA.secuenciaActual` advanced to the range tail, exactly 1 `MOVIMIENTO_INVENTARIO` `SALIDA_VENTA` with `cantidadNueva < cantidadAnterior`). (Dispatcher final-state fact; outranks the earlier snapshot.)
2. **Smoke fix touched test plumbing only** — the remote Auth login required a data fix (fields in `auth.users` had NULL token columns); the E2E label fix «Password»→«Contraseña» landed as commit `9561aa7`. Feature code was NOT changed by the smoke fix.
3. **Gates at close**: `pnpm test` 66 suites / 585 pass; `pnpm test:integration` 26 suites / 108 pass (real DB docker postgres :5433); `pnpm exec tsc --noEmit` exit 0; `pnpm lint` 0 problems; `pnpm e2e` 1/1 passed.
4. **No pending uncommitted production changes** at close; working branch `feat/fase-5c-ncf-confirm` @ `9561aa7`.
5. **Runtime ledger**: objective `verify-fase-5c-final` SETTLED complete (settle outcome passed, evidence sha256 `fd0948a3670643ff0f3b566b0995e8397b0f5ce1100eb6a2c8f437409a39dce0`).

### Snapshot-to-final reconciliation (no unrankable contradiction)

- Per `verify-report.md` (persisted before the final smoke), the E2E smoke "cannot run unattended in CI... live run gated on external credentials by design; test skips if `E2E_PASSWORD` empty". That claim was true at verification time.
- Final state: the live run subsequently PASSED 1/1 using exactly those seeded credentials (remote Supabase Auth + local docker Postgres), with the login-label fix in commit `9561aa7` and the runtime ledger `verify-fase-5c-final` settled complete. The snapshot's "gated" claim was time-bound; the gate was satisfied before close. Both statements are recorded: the earlier one is historical fact, the final one is the state at close.

## Verification Evidence (Mechanical Copy Contract)

### Spec composition (existing mains — native `gentle-ai sdd-archive-compose`)

```
gentle-ai sdd-archive-compose --canonical openspec/specs/venta/spec.md --delta openspec/changes/fase-5c-ncf-confirm/specs/venta/spec.md --output openspec/specs/venta/spec.md.compose-tmp
→ exit 0, atomic mv applied
gentle-ai sdd-archive-compose --canonical openspec/specs/inventario/spec.md --delta openspec/changes/fase-5c-ncf-confirm/specs/inventario/spec.md --output openspec/specs/inventario/spec.md.compose-tmp
→ exit 0, atomic mv applied
```

### Full-spec copies (no existing main — temp copy + `diff -r` readback)

```
diff -r openspec/changes/fase-5c-ncf-confirm/specs/ncf-engine/spec.md <temp> → diff_exit=0 (empty)
diff -r openspec/changes/fase-5c-ncf-confirm/specs/factura-emision/spec.md <temp> → diff_exit=0 (empty)
```

### Archive move (snapshot + `git mv` + recursive readback vs pre-move snapshot)

```
git mv openspec/changes/fase-5c-ncf-confirm openspec/changes/archive/2026-09-10-fase-5c-ncf-confirm → exit 0 (8 tracked files staged as renames)
diff -r <snapshot>/source openspec/changes/archive/2026-09-10-fase-5c-ncf-confirm → readback_exit=0, EMPTY (byte-identical tree)
```

Empty `diff -r` readbacks are the only passing evidence; all passed. This archive-report.md is additive and was written after the readback, so it is excluded from the comparison.

## Specs Synced (Source of Truth)

| Domain | Action | Details |
|--------|--------|---------|
| venta | Updated (compose) | 14 → 17 requirements: +ADDED R-V15 (Atomic sale confirmation, 4 scenarios), R-V16 (Confirmed-sale cancellation, 2 scenarios), R-V17 (Deterministic DESC_MAX window reader, 1 scenario); MODIFIED R-V13 (error catalog 14 → 19 codes), R-V14 (POS UI confirm control). Unrelated R-V1..R-V12 preserved byte-for-byte. |
| inventario | Updated (compose) | 6 → 8 requirements: +ADDED Confirmed-sale exit batch (3 scenarios), Cancellation reposition batch (1 scenario); MODIFIED Tenant isolation and typed future seams (exit seam now implemented). Others preserved. |
| ncf-engine | Created (full spec copy) | `openspec/specs/ncf-engine/spec.md` — 6 requirements R-N1..R-N6 (consume, composition, 90% threshold, exhaustion, SD expiry, seed). |
| factura-emision | Created (full spec copy) | `openspec/specs/factura-emision/spec.md` — 4 requirements R-F1..R-F4 (gated emission, B01/B02 eligibility, recomputed amounts, derived payment state). |

## Archive Contents

`openspec/changes/archive/2026-09-10-fase-5c-ncf-confirm/` — byte-identical to the active change folder at move time:

- proposal.md ✅
- exploration.md ✅
- specs/venta/spec.md, specs/inventario/spec.md, specs/ncf-engine/spec.md, specs/factura-emision/spec.md ✅
- design.md ✅
- tasks.md ✅ — 46/46 tasks `[x]`, zero unchecked implementation tasks in the archived audit trail (verified by grep on the archived copy)
- verify-report.md ✅ (intermediate snapshot; superseded by final-state facts above where later work changed the state)
- archive-report.md ✅ (this file, additive)

Active `openspec/changes/fase-5c-ncf-confirm/` no longer exists.

## Task Completion Gate

Persisted tasks artifact inspected before any spec sync or move: 46/46 tasks complete (`- [x]`), zero unchecked. No stale-checkbox reconciliation was needed; no intentional override was exercised.

## Rules Applied

- `openspec/config.yaml` has no `rules.archive` entries — nothing additional to apply.
- No delta contains REMOVED/RENAMED sections; no destructive merge warning was required.
- No schema migrations in the change (`git diff --stat` at verification: zero `prisma/migrations`).

## Risks

- **None blocking.** Historical notes for follow-up (unchanged by this archive, recorded per verify-report): CI-unattended E2E still needs a pre-seeded staging environment (`pnpm test:e2e:ci` suggestion); `runInBand` → `maxWorkers: 1` Jest compatibility suggestion; B01 remains local-validation-only V1 (no DGII portal lookup) with corporate 11-digit RNC deferred as an open item for the accountant. All are suggestions/limitations, not open defects.

## Next Recommended

none — SDD cycle complete for fase-5c-ncf-confirm. Next phase belongs to a new change (fase 6 pagos per the roadmap).

## Sources Read (traceability)

- `openspec/changes/fase-5c-ncf-confirm/{proposal,design,tasks,verify-report}.md`
- `openspec/changes/fase-5c-ncf-confirm/specs/{venta,inventario,ncf-engine,factura-emision}/spec.md`
- `openspec/config.yaml`
- Orchestrator launch prompt final-state facts (outrank the verify-report snapshot where later work changed state)