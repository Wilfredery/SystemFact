# Design: auth-tenant-selector (F1 — admin-only sucursal selector)

SDD phase: **design** (D1–D8 in order; D1/D2 were deferred to this phase by the
owner in the proposal). Binding inputs: `proposal.md` §S1–S5 (+ Out-of-scope
hard list) and the three delta specs (`tenant`, `tenant-selector-ui`,
`auth-login-restyle`). Code ground truth read at design time:
`app/middleware.ts`, `app/src/app/(app)/layout.tsx`,
`app/src/shared/ui/app-shell/shell.tsx`, `app/src/modules/tenant/**` (domain
`tenant.ts`, infrastructure `tenant-runtime.ts` / `withTenantTransaction.ts` /
`tenant-where.ts`), `app/src/modules/auth/**` (`auth-identity.ts`,
`auth-service.ts`, `domain/errors.ts`, `http/actions.login.ts`),
`app/prisma/schema.prisma` (exact models below), `app/src/app/globals.css` +
`layout.tsx` (font/token registry), `app/src/components/ui/*` (F0 primitives
inventory). Engram: `sdd/auth-tenant-selector/explore` (#1097).

Schema pin (binding for tasks — the delta specs say generically `activo`,
the Prisma model says otherwise):

| Model       | Exact fields (schema.prisma) |
|-------------|------------------------------|
| `Empresa`   | `id`, `nombreComercial String @db.VarChar(255)` (display name; there is NO `nombre` column) |
| `Sucursal`  | `id Int`, `empresaId Int`, `nombre String`, `direccion`, `telefono`, **`activa Boolean @default(true)`** (NOT `activo`), `createdAt`, `updatedAt` |
| `Usuario`   | `id Int`, `empresaId Int`, **`sucursalId Int`**, `nombre`, `nombreUsuario @unique`, `passwordHash`, `email?` (never exposed), `activo Boolean @default(true)`, `authUserId String? @db.Uuid` (lazy-bound `sub`, partial unique), `version Int @default(1)` (optimistic locking) |
| `Auditoría` | `MovimientoAuditoria`: `empresaId Int`, `sucursalId Int?` (nullable), `usuarioId Int`, append-only |

---

## D1 — Switch persistence: **REWRITE `Usuario.sucursalId`** (decided)

**Trace of where `app.current_sucursal_id` comes from today** (verified, not
assumed): request → `middleware.ts` (`supabase.auth.getUser()`, edge — no DB)
→ `(app)/layout.tsx` or an action's `getCurrentTenantContext(supabase)` →
`resolverAuthSubDeSesion` (`auth-identity.ts:56`, `getUser()` → normalized
`sub`) → `buscarUsuarioPorAuthSub` (`auth-identity.ts:81`, own transaction
with `app.is_login_flow`) → **reads `usuario.sucursalId` straight from the
`USUARIO` row, fresh on EVERY request** → `buildTenantContext` → `TenantCtx`
→ `setTenantContext(tx, ctx)` pins the four GUCs inside
`withTenantTransaction`. There is no cache, no session table, no token state:
the row IS the resolution point.

**Decision:** `cambiarSucursalActiva` persists by
`usuario.update({ where: { id: ctx.usuarioId }, data: { sucursalId, version: { increment: 1 } } })`
inside `withTenantTransaction`, after re-validating the target. Nothing else
changes: every next resolution (layout header, any action, RLS GUCs) reads the
updated row and comes out on the new branch, by construction.

Why it wins, measured against the spec's post-condition contract
(TEN-SWITCH-04-A..E):

1. **Zero resolver/middleware/session refactor** — the contract said the
   chosen mechanism must be expressible in ≤1 middleware/session refactor;
   this needs **zero**. Session-scoped precedence would require either
   re-signing session tokens (**forbidden**: "no new signing tokens",
   spec anti-requirement) or a per-request override plumbed through
   `getCurrentTenantContext`/`getCurrentTenantHeader` (two resolvers, both in
   the ADR-019 login-flow-adjacent path) plus a cookie with cache/staleness
   semantics — more surface, new failure class.
2. **Multi-device/multi-session consistency** — the switch is account-wide
   (every session of that admin moves to the same branch). Honest tradeoff,
   and the *right* one: `TenantCtx.sucursalId` is a single truth, and an
   admin "operates a branch" (doc 17 §5), not "a branch per device". A
   session-scoped override would let two sessions of the same admin write
   different operations with no DB-visible reason — worse for audit triage.
3. **Audit semantics** — `MovimientoAuditoria.sucursalId` is written by the
   operation call sites from `ctx` at operation time; it keeps meaning "the
   branch where the operation ran". Rewriting the row does **not** disturb
   the append-only log and does **not** mint LOGIN rows (step 5 of the spec).
   A session-scoped cookie could diverge audit's view of "active branch" per
   device — rejected.
4. **`(app)/layout.tsx` ripening risk** — none: `getCurrentTenantHeader`
   already re-reads the row per request; after the rewrite the header shows
   `usuario.sucursal.nombre` of the NEW branch on the next navigation with no
   code change (this was the proposal's risk #1 — closed by construction,
   not by patching).
5. **AGENTS.md alignment** — "no speculative flexibility", "cheapest safe
   path": no new column, no migration, no session store, no third truth. The
   semantic overload of `Usuario.sucursalId` ("assigned branch" for
   despachador/cobrador, "active branch" for Administrador) is the existing
   system's meaning already — doc 04 makes branch switching an admin-only
   *assignment* change, so the column keeps one meaning: the branch this user
   operates.
6. **Idempotency/concurrency** — re-confirming the current branch short-circuits
   as a no-op success (no write — TEN-SWITCH-04-E); the actual update is
   versioned (`version` increment keeps the optimistic-locking ledger
   coherent) and runs inside the mandatory wrapper (ReadCommitted + row-level
   re-validation), so a lost race simply re-verifies or denies.

**Third options rejected:** `sucursalActiva` column / per-session table —
schema migration + RLS-policy churn + a new resolver branch ("if esAdmin read
X else Y") to split one truth into two; violates YAGNI and costs more than the
row rewrite with no invariant gained. If the owner ever re-opens this, what
would be needed from them: explicit approval for a migration + a definition of
which sessions/devices may diverge — not needed.

---

## D2 — Admin post-login landing: **decide in the login action; middleware untouched** (decided)

- **Middleware stays byte-identical**: `middleware.ts` runs at the edge, has no
  DB access, and currently redirects authenticated users from `/login` →
  `/dashboard`. Growing a Prisma read or an `esAdmin` branch there would
  invent a new runtime capability — rejected.
- **Landing decision lives in the login Server Action**
  (`modules/auth/http/actions.login.ts`, `login()`): after a successful
  `loginWithCredenciales`, the action redirects to
  `/selector-empresa-sucursal` **only when** the authenticating user is admin
  AND their empresa has > 1 active branch; otherwise `/dashboard`, unchanged.
  - The branching input comes from an **extension of the `AuthResult`
    success payload** (`auth-service.ts`): `{ ok: true, esAdmin:
    boolean, activeBranchCount: number }`. The count is one cheap
    `sucursal.count({ where: { empresaId: usuario.empresaId, activa: true } })`
    executed inside the **same login bootstrap window** (R1.B unaffected —
    this IS the login flow; no `app.is_login_flow` widening, no new auth API,
    the count runs only AFTER credentials verified + `sub` bound + enlace ok,
    i.e. only for the account holder).
  - **Non-admin fast path preserved**: `esAdmin=false` → `/dashboard`
    (17 §5), regardless of branch count.
  - **Single-branch admin** → `/dashboard` (selector skipped; nothing to
    choose).
  - **Multi-branch admin** → `/selector-empresa-sucursal` (selector first).
- **Already-authenticated user typing `/login`** → middleware still sends them
  to `/dashboard` (unchanged). The selector is always reachable via the
  header slot (S5) — no middleware semantics change is needed anywhere.
- **Post-switch navigation** (S5, SEL-NAV-06-A/B): on switch success the
  action redirects to **`/dashboard`** — it is in the eight sidebar module
  routes, header re-renders server-side and shows the new `sucursalNombre`
  automatically (layout reads the updated row per request). Nobody stays on
  the selector; no dead route exists.
- **Playwright e2e touchpoints**: the login-flow e2e gains a landing-branch
  assertion (multi-branch admin → selector; non-admin and 1-branch admin →
  `/dashboard`), plus the selector suite's SEL-ROUTE-01-A/B and SEL-NAV-06-A/B
  scenarios from the UI spec. An existing e2e that asserts "admin lands on
  `/dashboard`" must be audited and updated (tasks item).

---

## D3 — S1 use case shape

- `modules/tenant/domain/errors.ts` — NEW per-module catalog (same pattern as
  `auth/domain/errors.ts`): exported constants `TEN_OPS_NO_AUTORIZADO`,
  `TEN_SUCURSAL_NO_VALIDA`, derived union `TenantErrorCode`, `messageFor`
  Spanish lookup. Adapters/components never inline text.
- `modules/tenant/infrastructure/repo-sucursal.ts` (Prisma port):
  `listarSucursalesActivas(tx, empresaId): Promise<{ id: number; nombre: string }[]>`
  — `sucursal.findMany({ where: { empresaId, activa: true }, select: { id, nombre }, orderBy: { nombre: "asc" } })`.
  Narrow select; no deep tenant data. (Field is `activa` per schema.)
- `modules/tenant/application/listarSucursalesDeEmpresa.ts`:

  ```ts
  export type ListarSucursalesResult =
    | { ok: true; sucursales: readonly SucursalResumen[] }
    | { ok: false; code: TenantErrorCode; message: string };

  export async function listarSucursalesDeEmpresa(
    ctx: TenantCtx,
    tx: PrismaTx,
    deps: { listarSucursalesActivas: typeof defaultReader } = defaultDeps,
  ): Promise<ListarSucursalesResult>
  ```

  - **No empresa/sucursal scope parameters exist in the signature** — P6
    enforced by typecheck (TEN-LIST-01-B); scope comes exclusively from
    `ctx.empresaId`.
  - Deny-by-default: `ctx.esAdmin === false` → `{ ok: false, code:
    TEN_OPS_NO_AUTORIZADO, message }` before any read (TEN-LIST-01-C).
  - Empty active set → `{ ok: true, sucursales: [] }` (TEN-LIST-03-A).
  - `ctx` also carries the current `sucursalId`, which the UI uses to mark the
    current option — no extra read.
- **Code path (selector → use case), zero client business logic:**
  `(app)/selector-empresa-sucursal/page.tsx` (Server Component) →
  `data.ts` server loader: `getCurrentTenantContext(supabase)` → null ⇒ layout
  already redirected (defense in depth the loader re-checks) →
  `withTenantTransaction(ctx, tx => listarSucursalesDeEmpresa(ctx, tx))` →
  plain data passed to the render. Adapters stay thin; no nesting (the loader
  opens exactly one wrapper).

## D4 — S2 use case shape

```ts
export type CambiarSucursalResult =
  | { ok: true }
  | { ok: false; code: TenantErrorCode; message: string };

export async function cambiarSucursalActiva(
  ctx: TenantCtx,
  input: { readonly sucursalId: number },
  tx: PrismaTx,
): Promise<CambiarSucursalResult>
```

Ordered gates inside the single `withTenantTransaction` opened by the http
adapter (never nested):

1. **Role gate** `ctx.esAdmin === false` → shoot `TEN_OPS_NO_AUTORIZADO`
   (deny-by-default; server-side, not UI).
2. **Idempotent short-circuit**: `input.sucursalId === ctx.sucursalId` →
   `{ ok: true }` with **no write and no audit** (TEN-SWITCH-04-E).
3. **Target validation (P6 + activa)**:
   `tx.sucursal.findFirst({ where: { id: input.sucursalId,
   empresaId: ctx.empresaId, activa: true } })`; `null` →
   `TEN_SUCURSAL_NO_VALIDA`. One code for BOTH a foreign-empresa target and an
   inactive one — merging them is deliberate (cross-tenant indistinguishability
   defense, same rationale as `AUTH_ENLACE_NO_RESUELTO`: RLS + the empresa
   filter make "elsewhere" and "not exist" unobservable, so splitting the codes
   would fabricate a distinction the system cannot make).
4. **Persistence (per D1)**:
   `tx.usuario.update({ where: { id: ctx.usuarioId },
   data: { sucursalId: input.sucursalId, version: { increment: 1 } } })`.
5. `{ ok: true }`.

Anti-requirements held: writes ONE row, ZERO audit rows (no LOGIN mint —
REQ-AUTH-AUD-001 untouched), no synthetic email reads/mentions (identity flows
only via `ctx.usuarioId`/`sub`), no new tokens, no new enums, no free strings.
http adapter `modules/tenant/http/actions.sucursal.ts` (thin): zod-validate
`sucursalId` int → delegate → return the typed result; the caller (switch
form) triggers navigation per D2 on `ok`.

## D5 — S3 selector screen

- **Exact route**: `app/src/app/(app)/selector-empresa-sucursal/page.tsx`
  (+ sibling `data.ts` loader). Inside `(app)` ⇒ AuthShell wraps it.
- **Server guards in `data.ts`** (both ways, per SEL-ROUTE-01-A/B): ctx null ⇒
  `redirect("/login")`; `!esAdmin` ⇒ `redirect("/dashboard")`. Non-admins
  never receive selector markup.
- **Composition (F0-only)**: `Card` (+header/content) as the frame; `Select`
  (F0 `select.tsx`) listing the active branches with the current branch
  preselected; `Button` "Confirmar" (disabled while pending, double-submit
  safe); `Badge` for the version-plan element; `Label`/`Input` NOT needed here
  (no text entry on board 02 — they belong to board 01).
- **Empresa read-only (P6, SEL-RENDER-02-A)**: `empresaNombre` rendered as a
  static heading — never a select/option/interactive node.
- **Version badge seam (SEL-PLAN-03-A)**: NEW pure module
  `app/src/shared/version-plan.ts` exporting
  `resolvePlanForVersion(): "free"` (typed constant return). The page imports
  the seam — nothing inlines the string. No Plan model/schema anywhere.
- **Empty state (SEL-EMPTY-04-A)**: message + confirm button unrendered; no
  navigation into a stateless selector.
- **Touch rules**: option/confirm controls ≥44px height, 8px spacing rhythm,
  keyboard reachable in DOM order; light-only token classes only
  (`text-ink`, `bg-surface`, `border-line`, …) — zero zinc/indigo/hex/dark:.

## D6 — S5 shell wiring

`shell.tsx:49-58`: the placeholder `<span aria-disabled>` inside the existing
`{esAdmin && …}` server branch is replaced with a real `next/link`
`<Link href="/selector-empresa-sucursal" data-testid="cambiar-sucursal">` —
accessible name "Cambiar sucursal", hitbox ≥44px, token classes, not
`aria-disabled`. Naming consistent with the sidebar entries (a `Link` like the
other nav destinations; no new nav entry added — the eight sidebar modules and
their placeholders are untouched). Non-admin render path is unchanged
byte-for-byte in behavior (SEL-SLOT-05-B): the branch was already exclusive to
admins, only the node inside it changed. Header content ("Empresa · Sucursal X")
re-resolves automatically after a switch (D2), so no client state is added.

## D7 — S4 login restyle (optional/cheap) — FileCut-list confirmed

- **Files**: `app/src/app/login/page.tsx`, `app/src/app/login/layout.tsx`
  (if present), and one message-only edit to
  `app/src/modules/auth/domain/errors.ts`.
- **Exact-copy resolution**: the board 01 error box shows EXACTLY
  "Credenciales inválidas". Today the catalog message is
  `"Credenciales inválidas o usuario bloqueado."`. Cheapest faithful move:
  **edit `AUTH_ERROR_MESSAGES[AUTH_CREDENCIALES_INVALIDAS]` to exactly
  `"Credenciales inválidas"`** — the catalog is the single source of truth for
  user-facing copy; the code, its union, and the silent-about-cause semantics
  are untouched, and `LoginResult`/page logic stay byte-stable (LOG-05-A
  holds: signature and behavior unchanged, copy-only). The removed suffix
  weakens nothing: wrong-password and the authSub-null fail-closed case still
  render the identical string (LOG-02-B intact). `AUTH_USUARIO_INACTIVO`
  keeps its existing message — the spec's §LOG-02 wording "(or a disabled
  user)" is resolved in favor of the spec's own §Requirement line
  ("INACTIVE user rejection keeps their existing catalog copy"; the INACTIVE
  code is only reachable with valid credentials, auth-service docblock).
- **Fonts/tokens**: Source Sans 3 is ALREADY the global font
  (`layout.tsx` loads it, `globals.css` maps `--font-sans`) — zero font work.
  All colors come from the F0 semantic tokens; strip every
  `zinc-*`/`indigo-*`/hex/`dark:` class from the two files (LOG-04-A).
- **Touch**: submit ≥44px, ≥8px separation from the error box, 8px rhythm,
  `nombreUsuario` autofocus kept, Enter submits, `isPending` → disabled +
  "Ingresando…" (LOG-04-B).
- **Recuperar contraseña (LOG-03-A)**: no recovery flow exists in F1 →
  rendered as a link-styled, keyboard-reachable inert element
  (`tabIndex=0`, `aria-disabled="true"`, title "Disponible próximamente"),
  ≥44px hitbox. Visible, navigable by tab, inert by design.
- **No email anywhere**: no email field, no synthetic suffix on screen
  (LOG-01-A).
- **Escape hatch**: if the restyle grows beyond trivial, S4 is dropped
  entirely (LOG-05-B); the catalog message edit would then ride with the
  change's bump commit or be dropped with the slice.

## D8 — Commit plan, verification gates, delivery forecast

Branch `feature/f1-auth-tenant-selector` off `master`. **Six commits**:
1. `feat(tenant): admin-only listing of active empresa sucursals` — S1:
   domain errors catalog + Prisma port + use case + unit/integration tests.
2. `feat(tenant): switch active sucursal for admins` — S2: use case + tests
   (happy/idempotent/foreign/inactive/non-admin).
3. `feat(auth): post-login landing for multi-branch admins` — AuthResult
   extension + active-branch count in the login bootstrap + `login()`
   redirect branch + unit tests + e2e landing assertions.
4. `feat(tenant-ui): selector-empresa-sucursal page and shell trigger` — S3
   page/data.ts/version-plan seam + S5 shell Link + component tests.
5. `feat(auth-ui): login screen board-01 restyle` — S4 (cuttable): page +
   layout + catalog message edit.
6. `chore(release): bump systemfact to 0.16.0` — ONLY the 3 release files
   (`app/package.json` 0.15.0 → **0.16.0**, `app/CHANGELOG.md`,
   `.release-please-manifest.json`). feat → MINOR pre-1.0. Files written
   **BOM-free** (`UTF8Encoding($false)` / `WriteAllText`; verify
   `bytes[0] -ne 0xEF`) — the PR #59 CI-break rule.

**Verification gates** (each commit 1–4): `pnpm lint` +
strict `tsc` + targeted `pnpm jest <touched>` + (commits 3–4) `pnpm build`.
CI gate on the PR runs the full matrix (ESLint, typecheck, prisma validate,
unit, integration vs Postgres 16 w/ RLS, build, conventional-commits guard) —
it must be green before human merge.

**Size forecast (update)**: the full change now lands **~300–380 non-vendored
lines** (the split landing slice and the F0-only screen keep it under the flap
of the proposal's guess); **the >400 threshold is NOT expected to trigger** —
no `size:exception` label unless the final count exceeds 400 at PR time.

**PR description will contain**: one-line What/Why; the S1–S5 → commit map;
scenario traceability (TEN-*, SEL-*, LOG-* to their tests); the D1/D2
decisions in one sentence each with their rejected alternatives; the two
spec-letter clarifications resolved by design (`activa` field pin;
AUTH_CREDENCIALES_INVALIDAS copy via catalog message edit); explicit "no audit
rows / no R1.B widening / no synthetic email exposure" self-check; S4
cuttable-slice notice; `bump validated: 0.16.0` line for the gatekeeper.

## Risks (design-dispositions)

1. `Usuario.sucursalId` rewrite changes branch for ALL sessions of that admin —
   accepted and documented (D1.2); admins-only blast radius.
2. Landing branching adds a DB read to the login path — one cheap count inside
   the already-transactional bootstrap window; no new flow flag.
3. Existing e2e asserting post-login admin landing must be audited (D2) —
   tasks item, else CI e2e could fail.
4. S4 catalog message edit is user-visible copy on a shipped surface —
   intentional (board 01 exact copy), code semantics untouched.
5. Idempotency race (two admins switching simultaneously is a single-user-row
   update) — the row-locking UPDATE inside the wrapper makes last-write-win
   safe; a stale retry that re-verifies returns the no-op short-circuit or
   validates against the already-current branch.
