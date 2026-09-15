```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:026b3c8140ccb23cfc3c975def890f21b8e8743063ee5a95fcade875744154ca
verdict: pass
blockers: 0
critical_findings: 0
requirements: 12/12
scenarios: 32/32
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:dd92b49215b09a0514fbcd8163ffb32d8527101b213199fb007aedc122d01dda
build_command: pnpm build
build_exit_code: 0
build_output_hash: sha256:176fa12f2bd207c2d7d0c03ddbca2442d09eb6ff7f8a0399ea2b461ca129292c
```

# Verify Report: fase-5d-devolucion-b04 (Devoluciones, Nota de Crédito B04)

## Re-verification on current master (evidence envelope)

This section records a fresh, independent verification run on current `master` commit
`83c3b695bd39175c51d315a05dfe98efc97bb358` (HEAD at verification time). Every command was
executed in `app/` and its raw stdout/stderr captured to a file; the `test_output_hash` /
`build_output_hash` in the envelope are the SHA-256 of those exact captured outputs.

- `pnpm lint` → exit 0 (0 problems; sha256 `a6d6ff1c66f0c23d303b894d3878ff2da6ae4d5645282104321902c39cc37673`)
- `pnpm exec tsc --noEmit` → exit 0 (clean; empty output)
- `pnpm test` (unit, jsdom) → exit 0, **71 suites / 642 tests passed** (sha256 `dd92b49215b09a0514fbcd8163ffb32d8527101b213199fb007aedc122d01dda`)
- `pnpm test:integration` (real Postgres 16, `systemfact_app` role, RLS enforced; `sf-postgres`
  healthy on localhost:5433) → exit 0, **29 suites / 112 tests passed** (sha256 `31be1270c244c2691ef78f2150be71b8d1b3a83191961d616cf4ea8e8789c75a`)
- `pnpm build` (`next build`) → exit 0, compiled + 7/7 static pages (sha256 `176fa12f2bd207c2d7d0c03ddbca2442d09eb6ff7f8a0399ea2b461ca129292c`)

`evidence_revision` is the SHA-256 of the HEAD commit-hash string (reproducible identity of the
verified revision). The envelope's `test_*` pair represents the canonical project test command
(`pnpm test`); the integration suite above is additional corroborating evidence for the fiscal
devolucion flows and was also green. Playwright E2E remains CI-secrets-gated and was not executed
locally (unchanged, non-blocking, see "Known honest gaps"). Verdict: **PASS**, no blockers,
no critical findings.

---

**Verdict: PASS** — all requirements verified against merged master (v0.4.0, tag e740b3f).
Artifacts reconciled on branch `sdd/fase-5d-artifact-reconciliation`.

## Verification baseline (at close)

- `pnpm lint`: 0 problems
- `pnpm exec tsc --noEmit`: exit 0
- Unit (jsdom): **71 suites / 642 tests**, all green
- Integration (real Postgres 16, `systemfact_app` role, RLS enforced): **29 suites / 112 tests**, all green, repeatable ×2
- Race suites: zero flakes across ×5 (cumulative/concurrency/idempotencia repeat runs) / ×3 repeats
- E2E happy-path spec (`app/e2e/devolucion.spec.ts`) authored and CI-gated by secrets
  (`E2E_USER`, `E2E_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`):
  **honesty note** — this spec skips locally without `E2E_PASSWORD`; it only executes when
  those secrets exist in the CI environment.

## Requirement verdicts — `specs/devolucion/spec.md`

