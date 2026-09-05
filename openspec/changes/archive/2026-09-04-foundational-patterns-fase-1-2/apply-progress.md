# Apply Progress: foundational-patterns-fase-1-2

**Change**: foundational-patterns-fase-1-2
**Batch**: Phase 1 (WU4 cleanup) + Phase 2 (WU1 wrapper) + Phase 3 (WU2 ESLint rule) + Phase 4 Slice 4-A (WU3 Producto domain + ITBIS migration) + Phase 4 Slice 4-B (WU3 Producto infrastructure + application) + Phase 4 Slice 4-C (WU3 Producto HTTP adapters + REQ-LINT-003 conflict resolution)
**Mode**: Standard (strict_tdd=false)
**Date**: 2026-09-02 (Phases 1–3) · 2026-09-03 (Phase 4 Slices 4-A + 4-B + 4-C)
**Agent**: sdd-apply-calidad-precio
**Delivery**: auto-chain, stacked-to-main, review budget 400 lines → Phase 4 (~650 LOC) split into 3 stacked sub-slices (4-A domain, 4-B infra+application, 4-C http+lint).

## Completed Tasks

### Phase 1 — WU4 cleanup
- [x] 1.1 Create `app/src/modules/auth/domain/synthetic-email.ts`
- [x] 1.2 Modify `app/src/modules/auth/infrastructure/auth-service.ts`
- [x] 1.3 Modify `app/src/modules/tenant/infrastructure/tenant-runtime.ts`
- [x] 1.4 Modify `app/src/modules/tenant/domain/tenant.ts` (narrow + remove dead code)
- [x] 1.5 Modify `app/src/modules/tenant/domain/tenant.test.ts` (update affected tests)
- [x] 1.6 Modify `app/scripts/probe-set-local.ts` (test 3 update)

### Phase 2 — WU1 wrapper
- [x] 2.1 Create `app/src/modules/tenant/infrastructure/withTenantTransaction.ts`
- [x] 2.2 Create `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts`
- [x] 2.3 Create `app/tools/scripts/verify-rls.ts`
- [x] 2.4 Modify `app/package.json` (add `rls:verify` script)
- [x] 2.5 Modify `docs/19-directivas_desarrollo.md` (add wrapper convention)

### Phase 3 — WU2 ESLint rule (completed in this apply run)
- [x] 3.1 Create `app/tools/eslint-plugin-systemfact/package.json`
- [x] 3.2 Create `app/tools/eslint-plugin-systemfact/index.ts`
- [x] 3.3 Create `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts`
- [x] 3.4 Create `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts`
- [x] 3.5 Modify `app/eslint.config.mjs` (register plugin)
- [x] 3.6 Create + delete `app/src/modules/_example/actions.ts` (ephemeral rule verification)

> Note: files for 3.1–3.5 were already present on disk from a prior interrupted
> pass; this run verified them against the spec (rule test: 8/8 pass), then
> completed the only genuinely-remaining task, 3.6 (end-to-end verification via
> an ephemeral `actions.ts` fixture that was created, flagged by `eslint`, and
> deleted). The stale "Remaining Tasks" list below (from the Phase 1+2 batch) is
> superseded by this section.

### Phase 4 — Slice 4-A (WU3 Producto domain + ITBIS migration)

This run is the first of three stacked sub-slices for Phase 4 (~650 LOC total, split
to respect the 400-line review budget). Slice 4-A = the pure/fiscal foundation:
ITBIS-validity schema migration + the `producto/domain/*` layer. It has NO dependency
on the repository/application/http layers or on the `withTenantTransaction` wrapper, so
it lands independently onto `main` and unblocks 4-B/4-C.

Prior interrupted pass already wrote these files to disk (untracked). This run VERIFIED
each against `specs/producto/spec.md` and design §2, confirmed zero drift that needs a
code change, authored the missing docs note, and locked evidence.

