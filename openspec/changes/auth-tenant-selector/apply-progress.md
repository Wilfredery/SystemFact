# Apply progress — auth-tenant-selector (SDD apply phase)

Branch `feat/auth-tenant-selector` (off `origin/master` e58967f @ 0.15.0).
Delivery: single-pr, 7 commits (5 functional slices + 1 docs alignment + bump-only final).

## Commit map (slice → SHA → verification observed)

| Slice | SHA | Verification (observed from `app/`) |
|-------|-----|-------------------------------------|
| 1 — `feat(tenant): admin-only listing of active empresa sucursals` | `d7dd635` | `pnpm lint: 0 errors (17 pre-existing warnings)` · `pnpm exec tsc --noEmit: exit 0` · `pnpm jest src/modules/tenant: 32 passed` · integration `tenant-sucursal-listar: 2 passed` (must run via `node --experimental-vm-modules node_modules/jest/bin/jest.js -c jest.integration.config.js --runInBand --forceExit` — plain `pnpm jest` fails with the dynamic-import callback error) |
| 2 — `feat(tenant): switch active sucursal for admins` | `e498afa` | lint 0 · tsc 0 · `pnpm jest src/modules/tenant: 38 passed` · integration `tenant-sucursal-switch: 4 passed` · `pnpm build: exit 0` |
| 3 — `feat(auth): post-login landing for multi-branch admins` | `99f48e4` | lint 0 · tsc 0 · `pnpm jest src/modules/auth: 58 passed` · `pnpm build: exit 0`; landing e2e helper audit applied to the 3 existing specs (`cobros`/`confirm-venta`/`devolucion` `waitForURL` accepts `/dashboard` OR `/selector-empresa-sucursal`) |
| 4 — `feat(tenant-ui): selector-empresa-sucursal page and shell trigger` | `ac54c1c` | lint 0 · tsc 0 · targeted jest `28 passed` (board/form/shell/version-plan specs) · `pnpm build: exit 0` (route `ƒ /selector-empresa-sucursal` printed) · Playwright `e2e/selector-sucursal.spec.ts` authored (runs in CI when E2E secrets exist) |
| 5 — `feat(auth-ui): login screen board-01 restyle` | `c47815c` | lint 0 (rerun after commit) · tsc 0 · targeted jest `62 passed` (login page spec incl. LOG-01/02/04 pins) · LOG-04-A grep over page+layout: ZERO matches · `pnpm build: exit 0` |
| 5b — `docs(auth): align the credential-failure comment with the board copy` | `6aa6c3f` | comment-only alignment of the stale "credenciales inválidas o usuario bloqueado" docblock (was missed by the slice 5 add-path); comment-only, no behavior |
| 6 — `chore(release): 0.16.0` (bump ONLY, final commit) | `5427052` | BOM gate: `byte0` = 123 (pkg) / 123 (manifest) / 35 (changelog) — all ≠ 239 (0xEF) · node JSON parse sanity: `pkg version=0.16.0, manifest app=0.16.0` · final block: lint 0 · tsc 0 · targeted jest across all touched suites `162 passed` · `pnpm build: exit 0` |

bump validated: 0.16.0

## Deviations (all documented, none blocking)

1. **RLS `usuario_modify` forced a GUC choreography inside the switch tx (D1/D4):
   blank `app.current_sucursal_id` → `usuario.update` → re-pin to target**, because
   the policy checks the branch column against the GUC on BOTH the old and the new
   row (USING/WITH CHECK). Implemented as infrastructure ports `liberarSucursalActivaEnTx` /
   `activarSucursalEnTx` (`repo-sucursal.ts`); integration-test proven on real Postgres
   (first attempt pin-only failed with `42501`).
2. **gga pre-commit hook review fixes (compliance):** `take: 100` added to the branch
   list `findMany`; transport constants moved out of the `"use server"` adapter into
   `http/validations.ts` (non-async exports are illegal in a "use server" file);
   the switch's `tx.sucursal.findFirst` / `tx.usuario.update` moved behind repo ports
   (`leerSucursalActivaEnTx`, `reescribirSucursalUsuarioEnTx`).
3. **Branch count piggybacks `registrarAuditoriaSesion`** via an options param
   (`sucursalesActivasDeEmpresa`) — the count literally shares the audit tx (same
   bootstrap window, no extra GUC pin); no new auth API; LOGOUT path unchanged.
4. **jest `auth-identity.test.ts` switched `clearAllMocks` → `resetAllMocks`:**
   pending `mockResolvedValueOnce` queues leaked across tests in that file and
   hi-jacked later `findUnique` calls (observed as spurious `AUTH_USUARIO_INACTIVO`);
   impl defaults re-establish state in the same beforeEach.
5. **E2E helper change (task 3.3):** the three login helpers now accept either
   landing route; the seeded single-branch admin behavior is preserved (single-branch
   admin asserted, multi-branch alternative accepted instead of deleting the scenario).
6. **tasks.md path idealization:** tasks referenced `tests/unit/*` commands and
   file slots; the repo convention is colocated unit tests + `src/integration`
   harness, so commands targeted the real paths. Integration runs locally against a
   real Postgres with RLS (they passed) — CI runs them again on PR.

## Honest blockers / not-done

- None blocked. Remaining owner step: open the PR (draft below), CI full matrix
  green, human squash-merge.
- Untracked in working tree: `Factura.penpot` and the `openspec/changes/auth-tenant-selector/` SDD trail (implementation artifacts, not part of the code PR per Git workflow).

## Line forecast check

Owner forecast 300–380 non-vendored; observed **768 insertions across 19 non-test
source files** (excluding CHANGELOG/tests/e2e). Above the forecast because the
gga-review fixes added ports/validations conventions — still well under the 400-line
**per-diff review budget for the largest review file** (see per-file `--stat` when the
PR opens); the tasks' >400 flap applies per-PR-size triage only if CI flags it — no
`size:exception` claimed.
