# Exploration: auth-tenant-selector (F1 — selector screen, version gate)

Read-only phase (SDD explore). Mirrors Engram topic `sdd/auth-tenant-selector/explore`.

## Current state (evidence)

### Landed (F0)
- `app/middleware.ts`: session gate. Public paths = `["/login"]` only (deny-by-default). Authenticated users hitting `/login` are redirected straight to `/dashboard`; unauthenticated users to `/login`. Session refreshed via `supabase.auth.getUser()` (JWT validated, not cookie-trusted).
- `app/src/app/login/page.tsx` + `layout.tsx`: functional login (client component, `useActionState`), accepts `nombreUsuario` + `password` (ADR-014 — email never shown/used). ⚠️ Raw zinc/indigo Tailwind classes + dark-mode variants predate F0 tokens; login stayed outside F0's `(app)` scope.
- `app/src/app/(app)/layout.tsx`: `getCurrentTenantHeader(supabase)` → `null` ⇒ `redirect("/login")`. Renders `AuthShell` with empresa/sucursal names and a placeholder "Cambiar sucursal" span, server-gated to `esAdmin`, `aria-disabled`, reserved "into F1" (shell.tsx D4.4).
- `app/src/modules/tenant/infrastructure/tenant-runtime.ts:135` `getCurrentTenantHeader`: REUSE-read replaying identity resolution (unchanged primitives):
  - `resolverAuthSubDeSesion` (`auth/infrastructure/auth-identity.ts:56`) — `supabase.auth.getUser()` → `sub`.
  - `buscarUsuarioPorAuthSub` (`auth-identity.ts:81`) — Usuario by `authUserId = sub`, in its own `$transaction` with `app.is_login_flow` flag (ADR-019 gallina-huevo). Same user stored in `login-flow.ts`.
  - Wider selects Empresa (`nombreComercial` — no `nombre` column, ERD v4.7) + Sucursal (`nombre`), then `buildTenantContext` → roles → `esAdmin`.
  - `getCurrentTenantContext` (same file, :93) is the canonical `TenantCtx` resolver with the narrow select.
- `withTenantTransaction` (`tenant/infrastructure/withTenantTransaction.ts`): mandatory DB wrapper; first statements set RLS GUCs `app.current_empresa_id / sucursal_id / usuario_id / es_admin` (`set_config` local, bound params). Rejects nesting via AsyncLocalStorage.

### Missing (gap vs ratified Penpot map)
- **Board 02-Selector-Empresa-Sucursal: does not exist** — no route, no component, no backend read use case.
- **Sucursal listing use case: none** — zero `sucursal.findMany` in `modules/tenant`; no "list my branches" API anywhere.
- **Switch-sucursal mutation: none** — F0 explicitly reserved the header affordance.
- **Plan (premium) model: absent from schema** — no `Plan` model, no premium flag (grep on `app/prisma/schema.prisma` clean). The "(Version plan) Selector-Empresa-Sucursal" board is today pure design (premium *access door* per `docs/01/02/15/17/19`). Model must be extensible (only premium access now, function list per plan grows later without structural change).

## Rules that sized the selector (docs)
- `docs/17-plan_wireframes.md` §5 flow raíz: **Despachador and Cobrador NEVER select** — they land directly on their assigned empresa+sucursal. **Only the Administrador** can change sucursal (header button, no logout, doc 16 §?): the selector is an ADMIN-only affordance, both as post-login screen and header switch.
- `docs/20-Respreguntas_jefe_seguridad_auth.md` P6 answer (doc 12/20): **the Administrator is isolated to their own empresa** — the selector can NEVER offer another company. `Usuario.empresaId` is immutable at this layer; only `sucursalId` varies (and company must own that branch).
- `docs/04-rolesPermisosFact.md` matrix: "Cambiar sucursal" ✅ admin / ❌ despachador / ❌ cobrador; multi-role users exist; the matrix is enforced server-side (UI hiding is not security).
- `docs/19-directivas_desarrollo.md`: planes free/premium extensible; acceso premium desde el board `(Version plan)` Selector-Empresa-Sucursal.

