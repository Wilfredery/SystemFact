# Administración screen (Step 7, frontend-screens-plan) — read-only first

Branch `feature/screens-administracion` · target v0.26.0 · issue-first PR gate.

## Specs

- S1 (owner decision 2026-11-10: "Read-only first"). PR #1 is a read-only directory: NO user creation (standing decision), NO role assignment, NO branch assignment, NO activate/deactivate writes, NO RLS changes. Those are deferred to a later PR.
- S2 Wireframe 08-Administración has three tabs; PR #1 renders all three read-only:
  - S2a Usuarios: search "Buscar usuario...", columns Usuario (nombreUsuario), Nombre, Rol, Empresa/Sucursal, Estado (Activo/Inactivo badges), no Acciones column.
  - S2b Empresas y sucursales: columns Empresa, Sucursales, Estado; no create/edit actions.
  - S2c Configuración: Parámetros del sistema read-only — ITBIS general/reducido with vigencia, retenciones (Ret. ISR servicios profesionales/técnicos, Ret. ITBIS compra informal), NCF numeración per type (B01/B02/B04) with rango, secuencia actual, vigenciaFin and % used.
- S3 Roles per L8/L9 pattern: named groups in `tenant/http/shared.ts` — `ROLES_VER_ADMINISTRACION` (Administrador) for this read-only build; Operador/Despachador get an access message (no data) per deny-by-default. No literal role names outside shared.ts.
- S4 Backend additive only: expose `listarUsuarios` (search nombreUsuario/nombre, filter activo, page/pageSize per shared pagination, returns roles list + sucursal name + empresa name via ctx header), `listarSucursalesDeEmpresa` action (existing use case), `obtenerPermisosAdministracionAction`, and a configuración read action reusing existing config/NCF repositories (no Prisma in http). All inside withTenantTransaction.
- S5 RLS constraint respected: user listing shows the users of the session branch per existing `usuario_select` policy (P6 closed company-wide admin mode). A company-wide listing needs a new RLS policy — DEFERRED, explicitly out of scope; the screen shows only its branch's users and documents this.
- S6 Screen `/administracion` clones the Compras pattern: server page (tenant ctx → /login; permisos deny-by-default), client island with 300 ms debounced search, estado filter, 25/page, "Página X de Y", tab toggle ( Usuarios / Sucursales / Configuración — URL param, no client constants imported by the server page), data-testid="usuario-fila-${id}", no dialog (read-only) hence no dialog-scroll risk.
- S7 Nav entry "Administración" enabled (disabled:false → /administracion) in the same PR; nav-routes guard satisfied; /administracion auto-covered by csp-authenticated.spec.ts.
- S8 Tests: RTL specs (three tabs, admin sees data, Operador/Despachador access message, filters, pagination, empty state); unit tests for new actions/validations; integration where touched; one local E2E spec `app/e2e/administracion.spec.ts` (admin sees usuarios/sucursales/configuración; Operador and Despachador get the access message; no skips).
- S9 Version bump 0.26.0 in the final patch commit (package.json + manifest + CHANGELOG, UTF-8 no BOM); Conventional commits; squash-merge with Closes #N.

## Tasks

- T1 (S3,S4,S5) tenant backend read actions + validations + role group (own commit)
- T2 (S2,S6,S7) screen with three tabs + nav entry + RTL specs
- T3 (S8,S9) E2E spec + version bump + tracker log

## Slices

- Slice A (T1, commit b3e51f7): read-only backend (4 actions, repositories, 6 new test suites; gga review PASSED). Gap: Configuración has no ITBIS reader — S2c renders that half as a documented gap.

## Log

- L1 (2026-11-10): "Go" (owner approval to start Step 7 after Step 6 shipped). Verbatim request chain: "Continue with step 6: compras" → shipped → "Go" (deploy arc) → "Go" (start Step 7).
- L2: Explorer handoff — no listarUsuarios/listarSucursales actions exist; RLS `usuario_select` shows own branch only (P6 closed company-wide admin mode); wireframe 08 extracted 2026-11-10: boards 08a Empresas-Sucursales, 08b Usuarios-Roles (+ Nuevo usuario — deferred), 08c Configuración (ITBIS 18/16%, retenciones, NCF secuencias B01/B02/B04).
- L3 (owner decision, ask_user_question 2026-11-10): PR #1 scope = "Read-only first" — directory screens only, no RLS changes, no assignment writes; assignments/edits later.
- L4 (2026-11-10, T1 backend): read-only tenant backend landed — `tenant/http/shared.ts` (`ROLES_VER_ADMINISTRACION = ["Administrador"]`, the ONE place role names for this capability are written), `listarUsuariosAction` + `application/listar-usuarios.ts` + `infrastructure/usuario-repository.ts`, `listarSucursalesDeEmpresaAction` (thin adapter over the existing use case), `obtenerPermisosAdministracionAction`, `consultarConfiguracionAction` + `application/consultar-configuracion.ts` + `infrastructure/administracion-config-repository.ts`. Denial uses the existing tenant code `TEN_OPS_NO_AUTORIZADO` (no new error code). Gaps found while reading the existing repositories, none fabricated:
  - **ITBIS rates are NOT exposed**: no existing tenant reader returns a `TASA_ITBIS` rate with its validity window (`venta` validates the per-product `tasaItbis`/`itbisVigenteDesde`; the shared `ConfiguracionEmpresa` seam returns only `clave`/`valor`). The field is OMITTED from `consultarConfiguracionAction`; S2c's ITBIS half needs its own reader (deferred, out of T1's surfaces).
  - **Config vigencias are NOT exposed** for the same reason (`leerConfigActivaEnTx`/`leerConfigsActivasEnTx` select `clave`/`valor` only), so retentions show rate only, no validity window. NCF rows DO carry `vigenciaFin` (ncf reader).
  - **Retentions** come from compra's `leerTasasRetencionEnTx`, which hard-fails with `CONFIG_RETENCION_FALTANTE` when a key is missing/expired: the read view maps that to `retenciones: null` ("no configurada"), never a fabricated 0%.
  - **NCF read** reuses ncf's only read, `bloquearSecuenciaActivaEnTx` (`FOR UPDATE`). The lock lives only for this read-only transaction (released at commit); a lock-free read would require editing the ncf module (out of scope).
  - **Sucursales**: the existing use case returns active branches only (`{id, nombre}`), so the action has no per-branch `estado` to expose; T2 renders them as active.
  - **Usuarios (S5)**: the query pins `empresaId` only and deliberately adds NO `sucursalId` predicate — the branch scope stays owned by the existing `usuario_select` RLS policy; the branch GUC is never blanked and no policy/migration was touched. Company-wide listing remains DEFERRED.
- L5 (2026-11-10, T2 screen): read-only `/administracion` shipped — server page (`app/src/app/(app)/administracion/page.tsx`) validates `tab`/`page`/`busqueda` (sliced to 100)/tri-state `activo` and reads the CURRENT tab through the T1 actions in ONE `Promise.all` with the permission probe; deny-by-default renders only the access message. Client island `tenant/ui/AdministracionScreen.tsx` (three tabs, 300 ms debounced search, tri-state estado filter, 25/page, "Página X de Y", `usuario-fila-${id}`, stale-result guard) with the PURE `tenant/ui/administracion-tabs.ts` helper (server page imports the tab values/query builders from it, never from the `"use client"` module). Nav "Administración" enabled in `shell.tsx`. Configuración renders retentions + NCF rows and the explicit "No disponible aún" ITBIS note (L4 gap). 20 RTL tests (2 suites) cover the three tabs, both deny paths, the URL contract and pagination.
