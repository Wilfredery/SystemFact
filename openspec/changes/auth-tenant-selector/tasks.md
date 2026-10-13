# Tasks: auth-tenant-selector (F1 — admin-only sucusal selector)

SDD phase: **tasks**. Binding inputs: `design.md` D1–D8 (owner-ratified 2026-10-13),
`specs/{tenant,tenant-selector-ui,auth-login-restyle}/spec.md`, `proposal.md` §S1–S5.
Branch: `feature/f1-auth-tenant-selector` off `master`. Delivery: **single-pr**, interactive session, hybrid store.

**Owner release guard (binding, Engram `release/protocolo-manual` #1095):** the final commit
of this change is the version bump ONLY (app/package.json + app/CHANGELOG.md +
.release-please-manifest.json, BOM-free). The S4 catalog-copy edit ships in the S4 commit;
the bump commit must NEVER mix with feature files. The apply report MUST end with the
literal line `bump validated: 0.16.0`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~305–375 non-vendored (owner forecast 300–380) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (6 commits per D8) |
| Delivery strategy | single-pr |
| Chain strategy | stacked-to-main (single feature PR → master; no chain) |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low
```

FFFF-size policy: ~300–380 lines is under the 400 non-vendored budget — **no
`size:exception` is required and none must be flagged**. Trouble threshold only if the
final count lands >400 at PR time.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | S1 backend listing (catalog + port + use case) | PR 1 (commit 1) | `pnpm jest tests/unit/modules/tenant` + tests/integration tenant listing | Jest mocks / Postgres 16 integration | Revert commit 1; no downstream consumer exists yet |
| 2 | S2 backend switch (gates + version++ rewrite) | PR 1 (commit 2) | `pnpm jest tests/unit/modules/tenant tests/integration/modules/tenant` | Jest mocks / Postgres 16 integration | Revert commit 2; S1 untouched |
| 3 | Auth landing (AuthResult extension + redirect branch) | PR 1 (commit 3) | `pnpm jest tests/unit/modules/auth` | Jest + (optional) Playwright landing spec | Revert commit 3; middleware byte-identical |
| 4 | S3 selector screen + S5 shell slot | PR 1 (commit 4) | `pnpm jest tests/unit/app/selector-empresa-sucursal` + Playwright selector suite | Playwright dev server | Revert commit 4; backend slices stand alone |
| 5 | S4 login restyle (cuttable) | PR 1 (commit 5) | `pnpm jest tests/unit/app/login` + LOG-02 e2e | Playwright dev server | Drop contract: revert commit 5 wholesale (LOG-05-B) |
| 6 | Release bump 0.15.0 → 0.16.0 | PR 1 (commit 6) | `pnpm build` + BOM gate byte-check | Node JSON.parse sanity | Not reversible post-merge; bump-only commit |

## Phase 1 — Slice 1: S1 backend listing (commit 1: `feat(tenant): admin-only listing of active empresa sucursals`)

- [ ] 1.1 Create `app/src/modules/tenant/domain/errors.ts` — per-module catalog following `app/src/modules/auth/domain/errors.ts` (read-only, pattern reference): exported constants `TEN_OPS_NO_AUTORIZADO`, `TEN_SUCURSAL_NO_VALIDA`, derived union `TenantErrorCode`, `messageFor` Spanish lookup. Adapters/components never inline text. Covers TEN-CAT-02-A.
- [ ] 1.2 Create `app/src/modules/tenant/infrastructure/repo-sucursal.ts` — Prisma port `listarSucursalesActivas(tx, empresaId): Promise<{ id number; nombre string }[]>` via `sucursal.findMany({ where: { empresaId, activa: true }, select: { id, nombre }, orderBy: { nombre: "asc" } })`. **Schema pin: field is `activa` (design table), the delta spec's generic "activo" wording is resolved by design.** Narrow select, no deep tenant data.
- [ ] 1.3 Create `app/src/modules/tenant/application/listarSucursalesDeEmpresa.ts` — exported type `ListarSucursalesResult = { ok: true; sucursales: readonly SucursalResumen[] } | { ok: false; code: TenantErrorCode; message: string }`. Signature `listarSucursalesDeEmpresa(ctx, tx, deps?)`: **no empresa/sucursal scope parameters exist in the surface** (TEN-LIST-01-B, enforced by typecheck); deny-before-read when `!ctx.esAdmin` → TEN_OPS_NO_AUTORIZADO (TEN-LIST-01-C); empty active set → `{ ok: true, sucursales: [] }` (TEN-LIST-03-A); scope derived exclusively from `ctx.empresaId`; `ctx.sucursalId` carried for the UI current-branch marker on slice 4.
- [ ] 1.4 Write jest unit tests (no DB): non-admin deny with stable code + messageFor copy (TEN-CAT-02-A), empty-result success (TEN-LIST-03-A), message-never-leaks-ids assertion.
- [ ] 1.5 Write jest integration test against real query semantics: admin sees active B1,B2 but not inactive B3 and not other empresas' branches with where-clause `{ empresaId: ctx.empresaId, activa: true }` and narrow select (TEN-LIST-01-A).
- [ ] 1.6 Verification block (gate): `pnpm lint` + strict `tsc` + `pnpm jest tests/unit/modules/tenant tests/integration/modules/tenant` green.
- [ ] 1.7 Rollback boundary: revert commit 1 only — no consumer exists yet.

## Phase 2 — Slice 2: S2 backend switch (commit 2: `feat(tenant): switch active sucursal for admins`)

- [ ] 2.1 Create `app/src/modules/tenant/application/cambiarSucursalActiva.ts` — exported type `CambiarSucursalResult = { ok: true } | { ok: false; code: TenantErrorCode; message: string }`, signature `cambiarSucursalActiva(ctx, { sucursalId }, tx)` per D4, ordered gates inside the single `withTenantTransaction` opened by the http adapter (never nested):
  1. Role gate `!ctx.esAdmin` → `TEN_OPS_NO_AUTORIZADO` (server-side deny-by-default).
  2. Idempotent short-circuit `input.sucursalId === ctx.sucursalId` → `{ ok: true }`, **no write, no audit** (TEN-SWITCH-04-E).
  3. Target validation `tx.sucursal.findFirst({ where: { id: input.sucursalId, empresaId: ctx.empresaId, activa: true } })` → null ⇒ `TEN_SUCURSAL_NO_VALIDA` for BOTH foreign-empresa and inactive targets (merged deliberately — cross-tenant unobservability, TEN-SWITCH-04-B/D).
  4. Persistence per D1: `tx.usuario.update({ where: { id: ctx.usuarioId }, data: { sucursalId: input.sucursalId, version: { increment: 1 } } })` — one row, `version++` optimistic-lock ledger (TEN-SWITCH-04-A).
  5. Return `{ ok: true }`; ZERO audit rows (REQ-AUTH-AUD-001 untouched), no `app.is_login_flow` widening, no synthetic email reads, no new tokens/enums/free strings.
- [ ] 2.2 Create `app/src/modules/tenant/http/actions.sucursal.ts` — thin adapter: zod-validate `sucursalId` as int → delegate to the use case → return the typed result; the switch form triggers navigation per D2 on `ok`. Zero business logic (AGENTS.md).
- [ ] 2.3 Write jest unit tests with mock tx: all five gates (non-admin deny 04-C, idempotent no-op no-write 04-E, foreign+inactive shared code 04-B/D, version increment asserted on update input, no audit call).
- [ ] 2.4 Write jest integration test: after a confirmed switch a subsequent user-row read resolves the NEW sucursalId and the audit table gained no LOGIN row (TEN-SWITCH-04-A behavior-level).
- [ ] 2.5 Verification block: `pnpm lint` + `tsc` + targeted `pnpm jest tests/unit/modules/tenant tests/integration/modules/tenant` green.
- [ ] 2.6 Rollback boundary: revert commit 2; commit 1 unaffected.

## Phase 3 — Slice 3: auth landing (commit 3: `feat(auth): post-login landing for multi-branch admins`)

- [ ] 3.1 Extend `AuthResult` success payload in `app/src/modules/auth/application/auth-service.ts` per D2/ratified D1/D2: add `esAdmin: boolean` and `activeBranchCount: number`; execute one cheap `sucursal.count({ where: { empresaId: usuario.empresaId, activa: true } })` inside the **same login bootstrap window** (R1.B unaffected — this IS the login flow; no `app.is_login_flow` widening, no new auth API; count runs only AFTER credentials verified + `sub` bound + enlace ok).
- [ ] 3.2 Edit `app/src/modules/auth/http/actions.login.ts` `login()`: after successful `loginWithCredenciales` redirect to `/selector-empresa-sucursal` ONLY when `esAdmin && activeBranchCount > 1`; otherwise `/dashboard`. **Non-admin fast path preserved** (`esAdmin=false` → `/dashboard` regardless of count, doc 17 §5); single-branch admin → `/dashboard`. Middleware `app/middleware.ts` stays byte-identical.
- [ ] 3.3 Audit existing e2e/tests that assert "admin lands on /dashboard" and update honestly: keep the assertion for single-branch admin, add the multi-branch-admin alternative rather than deleting a passing scenario (design risk 3).
- [ ] 3.4 Write jest unit tests for the redirect branch: `esAdmin=false` → `/dashboard`; admin `activeBranchCount=1` → `/dashboard`; admin `activeBranchCount>1` → `/selector-empresa-sucursal`.
- [ ] 3.5 Post-switch anchor (consumed by slice 4, D2): switch success navigates to `/dashboard` — documented here, implemented in 4.4.
- [ ] 3.6 Verification block: `pnpm lint` + `tsc` + targeted `pnpm jest tests/unit/modules/auth` + **`pnpm build` (first build gate of the change, per D8 commits 3–4)** green.
- [ ] 3.7 Rollback boundary: revert commit 3; login contract reverts; middleware untouched throughout.

## Phase 4 — Slice 4: S3 selector screen + S5 shell slot (commit 4: `feat(tenant-ui): selector-empresa-sucursal page and shell trigger`)

- [ ] 4.1 Create `app/src/shared/version-plan.ts` — NEW pure module exporting `resolvePlanForVersion(): "free"` (typed constant return). The page imports the seam; nothing inlines the string. No Plan model/schema anywhere (SEL-PLAN-03-A).
- [ ] 4.2 Create `app/src/app/(app)/selector-empresa-sucursal/data.ts` — server loader: `getCurrentTenantContext(supabase)` null ⇒ `redirect("/login")` (SEL-ROUTE-01-A; layout already guards — loader re-check is defense in depth); `ctx.esAdmin === false` ⇒ `redirect("/dashboard")` (SEL-ROUTE-01-B, non-admins never receive selector markup); then exactly ONE `withTenantTransaction(ctx, tx => listarSucursalesDeEmpresa(ctx, tx))` — no nesting, plain data only, zero client business logic.
- [ ] 4.3 Create `app/src/app/(app)/selector-empresa-sucursal/page.tsx` — board 02 composition from F0 primitives only (`app/src/components/ui/*`: Card frame, Select, Button "Confirmar", Badge): `empresaNombre` rendered once as a static read-only heading, never selectable (P6, SEL-RENDER-02-A); active branches exactly the S1 result with current branch preselected/marked (SEL-RENDER-02-B); static "free" badge read via `app/src/shared/version-plan.ts`; empty state = message + confirm unrendered (SEL-EMPTY-04-A); F0 semantic tokens only, light-only, zero zinc/indigo/hex/dark: classes (SEL-RENDER-02-C); touch: ≥44px targets, 8px rhythm, keyboard reachable in DOM order.
- [ ] 4.4 Create the minimal switch confirm component next to the page (client, interactivity only): calls the thin action from `2.2` with `{ sucursalId }`, disables on first submit, navigates to `/dashboard` on `ok` per D2 (SEL-NAV-06-A/B — header re-resolves server-side; no dead route, session kept, no re-login).
- [ ] 4.5 Edit `app/src/shared/ui/app-shell/shell.tsx` (lines 49–58, D6): replace the placeholder `<span aria-disabled>` inside the existing `{esAdmin && …}` server branch with a real `next/link` `<Link href="/selector-empresa-sucursal" data-testid="cambiar-sucursal">` — accessible name "Cambiar sucursal", hitbox ≥44px, token classes, not `aria-disabled`. Non-admin render path behavior unchanged (SEL-SLOT-05-B); sidebar's eight modules and placeholders untouched.
- [ ] 4.6 Write jest unit tests: version seam returns "free" and page imports it; empty-state branch (confirm unreachable); primitives/tokens-only review hook for SEL-RENDER-02-C.
- [ ] 4.7 Write Playwright e2e: SEL-ROUTE-01-A/B guards; SEL-RENDER-02-A/B; SEL-SLOT-05-A/B (trigger navigates; non-admin shell unchanged); SEL-NAV-06-A/B (post-switch lands `/dashboard` showing "Sucursal <new>", session kept).
- [ ] 4.8 Verification block: `pnpm lint` + `tsc` + targeted `pnpm jest tests/unit/app/selector-empresa-sucursal tests/unit/shared` + `pnpm build` + BOM grep `rg --fix-string-removal` equivalent (see 6.2 grep command) over the NEW files' encoding soundness — full: `pnpm build && pnpm jest` alias for the touched suites.
- [ ] 4.9 Rollback boundary: revert commit 4; slices 1–3 stand alone; header falls back to placeholder semantics only by revert.

## Phase 5 — Slice 5 (cuttable): S4 login restyle (commit 5: `feat(auth-ui): login screen board-01 restyle`)

- [ ] 5.1 Edit `app/src/app/login/layout.tsx` (if present) and `app/src/app/login/page.tsx` — board 01 presentational restyle ONLY: F0 semantic tokens; strip every `zinc-*`/`indigo-*`/`slate-*`/hex/`dark:` class (LOG-04-A). Zero auth logic changes (LOG-05-A).
- [ ] 5.2 Edit `app/src/app/login/page.tsx` — exactly two credential fields: `nombreUsuario` (label "Usuario", `autoComplete="username"`, autofocus kept, Enter submits) and `password` (label "Contraseña", `autoComplete="current-password"`, type password). NO email field, NO synthetic suffix (`@users.systemfact.internal`) on screen anywhere (LOG-01-A). `isPending` → disabled + "Ingresando…"; submit ≥44px, ≥8px separation from the error box (LOG-04-B).
- [ ] 5.3 Edit `app/src/modules/auth/domain/errors.ts` — catalog-copy only: `AUTH_ERROR_MESSAGES[AUTH_CREDENCIALES_INVALIDAS]` becomes exactly `"Credenciales inválidas"` (single source of truth for user-facing copy; code, union, silence-about-cause semantics untouched; LOG-02-A/B hold; `AUTH_USUARIO_INACTIVO` keeps its existing copy). Single message-only edit in this file.
- [ ] 5.4 Write adapter-level jest copy-pin test: the mapped message equals the exact string "Credenciales inválidas" (guards the shipped surface).
- [ ] 5.5 Render "Recuperar contraseña" as a link-styled inert element (F1 has no recovery flow): visible, keyboard-reachable, ≥44px hitbox, `tabIndex=0`, `aria-disabled="true"`, title "Disponible próximamente" (LOG-03-A). No backend recovery endpoint.
- [ ] 5.6 Escape hatch check (commit gate): if the restyle cost rises above trivial, DROP the slice entirely per LOG-05-B (S1–S3/S5 remain fully implementable; the catalog edit then rides the bump commit or is dropped with the slice — decide before commit 5, never mix into 6).
- [ ] 5.7 Verification block: `pnpm lint` + `tsc` + `pnpm jest tests/unit/app/login` + grep LOG-04-A (`rg '(zinc-|indigo-|#[0-9a-fA-F]{3,6}|dark:)' src/app/login` → zero matches) + one cross-check build (`pnpm build`).
- [ ] 5.8 Rollback boundary: revert commit 5 wholesale; login behavior was already correct pre-slice.

## Phase 6 — Slice 6: release bump 0.15.0 → 0.16.0 (commit 6: `chore(release): 0.16.0`)

- [ ] 6.1 Edit ONLY the 3 release files, as the change's final commit and never mixed with feature files (owner release guard): `app/package.json` `0.15.0` → `0.16.0`; `.release-please-manifest.json` → same version; `app/CHANGELOG.md` entry. Commit message exactly `chore(release): 0.16.0`.
- [ ] 6.2 BOM gate (PR #59 CI-break rule): write machine-consumed files with `[IO.File]::WriteAllText()` + `UTF8Encoding($false)` (never PowerShell 5.1 `Set-Content -Encoding UTF8`), then verify `bytes[0] -ne 0xEF` on all three files, e.g. `rg '^\xEF' <file>` byte-probe or `[IO.File]::ReadAllBytes(<file>)[0] -cne 0xEF` for `app/package.json`, `.release-please-manifest.json`, `app/CHANGELOG.md`.
- [ ] 6.3 Mandatory gate step: confirm in the apply/report output the literal final line `bump validated: 0.16.0` — the gatekeeper requires it before the PR.
- [ ] 6.4 Final verification block (change-level): `pnpm lint` + strict `tsc` + targeted jest for the whole diff + `pnpm build` fully green on `feature/f1-auth-tenant-selector`; then PR → CI full matrix (ESLint, typecheck, prisma validate, unit, integration vs Postgres 16 w/ RLS, build, conventional-commits guard) must be green before human squash merge.
- [ ] 6.5 Rollback boundary: bump-only commit; not merged without the 6.3 gate.

## Traceability quick map (spec scenario → task)

TEN-LIST-01-A/B/C → 1.2/1.3/1.4/1.5 — TEN-CAT-02-A → 1.1/1.4 — TEN-LIST-03-A → 1.3/1.4 —
TEN-SWITCH-04-A → 2.1/2.3/2.4 — 04-B/D → 2.1/2.3 — 04-C → 2.1/2.3 — 04-E → 2.1/2.3 —
SEL-ROUTE-01-A/B → 4.2/4.7 — SEL-RENDER-02-A/B/C → 4.3/4.6/4.7 — SEL-PLAN-03-A → 4.1/4.6 —
SEL-EMPTY-04-A → 4.3/4.6 — SEL-SLOT-05-A/B → 4.5/4.7 — SEL-NAV-06-A/B → 4.4/4.7 —
LOG-01-A → 5.2 — LOG-02-A/B → 5.3/5.4 — LOG-03-A → 5.5 — LOG-04-A/B → 5.1/5.2/5.7 —
LOG-05-A/B → 5.1/5.6.