- [x] 4.1 Prisma migration `20260902160000_add_itbis_validity_to_producto/migration.sql` — verified: adds `itbisVigenteDesde NOT NULL` (default `2012-01-01`), `itbisVigenteHasta NULL`, `itbisAplicaRetencionITBIS NOT NULL DEFAULT false` to `PRODUCTO`; explicit idempotent backfill `UPDATE`; down block present (commented per Prisma convention). (tasks index 4.1)
- [x] 4.3 `producto/domain/producto.ts` — verified: `TasaItbis = '0'|'16'|'18'`, `ProductoItbis` VO, `Producto` entity (`precioVenta: Decimal`, derived `exento`), `buildProductoItbis` rejects `vigenteHasta < vigenteDesde` (PROD-003-B), pure (Decimal type-only import). (tasks index 4.3)
- [x] 4.4 `producto/domain/errors.ts` — verified: all 7 spec error codes + `NO_AUTORIZADO`/`SESION_INVALIDA` for http, `ProductoErrorCode` union, `messageFor`, `ProductoDomainError`. (tasks index 4.4)
- [x] 4.5 `producto/domain/calcular-itbis.ts` — verified: pure `calcularItbisProducto`, all-Decimal, DGII formula `base * tasa / 100`, negative qty throws `CANTIDAD_INVALIDA`, zero/exento short-circuit. (tasks index 4.5)
- [x] 4.6 `producto/domain/calcular-itbis.test.ts` — verified: 7 tests, exact DGII fixtures (18/16/0, mixed cart, precision, zero, negative). (tasks index 4.6)
- [x] 4.15 `docs/21-evaluacion_por_fases_prisma.md` — ADDED subsection "Vigencia ITBIS por producto (WU3)" rows 1.42–1.44 documenting the columns, the `2012-01-01` backfill rationale (last general rate-change year), and the down-migration note. This was the only genuinely-missing authored deliverable this run. (tasks index 4.15 / detailed task 4.13)
- [x] 4.2 Apply migration locally + verify backfill — VERIFIED 2026-09-03 (local Postgres up at `localhost:5433`). `prisma migrate status` → **9 applied, "Database schema is up to date!"**. Live-DB probe of `PRODUCTO`: the three ITBIS columns exist with the migration's exact constraints — `itbisVigenteDesde TIMESTAMPTZ NOT NULL DEFAULT '2012-01-01 00:00:00+00'`, `itbisVigenteHasta TIMESTAMPTZ NULL`, `itbisAplicaRetencionITBIS BOOLEAN NOT NULL DEFAULT false`. `prisma migrate diff --from-config-datasource --to-schema` emits **no `ADD COLUMN`** (columns present; only a benign `DROP DEFAULT` on the backfill defaults, which the datamodel intentionally omits because the app layer sets them). `PRODUCTO` row count = 0, so the backfill is vacuously correct and DEFAULT-guaranteed for any pre-existing rows at apply time. Run-only task — no file authored, no commit.

### Phase 4 — Slice 4-B (WU3 Producto infrastructure + application)

Second stacked sub-slice. Depends on Slice 4-A (domain + migration) and the WU1
`withTenantTransaction` wrapper. Scope: the Producto Prisma repository (sole Prisma
access point) and the `crear-producto` / `listar-productos` application use cases with
their unit tests, plus the AGENTS.md wrapper/ESLint documentation (task 4.14). The
HTTP adapters (`validations.ts`, `actions.ts`) are Slice 4-C and were NOT touched.

The four code files already existed on disk from a prior interrupted pass and were
green, but verification against `specs/producto/spec.md` + design §4 exposed ONE real
architectural defect, which this run fixed:

- [x] 4.7 `producto/infrastructure/producto-repository.ts` — verified + FIXED: it is now
      the SOLE Prisma access point. Added `registrarProductoCreadoEnTx` and
      `registrarProductoListadoEnTx` (append-only `movimientoAuditoria.create`, REQ-PROD-010)
      so audit writes no longer live in the application layer. Confirmed `select`-only,
      `orderBy: { codigo: 'asc' }`, `skip=(page-1)*limit`, `take=limit`, and every read
      filters by `empresaId` (REQ-PROD-006).
- [x] 4.8 `producto/application/crear-producto.ts` — verified + FIXED: replaced the inline
      `tx.movimientoAuditoria.create` (application-layer Prisma call — violation of the
      "Prisma only in infrastructure" rule) with a call to the repository audit helper; and
      removed a duplicated message map, now using the canonical `messageFor` from
      `domain/errors`. Validation order (tasa → precio → vigencia → duplicate) returns typed
      `Err(code)`; happy path returns `Ok({ producto })` (REQ-PROD-005).
- [x] 4.9 `producto/application/listar-productos.ts` — verified + FIXED: same audit
      delegation; `Promise.all` over count+list (no N+1); validates `limit` 1–100 and `page ≥ 1`
      (REQ-PROD-006 edge cases).
- [x] 4.10 `crear-producto.test.ts` — updated to the audit-to-infra refactor: the repository
      mock now exposes `registrarProductoCreadoEnTx`, and the "audit emitted" assertion checks
      that helper instead of a direct `tx.movimientoAuditoria.create`. 5 scenarios (happy,
      duplicate, invalid tasa, invalid price, invalid vigencia) pass.