## Backend seams
| Need | Exists? | Seam |
|---|---|---|
| Resolve session user + roles + esAdmin | ✅ | Reuse `resolverAuthSubDeSesion` + `buscarUsuarioPorAuthSub` verbatim (no new auth API). |
| List sucursals of my empresa | ❌ | NEW read use case in `modules/tenant` (or `modules/tenant/application`), executed inside `withTenantTransaction` with the current `TenantCtx` (tenant-scoped read; NOT login-flow — R1.B must not widen). Filter `empresaId = ctx.empresaId AND activo`, admin-gated server-side. |
| Change active sucursal | ❌ | NEW admin-only use case; design question (open for propose): session-level switch vs updating `Usuario.sucursalId` (currently the GUC comes straight from the user row → today those are the same thing; a session-scope switch implies precedence/ownership rules). |
| Read current plan/version | ❌ | No model. Candidate for F1: static "free" classification + a reserved invocation point; defer persistence schema (YAGNI / strict). |
| Tenant GUCs / RLS / audited logout | ✅ | untouched |

## Seams decided for the UI (candidates → propose)
1. `selector` route placement: post-login for admins only (middleware/layout decides by `esAdmin` from the identity read), `/selector-empresa-sucursal` inside `(app)` or a sibling public-ish route; non-admins must still land `/dashboard` directly (17 §5 invariant).
2. Replace the placeholder span in `AuthShell` header with the real "Cambiar sucursal" trigger opening the selector (server-gated branch already exists).
3. Sucursal option card/list per board 02 with names + activo status only (no deep tenant data — the selector is pre-context).
4. Login page token pass (board 01): migrate to F0 tokens (`@/shared/ui` primitives, light-only), still outside `(app)`.

## Multi-tenant invariants F1 must not break
- Every context-aware query goes through `withTenantTransaction` with the 4 GUCs; selector read filtered by session `empresaId` — never accept empresa/sucursal ids from the client as authorization.
- Deny-by-default: the switch/list actions re-verify role + company + branch ownership server-side (matrix, doc 04).
- ADR-014: identity by `nombreUsuario`/`sub`; synthetic email (`@users.systemfact.internal`) never reaches the UI.
- The `app.is_login_flow` exception stays pocket-sized; the selector itself runs under a real `TenantCtx`.
- Audit LOGOUT/LOGIN specced rows (`openspec/specs/auth/spec.md` REQ-AUTH-AUD-001) are not bypassed by the new path — branch switching is a tenant-context question, not re-authentication, so it MUST NOT mint LOGIN rows (propose decision).
- State enums/flows untouched; no new free strings.

## Risks / open questions
- Persistence semantics of "cambiar sucursal": is the admin's branch change session-scoped or does it rewrite `Usuario.sucursalId` (which today also defines assignment to themselves)? Needs owner verdict; affects the use case design more than the UI.
- Login redirect chain must change coherently: middleware redirects authenticated users away from `/login` to `/dashboard` — with an admin-first selector, first-visit admin routing lives in the `(app)` layout or a dedicated post-login route (life after login decision for propose).
- The premium board: in F1 without a Plan model; overbuilding a "flexible" plan engine now violates strict YAGNI (doc: only premium access this stage, no backend).
- Board 01-Login is part of F1's ratified screens but the token migration touches files outside the selector — try to keep the slice to the selector + header trigger; a separate login-token pass can follow.

## What
Read-only exploration for `auth-tenant-selector` (frontend F1) — mapped the current auth/tenant flow, the ratified board rules, and the backend seams.
## Why
Selector-Empresa-Sucursal F1 needs to know what exists before a proposal/design without inventing APIs.
## Where
openspec/changes/auth-tenant-selector/explore.md (mirror of Engram `sdd/auth-tenant-selector/explore`)
## Learned
Empresa is NOT selectable (P6 answer — even admin is company-isolated); F0's getCurrentTenantHeader already became the identity plumbing reused verbatim by F1; the version plan board has no backend counterpart in the schema today.