| Req | Requirement | Verdict | Evidence (tests) |
|-----|-------------|---------|------------------|
| R-D1 | Return only against CONFIRMADA + VIGENTE FACTURA, stable errors, zero writes | ✅ PASS | `app/src/modules/devolucion/application/__tests__/crear-devolucion.spec.ts` (unit: BORRADOR→604, ANULADA FACTURA→603); integration happy path inside `devolucion-cumulative.integration.test.ts` runs against fixed DB states (CONFIRMADA+VIGENTE) |
| R-D2 | Line-level partial returns + cumulative cap | ✅ PASS | `app/src/integration/devolucion-cumulative.integration.test.ts`: scenario A growth within cap succeeds (with pairwise-distinct quantities, see R-D5 note); scenario B exceeds → `CANTIDAD_EXCEDE_ORIGINAL`, zero writes, zero B04 burn |
| R-D2 (concurrency) | Concurrent same-factura returns serialize | ✅ PASS | `app/src/integration/devolucion-concurrency.integration.test.ts` — deterministic same-factura race (venta-lifecycle blocker + `pg_stat_activity` parking on the INVENTARIO row); exactly one winner, loser surfaces 605, no lost update, no negative stock; ×5 / ×3 repeats zero flakes |
| R-D3 | Return window from `PLAZO_DEVOLUCION` config (default 15d SD; missing → hard-fail) | ✅ PASS | covered in slice-1 unit + integration suites (clock/window injection per the real-DB suite recipe; `leerPlazoDevolucionEnTx` from ConfiguracionEmpresa); `DEVOLUCION_FUERA_DE_PLAZO` (601) surfaced as typed error |
| R-D4 | Conditional inventory reversal (VENDIBLE→ENTRADA_DEVOLUCION; DANADO→SALIDA_MERMA), branch match | ✅ PASS | `app/src/integration/devolucion-idempotencia.integration.test.ts` + cumulative suite exercise both `tipoReposicion` flows with before/after quantities at the original branch; branch-match validation in ReturnForm + server-side gate |
| R-D5 | Atomic B04 consumption + idempotent retry | ✅ PASS (amended semantics) | `app/src/integration/devolucion-idempotencia.integration.test.ts` + `app/src/modules/devolucion/application/__tests__/crear-devolucion.spec.ts` (gate unit proof). **Note (approved design deviation):** the idempotency gate is an exact-triple retry check (`productoId, cantidad, tipoReposicion` on a VIGENTE NC of the same factura) via `existeDevolucionIdenticaEnTx`, rejecting with `DEVOLUCION_YA_REGISTRADA` (code 605, catalog census 24) BEFORE the cap check and BEFORE `consumirNcfEnTx` → zero burn/double-consume. A distinct quantity for the same product/factura is a legal cumulative return; consequently two prior NCs of the SAME quantity can never coexist, and the cumulative-cap scenarios use pairwise-distinct quantities. The race loser deterministically surfaces 605 post-lock. |
| R-D6 | NC totals via sale ITBIS calculators + audit rows | ✅ PASS | `app/src/modules/devolucion/domain/__tests__/devolucion.spec.ts` (`calcularTotalesNotaCredito`, Decimal(12,2)/(12,3) via prisma.Decimal); audit appends exercised in the integration suites inside `withTenantTransaction` |
| R-D7 | Tenant isolation (RLS GUCs) + derived ADR-017 balance | ✅ PASS | All devolucion integration suites run through `withTenantTransaction` with RLS GUCs (`app.current_*`); cross-tenant not-found covered by the tenant-isolation suite family; ADR-017 derived balance asserted in `app/e2e/devolucion.spec.ts` (CI) and in the integration happy path |

## Requirement verdicts — deltas of venta / inventario / ncf-engine

| Req | Delta requirement | Verdict | Evidence |
|-----|-------------------|---------|----------|
| R-V13-add | 4 return error codes (601–604) in the `VentaResult` catalog | ✅ PASS | `app/src/modules/venta/domain/errors.ts` — codes 601 `DEVOLUCION_FUERA_DE_PLAZO`, 602 `CANTIDAD_EXCEDE_ORIGINAL`, 603 `FACTURA_NO_VIGENTE`, 604 `VENTA_NO_CONFIRMADA`, plus amended 605 `DEVOLUCION_YA_REGISTRADA` (catalog census 24); stable codes + user messages, no Prisma internals; unit proven via `crear-devolucion.spec.ts` |
| R-V13 | Pinned error catalog | ✅ PASS (pinned + amended to 24 codes with the approved 605 addition) | `errors.ts` census lock in place; exhaustive `estadoVentaDesdeDb` mapping unchanged |
| R-S5-add | `registrarDevolucion` return-inventory primitive | ✅ PASS | `app/src/modules/devolucion/infrastructure/devolucion-repository.ts` (`registrarMovimientoDevolucionEnTx`, ascending-productoId lock order, `MovimientoInventario` with `notaCreditoId` + before/after); exercised in all devolucion integration suites; no Prisma migration (enums already in ERD v4.7); `costoPromedio` untouched |
| R-S5 | Tenant isolation + typed seams | ✅ PASS | return seam now implemented; transfer remains typed-unimplemented; inventory suites unchanged still green |
| R-N6 | Seed provisions B04 range | ✅ PASS | `app/src/integration/seed-ncf.integration.test.ts` (B04 row upserted per empresa+tipoNcf with independent range 201–300); consumed B04 verified in devolucion integration suites (seed 200 → first B0400000201) |
| UI mount | DevolverButton/ReturnForm on CONFIRMADA venta rows | ✅ PASS | jsdom UI tests from PR #30 (`app/src/modules/devolucion/ui/__tests__/return-ui.spec.tsx` + venta DraftList spec updates), within the 71-suite unit run |

## Release evidence

- v0.4.0 tagged at **e740b3f** via release-please PR #35 (squash-merged per CI/CD rule).
- Merged slices: PR #26 (55681b7, slice 1) · PR #28 (d78d938) · PR #29 (2eff6ff) ·
  PR #30 (a05accc, slice 2) · PR #33 (a7eb2be, slice 3 + 605 amendment) · PR #36 (6d20bfe, cleanup).

## Known honest gaps

- E2E devolucion spec is secrets-gated: not executed locally in this session; verdict relies
  on unit + integration coverage plus CI execution when secrets are present.
- Slice-1 task texts describe cumulative-cap-first rejection; the merged runtime ADDS the 605
  exact-triple gate BEFORE the cap/writes (approved amendment, recorded in tasks.md inline).
