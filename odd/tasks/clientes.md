# clientes — Step 3 of the screens plan: the Clientes screen

Objective: a Clientes screen over the EXISTING cliente backend (crear/actualizar/desactivar/obtener/listar use cases and typed HTTP actions already exist). No wireframe: reuse the Productos/Inventario list + dialog pattern (S2 of the plan). The owner reviews the result on the demo company.
Parent plan and hand-off: `odd/tasks/frontend-screens-plan.md` (Step 3).

## Specs

- **S1** — plan Step 3 (quoted): "Clientes | M | Used by sales and credit; credit fields admin-only; RNC/cédula validation".
- **S2** — plan open question 2 (quoted): "reuse the existing components and the 44/48px, 8px rules, keep one consistent list + dialog pattern, and have the owner review each screen on the demo company."
- **S3** — L9 (quoted): "Operador and Despachador view-only for both, with the Administrador managing." Applied to Clientes: Operador/Despachador see the list (they sell to and collect from clients), Administrador manages. CREDIT FIELDS are admin-only even in view mode.
- **S4** — AGENTS.md: master entity never deleted (`activo=false`); multi-tenancy + `withTenantTransaction`; server-side role gate; stable error codes; paginated lists (25 default, max 100); RNC/cédula validation per DGII rules (domain); optimistic locking `version` on concurrent edits.
- **S5** — CSP route derives from filesystem (verify only); menu entry enabled in the same PR; version bump in the three files (0.23.0); one local E2E spec.

## Tasks

- [x] T1 (S1-S4) `/clientes` screen: paginated list, search, create/edit dialog (nombre/comercial, RNC/cédula with validation, contacto, crédito: plazo and límite ADMIN-ONLY fields), desactivar with confirmation. Backend extensions additive only where the read projection/dialog needs fields missing today (mirror the Step 2 option-A pattern: RED→GREEN per rule, existing suites unchanged). Risk: none beyond S4 (credit-visibility gate is the security-sensitive bit — if the domain lacks a credit-field separation, STOP and report instead of inventing one).
- [x] T2 (S5) E2E spec (admin creates/edits/deactivates; Operador sees no manage buttons AND no credit fields; Despachador same), menu entry, version bump 0.23.0 in three files.
- [ ] T3 Reconciliation: full unit + focused checks, tracker, single PR (issue-first).

## Log

- L1 (2026-11-10): owner approved Step 3 ("Go to step 3, pls") after Step 2 shipped (v0.22.0 deployed, smoke 7/7, demo 5/5). Backend readiness verified read-only: all five use cases + actions exist in `src/modules/cliente`.
- L2 (2026-11-10): T1 and T2 built on `feature/screens-clientes`, one commit per slice (backend extension + tests; screen + component tests; e2e + menu + 0.23.0). **Specs covered:** S1 (list with 25/page, search, create/edit dialog, RNC/cédula via the shared DGII mod-11 validator), S2 (reuses the Productos list + dialog pattern and its 44/48px, 8px classes; no wireframe), S3 (Operador/Despachador view-only with **zero** manage markup and **no** credit columns; the Administrador manages; credit fields Administrador-only on create and edit, re-checked server-side), S4 (soft delete `activo=false`, `withTenantTransaction`, server-side role gates, stable error codes, 25/page pagination, DGII validation in the domain, optimistic lock on `version`), S5 (menu entry enabled, version 0.23.0 in the three files, `e2e/clientes.spec.ts`; the CSP guard derives routes from the filesystem and needs no edit). **Backend extension (additive):** `estado` filter joined the legacy `incluirInactivos` switch, `listarClientes` returns the page size and clamps a page past the end, `obtenerPermisosClienteAction` answers manage/credit visibility from the named groups, `llevaCreditoEnCreacion` mirrors `llevaCamposDeCredito`; the action result shape stayed `{ items, total, page }` so the venta/devolucion/cobros consumers keep their contract. **Breaking (deliberate, S3/L9):** `Operador` can no longer create/edit/deactivate clients; `ROLES_GESTION_CLIENTES` is now `["Administrador"]` and one existing action-test expectation was updated for it. **Not in this task's edit surfaces:** the Status table in `odd/tasks/frontend-screens-plan.md` still says "not started" for Step 3 — the parent owns that file. The integration suite (`cliente-tenant.integration.test.ts`) was not run here (needs the real Postgres harness); its own role arrays are unaffected by the new group names.
