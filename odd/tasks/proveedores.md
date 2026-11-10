# proveedores — Step 4 of the screens plan: the Proveedores screen

Objective: a Proveedores screen over the EXISTING proveedor backend (crear/actualizar/desactivar/listar use cases and typed HTTP actions already exist). No wireframe: reuse the Productos/Clientes list + dialog pattern. The owner reviews the result on the demo company.
Parent plan and hand-off: `odd/tasks/frontend-screens-plan.md` (Step 4). Suppliers appear as a field in the future purchase form (Step 6), so this screen is also a prerequisite for it.

## Specs

- **S1** — plan Step 4 (quoted): "Proveedores | S/M | Needed before purchases".
- **S2** — plan open question 2 (quoted): "reuse the existing components and the 44/48px, 8px rules, keep one consistent list + dialog pattern, and have the owner review each screen on the demo company."
- **S3** — L9 (quoted): "Operador and Despachador view-only for both, with the Administrador managing." Applied to Proveedores: Operador/Despachador see the list (they receive purchases), Administrador manages. There are NO admin-only field groups analogous to client credit unless the domain already separates them — do NOT invent one.
- **S4** — AGENTS.md: master entity never deleted (`activo=false`); multi-tenancy + `withTenantTransaction`; server-side role gate; stable error codes; paginated lists (25 default, max 100); RNC/cédula validation if the domain owns it; optimistic locking `version` on concurrent edits.
- **S5** — CSP route derives from filesystem (verify only); menu entry enabled in the same PR; version bump 0.24.0 in the three files; one local E2E spec.

## Tasks

- [x] T1 (S1-S4) `/proveedores` screen: paginated list, search, create/edit dialog (nombre/razón social, RNC/cédula if the domain validates it, contacto, dirección), desactivar with confirmation. Backend extensions additive only where the screen needs fields missing today (Step 2/3 option-A pattern: RED→GREEN per rule, existing suites unchanged). Risk: none beyond S4.
- [x] T2 (S5) E2E spec (admin creates/edits/deactivates; Operador/Despachador view-only), menu entry, version bump 0.24.0 in three files.
- [ ] T3 Reconciliation: full unit + focused checks, tracker, single PR (issue-first, "Closes #N" in the squash message).

## Log

- L1 (2026-11-10): owner approved Step 4 ("Go") right after Step 3 shipped (v0.23.0 deployed, smoke 7/7, demo 5/5). Backend readiness verified read-only: crear/actualizar/desactivar/listar use cases + actions exist in `src/modules/proveedor`.
- L2 (2026-11-10): T1 and T2 are implemented on branch `feature/screens-proveedores` (three commits: backend extension, screen + component tests, e2e + menu + 0.24.0); nothing pushed. **Backend extension (additive):** `obtenerProveedor` + `obtenerProveedorAction` (single read with the stored `version` for the optimistic lock) and `obtenerPermisosProveedorAction`; one named role group per capability in `http/shared.ts` — `ROLES_VER_PROVEEDORES` (Administrador, Operador, Despachador) for list and detail, `ROLES_GESTION_PROVEEDORES` now Administrador-only (L9, breaking for Operador), `ROLES_ADMIN_ONLY` for deactivation. **Fields:** the domain owns nombre, RNC (9–11 digits after stripping separators, blank = informal), contacto, teléfono, tipoProveedor and tipoPersona. There is **no `direccion` column** on `PROVEEDOR` and adding one needs a Prisma migration, which is outside this task's edit surfaces — the screen shows contacto + teléfono and the dialog has both fiscal classifications. **Open for the owner:** say if a supplier address column is wanted (it becomes its own migration commit).
- L3 (2026-11-10): verification run locally: `npx jest` full unit suite green (169 suites / 1651 tests), `npx tsc --noEmit` clean, ESLint clean on the new files. The local E2E lane was **not** run in this session (it needs the ephemeral Supabase stack and a built app); `e2e/proveedores.spec.ts` is typechecked and linted only, so CI is its first real execution. Remaining for T3: the PR (issue-first, "Closes #N") and the tracker/status handoff by the parent.
