# Proposal: Selective backend-pure reorganization (refactor only)

## Why
Large files (>1000 lines) slow navigation, review, onboarding, reuse and increase coupling. The backend audit is closed (11/11, v0.11.27) and we want to reduce technical debt without changing behavior or touching UI-crossing code prematurely.

## What
Apply incremental, behavior-preserving reorganization to **backend-pure** areas only, following ADR-013 modular monolith. Defer UI-crossing (app/, components/features/UI, shared UI hooks/utils/types, barrels/public exports) until after frontend work, where vertical feature cuts are clearer.

## Scope (backend-pure only)
- `src/modules/*/http/actions.ts` → split by use-case (e.g. `ventas.actions.ts`, `pagos.actions.ts`, `clientes.actions.ts`) as thin adapters. Keep `withTenantTransaction(ctx, fn)` and server-side authorization.
- `src/modules/*/application/` → 1 use case per file where monolithic.
- `src/modules/*/infrastructure/` → split repositories by cohesion/entity; avoid god repo.
- `src/modules/*/domain/` → only internal extraction (helpers/types). No business logic changes or fiscal rule edits.

## Out of scope (postpone)
- `src/app/`, pages/routes, layouts/route handlers
- `components/`, `features/`, UI, shared UI hooks/utils/types
- barrels/public exports with broad cross-cutting impact

## How
- Incremental strangler: extract, not rewrite. Add temporary re-exports if public exports change.
- PRs 50–250 lines. If >400, chained PRs per Review Workload Guard.
- 1 cohesive change per commit (move + imports + build/types). Conventional commits `refactor:`.
- Verify: `tsc --noEmit`, ESLint, affected tests, build. Critical paths (ventas, NCF, inventario, pagos): light smoke if medium/high blast radius.
- CodeGraph first, `explore` if 4+ files. Map before touching. Pick 1 low-risk candidate first, iterate small batches.
- No big bang. Behavior-preserving only.

## Success criteria
- Reduced file length, clearer boundaries, no behavior changes, CI green, no public API break without temporary re-exports.
