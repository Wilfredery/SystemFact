# Proposal: auth-tenant-selector (F1 — admin-only sucursal selector)

Change ID: `auth-tenant-selector` — SDD phase: **propose**.
Ratified Penpot boards in scope: **01-Login** (optional slice), **02-(Version plan) Selector-Empresa-Sucursal**, and the existing **03-Dashboard** as the non-admin landing (unchanged).
Frontend map: Engram `design/penpot-frontend-map` (#1086); F0 foundation: `sdd/ui-foundation/*` (landed, v0.15.0).

## Why

- `(app)` shell renders a reserved, `aria-disabled` "Cambiar sucursal" placeholder (`shared/ui/app-shell/shell.tsx`, D4.4) with nothing behind it — F0 explicitly parked this slot "into F1".
- Board 02-Selector-Empresa-Sucursal does not exist: no route, no component, no backend read, no switch mutation.
- There is no `sucursal.findMany`-style "list my empresa's branches" use case anywhere in `modules/tenant`, so there is nothing to serve the selector.
- Docs nudge it forward: doc 17 §5 (only the Administrador may change sucursal, header button, no logout) + doc 20 P6 (even the admin is isolated to their own empresa — `empresaId` is NOT selectable, only `sucursalId` varies within it) + doc 04 matrix ("Cambiar sucursal" ✅ admin / ❌ despachador / ❌ cobrador, enforced server-side).
- Login (board 01) already works (`useActionState`, `nombreUsuario`+`password`) but still uses raw zinc/indigo Tailwind + dark-mode classes that predate F0 tokens.

## What Changes — 5 sub-slices, single PR (capability: auth + tenant)

### S1 (backend, tenant capability) — Admin-only "list my empresa's active sucursals" read
- NEW read use case in `modules/tenant` (`application/listarSucursalesDeEmpresa` + `infrastructure` Prisma port), executed inside `withTenantTransaction` with the real `TenantCtx` — **NOT** the login-flow exception (`app.is_login_flow` must NOT widen; R1.B).
- Server gate: rejects hard when `esAdmin = false` (deny-by-default; UI hiding is not security, doc 04).
- Filter `empresaId = ctx.empresaId AND activo = true`; select is narrow (id, nombre, activo) — pre-context read, no deep tenant data.
- E2E for non-admins: no ids from the client can authorize a company-scoped list — tenant scope always from session, never from input.

### S2 (backend, tenant capability) — "Switch active sucursal" use case
- NEW admin-only switch use case, server-side authorization re-verifies role + that the target sucursal belongs to the caller's `empresaId` (P6 invariant; never trust a client id alone).
- **Design question (DEFERRED to `design` per owner, do not decide here):** switch persistence — session-scoped precedence vs rewriting `Usuario.sucursalId` (today the RLS GUC is straight from the user row, so both are the same mechanism now; the choice owns the use case internals).
- Invariants: tenant-context switch means NO minting of LOGIN audit rows — branch change is NOT re-authentication (`REQ-AUTH-AUD-001` untouched, `openspec/specs/auth/spec.md`); no new free strings or state enums (ADR-014, frozen enums).
- Idempotent: re-confirming the current branch is a no-op, not an error; concurrent-safe via the transaction wrapper.

### S3 (frontend, selector route) — Board 02 screen, admin-only
- `/selector-empresa-sucursal` inside `(app)`, uses F0 tokens + primitives (button, input, card, select) + format home only.
- Version-plan cut: static "free" badge + reserved invocation seam (YAGNI — no Plan model/schema in F1; function list per plan can grow later without structural change).
- Admin gating: non-admins (despachador/cobrador) NEVER land here — layout/admin branch of the shell guards routing; server rejects non-admin calls at S1/S2.
- Post-login routing for admins (middleware currently sends all auth-users hit on /login to /dashboard) = **design question DEFERRED by owner**: who routes to selector on first visit.

### S4 (frontend, login restyle — optional slice, NOT scope creep)
- Restyle `src/app/login/page.tsx` + layout to ratified Penpot board 01 (FiledOut): fields `nombreUsuario` + `password`, single error "Credenciales inválidas", "recuperar contraseña" link; F0 tokens/primitives, light-only, stays outside `(app)`.
- **Optional/cheap only** — if notes the board key behavioral already works; skip if cost rises above trivial. Board 01 first, no function changes, no auth logic changes.

### S5 (frontend, wire) — "Cambiar sucursal" slot → selector
- Replace the placeholder span in `AuthShell` header with an admin-only link into `/selector-empresa-sucursal` (server-gated branch already exists; same esAdmin check).
- Concurrency: UX on what happens after a switch (stay / return to dashboard / show chosen branch in header) = **design question DEFERRED by owner** (post-switch routing still design).

## Impact — every file touched

- NEW `app/src/modules/tenant/application/listarSucursalesDeEmpresa.ts` + tests
- NEW `app/src/modules/tenant/infrastructure/*port or query (Prisma inside withTenantTransaction)*` + tests
- NEW `app/src/modules/tenant/application/cambiarSucursalActiva.ts` (+ optional `infrastructure` persistence detail; per design) + tests
- Server Action / http adapter: NEW `app/src/modules/tenant/http/...` thin adapter(s) (validate → authorize → delegate)
- NEW `app/src/app/(app)/selector-empresa-sucursal/page.tsx` (+ small server-side `data.ts` or inline loader; zero client business logic)
- EDIT `app/src/shared/ui/app-shell/shell.tsx` (placeholder span → real trigger link, admin-gate preserved)
- EDIT `app/src/app/login/page.tsx` + `layout.tsx` (S4 only, optional)
- POSSIBLY EDIT `app/middleware.ts` / `(app)/layout.tsx` (post-login routing decision — only per design outcome; no auth re-hardening invented here)
- Possibly EDIT `app/src/modules/tenant/infrastructure/tenant-runtime.ts` IF the switch persistence (design) requires reading/writing active branch elsewhere

## Delivery protocol (binding)

- **Single PR** ratified. Honest forecast: ~230–380 total across S1–S5 including tests; **S2+S3 alone push above 200, and the full change is forecast near the 400 non-vendored limit — flag `size:exception` in the PR only if the final count lands >400.**
- **Process rule (owner-guard release/protocolo-manual, Engram obs #1095) — verbatim:** the final commit of this change's apply MUST carry the version bump (app/package.json + app/CHANGELOG.md + .release-please-manifest.json); the gatekeeper must verify `bump validated: <version>` before PR.
- **Interactive execution**; store hybrid (Engram + openspec mirror).
- Gate per slice: typecheck, lint, unit tests, build green on `feature/<phase>-<module>` branch.

## Out of scope (hard)

- Empresa selector in any form (P6 — admin company-isolated; `empresaId` immutable at this layer).
- Plan model/schema or multi-empresa — `(Version plan)` cut is static "free" + reserved seam only.
- No login-flow widening; no new auth APIs; no `app.is_login_flow` growth.
- No audit rows from the branch-switch path (no login-token minting).
- No client business logic (no fiscal math, no computed balance in selector).
- No tailwind/config churn beyond what F0 already landed.

## Risks

1. S2 persistence semantics (session vs user-row rewrite) ripple into `(app)/layout.tsx` branch resolution — the widest unknown; narrow it at `design` before S2 implementation.
2. Post-login routing: middleware redirects logged-in users at `/login` → `/dashboard`; routing an admin to the selector first must not break the non-admin fast path (17 §5).
3. S4 (login restyle) seams files outside `(app)/` — keep the slice cheap and cuttable to keep the PR in range.
4. ADR-014: synthetic email and `nombreUsuario`-based flow must never leak a new signing token or a LOGIN row via the switch path.