- [x] 4.11 `listar-productos.test.ts` — same refactor: mocks `registrarProductoListadoEnTx`;
      assertions moved off the raw tx. 5 scenarios (page1, page2, empty, limit>100, page<1) pass.
- [x] 4.14 `AGENTS.md` wrapper-requirement documentation — the `withTenantTransaction` bullet
      already existed from the Phase 1 batch; this run added the defense-in-depth reference to
      the ESLint rule `systemfact/server-action-must-wrap-tenant` (detailed task 4.14
      acceptance: "AGENTS.md mentions the ESLint rule"). The plugin wiring itself was already
      done in task 3.5 (`eslint.config.mjs`, scoped to `src/**/actions.ts(x)`), so the
      index-4.14 "document split" note is satisfied: shared plugin wiring lives in 3.5,
       Producto HTTP-specific wiring lands with 4-C.

### Phase 4 — Slice 4-C (WU3 HTTP adapters + REQ-LINT-003 conflict resolution)

Third and final stacked sub-slice for Phase 4. Scope: the HTTP layer only —
`producto/http/validations.ts` (task 4.12) and `producto/http/actions.ts`
(task 4.13) — plus resolution of the ESLint conflict documented since Phase 3
and carried through Slices 4-A/4-B (the ONLY slice where it belongs). No prior-phase
or unrelated audit files were touched.

Both files existed on disk from a prior interrupted pass. Verification against
`specs/producto/spec.md` REQ-PROD-007/008 + AGENTS.md surfaced ONE real defect
and the KNOWN lint conflict:

- [x] 4.12 `producto/http/validations.ts` — VERIFIED, no change needed. Both zod
      schemas match REQ-PROD-007/008 exactly: `zCrearProductoInput` (categoriaId
      int+positive, codigo/nombre trim 1–255, descripcion optional trim ≤255,
      precioVenta decimal regex `^\d+(\.\d{1,2})?$`, itbisTasa enum `'0'|'16'|'18'`,
      itbisVigenteDesde coerced date, itbisVigenteHasta nullable+optional coerced
      date, itbisAplicaRetencionITBIS boolean default false) and
      `zListarProductosQuery` (page int≥1 default 1, limit int 1–100 default 25,
      descripcion optional, incluirInactivos coerced boolean default false).
