# productos — Step 2 of the screens plan: the Productos screen

Objective: a Productos screen over the EXISTING producto backend (create/edit/deactivate/list use cases and HTTP actions are already built and tested). No wireframe exists (plan F5, open question 2): reuse the established list + dialog pattern from the Inventario screens (44/48px, 8px rules, same components); the owner reviews the result on the demo company.
Parent plan and hand-off: `odd/tasks/frontend-screens-plan.md` (Step 2).

## Specs

- **S1** — plan Step 2 (quoted): "Productos | M | Depends on categories; Decimal price and ITBIS per product; audit on price change".
- **S2** — plan open question 2 (quoted): "reuse the existing components and the 44/48px, 8px rules, keep one consistent list + dialog pattern, and have the owner review each screen on the demo company. Agree?" (owner proceeded with the plan).
- **S3** — L9 decision, verbatim: "Operador and Despachador view-only for both, with the Administrador managing." Both products AND inventory are view-only for Operador/Despachador; Administrador manages.
- **S4** — AGENTS.md: money = Decimal(12,2); ITBIS per product with validity; master entities NEVER deleted, `activo=false`; multi-tenancy + `withTenantTransaction`; server-side role gate; stable error codes; lists paginated (default 25, max 100); audit on price change (backend already writes it).
- **S5** — CSP enforced: add the new route to `e2e/csp-authenticated.spec.ts`; menu entry enabled in the same PR (no dead links; `tools/config/nav-routes.test.ts` guard).

## Tasks

- [x] T1 (S1-S4) `/productos` screen: paginated list (25/page), filters (search by name/code, category selector, status), create/edit dialog (Decimal price, ITBIS per product, unidad, categoría), deactivate with confirmation; Administrador manages, Operador/Despachador view-only (no create/edit buttons, server-side gate too). Route: parent inline or worker per context budget. Risk: none beyond S4 conventions (backend unchanged).
- [x] T2 (S5) E2E spec (admin creates/edits/deactivates a product; Operador sees no manage buttons), CSP route, menu entry, version bump. Risk: none.
- [ ] T3 (S6) Reconciliation: full unit + focused integration, tracker/PR per the Step 1b flow (issue-first, single PR).

## Log

- L1 (2026-11-10): owner approved starting Step 2 after the REST-standards detour ("lest continue with step 2, pls"). Backend readiness verified read-only: `src/modules/producto` has crear/actualizar/desactivar/listar use cases, ITBIS domain, typed HTTP actions with pagination (limit ≤ 100). UI is the only missing piece.
- L2 (2026-11-10): T1 and T2 built on `feature/screens-productos` (option A, full scope), in three reviewable commits. The backend extension is additive: `consultarProductos` + `consultarProductosAction` (projection with categoria name, unidad, Decimal price string, ITBIS rate with its vigencia window, activo, version; search by nombre/descripcion/codigo; categoriaId and estado filters, with `incluirInactivos` still honored), `obtenerProductoDetalle` + `obtenerProductoPorIdAction` (edit prefill with version), `obtenerPermisosProductoAction` (manage role group, so no screen names a role), and `unidadMedida` accepted by crear/actualizar (audited like the other fields; a creation without an explicit ITBIS validity starts its window now). No behavior below the new fields changed; the old listing use case and role groups are untouched. The screen reuses the shipped Inventario pattern (plain 44/48px controls, 25/page, debounced search, `page.tsx` shell + client island) and adds the project's vendored Dialog for create/edit/deactivate. The category selector comes from the product read itself, so the Despachador viewer never needs `listarCategoriasAction` (still Admin/Operador) and its permissions were not broadened. S5: the menu entry is enabled and `tools/config/nav-routes.test.ts` now requires `/productos`; `e2e/csp-authenticated.spec.ts` derives routes from the filesystem, so it covers the new page with no edit (verified by reading the spec, not run: the local Supabase lane needs Docker). Version 0.22.0 in the three files. Not pushed; T3 (reconciliation) remains.
