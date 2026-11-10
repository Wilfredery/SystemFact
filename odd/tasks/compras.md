# Compras screen (Step 6, frontend-screens-plan)

Feature branch: `feature/screens-compras` · target version 0.25.0 · issue-first PR gate.

## Specs

- S1. Wireframe `05-Compras` 05a-Compra-Nueva (roles label: Administrador): purchase form with Proveedor (+RNC shown), Fecha, Tipo `Formal → B01`, Sucursal selector, lines (Código, Producto, Cantidad, Unidad, Costo Unit., Costo Total, ITBIS %, Acciones ✕), "+ Agregar producto", fiscal breakdown (Subtotal, ITBIS por línea, Ret. ISR (2%), Ret. ITBIS (solo B11), Total), buttons Guardar Borrador / Confirmar Compra, estado badge Borrador.
- S2. Reception checkbox "Recibir mercancía al confirmar compra": when checked, confirmarCompraAction then recibirCompraAction run in sequence; when it fails, show the typed error and keep the purchase state visible.
- S3. Roles: per owner L8/L9 pattern, one named group per capability in `compra/http/shared.ts` — `ROLES_VER_COMPRAS` (Administrador, Operador, Despachador) and `ROLES_GESTION_COMPRAS` (Administrador). Reads (list, detail, permisos) use VER; create/update/confirm/cancel/receive use GESTION. Screens and actions read groups, never literal role names; changing a role later is a one-line edit.
- S4. List page `/compras` (server component, clone the Proveedores pattern): paginated 25/page, corrida columns correlativo, proveedor, tipo, NCF, estado badge, fecha, total; estado + tipo + proveedor-search filters; obtenerPermisosCompraAction drives Acciones visibility; deny-by-default.
- S5. Borrador editing (create + edit lines), Confirmar (shows returned retentions), Recibir (PENDIENTE only), Cancelar with mandatory motivo; Cancel hidden/disabled for RECIBIDA (no state path exists); PAGADA out of scope.
- S6. Decimal inputs sent as strings (cantidad 12,3; costo 12,2); money/quantities never floats in UI math display.
- S7. Backend gaps closed additively: filtered `listarCompras` (estado, tipoCompra, proveedor busqueda, page/limit), `obtenerCompraAction` reuse for detail, `obtenerPermisosCompraAction` mirroring `obtenerPermisosProveedorAction`.
- S8. CxP view read-only via `consultarCxPAction` (Administrador-only FIN-3): saldoPendiente, pagos, proveedor; no payment-creation backend this PR (YAGNI).
- S9. Tests: RTL specs for the screen; unit tests for new validations/actions; one local E2E spec `app/e2e/compras.spec.ts` (no skips; admin CRUD, Operador/Despachador view-only); register nav entry (enables Compras in shell.tsx; nav-routes guard test) and the `/compras` route is auto-covered by csp-authenticated.spec.ts.
- S10. Version bump 0.25.0 in final patch commit (package.json + manifest + CHANGELOG, UTF-8 no BOM); Conventional commits; squash-merge with Closes #N.

## Tasks

- T1 (S3,S7) role groups + filtered listarCompras + permisos action (backend, own commit)
- T2 (S4,S6) list page + filters + nav entry + RTL spec
- T3 (S1,S2,S5,S6) create/edit form + confirm/receive/cancel flows + RTL spec
- T4 (S8) CxP read-only tab
- T5 (S9,S10) E2E spec + e2e seed roles check + version bump + tracker log

## Log

- L1 (2026-11-10): "Continue with step 6: compras" — original request verbatim.
- L2: Wireframe 05-Compras extracted and read (Penpot zip → scratch dir outside repo, deleted after): labels/fields recorded in S1; roles label "Administrador" on 05a; reception checkbox exists; no list filters drawn (S4 filters come from the owner's standing "filters on lists" answer).
- L3: Backend map (explorer handoff): states BORRADOR/PENDIENTE/RECIBIDA/CANCELADA; retentions matrix in domain/calculators.ts; avg cost company-wide on recibir; cancelar does NOT reverse inventory and RECIBIDA has no cancel path (UI must reflect); CxP read-only at reportes (FIN-3); all compra actions currently ROLES_ADMIN_ONLY.
- L4 (2026-11-10): T1 (S3,S7) done: `compra/http/shared.ts` now has the named capability groups `ROLES_VER_COMPRAS` (Administrador, Operador, Despachador) and `ROLES_GESTION_COMPRAS` (Administrador), replacing the old admin-only literal; reads use VER, writes use GESTION. New `obtenerPermisosCompraAction` mirrors the proveedor one (deny-by-default). `zListarComprasQuery` + `listarCompras`/`listarComprasEnTx`/`contarComprasEnTx` accept optional estado, tipoCompra and proveedorBusqueda (AND-combined, same `where` for page and count); pagination and empresaId tenancy unchanged.
