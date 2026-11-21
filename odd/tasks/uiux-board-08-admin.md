# UI/UX board 08 — Administración (factura.penpot 08a/08b/08c)

Branch `feature/uiux-board-08-admin` · target v0.42.0 · UI-only plus one read action. Parent tracker: `odd/tasks/uiux-alignment.md`.

## Specs

- S1 Tabs follow wireframe 08 exactly: **Empresas, Sucursales, Usuarios, Roles, Configuración**, in that order; the default tab is Empresas. Unknown `tab` param falls back to Empresas.
- S2 Empresas tab is READ-ONLY: the session company (name, its branches, Estado). NO "+ Nueva empresa", NO Editar, NO Eliminar, NO Desactivar: no company write use case exists, tenant provisioning is high risk (ADR needed) and master entities are never deleted (AGENTS.md). Reported as a deferred decision, not silently dropped.
- S3 Roles tab is READ-ONLY: the active role catalog (`consultarRolesCatalogo`) fed by a new thin read action `listarRolesAdministracionAction`, server-side gated by `ROLES_VER_ADMINISTRACION`, wrapped in `withTenantTransaction`. No role editing.
- S4 Usuarios tab: the Roles column shows every role joined with " · " (wireframe 08b). Existing writes (Cambiar roles, Activar/Desactivar, Mover de sucursal) stay as visible touch buttons (fewer taps than a menu). "+ Nuevo usuario" stays absent (owner withdrew in-app user creation).
- S5 Sucursales tab gains a "Buscar sucursal..." search box (client-side filter over the already-loaded list, 300 ms debounce not needed: no network).
- S6 Configuración: NO global "Guardar cambios" (per-row/card edit keeps its own confirm; a global save adds partial-edit risk). NCF sequences stay READ-ONLY (consumption is atomic and server-controlled). ITBIS keeps validity (Vigente desde/hasta) and its existing validated edit.
- S7 Every raw Tailwind palette class in the Administración UI files (`AdministracionScreen`, `GestionUsuarioDialogs`, `GestionSucursalDialog`, `EditarTasasItbisCard`, `administracion/page.tsx`) maps to F0 tokens; a source-level no-raw-palette guard test pins it.
- S8 Accessibility: tablist/tab semantics with `aria-selected`, `aria-controls` and a tabpanel; touch targets stay `min-h-11`.
- S9 No authorization change: the Empresas and Roles tabs deny every role except Administrador, proven by tests; every action keeps its server-side re-check.
- S10 Version bump 0.42.0 (`app/package.json`, `.release-please-manifest.json`, `app/CHANGELOG.md`, UTF-8 no BOM).

## Tasks

- [x] T1 (S1,S2,S3,S9) tabs + Empresas + Roles + new read action + tests
- [x] T2 (S4,S5,S7,S8) Usuarios/Sucursales alignment + token retrofit + guard
- [x] T3 (S6,S7) Configuración alignment + tokens (T1-T3 ship in one feature commit: the worker interleaved them in the same files)
- T4 (S10) bump + tracker log, JD dual review, PR, merge, deploy, smoke, tag+release (owner-approved)

## Log

- L1: "Go with board 8, check, recheck, evaluate and do an audit with the recommendations, pls"
- L2: "Go with recomendations in the professional, recent practice, safe and security way, pls." (approves BOARD REPORT 08 items 1-12; owner standing order 2026-11-07: parent runs prod flows after deploy, tag+release after everything looks good, per L-board07.)
- L3: Deviations from the report, to disclose: item 3 "Desactivar" for companies is NOT built (no company write use case exists; a dead or unsafe control is worse than none); item 5 row menu replaced by visible buttons (fewer taps).
- L4: worker pass verified by parent: tsc clean, eslint clean, jest tenant 37 suites / 537 tests green. page.tsx switched to `getCurrentTenantHeader` (TenantCtx has no empresaNombre). Playwright e2e edited, runs in CI only.