- [x] 4.13 `producto/http/actions.ts` — VERIFIED + FIXED. Two defects corrected:
      (1) **Prisma-in-HTTP violation**: the adapter's local `autorizado()` ran a
      `tx.usuario.findUnique` directly in `http/`, breaking AGENTS.md "Data access
      ONLY via Prisma from `infrastructure/`". Moved the role lookup into the
      repository as `tieneRolPermitidoEnTx(tx, usuarioId, roles)` (sole Prisma
      access point) and the adapter now calls it inside the wrapper. (2) Replaced
      the `Prisma.Decimal` value import with the application layer's canonical
      `Decimal` from `@prisma/client/runtime/client`. The adapter remains a thin
      wrapper: zod safe-parse → resolve ctx from session (auth read) → single
      `withTenantTransaction(ctx, …)` → server-side role gate (Admin/Operador for
      create per REQ-PROD-007; any authenticated role for list per REQ-PROD-008) →
      delegate to use case → map typed `Err` / DTO to `ActionResult`. No duplicated
      wrapper (each action opens exactly one; use cases accept the injected `tx`
      per Slice 4-B Deviation #5 — no `NestedTenantTransactionError`).
- [x] **REQ-LINT-003 conflict — RESOLVED.** The rule demands `withTenantTransaction`
      be the LITERAL first statement, but the tenant context MUST be resolved from
      the Supabase session (`getCurrentTenantContext`, an auth read that opens its
      own login-flow transaction per ADR-019 — not tenant-DB business access) before
      it can be passed as the wrapper's first argument. A literal-first-statement
      shape is therefore impossible without changing the WU1 wrapper signature. Chosen
      resolution: **documented per-line `// eslint-disable-next-line
      systemfact/server-action-must-wrap-tenant`** on each exported action — the
      escape hatch explicitly sanctioned by REQ-LINT-005 / Scenario LINT-005-B and
      already used in `auth/http/actions.ts`. This keeps WU2 (Phase 3) rule + tests
      untouched (zero regression to prior phases) while preserving the actual security
      invariant: authorization + every Prisma call run inside the wrapper. Full
      `pnpm lint` now exits 0 (was 2 findings). Alternative (relax REQ-LINT-003 to
      "wrapper before any DB access") deliberately NOT taken: it would have weakened
      the guard for every future action and required editing Phase-3 tests, which is
      outside the Slice 4-C file boundary.
- [x] 4.14 (index) — CONFIRMED. Shared plugin wiring lives in `eslint.config.mjs`
      (task 3.5, glob `src/**/actions.ts(x)`); Producto HTTP-specific wiring needs no
      extra config — the new `http/actions.ts` is already covered by that glob, which
      is exactly why it was flagged before this resolution.

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `app/src/modules/auth/domain/synthetic-email.ts` | Created | Single source of truth for synthetic email encode/decode |
| `app/src/modules/auth/infrastructure/auth-service.ts` | Modified | Imports synthetic-email helpers from domain |
| `app/src/modules/tenant/infrastructure/tenant-runtime.ts` | Modified | Imports decode from domain; removes null branch |
| `app/src/modules/tenant/domain/tenant.ts` | Modified | `TenantCtx.sucursalId: number`; `TenantFilter` simplified |
| `app/src/modules/tenant/domain/tenant.test.ts` | Modified | Removed null/company-scope tests |
| `app/src/modules/tenant/infrastructure/tenant-where.ts` | Modified | Updated to non-scoped `TenantFilter` (implicit dependency) |
| `app/scripts/probe-set-local.ts` | Modified | Test 3 uses `sucursalId: 1` |
| `app/src/modules/tenant/infrastructure/withTenantTransaction.ts` | Created | Wrapper with GUC setup + nested detection |
| `app/src/modules/tenant/infrastructure/withTenantTransaction.test.ts` | Created | Integration test run via tsx |
| `app/tools/scripts/verify-rls.ts` | Created | Smoke test for BYPASSRLS, role, pool mode |
| `app/package.json` | Modified | `rls:verify` points to `tools/scripts/verify-rls.ts` (merged with audit changes) |
| `app/jest.config.js` | Modified | Ignores `withTenantTransaction.test.ts` from Jest (implicit) |
| `docs/19-directivas_desarrollo.md` | Modified | Added §3.1 wrapper convention |
| `AGENTS.md` | Modified | Cross-linked wrapper requirement |
| `app/tools/eslint-plugin-systemfact/package.json` | Created | Plugin manifest (3.1) — verified against spec |
| `app/tools/eslint-plugin-systemfact/index.ts` | Created | Plugin entry exporting the rule (3.2) — verified |
| `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts` | Created | Custom ESLint rule (3.3) — verified, 8/8 tests pass |
| `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts` | Created | RuleTester suite: 5 valid + 3 invalid (3.4) |
| `app/eslint.config.mjs` | Modified | Registers `systemfact` plugin + enables rule on `src/**/actions.ts(x)` (3.5) |
| `app/src/modules/_example/actions.ts` | Created then Deleted | Ephemeral fixture for 3.6 rule verification; NOT committed |
| `app/prisma/migrations/20260902160000_add_itbis_validity_to_producto/migration.sql` | Verified (pre-existing) | ITBIS validity + retention columns + backfill (4.1); down block commented per Prisma convention |
| `app/prisma/schema.prisma` | Verified (pre-existing) | `Producto` model has `itbisVigenteDesde`/`itbisVigenteHasta`/`itbisAplicaRetencionITBIS`; generated client consistent |
| `app/src/modules/producto/domain/producto.ts` | Verified (pre-existing) | `TasaItbis` frozen enum, `ProductoItbis` VO, `Producto` entity, `buildProductoItbis` vigencia validation (4.3) |
| `app/src/modules/producto/domain/errors.ts` | Verified (pre-existing) | 7 spec error codes + auth codes, `ProductoDomainError`, `messageFor` (4.4) |
| `app/src/modules/producto/domain/calcular-itbis.ts` | Verified (pre-existing) | Pure DGII ITBIS calc, all-Decimal (4.5) |
| `app/src/modules/producto/domain/calcular-itbis.test.ts` | Verified (pre-existing) | 7 tests: 18/16/0 rates, mixed cart, precision, zero, negative qty (4.6) |
| `docs/21-evaluacion_por_fases_prisma.md` | Modified (this run) | Added §Vigencia ITBIS rows 1.42–1.44: columns, `2012-01-01` backfill rationale, down-migration note (4.15/4.13) |
| `app/src/modules/producto/infrastructure/producto-repository.ts` | Modified (Slice 4-B) | Added `registrarProductoCreadoEnTx` + `registrarProductoListadoEnTx`; now the sole Prisma access point (4.7) |
| `app/src/modules/producto/application/crear-producto.ts` | Modified (Slice 4-B) | Audit delegated to repo (removed application-layer `prisma` call); uses canonical `messageFor` (4.8) |
| `app/src/modules/producto/application/listar-productos.ts` | Modified (Slice 4-B) | Audit delegated to repo; `Promise.all` count+list (4.9) |
| `app/src/modules/producto/application/crear-producto.test.ts` | Modified (Slice 4-B) | Mocks `registrarProductoCreadoEnTx`; audit assertion moved off raw tx (4.10) |
| `app/src/modules/producto/application/listar-productos.test.ts` | Modified (Slice 4-B) | Mocks `registrarProductoListadoEnTx`; audit assertion moved off raw tx (4.11) |
| `AGENTS.md` | Modified (Slice 4-B) | Wrapper bullet extended with `systemfact/server-action-must-wrap-tenant` ESLint-rule reference (4.14) |
| `app/src/modules/producto/http/validations.ts` | Verified (Slice 4-C, pre-existing) | `zCrearProductoInput` + `zListarProductosQuery` zod schemas match REQ-PROD-007/008 exactly — no change (4.12) |
| `app/src/modules/producto/http/actions.ts` | Modified (this run, Slice 4-C) | Removed Prisma-in-http `autorizado()` (now `tieneRolPermitidoEnTx`); `Prisma.Decimal`→`Decimal`; documented `// eslint-disable-next-line` on both actions resolving the REQ-LINT-003 conflict; thin wrapper, single `withTenantTransaction`, server-side role gate (4.13) |
| `app/src/modules/producto/infrastructure/producto-repository.ts` | Modified (Slice 4-C) | Added `tieneRolPermitidoEnTx(tx, usuarioId, roles)` — role lookup relocated OUT of `http/` into the sole Prisma access point (additive; does not alter 4-B behavior/tests) |

## Work Unit Evidence

### Phase 1 (WU4 cleanup)

| Evidence | Result |
|---|---|
| Focused test command | `pnpm test src/modules/tenant/domain/tenant.test.ts` — exit 0, 11 tests passed |
| Runtime harness | `npx tsx scripts/probe-set-local.ts` — exit 0, all 4 tests passed |
| Rollback boundary | 7 files: synthetic-email.ts (new), auth-service.ts, tenant-runtime.ts, tenant.ts, tenant.test.ts, tenant-where.ts, probe-set-local.ts |

### Phase 2 (WU1 wrapper)

| Evidence | Result |
|---|---|
| Focused test command | `npx tsx src/modules/tenant/infrastructure/withTenantTransaction.test.ts` — exit 0, 3 scenarios passed |
| Runtime harness | `pnpm rls:verify` — exit 0, role `systemfact_app` has BYPASSRLS=false; local pooling warning is expected for `localhost:5433`, while production requires transaction-mode pooling |
| Rollback boundary | 6 files: withTenantTransaction.ts (new), withTenantTransaction.test.ts (new), verify-rls.ts (new), package.json, jest.config.js, 19-directivas_desarrollo.md |

### Phase 3 (WU2 ESLint rule)

| Evidence | Result |
|---|---|
| Focused test command | `pnpm test tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.test.ts` — exit 0, 8 tests passed (5 valid + 3 invalid) |
| End-to-end rule check (3.6) | `pnpm lint src/modules/_example/actions.ts` (ephemeral fixture) — fixture violating action flagged with `systemfact/server-action-must-wrap-tenant`; correctly-wrapped `return await withTenantTransaction(...)` NOT flagged (no false positive). No ESLint configuration error → REQ-LINT-005-A satisfied. Fixture then deleted. |
| Full lint | `pnpm lint` — loads config with no error; reports 2 findings in `src/modules/producto/http/actions.ts` (Phase 4 / WU3 file, out of Phase 3 scope — see Deviations). |
| Rollback boundary | 5 files: tools/eslint-plugin-systemfact/package.json, index.ts, rules/server-action-must-wrap-tenant.ts, rules/server-action-must-wrap-tenant.test.ts, eslint.config.mjs |

### Phase 4 — Slice 4-A (WU3 domain + ITBIS migration)

| Evidence | Result |
|---|---|
| Focused test command | `pnpm test src/modules/producto/domain/calcular-itbis.test.ts` — exit 0, **7/7** DGII fixtures pass (18%→9000, 16%→160, 0%→0, mixed cart, decimal precision, zero, negative-throws) |
| Full suite (no regression) | `pnpm test` — exit 0, 7 suites / **39 tests** pass (was 11 pre-Phase-4; domain adds 7, application mocks already present add the rest) |
| Type check | `pnpm tsc --noEmit` — exit 0 |
| Lint (domain-slice boundary) | `npx eslint src/modules/producto` — only 2 findings, both in `http/actions.ts` (Slice 4-C file). Domain/schema/docs in this slice are lint-clean. |
| Migration application | `npx prisma migrate status` — **PASS** (task 4.2, 2026-09-03): 9 migrations applied, "Database schema is up to date!" at `localhost:5433`. `prisma migrate diff --from-config-datasource --to-schema` → no `ADD COLUMN` (columns present). Live `information_schema` probe confirms the three ITBIS columns with `NOT NULL DEFAULT` (`2012-01-01` / `false`); `PRODUCTO` row count = 0 → backfill vacuously correct. |
| Rollback boundary | 7 files: producto/domain/{producto,errors,calcular-itbis,calcular-itbis.test}.ts, prisma/migrations/20260902160000_.../migration.sql, prisma/schema.prisma (ITBIS cols), docs/21 note. Removable without touching 4-B/4-C (those are separate stacked PRs). |

### Phase 4 — Slice 4-B (WU3 infrastructure + application)

| Evidence | Result |
|---|---|
| Focused test command | `pnpm test src/modules/producto/` — exit 0, **17/17** across 3 suites (domain 7 + crear-producto 5 + listar-productos 5) |
| Application-layer test command | `pnpm test src/modules/producto/application/` — exit 0, **10/10** use-case unit tests (mocked repository) |
| Type check | `pnpm tsc --noEmit` — exit 0 |
| Layering check | `grep tx.(producto\|movimientoAuditoria\|usuario)\. src/modules/producto/application/*.ts` — no matches (Prisma no longer reached from application). Repository is the sole Prisma access point. |
| Lint (Slice 4-B boundary) | `npx eslint src/modules/producto/application src/modules/producto/infrastructure` — exit 0, clean. (The 2 remaining `producto` findings are in `http/actions.ts`, a Slice 4-C file — untouched, see Deviations.) |
| Full suite (no regression) | `pnpm test` — exit 0, 7 suites / **39 tests** (unchanged from Slice 4-A baseline; refactor preserved all scenarios) |
| Changed-line estimate | ~110 reviewable lines (additions+deletions) across 6 files — within the 400-line budget |
| Rollback boundary | 6 files: producto-repository.ts, crear-producto.ts, listar-productos.ts, crear-producto.test.ts, listar-productos.test.ts, AGENTS.md. Depends on Slice 4-A (domain + migration) + WU1 wrapper; removable without touching 4-C `http/`. |

### Phase 4 — Slice 4-C (WU3 HTTP adapters + lint-conflict resolution)

| Evidence | Result |
|---|---|
| Focused lint (the conflict) | `npx eslint src/modules/producto` — exit 0, CLEAN. The 2 prior `systemfact/server-action-must-wrap-tenant` findings in `http/actions.ts` are gone after the documented `eslint-disable-next-line` (REQ-LINT-005 exception) |
| Full lint | `pnpm lint` (`npx eslint .`) — exit 0, CLEAN. Phase 3's cross-phase red run is now fully resolved |
| Focused test command | `pnpm test src/modules/producto/` — exit 0, **17/17** (domain 7 + crear-producto 5 + listar-productos 5). Adding the repository authz export did not touch the mocked use-case tests |
| Type check | `pnpm tsc --noEmit` — exit 0 |
| Layering check | `http/actions.ts` contains no `tx.<model>.` / `prisma.<model>.` call — Prisma now only via `producto-repository` (sole access point); authorization delegated to infra helper inside the wrapper |
| Full suite (no regression) | `pnpm test` — exit 0, 7 suites / **39 tests** (unchanged baseline; WU2 rule tests still pass untouched, proving no Phase-3 regression) |
| Changed-line estimate | ~169 reviewable lines for the 4-C PR (validations 24 + actions 123 + repository delta ~22) — within the 400-line budget |
| Rollback boundary | 3 files: http/validations.ts (verified only), http/actions.ts (modified), producto-repository.ts (additive). Depends on Slices 4-A + 4-B + WU1 wrapper. Fully reversible without touching any prior-phase or unrelated audit file. NOT committed (per instruction). |

## Additional Verification

- `pnpm tsc --noEmit` — exit 0 (Phases 1–3 snapshot and re-confirmed in Slice 4-A)
- `pnpm test` — Phases 1–3: exit 0, 11 tests. Slice 4-A re-run: exit 0, **39 tests** (Producto domain + application specs on disk now execute alongside prior suites).

## Deviations from Design

1. `TenantFilter` scope removed entirely (design kept `scope: "branch"`). Task instructions explicitly recommended removing scope; `tenantWhere` was updated accordingly.
2. `tenant-where.ts` and `jest.config.js` were modified to keep the build green and `pnpm test` passing, even though they were not in the explicit task list.
3. (Slice 4-A) Decimal is imported from `@prisma/client/runtime/client`, not `runtime/library` as the design prose (task 4.2/4.4) suggests. This is correct for the installed Prisma 7: the entire generated client under `src/generated/prisma` uses `runtime/client`, and `tsc --noEmit` + Jest resolve it. Design prose is version-stale; code is authoritative. No change made.
4. (Slice 4-A) The migration's down block is present but commented out (Prisma convention — down migrations are manual). REQ-PROD-009 "down preserves integrity" is satisfied for pre-production (no dependent data), consistent with design §3.6. No change made.
5. (Slice 4-B) Use-case signature is `crearProducto(tx, ctx, input)` / `listarProductos(tx, ctx, query)` — the transaction is injected by the HTTP layer's `withTenantTransaction` (Slice 4-C `actions.ts`), not opened inside the use case. The detailed tasks 4.7/4.8 prose literally specify `crearProducto(ctx, input)` opening the wrapper, but (a) the already-locked Slice 4-C `actions.ts` calls `crearProducto(tx, ctx, ...)` and (b) a use case that opened `withTenantTransaction` would NEST inside the action's wrapper and trip `NestedTenantTransactionError`. The injected-tx form satisfies REQ-PROD-005 acceptance ("all DB operations run inside `withTenantTransaction`") because the injected `tx` IS the wrapper's transaction. Left as-is to keep 4-C coherent and the build green; flagged for the 4-C lint-conflict resolution (see Issue below).
6. (Slice 4-B) Moved the `movimientoAuditoria.create` audit writes OUT of the application layer and INTO the repository (`registrarProductoCreadoEnTx` / `registrarProductoListadoEnTx`). Rationale: the on-disk use cases called Prisma directly in `application/`, violating AGENTS.md ("Data access ONLY via Prisma from `infrastructure/`") and task 4.6 ("ALL Prisma access is ONLY in this file"). Also removed the ad-hoc `"CREAR" as unknown as AccionAuditoria` casts in favour of the typed `AccionAuditoria.CREAR` / `.ACTUALIZAR` enum members. The listing read emits `accion = ACTUALIZAR` (the frozen `AccionAuditoria` enum has no read/list member and is out of scope to extend); `entidad = "Producto"` for both events to keep the catalog queryable. Tests updated accordingly.
7. (Slice 4-C) The on-disk `http/actions.ts` ran authorization (`tx.usuario.findUnique`) directly in the HTTP adapter — a Prisma-in-`http/` violation of AGENTS.md and the "thin adapter" rule. Fixed by moving the role lookup into `producto-repository.ts` as `tieneRolPermitidoEnTx(tx, usuarioId, roles)` (infrastructure remains the sole Prisma access point) and calling it from within the wrapper. This is the ONLY reason a Slice 4-B file (repository) changed in the 4-C slice; the edit is purely additive and leaves all existing 4-B functions, tests, and behavior untouched. Also switched the DTO price construction from a `Prisma.Decimal` value import to `Decimal` from `@prisma/client/runtime/client`, matching the application layer's canonical import (Slice 4-A Deviation #3 rationale). No design change required — this restores conformance.
8. (Slice 4-C) REQ-LINT-003 "wrapper as literal first statement" is architecturally unsatisfiable for tenant DB actions because the `TenantCtx` must first be resolved from the Supabase session and passed as the wrapper's first argument. Resolved with a documented per-line `eslint-disable` (sanctioned by REQ-LINT-005 / LINT-005-B, precedent in `auth/http/actions.ts`) rather than editing the WU2 rule, to avoid regressing Phase 3. The security invariant (all authz + DB inside the wrapper) is preserved. Recorded as a design tension for the verify phase to consider relaxing REQ-LINT-003 in a future change.

## Issues Found

The local direct PostgreSQL connection intentionally warns because transaction-mode pooling is a production-only requirement. Role and BYPASSRLS validation remain mandatory in every environment.

### Phase 3 cross-phase interaction (surfaced for Phase 4 / verify)

`pnpm lint` (full project) now exits non-zero due to 2 findings in
`app/src/modules/producto/http/actions.ts` (`crearProductoAction`, `listarProductosAction`).
Those files are **Phase 4 (WU3)** deliverables and were intentionally NOT touched in
this Phase 3 batch. The findings are genuine and expected: Task 4.12 specifies
`zod parse → build ctx → withTenantTransaction(...)` (validation/session work happens
BEFORE the wrapper), while the rule's REQ-LINT-003 requires `withTenantTransaction` to be
the literal first statement. Phase 4 must reconcile this — either hoist the wrapper to the
first statement, or add a documented `// eslint-disable-next-line systemfact/server-action-must-wrap-tenant`,
or the design should relax REQ-LINT-003 to "wrapper appears before any DB access". Flagged
so the Phase 4 apply/verify step resolves it deliberately rather than discovering a red lint run late.

> **Slice 4-A update (2026-09-03):** Re-confirmed `npx eslint src/modules/producto` still
> reports exactly these 2 findings, both in `http/actions.ts` (lines 51, 92). The conflict
> does **NOT** fall inside Slice 4-A (domain + migration), so it was deliberately left
> unresolved per the slice boundary. It is assigned to **Slice 4-C** (Producto http layer).
> > decision should be a dedicated WU2 change, not folded into a Producto HTTP slice.

> **Slice 4-C resolution (2026-09-03):** RESOLVED. Chose the documented per-line
> `// eslint-disable-next-line systemfact/server-action-must-wrap-tenant` on both
> `crearProductoAction` and `listarProductosAction` — the exception explicitly
> sanctioned by REQ-LINT-005 / Scenario LINT-005-B and already precedented in
> `auth/http/actions.ts`. Rationale for NOT relaxing the rule: it lives in Phase 3
> (WU2) with passing RuleTester tests, so editing it crosses the Slice 4-C file
> boundary and risks regressing a completed, locked work unit; a future WU2 change
> is the right home if "wrapper before any DB access" is preferred. The substantive
> fix that DID land here is architectural: the adapter's direct `tx.usuario.findUnique`
> (Prisma in `http/`) was relocated to the repository (`tieneRolPermitidoEnTx`), so
> tenant-DB access and the role gate now both run inside the single wrapper.
> **`pnpm lint` now exits 0** (was 2 findings since Phase 3).

## Remaining Tasks

Phase 4 split into three stacked sub-slices (review budget 400, stacked-to-main):

**Slice 4-A — DONE this run** (see §Phase 4 Slice 4-A above): 4.1, 4.3, 4.4, 4.5, 4.6, 4.15.
- [x] 4.2 Apply migration locally + verify backfill — DONE 2026-09-03 (local Postgres up at `localhost:5433`): `prisma migrate status` = 9 applied / up-to-date; live-DB probe confirms the three ITBIS columns with `NOT NULL DEFAULT`s and `PRODUCTO` row count = 0 → backfill vacuously correct. No file, no commit.

**Slice 4-B — DONE this run** (see §Phase 4 Slice 4-B above): 4.7, 4.8, 4.9, 4.10, 4.11, 4.14.
- Fixed the one real defect surfaced by verification: Prisma audit access moved out of the
  application layer into the repository (sole-access rule). Tests updated; full suite green.

**Slice 4-C — WU3 http adapters + lint-conflict resolution — DONE this run** (see §Phase 4 Slice 4-C above): 4.12, 4.13, 4.14 (index).
- [x] 4.12 `producto/http/validations.ts` — verified against REQ-PROD-007/008, no change.
- [x] 4.13 `producto/http/actions.ts` — verified + fixed: Prisma-in-http authorization relocated to the repository (`tieneRolPermitidoEnTx`); canonical `Decimal` import; thin single-wrapper adapter with server-side role gate.
- [x] **REQ-LINT-003 lint conflict — RESOLVED** with a documented per-line `eslint-disable` (REQ-LINT-005 exception). `pnpm lint` exits 0.
- [x] 4.14 (index) confirmed: shared plugin wiring is in task 3.5 (`eslint.config.mjs`, `src/**/actions.ts(x)` glob); Producto HTTP is already covered — no extra wiring.

All Phase 4 sub-slices (4-A + 4-B + 4-C) are now complete, and the previously
deferred task 4.2 (apply migration locally + verify backfill) was VERIFIED on
2026-09-03 now that the local Postgres is healthy at `localhost:5433`
(`prisma migrate status` = 9 applied / up-to-date; live-DB probe confirms the
three ITBIS columns with their `NOT NULL DEFAULT`s; `PRODUCTO` row count = 0 →
backfill vacuously correct). **All 32 tasks are complete.** Nothing is committed
(per instruction); the stacked-to-main chain for Phase 4 = PR(4-A) → PR(4-B) →
PR(4-C).

## Native Runtime Settlement

- **Token**: sha256:16a0cc7ea0f7879033e104cfe612ad3d8c8d381c66349af8e9bed58b9a7e69c1
- **Evidence revision**: 743204716d84827f29e5455b74717c32a2fb46af
- **Outcome**: passed
- **Diagnosis**: All 11 tasks implemented; type check, Jest, probe, and integration test pass; `rls:verify` passes locally.
- **Harness disposition**: reused
