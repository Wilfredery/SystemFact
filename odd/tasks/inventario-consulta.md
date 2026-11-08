# inventario-consulta — Step 1a of the screens plan: Inventario / Productos list (read-only view)

Objective: build the wireframe board `04-Inventario-Consulta` as drawn. Operador and Despachador view only; Administrador manages.
Parent plan and hand-off: `odd/tasks/frontend-screens-plan.md` (Step 1). The adjust form (`04-Inventario-Ajuste`, Administrador only) is Step 1b, a separate PR.

## Specs

- **S1** — "I have 04-inventario and maybe has information from inventario inside the products for a reason, cause I took time creating the wireframe. Mmmm, keep operador and despachador with the same rol, just make it possible to easly change in the future just in case." (L8 of the plan: follow the wireframe as drawn; one named role-group constant per capability in `http/shared.ts`; screens and actions read the groups, never literal role names.)
- **S2** — "Operador and Despachador view-only for both, with the Administrador managing."
- **S3** — wireframe `04-Inventario-Consulta` (read 2026-11-08): title "Inventario"; KPI cards "Total productos", "Bajo stock", "Agotados", "Valor de inventario" (e.g. `RD$ 152,700.00`); filter bar with search "Buscar por nombre o código...", category selector "Todas las categorías", status selector "Todos los estados"; table columns "Código", "Nombre", "Categoría", "Und.", "Existencia", "Stock mín.", "Estado", "Acciones"; status badges "Disponible", "Bajo stock", "Agotado". Label note: "Roles que la ven: Administrador, Despachador" (the owner then decided Operador shares the Despachador role group, S1). The "+ Ajustar" button and the row "⋯" actions belong to the adjust flow (Step 1b, Administrador only): not in this PR.
- **S4** — `AGENTS.md`: multi-tenancy (`empresaId` + branch), `withTenantTransaction` in every action, server-side role checks, Decimal for money, lists paginated (25 default, 100 max), typed errors with stable codes, one local E2E spec, new route covered by the CSP spec, nav entry enabled in the same PR.

## Tasks

- [x] T1 (S1,S2,S4) Role groups: view group (Administrador, Operador, Despachador) and manage group (Administrador) for producto and inventario; list actions read the view group; write actions read the manage group. Risk: item 2 (permissions), own commit. **Done: `7a99c44`** (shared.test.ts in both modules pins group membership; actions tests read the constants).
- [x] T2 (S3,S4) Backend query + action: products of the company with category name, unit, branch stock, minimum stock, derived status; filters search (name or code), category, status; pagination; KPIs over the whole branch scope (not the filtered page); value = sum(stock x costoPromedio) as Decimal. **Done: `9034c32`** (67 unit tests; 7 real-DB integration tests in `src/integration/consultar-inventario.integration.test.ts`).
- [x] T3 (S3,S4) Screen `/inventario` (server page + client island), nav entry enabled, route guard test green, version bump. **Done: `3a3b340`**, then `714c3d4` fixed a runtime bug the unit tests could not see (the server page imported the page-size constant from the `use client` island and got a client reference; every role saw "Datos de entrada inválidos."). Version bump 0.20.0 in the closing commit.
- [x] T4 (S2,S4) Local E2E: seed an Operador and a Despachador user, spec `inventario.spec.ts` for Administrador, Operador and Despachador (all see the list and filters; none sees manage controls except in 1b). **Done: `3696f8a`**; spec run on the local stack with a production build: 4 passed (3 role tests + the CSP spec, which visited 10 pages including `/inventario`). `provision-local-e2e.sh` was NOT run end to end (no `psql` on the dev host, re-provisioning needs a stack wipe): CI is its first full run.

## Log

- L1 (2026-11-08): owner request: "Check in memory and continue with the last session where we left. Answering a question u made me: Operador and Despachador view-only for both, with the Administrador managing."
- L2 (2026-11-08): wireframe page `04-Inventario` read (extracted outside the repo, deleted afterwards): boards `04-Inventario-Consulta` and `04-Inventario-Ajuste`; S3 above.
- L3 (2026-11-08): T1-T4 built and committed on `feature/screens-inventario-consulta`. The local E2E run found the page-size bug above; fixed in `714c3d4`. Local environment note: the local integration database had `LOGIN_INTENTO` owned by `postgres` instead of `it_migrator`, so every integration test failed in the harness truncate; fixed in the local throwaway DB only (`ALTER TABLE ... OWNER TO it_migrator`), no repo change. Role change is a BREAKING change for `Operador` (it could manage products and stock before); native review is due because it touches permissions (high-risk item 2).
