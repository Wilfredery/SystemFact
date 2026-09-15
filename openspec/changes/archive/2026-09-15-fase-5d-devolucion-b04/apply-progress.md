# Apply Progress: fase-5d-devolucion-b04

Reality log per PR slice, as merged to `master`. Complements the engram topic
`sdd/fase-5d-devolucion-b04/apply-progress` (slice 3 detail).

## Slice 1 — Foundation (PR #26, merged 55681b7)

All tasks 1.1–1.10 done in one PR: devolucion domain (pure functions + 4 error-code
constants), application `crearDevolucion` orchestration, infrastructure
`devolucion-repository.ts` (cumulative cap read, `SELECT FOR UPDATE` serialization,
NC + detail + movement writers), thin `devolverVentaAction` + Zod validations,
error codes 601–604 appended to the venta catalog (`VentaResult`, codes 23→24 codes),
venta/helpers for devolucion reads, `PLAZO_DEVOLUCION` config read, B04 seed range
(201–300), and unit tests for pure domain functions.
Support PRs (infrastructure, no task text): PR #28 (d78d938, exact dep pinning + docs),
PR #29 (2eff6ff, deterministic race-test infrastructure).

## Slice 2 — UI + E2E (PR #30, squash a05accc)

Tasks 2.1–2.3 done: `DevolverButton.tsx` + `ReturnForm.tsx` client components mounted on
CONFIRMADA rows of venta `DraftList`, jsdom UI tests, and E2E happy-path spec
`app/e2e/devolucion.spec.ts` asserting NC VIGENTE, B04 sequence advance,
`ENTRADA_DEVOLUCION` stock restore, and ADR-017 derived balance. E2E runs in CI when
secrets (`E2E_USER`, `E2E_PASSWORD`, ...) are present; skips locally otherwise.

## Slice 3 — Critical tests + approved runtime amendment (PR #33, squash a7eb2be)

Tasks 3.1–3.3 done (test-only suites: `devolucion-cumulative`,
`devolucion-concurrency`, `devolucion-idempotencia` integration tests), plus one
approved design deviation against the original slice-1 runtime: R-D5 idempotency was
not implemented in slice 1. Amendment adds error code `DEVOLUCION_YA_REGISTRADA`
(code 605, catalog census 24) and a gate in `crearDevolucion` that rejects an exact
`(productoId, cantidad, tipoReposicion)` triple on a VIGENTE NC of the same factura
via the reader `existeDevolucionIdenticaEnTx`, firing BEFORE the cumulative cap check
and BEFORE `consumirNcfEnTx` (zero B04 burn on retry). Semantics note: a distinct
quantity for the same product on the same factura remains a legal cumulative return.

## Slice 4 — Cleanup (PR #36, squash 6d20bfe)

Tasks 4.1–4.2 done as a docs-only deviation: task 4.1's barrel wording replaced by
`app/src/modules/devolucion/README.md` (no repo module uses `index.ts` barrels) —
interpretation documented inline in tasks.md; JSDoc pass completed; lint/tsc clean.

## Final verification at close

- `pnpm lint`: 0 problems. `pnpm exec tsc --noEmit`: exit 0.
- Unit (jsdom): 71 suites / 642 tests green. Integration (real Postgres 16, RLS):
  29 suites / 112 tests green, repeatable ×2.
- Race suites (`devolucion-concurrency`, plus repeat runs): zero flakes across ×5 / ×3 repeats.
- E2E happy-path spec authored, CI-gated by secrets (skips locally without `E2E_PASSWORD`).
- Released as v0.4.0 (tag at e740b3f via release-please PR #35).
