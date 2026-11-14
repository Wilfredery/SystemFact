## [0.28.0](https://github.com/Wilfredery/SystemFact/compare/v0.27.0...v0.28.0) (2026-11-14)

### Features

* **tenant:** the **Administración** screen can now **change a user's roles** and **activate or deactivate a user** (Step 7b), Administrador only. The Usuarios tab gets an `Acciones` column with "Cambiar roles" (one checkbox per active role, at least one required) and "Desactivar"/"Activar" (confirmation dialog). The new state is shown only after the server confirms it, the list is re-read so the next write carries the new `version`, and every refusal renders its catalog message (a version conflict reloads the row and asks for an explicit retry). Your own row is disabled. Operador and Despachador still see only the access message. **Out of scope on purpose:** creating users, passwords, branch moves and a company-wide listing; creation stays operator-side (`app/USER-PROVISIONING.md`), no service-role key in the app.
* **tenant (backend):** `cambiarRolesUsuarioAction` and `cambiarEstadoUsuarioAction` behind `ROLES_GESTION_USUARIOS` (deny-by-default, `TEN_OPS_NO_AUTORIZADO`), strict input validation (ids bounded to int4), all inside `withTenantTransaction`. Inside the transaction: the target and the branch's active administrators are locked in id order, the actor is re-checked as an active Administrador under the lock, a stale `version` always conflicts (`TEN_CONCURRENCIA_CONFLICTO`), no self-deactivation or self-demotion (`TEN_AUTO_PROTECCION`), the branch always keeps an active Administrador (`TEN_ULTIMO_ADMINISTRADOR`), an unknown, foreign-tenant or other-branch id is `TEN_USUARIO_NO_ENCONTRADO` (no oracle), and an invalid role is `TEN_ROL_NO_VALIDO`. A repeat with the same effect is a no-op (no version bump, no audit row). Every real change appends one audit row with before and after. Users are never deleted. Deactivation takes effect on the user's next request.

### Security

* **rls (migration `20261114120000_usuario_writes_admin_only`):** writes on `USUARIO` and `USUARIO_ROL` are now **role-aware at the database**: INSERT, UPDATE and DELETE require `app.current_es_admin = 'true'` plus the tenant and branch scope (or bootstrap). Before, any same-branch session could write them at the DB level. SELECT policies are unchanged; `ROL` and audit are untouched. The login flow keeps its one exception, the lazy `authUserId` bind.
* **rls (migration `20261114130000_usuario_login_flow_column_guard`):** a `BEFORE UPDATE` trigger lets the login flow change only `authUserId` (RLS cannot restrict columns; found by the native review of the previous migration). A drift test fails if `USUARIO` gains a column the guard does not list.

### Tests

* **unit:** domain invariants, use cases, validations and actions (76 new), the Usuarios list and roles catalog readers, and the RTL suite for the column, dialogs, error mapping, pending state and own row (29).
* **integration (real Postgres, `systemfact_app` role):** the DB wall (Operador refused on UPDATE, INSERT and DELETE, cross-tenant, SELECT unchanged, login flow and bootstrap intact), the login-flow column guard, and the write use cases including a concurrency test on the last administrator and the audit rows.
* **e2e:** `administracion.spec.ts` runs the write flow on a dedicated throwaway user (`e2e-gestion-objetivo`, seeded in the CI fixture) and restores it; Operador and Despachador see no controls. No test may skip.

## [0.27.0](https://github.com/Wilfredery/SystemFact/compare/v0.26.0...v0.27.0) (2026-11-14)

### Features

* **caja:** the **Caja** screen (`/caja`), Step 8 of the screens plan: the **Cierre diario de caja** for today in `America/Santo_Domingo` (no retroactive date selector) with Total facturado, Total cobrado, Efectivo esperado and Diferencia, the per-method Ventas/Cobros table and the corte block, plus the separate **Resumen del día** (ventas, costo de lo vendido, margen bruto, margen %). Negative figures keep their sign, the scope label states the real scope (branch or company), and Total cobrado counts only cobros. **Cerrar caja** stays disabled with a "Próximamente" hint: the close is a derived report, nothing is persisted. No migration, no schema change, RLS untouched.
* **caja:** **Exportar PDF** of the daily close, generated server-side at `/api/caja/cierre-pdf` (Node runtime, session required, role gate before any aggregate, everything inside `withTenantTransaction`, no query parameters, `Cache-Control: no-store`). It reuses the screen's own use case, labels and formatters, so PDF and screen cannot diverge.
* **caja (backend, additive):** a pure domain (SD day window, efectivo esperado, diferencia, margen) with no DB or framework imports, a read-only repository over `PAGO`/`VENTA` by SQL aggregation, and read-only Server Actions behind `ROLES_VER_CAJA`, deny-by-default.

### Dependencies

* **pdfkit** 0.20.2 and **@types/pdfkit** 0.17.7 added in their own commit, for the server-side PDF only (built-in Helvetica, no client JS).

### CI

* **ci:** the Playwright jobs (`e2e` in `ci.yml`, `prod-smoke.yml`, `prod-demo.yml`) run on `ubuntu-24.04` instead of `ubuntu-latest`: the runner image moved to Ubuntu 26.04, where Playwright 1.57.0 fails with "does not support chromium on ubuntu26.04-x64". Revisit when Playwright is upgraded.

### Tests

* **unit:** the domain (day boundary incl. 03:59 UTC, efectivo esperado, diferencia, margen), the use cases, the repository, the validations and role gate, the screen and page RTL suites, and the PDF builder (real pdfkit) and route specs (401/403/200/typed refusal).
* **integration:** `caja.integration.test.ts` against a real Postgres for the daily close.
* **e2e:** `caja.spec.ts` (3 tests). No test may skip.

## [0.26.0](https://github.com/Wilfredery/SystemFact/compare/v0.25.0...v0.26.0) (2026-11-10)

### Features

* **tenant:** the **Administración** screen (`/administracion`), Step 7 of the screens plan, **read-only first** (owner decision: directory only, no RLS change): three tabs over one server page and a client island. **Usuarios** lists the session branch's users (search by `nombreUsuario`/nombre debounced at 300 ms, Activos/Inactivos/Todos filter, 25 per page, "Página X de Y") with Usuario, Nombre, Rol, Empresa/Sucursal and Activo/Inactivo badges — the branch scope is the existing `usuario_select` RLS policy, so a company-wide listing stays deferred. **Sucursales** shows the caller empresa's active branches from the existing use case. **Configuración** renders the read-only system parameters: the retentions, the NCF sequences (rango, secuencia actual, vigencia fin and % used) and an explicit "No disponible aún" note for the ITBIS rates, because no backend reader exposes a rate with its validity window yet. No create, edit, role or branch assignment, activate/deactivate or `Acciones` column anywhere — for any role. The "Administración" menu entry is enabled in the same release.
* **tenant (backend, additive):** one named role group, `ROLES_VER_ADMINISTRACION` (Administrador), in `tenant/http/shared.ts` — the single place a role name is written for this capability, deny-by-default for Operador and Despachador. Four read-only Server Actions inside `withTenantTransaction`: `listarUsuariosAction` (paginated `empresaId`-scoped listing, branch scope left to RLS), `listarSucursalesDeEmpresaAction` (thin adapter over the existing use case), `obtenerPermisosAdministracionAction` and `consultarConfiguracionAction` (a read-only view over the existing configuration/NCF readers; a missing or expired retention config renders as "no configurada", never a fabricated 0%). No Prisma in `http`, no error code invented (denial reuses `TEN_OPS_NO_AUTORIZADO`), no existing behavior changed.

### Tests

* **unit:** the role group on every read action and on the permission seam, the paginated/tenancy-scoped listing, the configuration view (retentions absent, NCF % used) and the pure NCF usage math. RTL suites cover the three tabs, the columns and rows, the debounced search and estado filter, pagination, the empty state, the URL contract and both deny paths (no data, only the access message).
* **e2e:** `administracion.spec.ts` has the Administrador read all three tabs — the Usuarios rows asserted by set equality against the branch's users in the database, the branch rows and the seeded B01/B02 NCF sequences — and Operador and Despachador land on the access message with no tabs, no tables and no rows. No write control exists for any of them. No test may skip.

## [0.25.0](https://github.com/Wilfredery/SystemFact/compare/v0.24.0...v0.25.0) (2026-11-10)

### Features

* **compra:** the **Compras** screen (`/compras`), Step 6 of the screens plan: a paginated list (25 per page) with the corrida columns correlativo, proveedor, tipo, NCF, estado badge, fecha and total, plus estado and tipo de compra filters and a debounced supplier search that both keep the page size and the frozen enums. Menu entry enabled in the same release.
* **compra:** the **purchase dialog** — supplier with its RNC, fecha (the `America/Santo_Domingo` business day), tipo de compra with its receipt kind shown as text (`B01` for mercancía, `B11` otherwise), the session **sucursal read-only** (the backend takes it from the context), and a lines editor with product search, quantity and cost as the exact typed Decimal strings and the per-line ITBIS rate frozen from the product. The fiscal breakdown is computed by the purchase **domain's own calculators**, never by float math and never re-implemented in the screen; the retention rows show the values the confirm returned, because the rates are tenant configuration. **Guardar Borrador** and **Confirmar Compra** persist in the right order, and the **Recibir mercancía al confirmar compra** checkbox chains the receipt after a settled confirmation: a typed refusal is shown and the purchase stays visible, never rolled back or retried.
* **compra:** **row actions per frozen state** — Editar and Confirmar for `BORRADOR`, Recibir for `PENDIENTE`, Cancelar for `BORRADOR`/`PENDIENTE` with a **mandatory motivo**, and **no cancel control on `RECIBIDA`** because the domain has no path back from it. Row Confirmar shows the returned ISR/ITBIS retentions, a read-only detail reuses the existing single-purchase read, and the write buttons disable while a row is being processed. A cancellation is not a deletion: the correlativo and the history are preserved.
* **compra:** the read-only **Cuentas por pagar** section (S8/FIN-3) below the list: documento, proveedor, fecha, sucursal, total, pagos, saldo pendiente and estado, plus the page-independent summary strip and link pagination that keeps the list filters. The gate is **server-side**: the same permission seam the Acciones column uses decides whether the report read is issued at all, and a refusal renders no section — never an empty shell. No payment-creation surface exists (YAGNI).
* **compra (backend, additive):** one named role group per capability in `compra/http/shared.ts` — `ROLES_VER_COMPRAS` (Administrador, Operador, Despachador) and `ROLES_GESTION_COMPRAS` (Administrador) — so reads (list, detail, permisos) and writes (create, update, confirm, cancel, receive) each name a group instead of a literal role, and no screen reads a role name. `listarCompras` gained the optional `estado`, `tipoCompra` and `proveedorBusqueda` filters (AND-combined, the same `where` for page and count), and a new `obtenerPermisosCompraAction` mirrors the proveedor permission seam (deny-by-default). No existing behavior changed for callers that pass none of the new filters.

### Tests

* **unit:** the role groups on the read and write actions and on the permission seam, the filtered listing (filters, pagination and tenancy), the purchase dialog (local rules, Decimal strings, the domain preview, confirm with the returned retentions, reception chaining and its typed refusal), the row-action state matrix including no cancel for `RECIBIDA`, and the CxP panel (columns, summary strip, empty state, link pagination, no write controls). The Compras page test covers the role gate, the URL filters, the CxP gate and the deny-by-default fallback.
* **e2e:** `compras.spec.ts` has the Administrador create a draft (the supplier is created through the Proveedores screen, because the CI fixture seeds none), assert the domain preview and the stored totals, edit the lines, confirm (asserting the atomic `CMP-%06d` correlativo and the frozen retentions), receive (asserting the `ENTRADA_COMPRA` movement and the branch stock delta) and cancel a second draft (asserting `CANCELADA` and that both rows still exist). Operador and Despachador read the list with no manage controls and no CxP section. No test may skip.

## [0.24.0](https://github.com/Wilfredery/SystemFact/compare/v0.23.0...v0.24.0) (2026-11-10)

### ⚠ BREAKING CHANGES

* **proveedor:** `Operador` can no longer create or edit suppliers; only `Administrador` manages them (deactivation was already Administrador-only). Owner decision, screens plan Step 4 with L9: "Operador and Despachador view-only for both, with the Administrador managing." The Proveedores screen needs one named role group per capability in `src/modules/proveedor/http/shared.ts` (`ROLES_VER_PROVEEDORES`, `ROLES_GESTION_PROVEEDORES`, `ROLES_ADMIN_ONLY`), so changing who may do what later is a one-line edit. `Operador` and `Despachador` still READ the supplier list — they receive purchases.

### Features

* **proveedor:** the **Proveedores** screen (`/proveedores`), Step 4 of the screens plan: a paginated list (25 per page) with search by name or RNC and an Activos / Todos los estados filter, the columns name, RNC, contacto, teléfono, tipo de proveedor, tipo de persona and status, and a **create/edit dialog** with nombre o razón social, **RNC validated with the domain's own rule** (separators stripped, 9–11 digits, blank allowed for an informal supplier, so the form stops exactly what the server would refuse), contacto, teléfono and the two frozen fiscal classifications (`tipoProveedor` FORMAL/INFORMAL, `tipoPersona` FISICA/JURIDICA). **Desactivar** asks for confirmation and sets `activo=false`: a supplier is never deleted, so its history, its purchases and its RNC are preserved; the server still refuses while a non-cancelled purchase references it. The edit dialog prefills from a fresh single-supplier read and sends the row `version` back, so a concurrent edit is refused with the fixed conflict message instead of silently overwritten. **Roles (S3/L9):** the Administrador manages; Operador and Despachador are view-only and get no manage markup at all, and the write actions re-check the role group on the server. Menu entry enabled in the same release.
* **proveedor (backend, additive):** a single-supplier read use case and action (`obtenerProveedor` / `obtenerProveedorAction`) returning the stored `version` for the optimistic lock, a permission seam (`obtenerPermisosProveedorAction`) that answers the screen from the manage role group, and the read actions moved to the named view group (`ROLES_VER_PROVEEDORES`: Administrador, Operador, Despachador). No existing behavior below the new fields changed: the listing DTO, the search translation and the deactivation guard keep their contract.

### Tests

* **unit:** the single-supplier read (stored version, foreign-tenant id indistinguishable from a missing one, invalid id refused without store access), the new actions (view group on list and detail, manage group on create/edit, Admin-only deactivation asserted against a refusal for every write) and the permission seam (manage yes/no, no session). Component tests mirror the clientes-ui/clientes-page specs: list columns and rows, view-only markup with zero manage controls, filters, debounced search, pagination, create (including the RNC the domain refuses and the blank RNC sent as `null`), edit (prefill from the single read, `version` round-trip, conflict message) and deactivation with confirmation; the page test covers the role gate, the query parameters, the deny-by-default permission fallback and the `/login` redirect.
* **e2e:** `proveedores.spec.ts` has the Administrador create a supplier (unique 9-digit RNC), check it against the database, edit its contact and phone (asserting the version bump), and deactivate it (asserting `activo=false` and that the row still exists), then Operador and Despachador read the list with no manage controls and no screen alert. The CSP guard needs no edit: it derives the routes from the filesystem and now covers `/proveedores`.

## [0.23.0](https://github.com/Wilfredery/SystemFact/compare/v0.22.0...v0.23.0) (2026-11-10)

### ⚠ BREAKING CHANGES

* **cliente:** `Operador` can no longer create, edit or deactivate clients; only `Administrador` manages them, and the credit fields stay Administrador-only on both create and edit. Owner decision, screens plan Step 3 with L9: "Operador and Despachador view-only for both, with the Administrador managing." The Clientes screen needs one named role group per capability in `src/modules/cliente/http/shared.ts` (`ROLES_VER_CLIENTES`, `ROLES_GESTION_CLIENTES`, `ROLES_GESTION_CREDITO`, `ROLES_ADMIN_ONLY`), so changing who may do what later is a one-line edit. `Operador` and `Despachador` still READ the client list — they sell to and collect from those clients.

### Features

* **cliente:** the **Clientes** screen (`/clientes`), Step 3 of the screens plan: a paginated list (25 per page) with search by name or RNC/cédula and an Activos / Inactivos / Todos los estados filter, the columns name, RNC/cédula, phone, type, credit, limit, term and status, and a **create/edit dialog** with nombre o razón social, **RNC/cédula validated with the shared DGII mod-11 rule** (the same one the domain runs, so the form stops exactly what the server would refuse), teléfono, dirección, classification and the **credit fields** (habilitar crédito, límite de crédito as a Decimal(12,2) string, plazo de crédito in days). **Desactivar** asks for confirmation and sets `activo=false`: a client is never deleted, so its history, its documents and its RNC are preserved; the server still refuses while a non-cancelled sale references the client. The edit dialog prefills from a fresh single-client read and sends the row `version` back, so a concurrent edit is refused with the fixed conflict message instead of silently overwritten. **Roles (S3/L9):** the Administrador manages; Operador and Despachador are view-only and get **no credit fields at all**, not even as read-only columns, and the write actions re-check both the manage group and the credit group on the server. Menu entry enabled in the same release.
* **cliente (backend, additive):** `listarClientes` gained the `estado` filter (activos / inactivos / todos) while the previous `incluirInactivos` switch keeps deciding when `estado` is absent, returns the page size for the screen's pagination, and clamps a page past the end instead of rendering an empty table; a permission seam (`obtenerPermisosClienteAction`) answers "may manage" and "may see credit" from the named role groups; `llevaCreditoEnCreacion` mirrors `llevaCamposDeCredito` so a credit-bearing creation needs the credit group. No existing behavior below the new fields changed, and the venta/devolucion/cobros suites that consume the listing action keep their contract.

### Tests

* **unit:** the estado filter translation (activos / inactivos / todos, still tenant-scoped, `todos` winning over `incluirInactivos`), the returned page size and the page clamp, the new role groups on the read and write actions (view group for list and detail, manage + credit groups for create, credit-group-only for a credit-bearing creation) and the permission seam (admin sees both, view-only sees neither, no session denies). Component tests mirror the productos-ui/productos-page specs: list columns and rows, view-only markup with zero credit fields, filters, debounced search, pagination, create (including the DGII refusal and the credit-hidden payload), edit (prefill from the single read, `version` round-trip, conflict message) and deactivation with confirmation; the page test covers the role gate, the query parameters and the deny-by-default permission fallback.
* **e2e:** `clientes.spec.ts` has the Administrador create a client (with a generated DGII-valid RNC), check it against the database, edit its phone and credit limit (asserting the version bump), and deactivate it (asserting `activo=false` and that the row still exists), then Operador and Despachador read the list with no manage controls and no credit columns. The CSP guard needs no edit: it derives the routes from the filesystem and now covers `/clientes`.

## [0.22.0](https://github.com/Wilfredery/SystemFact/compare/v0.21.0...v0.22.0) (2026-11-10)

### Features

* **producto:** the **Productos** screen (`/productos`), Step 2 of the screens plan: a paginated list (25 per page) with search by name or code, a category selector and an estado selector (Activos / Inactivos / Todos los estados), the columns code, name, category, unit, ITBIS, price and status, and a **create/edit dialog** with codigo, nombre, categoria, unidad, precio (Decimal(12,2), never a float), ITBIS (0/16/18) and descripcion. **Desactivar** asks for confirmation and sets `activo=false`: a product is never deleted, so its history and its code are preserved. The edit dialog prefills from a fresh single-product read and sends the row `version` back, so a concurrent edit is refused with the fixed conflict message instead of silently overwritten. **Roles (S3/L9):** the Administrador manages; Operador and Despachador are view-only — they get no manage markup at all, and the write actions re-check the role group on the server. The category selector degrades to "No hay categorías activas." when the caller cannot see any, without widening the categoria permissions. Menu entry enabled in the same release.
* **producto (backend, additive):** a filtered read use case and action (`consultarProductosAction`) returning the projection the screen needs — id, codigo, nombre, descripcion, categoriaId + category name, unidadMedida, precioVenta as a Decimal string, the ITBIS rate with its validity window, activo and version — with the `estado` filter while the previous `incluirInactivos` switch keeps working for old callers; a single-product read use case and action (`obtenerProductoPorIdAction`) with the full projection including `version`; and a permission seam (`obtenerPermisosProductoAction`) that answers the UI from the manage role group. `crear`/`actualizar` now accept `unidadMedida` (edited and audited like the other fields); a creation without an explicit ITBIS validity starts its window now. No existing behavior below the new fields changed.

### Tests

* **unit:** the new filtered read (projection, estado/legacy `incluirInactivos`, search and category filters, page clamp, pagination errors), the single-product read (full detail with version, missing/foreign tenant, invalid id), the unit passthrough of crear/actualizar with its audit diff, and the new actions (role groups, validation, error mapping). Component tests for the screen cover the read-only role (zero manage markup), filters, debounced search, pagination, create (including the price the server would refuse and the no-categories case), edit (prefill from the single read, `version` round-trip, conflict message) and deactivation with confirmation; a page test covers the role gate and the deny-by-default permission fallback.
* **e2e:** `productos.spec.ts` has the Administrador create a product, check it against the database, edit its price, and deactivate it (asserting `activo=false` and that the row still exists), then Operador and Despachador read the list with no manage controls. The CSP guard needs no edit: it derives the routes from the filesystem and now covers `/productos`.

## [0.21.0](https://github.com/Wilfredery/SystemFact/compare/v0.20.0...v0.21.0) (2026-11-08)

### Features

* **inventario:** the stock **adjust form** (`/inventario/ajuste`), built as drawn in wireframe `04-Inventario-Ajuste` and reachable from a new `+ Ajustar` link on the Inventario screen. **Administrador only**: the link is shown only to the manage role group, and anyone else who opens the URL gets an access message instead of the form (the adjust action re-checks on every call). Fields: product search, Entrada or Salida, one of six motivos (Conteo físico, Merma, Producto dañado, Producto vencido, Corrección de error, Otro), the amount to add or remove (owner decision, 2026-11-08: "Amount to add or remove"; the label "Nueva cantidad" is kept as drawn, with a live line `Existencia actual 150 → quedará 160` so it cannot be mistaken for the new total), and optional observaciones (200 characters). A Salida larger than the stock is stopped in the form ("Stock insuficiente") and, as always, by the server. An Entrada that would push the stock past what the column holds (999,999,999.999) is stopped in the form and by the server with a new stable error code, `STOCK_MAXIMO_EXCEDIDO` (before, the database raised a numeric overflow). An amount the form does not accept (a comma, `.5`, more than 3 decimals, zero) now says why instead of leaving a dead button. Every adjustment writes its `AJUSTE` movement and audit row, with the motivo and observaciones in the movement. **Idempotent.** Every adjustment carries a one-time request id (the form generates it); the server looks it up inside the transaction, after locking the stock row, and a repeat of the same request returns the first result without changing the stock, adding a second movement or a second audit row. The same id with a different amount is refused with a new stable code, `IDEMPOTENCIA_CONFLICTO`. After a timeout or network failure the form locks its fields and offers `Reintentar ajuste`, which resends the same request: if the first attempt had been applied, it is not applied twice. A page reload starts a new form with a new id, so after an unknown outcome check the Inventario list before adjusting again.

### Database

* **Migration `20261108200000_movimiento_inventario_idempotency_key`:** adds a nullable `idempotencyKey` column to `MOVIMIENTO_INVENTARIO` and a unique index on `(inventarioId, idempotencyKey)` (per inventory row, because the table has no `empresaId`). Existing movements and every movement written by a sale, purchase, cancellation or return keep `NULL`; Postgres allows several NULLs in a unique index. Same shape as the refund key on `PAGO`. **It must be applied to production before this version is deployed**, because the new code writes the column. Rollback is in the migration file (drop the index, drop the column).

### Tests

* **e2e:** `inventario-ajuste.spec.ts` adjusts stock as Administrador (Entrada 5, then Salida 5 to restore it) and asserts the database, not only the page: the `INVENTARIO` quantity and the `AJUSTE` movement with its motivo, previous and new quantity. Operador and Despachador get no `+ Ajustar` link and an access message on the direct URL. The spec also reads the Existencia cell of the Inventario table after each redirect, and a cleanup hook puts the stock back if the test dies midway. `inventario.spec.ts` now expects the link for Administrador only. Real-database integration tests pin the idempotency (a replay returns the first result and writes nothing; the same id with another amount is refused; the id is scoped to the inventory row) and the stock ceiling (an entry landing exactly on it passes, one thousandth more is rejected and rolled back).

## [0.20.0](https://github.com/Wilfredery/SystemFact/compare/v0.19.7...v0.20.0) (2026-11-08)

### ⚠ BREAKING CHANGES

* **producto, inventario:** `Operador` and `Despachador` are now **view-only** on products and inventory; only `Administrador` creates or edits products and adjusts stock. Before, `Operador` could. Owner decision, 2026-11-08: "Operador and Despachador view-only for both, with the Administrador managing." Each capability reads one named role group in the module's `http/shared.ts` (`ROLES_VER_PRODUCTOS`, `ROLES_GESTION_PRODUCTOS`, `ROLES_VER_INVENTARIO`, `ROLES_GESTION_INVENTARIO`), so changing who may do what later is a one-line edit. The product list also feeds the sales product search, which `Operador` and `Administrador` already use; `Despachador` still cannot sell.

### Features

* **inventario:** the **Inventario** screen (`/inventario`), built as drawn in wireframe `04-Inventario-Consulta`: four KPI cards (Total productos, Bajo stock, Agotados, Valor de inventario), search by name or code, category and status filters, the stock table with Disponible / Bajo stock / Agotado badges, and pagination (25 per page, 100 max). The KPI cards count the whole branch, never just the filtered page; the value is the sum of stock x average cost, kept as a decimal string. Products without an inventory row in the branch show as stock 0 (Agotado). Read-only: the adjust form and row actions (`04-Inventario-Ajuste`, Administrador only) are the next step. The menu entry is enabled in the same release.

### Tests

* **e2e:** the local E2E fixture seeds the `Operador` and `Despachador` roles and one user each, and the new `inventario.spec.ts` opens the screen as Administrador, Operador and Despachador (KPIs, seeded product, search, empty state, status filter, no adjust control). Real-database integration tests cover the consulta query (filters, literal `%` and `_` search, status rule shared with the domain, KPI scope, tenant isolation).

## [0.19.7](https://github.com/Wilfredery/SystemFact/compare/v0.19.6...v0.19.7) (2026-11-08)

### Bug Fixes

* **nav:** the "Cobros" menu entry led to a page that did not exist (404). `/cobros` now serves the receivables board, which is the wireframe's `03-Cobros` page, and a guard test (`tools/config/nav-routes.test.ts`) fails whenever an enabled menu link has no page behind it. No behaviour change elsewhere.

## [0.19.6](https://github.com/Wilfredery/SystemFact/compare/v0.19.5...v0.19.6) (2026-11-07)

### Features

* **ci:** a production **demo lane** that runs the local E2E flows against the deployed app by writing demo data into the demo company only (`odd/tasks/prod-demo-lane.md`, owner decisions S1-S2: "I give u the permison to create demo examples just to make sure the production(backend, frontend, supabase and vercel works well)" and company 5 "is only test/demo data"). It is a **separate lane** from the read-only production smoke, whose rule "it never writes" is unchanged: its own workflow `.github/workflows/prod-demo.yml` (`workflow_dispatch` only, never scheduled, never in `ci-gate`; the `confirm` input must equal `WRITE-DEMO-DATA` or the first step fails before anything is installed or run; `permissions: contents: read`; environment `prod-demo` with secrets `DEMO_USER`/`DEMO_PASSWORD` and variables `DEMO_EMPRESA_NAME`/`DEMO_BASE_URL`; the same pinned action SHAs as the smoke; skips fail the run; no artifact upload), its own `playwright.prod-demo.config.ts` (trace, screenshot and video off, no `webServer`, one worker, no retries, stops at the first failure) and the script `pnpm e2e:prod-demo`. The specs (`e2e-prod-demo/`) are UI-driven only (no `DATABASE_URL`): after login the empresa name shown by the app must equal `DEMO_EMPRESA_NAME` or the run aborts before any write; then a cash sale (B02), a credit sale to the first CREDITO client (B01) with a partial cobro visible on the estado de cuenta, a return of that sale (B04), the branch stock change read from the app's own insufficient-stock warning, and a walk of every authenticated page that fails on any CSP violation (a page the role cannot see must redirect, which is asserted as the deny-by-default). The demo user needs ONE role, `Operador` (role matrix with code evidence in the lane doc; provisioning steps with placeholder SQL and no password in `app/USER-PROVISIONING.md`). One run consumes 1 B01, 1 B02 and 1 B04 NCF for good. Pinned by `tools/config/prod-demo-guard.test.ts` (guard logic) and `tools/config/prod-demo-lane.test.ts` (the workflow keeps no schedule/push/pull_request trigger and keeps the confirmation input; the config keeps trace/screenshot/video off). Proven only against the local Docker and Supabase stack with an `Operador`-only user: 5 passed, 0 skipped; nothing was run against production.

## [0.19.5](https://github.com/Wilfredery/SystemFact/compare/v0.19.4...v0.19.5) (2026-11-07)

### Features

* **security:** the Content-Security-Policy is now **enforced** (docs/22 T1 stage 2, owner decision S7 in `odd/tasks/csp-nonce.md`: "check it through local first and if everythings correct process to the production"). `proxy.ts` sends `Content-Security-Policy` instead of `Content-Security-Policy-Report-Only` on the request (so Next still stamps its inline scripts with the nonce), on the response and on both auth-gate redirects; the policy itself is unchanged (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `'unsafe-inline'` or `'unsafe-eval'` for scripts, styles keep `'unsafe-inline'`, `connect-src` from `NEXT_PUBLIC_SUPABASE_URL`) and no report-only header is sent anymore. Measured locally before flipping, on `next build` + `next start` against the local Supabase stack: a new E2E guard (`e2e/csp-authenticated.spec.ts`) logs in and visits all 8 authenticated pages under `app/(app)` (dashboard, venta, cobros board, estado de cuenta, recibo, reportes, auditoria, selector) and fails on any `securitypolicyviolation`, and it reports 0; the full local E2E suite then passes under enforcement, sales, collections and returns included (19 passed, 0 skipped). The headers E2E and the production smoke now assert the enforcing header and that no report-only one remains (the smoke will fail against a deployment older than this release, by design). Rollback is one word in `proxy.ts`: `CSP_HEADER` back to `"Content-Security-Policy-Report-Only"`.

### Bug Fixes

* **security:** zod no longer probes `new Function` in the browser. Zod 4 tries `new Function("")` in a try/catch to decide whether to JIT its schemas; the throw is swallowed and nothing broke, but a strict CSP reports it as a violation, and venta, cobros board and estado de cuenta loaded it (3 `script-src` `eval` violations in the first authenticated measurement). `src/lib/zod.ts` now sets `z.config({ jitless: true })` before any schema is built and the 14 modules that imported "zod" import it from there; jitless only turns off zod's speed shortcut, so validation results are identical. Pinned by `tools/config/zod-wrapper.test.ts` (no other file under `src/` may import a runtime value from "zod") and `src/lib/zod.test.ts` (parsing makes 0 `new Function` calls). The CSP was NOT loosened: `'unsafe-eval'` stays out of `script-src`.

## [0.19.4](https://github.com/Wilfredery/SystemFact/compare/v0.19.3...v0.19.4) (2026-11-07)

### Features

* **security:** the proxy now sends a nonce-based `Content-Security-Policy-Report-Only` (docs/22 T1 stage 2, owner decisions S1-S4 in `odd/tasks/csp-nonce.md`). **Nothing is blocked**: the browser only reports. A fresh nonce is generated per request (Web Crypto, 16 random bytes) and passed to the app as `x-nonce` plus the request CSP, which is how Next stamps its own inline scripts; the header is also on the auth gate's 307 redirects, whose targets are unchanged. Scripts are nonce-only (`'self' 'nonce-…' 'strict-dynamic'`, per the Next 16 CSP guide; never `'unsafe-inline'` or `'unsafe-eval'`), styles keep `'unsafe-inline'` by owner decision, and `connect-src` takes the Supabase origin from `NEXT_PUBLIC_SUPABASE_URL` (an invalid URL fails loudly). The five static headers stay in `next.config.ts`, untouched. The production smoke (`e2e-prod/`) now fails on any `securitypolicyviolation` on `/login` and on the login-to-dashboard journey, logging directives and hosts only. **`/login` now renders per request** (`await connection()` in the login layout, the Next 16 CSP guide's way): a prerendered page cannot carry the nonce, and a local `next start` run before this change reported 13 violations on `/login`. After it, all 3 inline scripts carry the request's nonce and the same run reports 0 violations; the cost is that `/login` is no longer a static, cached response (it answers `no-store` and renders on every visit). Authenticated routes were already dynamic but are only provable by the production smoke. Enforcing is a separate, later release.

## [0.19.3](https://github.com/Wilfredery/SystemFact/compare/v0.19.2...v0.19.3) (2026-11-07)

### Bug Fixes

* **auth:** the production auth cookies were missing the `Secure` flag, proven by the prod smoke (`e2e-prod/session-smoke.spec.ts`: "must be Secure. Expected true, Received false"; docs/22 T6). `@supabase/ssr` and Next never set it on their own, so it is now set explicitly when the request is HTTPS (first `x-forwarded-proto` token, via the pure `withSecureOnHttps` helper) in both cookie-writing paths, `client.ts` and the proxy. Plain http (local and E2E) behaves exactly as before, and `httpOnly: false` / `sameSite: "lax"` are unchanged on purpose. To be re-proven by the prod smoke after the next manual deploy.

## [0.19.2](https://github.com/Wilfredery/SystemFact/compare/v0.19.1...v0.19.2) (2026-11-07)

### Bug Fixes

* **auth:** removed the unused browser-side Supabase client (`client-component.ts`, imported by nothing) and pinned with a test that none comes back. Only the proxy refreshes the session, which is what makes the Supabase inactivity timeout mean what it says once the project is on Pro. Also documented in `client.ts` why the auth cookies keep `httpOnly: false` (docs/22 T6). No behaviour change at runtime.

## [0.19.1](https://github.com/Wilfredery/SystemFact/compare/v0.19.0...v0.19.1) (2026-11-05)

### Bug Fixes

* **auth:** the throttle's count and insert are now **one locked decision** (docs/22 T3, finding `R4-002`). They used to be two statements, so a concurrent burst for one pair could all read the same count and all proceed — the provider's 150/5 min bucket bounded the damage, but the control did not do what it claimed under concurrency. The port is now a single `intentar(ip, clave, ahoraMs)` that takes `pg_advisory_xact_lock(hashtext(pair))`, reads the window newest-first, applies the policy and only then inserts, all inside one transaction; the lock is `xact`, so it cannot leak on a throw, and it serializes only the same pair. The policy decision moved into the repository because it has to run inside the lock to mean anything, while the application keeps the counter key, the loud fail-open path, the undo and the clear. `R4-003` becomes structurally impossible rather than handled, since there is no window between "recorded" and "verdict" left to throw in. **Verified in both directions on real Postgres:** with the lock, 8 concurrent attempts for one pair yield exactly the threshold; with the lock temporarily removed, the same test lets 8 of 8 through — so the test is not vacuous and the lock, not the connection pool, is what does the work.

## [0.19.0](https://github.com/Wilfredery/SystemFact/compare/v0.18.8...v0.19.0) (2026-11-05)

### Features

* **auth:** failed logins are now throttled per `(ip, nombreUsuario)` (docs/22 T3, ADR-020). Supabase's password rate limit is keyed on the IP of whoever calls it, and this app calls it from a Server Action, so the provider sees the **server's** IP for every user: it protects Supabase, hands a single attacker an app-wide lockout lever (one 429 bucket shared by everybody), and cannot tell one attacker from one user. The pair is the smallest unit that can. The policy is a 15-minute sliding window, 5 failures, then an exponential delay from 30 s that doubles per extra failure and is capped at 15 min so it always expires - a **delay, never a permanent lockout**, because a hard per-username lock is itself a denial-of-service lever against a user whose name an attacker already knows. Storage is `LOGIN_INTENTO`, the single documented exception to the `withTenantTransaction` rule: login runs before any `empresaId` exists, so the table carries no tenant data, is written only through Prisma (never PostgREST), and is born with RLS plus a PERMISSIVE policy scoped to the runtime role (`systemfact_app` is NOSUPERUSER NOBYPASSRLS and does not own tables) - a RESTRICTIVE deny-all is ANDed with every permissive policy and would have denied the app too, leaving the control silently inert. Two deliberate failure modes, both recorded rather than implied: the check **fails open** when the counter cannot be read (a broken counter must not become a login outage, and a database that cannot answer it cannot complete a sign-in either), and only a **rejected password** is counted - an inactive account or a policy refusal is reached with credentials Auth already accepted, so counting it would let anyone who knows a valid password lock that account out. A provider `429` now maps to its own typed code (`AUTH_AUTENTICACION_NO_DISPONIBLE`) instead of `AUTH_CREDENCIALES_INVALIDAS`, because during a project-wide bucket every user would otherwise be told a falsehood about their own password. The counter key folds case and spacing (the ADR-014 row lookup stays byte-exact) and is cleared on a successful sign-in, so honest typos do not follow a user into their next session. Test-first: RED observed for the action wiring and for the 429 mapping before either implementation existed. Residual, stated plainly: an attacker rotating IPs is slowed, not stopped - CAPTCHA stays the recorded go-public follow-up.

## [0.18.8](https://github.com/Wilfredery/SystemFact/compare/v0.18.7...v0.18.8) (2026-11-04)

### Bug Fixes

* **auth:** a password that no longer meets the current policy now has its own typed outcome (`AUTH_PASSWORD_POLICY`) instead of being reported as `Credenciales invalidas`. Raising the minimum length (docs/22 T7: 12 characters, no forced rotation, passphrases allowed) makes GoTrue refuse an existing account at sign-in with error code `weak_password`. That is not a credential failure: collapsing it into `AUTH_CREDENCIALES_INVALIDAS` told a legitimate user their credentials were wrong and left them no next step. The mapping reads the **stable error code** only - the provider message is prose about project configuration that changes with the dashboard, so matching it would turn the lookup into a guess - and the provider text is never surfaced: the auth error catalog owns the copy, which deliberately names no policy number, because the minimum length is Supabase configuration and not an app constant. No tenant read, no write and no audit row on this branch, the same posture as the generic rejection. Test-first: the RED assertion reproduced the collapse before the mapping existed.
## [0.18.7](https://github.com/Wilfredery/SystemFact/compare/v0.18.6...v0.18.7) (2026-11-04)

### Chores

* **ci:** Dependabot no longer opens npm **version** PRs (`open-pull-requests-limit: 0`), by owner decision after the first batch proposed changes nobody asked for. The clearest one was `@types/node` **26.6.6** for a project that runs **Node 24** (local `v24.22.1`, CI `node-version: "24"`, Vercel 24.x): typing against another major's API is how imports compile and then fail at runtime. Security-update PRs are unaffected — GitHub keeps a separate limit for them — and the alarm that matters is the `audit` job inside `ci-gate`: a production-scope advisory blocks the merge, naming the advisory and the patched version. The `github-actions` entry stays on, because a pinned SHA that never moves is its own risk.

## [0.18.6](https://github.com/Wilfredery/SystemFact/compare/v0.18.5...v0.18.6) (2026-11-04)

### Bug Fixes

* **db:** `_prisma_migrations` had a RESTRICTIVE deny-all policy and **no RLS enabled**, and no migration turned it on. `20261012192000` only creates the policy, and `20260902120000_enable_rls` lists the application tables by hand; the HOSTED project reads `relrowsecurity = true` only because an operator ran the `ALTER TABLE` by hand during the October advisor cleanup. Consequence: a database rebuilt from migrations alone - CI's ephemeral stack, or a disaster-recovery restore - came up with Prisma's ledger readable by the application role, because a policy on a table whose RLS is disabled is decoration. New migration `20261104230000_prisma_migrations_enable_rls` enables it; owner and superusers still bypass RLS, so `prisma migrate deploy` keeps working, and `FORCE` is deliberately not set so a rebuilt database matches the hosted posture instead of changing it.
* **ci:** `pnpm rls:verify` now proves **coverage**, not just the role. The existing checks assert the connection role is NOBYPASSRLS, which is a different claim from "every table has policies": a new context-aware table could ship with RLS off and zero policies while that check stayed green, and then any query that forgets `empresaId` returns another tenant's rows. The script enumerates `pg_class.relrowsecurity` plus its `pg_policy` count for every table and fails naming each offender in both directions (RLS off; RLS on with zero policies), and fails closed when the query returns nothing. This is what found the `_prisma_migrations` gap on its first real run.

**Verification:** local stack - guard GREEN (`all 26 tables have RLS enabled and at least one policy`), RED after `ALTER TABLE "CONFIGURACION_EMPRESA" DISABLE ROW LEVEL SECURITY` (error named the table), GREEN again after re-enabling. `tsc --noEmit` 0, `eslint` 0. CI runs the same guard inside the integration job, which is inside `ci-gate`.

## [0.18.5](https://github.com/Wilfredery/SystemFact/compare/v0.18.4...v0.18.5) (2026-11-04)

### Bug Fixes

* **deps:** the production audit was not a chore, it was a hole. `pnpm audit --prod` reported **37 advisories — 15 high, 3 critical**, and all three criticals were **`next` 16.3.3**: remote code execution in `next/og` ImageResponse, unauthenticated RCE in Image Optimization, and RCE in `use cache`, patched in `>=16.3.6` / `>=16.4.1`. Now **`next` 16.4.5**, `eslint-config-next` 16.4.5, `zod` 4.6.7, and `fast-uri` / `source-map-js` forced to their patched floors in `app/pnpm-workspace.yaml` (they arrive through prisma's CLI chain and postcss). `shadcn` — a CLI that never ships — moved from `dependencies` to `devDependencies`, where it was pulling a Windows command-injection advisory into the production tree for nothing. Result: **`pnpm audit --prod --audit-level high` → no known vulnerabilities** (37 → 0).
* **ci:** that finding is now enforced instead of remembered. Job `audit` runs `pnpm audit --prod --audit-level high` and is listed in **`ci-gate`'s `needs`**, so a new advisory blocks a merge instead of surfacing months later. All **12 third-party action refs are pinned to commit SHAs** (previously `@vN` tags: a moved tag is code execution inside CI) and `.github/dependabot.yml` groups weekly npm/Actions updates so those SHAs and versions move through PRs that CI actually checks.
* **docs:** the plan document behind this work (`docs/22`, kept out of this repo's git on purpose — `docs/` is ignored) had two things to correct and both are corrected there: T1's checkbox claiming the `middleware.ts` → `proxy.ts` rename was "zero behavior change, verified" was **false**, and the auth gate stayed dead for several releases because of it (0.18.1 fixed the code; the box now names the observation that would have failed), and T2 closes with the measured baseline. Nothing under `docs/` is shipped by this PR.

**Verification:** local `next build` green and still emitting `ƒ Proxy (Middleware)` (16.4.5 resolves `src/proxy.ts` the same way), `tsc --noEmit` 0, `eslint` 0 errors (17 pre-existing warnings), unit **141 suites / 1319 tests passed**. CI covers integration and E2E on the PR, plus the new audit job.

## [0.18.4](https://github.com/Wilfredery/SystemFact/compare/v0.18.3...v0.18.4) (2026-11-04)

### Chores

* **ci:** drop the `url` from the `prod-smoke` environment, reverting 0.18.3. It was meant to turn the deployment record into a link to production, but it earns its keep the other way: the hash-based deployment URLs sit behind Vercel Deployment Protection (SSO), so the button leads to a Vercel login screen rather than to the app, and the record is more useful as a plain `prod-smoke` entry per run. The environment itself stays - it is what scopes `PROD_USER`/`PROD_PASSWORD` to that single job - and no protection rules are added.

## [0.18.3](https://github.com/Wilfredery/SystemFact/compare/v0.18.2...v0.18.3) (2026-11-04)

### Chores

* **ci:** the `prod-smoke` environment now declares a **url** (`https://systemfact.vercel.app`), so the deployment record this repo already shows for each smoke run links to production instead of being a bare name. What the record IS does not change: it comes from the GitHub Actions environment that scopes `PROD_USER`/`PROD_PASSWORD` to that single job, and the manual `vercel deploy --prod` still creates nothing in GitHub - no deployment entry, no commit status. No protection rules, deliberately: the check lasts seconds and must run after every deploy, not wait for a click.

## [0.18.2](https://github.com/Wilfredery/SystemFact/compare/v0.18.1...v0.18.2) (2026-11-04)

### Documentation

* **docs:** close the production-smoke tracker with the runs that matter: `41894569175` (3 passed / 1 failed) is the run that FOUND the auth-gate regression of 0.18.1 by asking `/` for a 307 and getting 200, and `41897923869` on `22f6573` is the green one - **4 passed / 0 failed in 6.6s** - after redeploying the fix.
* **docs:** record how production is actually deployed, because it cost an hour here. The Vercel project `systemfact` keeps **Root Directory `.`** while the Next app lives in `app/`, so a git-source production deployment fails with `[NEXT_NO_VERSION] No Next.js version detected` (Vercel looks for a package.json at the repo root). The working recipe is an upload from the app directory: `cd app && vercel deploy --prod`, with `app/.vercel/project.json` already linked and gitignored. It creates no GitHub Deployment entry - the only `deployments` entries in the repository are the `prod-smoke`/`e2e` GitHub *environments* used by Actions, which is what the owner wanted to avoid from Vercel.

## [0.18.1](https://github.com/Wilfredery/SystemFact/compare/v0.18.0...v0.18.1) (2026-11-04)

### Bug Fixes

* **security:** the auth gate was not running in ANY build since #132. `proxy.ts` sat at the project root, but this app uses a `src/` directory, and Next only detects the proxy inside `src/` in that case: the build never printed `ƒ Proxy (Middleware)` and no warning said so. The consequence was invisible because every `(app)` page redirects from its own layout, so `/dashboard` still answered 307; what changed was that anything WITHOUT a page-level guard stopped being protected. A deployment that finally matched `master` showed it: an anonymous `/` served the Next.js scaffold page with 200, and an unknown path answered 404 instead of redirecting to `/login`. The fix is the file location - `app/src/proxy.ts` - and the build now names `ƒ Proxy (Middleware)`.
* **e2e:** add `app/e2e/auth-gate.spec.ts`. The existing suite asked for `/dashboard` without a session and expected 307, which passes even when the proxy never runs, because the `(app)` layout redirects on its own. The new spec hits two cases that only the proxy can satisfy: the static `/` and an unknown path, both of which must answer 307 to `/login`. With the file at the root both fail (200 and 404); at `src/proxy.ts` both pass.

* **e2e:** `security-headers.spec.ts` asked for a **404** on an unknown path and was green for as long as the proxy was dead, so the suite had encoded the consequence of the bug as correct behaviour. With the gate running, an unknown path is protected by default and answers 307 to `/login`; the case now asserts that redirect with the five headers, and the comment records why an anonymous 404 is unreachable (covering a 404 needs a session - follow-up).

**Verification:** RED with `proxy.ts` at the project root - build output has no `ƒ Proxy`, the spec fails 2/2 (`/` = 200, unknown = 404). GREEN at `src/proxy.ts` - build prints `ƒ Proxy (Middleware)`, anonymous `/` = 307, spec 2 passed (1.7s). Found by the production smoke on its first run against a deployment that actually contained `master`; the earlier green on that assertion only held because the deployed build predated #132.

## [0.18.0](https://github.com/Wilfredery/SystemFact/compare/v0.17.9...v0.18.0) (2026-11-04)

### Features

* **e2e:** a **production smoke** that answers "does production work" against the deployed app, as a lane separate from the local-stack E2E job. `app/playwright.prod.config.ts` declares **no `webServer`** (it must never boot a local server and call the result production), trace and screenshots are **off** (a trace of a live production login can carry the password, and the artifacts are uploaded in a public repo), and there is **no Vercel protection bypass at all**: the lane has to see what a visitor sees, and an opt-in flag whose trigger sits in a repository variable is weaker than the secret it gates.
* **e2e:** the suite is two spec files. `app/e2e-prod/public-smoke.spec.ts` asserts the anonymous surface (`/` redirects to `/login`, the login page answers 200 and carries the five baseline security headers); `app/e2e-prod/session-smoke.spec.ts` logs in through the real form as a single-branch **Operador**, asserts `/dashboard`, the `Hola, <nombre>` greeting and the tenant line, asserts the `Su rol no incluye paneles de reporte.` denial, and asserts that **no KPI tile renders** - a role-gate leak is a security regression, so it fails the run. Missing credentials **fail** the check instead of skipping it.
* **ci:** `.github/workflows/prod-smoke.yml` is `workflow_dispatch` only, uses its own `prod-smoke` **environment** for `PROD_USER`/`PROD_PASSWORD`, and deduplicates its failure issue. It is deliberately **not** part of `ci-gate`: production is deployed by hand from Vercel (no Vercel-to-GitHub integration), so a red production smoke must inform, never block a merge.

### Bug Fixes

* **e2e:** scope the role-gate assertion to `main`. An unscoped `getByRole("alert")` matches both the denial paragraph and Next's route announcer (`#__next-route-announcer__`), so strict mode failed the assertion before it could say anything about the gate.

**Verification:** with a real least-privilege identity against the deployed app, `pnpm e2e:prod` reports **`3 passed / 1 failed`** in 8.0s: the session smoke is green (login, dashboard, greeting, tenant line, denial, no KPI tile) and the single failure is the deployed build `2a76c31` (#118) missing four baseline headers, which predates v0.17.3 and clears on the next manual Vercel deploy. `tsc --noEmit` and `eslint` are clean; a failing run leaves only `test-results/.last-run.json`.

## [0.17.9](https://github.com/Wilfredery/SystemFact/compare/v0.17.8...v0.17.9) (2026-11-04)

### Documentation

* **docs:** `SETUP-LOCAL.md` no longer claims the hosted E2E path works. Both robot identities in the hosted project (`e2e-automation@users.systemfact.internal` and `e2e@users.systemfact.internal`) are **banned** — `banned_until` to 2126, `auth.sessions` and `auth.refresh_tokens` cleared — and the verification is a real password grant that returned `200` before and `400 user_banned` after, not the `UPDATE`'s own return value. The local stack (`supabase start` + `.github/ci/provision-local-e2e.sh`) is the only supported path and the one CI has run since v0.17.7; the reversal and completion SQL are recorded on issue #138 so the decision stays reversible without archaeology. The two `auth.users` rows were then deleted, which is the step that makes the removal permanent — the ban was deliberately the reversible half first. Post-deletion the same grant answers `400 invalid_credentials` (the identity no longer exists), and `auth.users`/`identities`/`sessions`/`refresh_tokens` all count 0 for it. The hosted `USUARIO` row (empresa 5, rol `Administrador`, `authUserId = null`) is untouched by the auth deletion and is now simply unreachable; deleting an app row is a separate decision with its own audit trail.
* **docs:** this release exists so that `master` and the version ledger agree: the merged change was documentation only, so the entry above is the entirety of it. No application behaviour changed.
## [0.17.8](https://github.com/Wilfredery/SystemFact/compare/v0.17.7...v0.17.8) (2026-11-04)

### Bug Fixes

* **e2e:** CI now runs the smoke against the **compiled production server** (`pnpm build && pnpm start`) instead of `next dev`. Two flake classes lived in the dev path and both vanish in a build. First, Turbopack's `next/font` machinery failed to resolve this app's Google font on a cold dev start (`NextFontGoogleFontFileReplacer … resolve_internal failed`, then `Timed out waiting 120000ms from config.webServer`) while the **same font compiled fine in `next build` during the same run** — one failure in four attempts, on a gate that is required for every PR. Second, the first spec to hit a route paid that route's compile cost inside its own per-test timeout: the double-click idempotency test took `32.7s` against the `30000ms` default and failed, then passed in `28.3s` on a warm run. A gate must not go red for a bundler it is not testing, and a re-run habit is how a real failure gets waved through. Measured effect of the change: the same 12 specs went from `6–33s` each to `1–5s` each (nothing compiles at test time) and the whole suite from `1.0–2.1m` to `1.1m` including the build. Local runs keep `pnpm dev`, and `reuseExistingServer` still honours an already-running server.
* **e2e:** the skip guard now fails a report that **contains failures**. Running it by hand against a report with one failing test printed `OK: 11 test(s) ejecutados, 0 salteados.` and exited 0 — the same lie as a skip, from the same file. In CI the Playwright step fails first, so the gate was never fooled; the guard was, and it is the artifact people read to decide whether a run counted. Covered by four synthetic reports: 12 passed → `OK`, 11 passed + 1 failed → exit 1, 3 flaky → `OK`, empty → exit 1.
## [0.17.7](https://github.com/Wilfredery/SystemFact/compare/v0.17.6...v0.17.7) (2026-11-03)

### Chores

* **ci:** the E2E lane no longer authenticates against the hosted Supabase project. It boots its own **ephemeral local Supabase stack** (`supabase start`, configured by the new committed `supabase/config.toml`) and provisions it inside the runner, so CI holds **no real credential at all** (issue #138, option C). Deleted with it: the `E2E preflight` job and its `needs`/`if` wiring, `environment: e2e`, the four secret references, and the `postgres:17.6` service container. The job now **always** runs — an unstartable stack fails it instead of silently skipping the suite — and the fail-on-skip guard is unchanged. Only `postgres`, `kong`, `gotrue` and `postgrest` boot: studio, mail, storage, realtime, edge runtime and analytics are off, and `db.seed` is off because Prisma owns the schema.
* **ci:** add `.github/ci/provision-local-e2e.sh`, one recipe for CI and for a developer. It applies the Prisma migrations as **`supabase_admin`** (the plain `postgres` role is not superuser in Supabase's local stack, and `ALTER ROLE postgres NOBYPASSRLS` fails under it), sets a per-run password on the RLS-bound `systemfact_app` role, loads `.github/ci/e2e-fixture.sql`, runs `seed:venta`/`seed:ncf`/`seed:cliente`/`config:verify`, and writes the env file the app and the specs read.
* **ci:** add `.github/ci/upsert-e2e-auth-user.mjs`: find-or-create the GoTrue user for `E2E_USER` through the admin API and **verify the password grant** before Playwright starts, so a broken identity fails with its real cause instead of a login timeout. The password is generated per run and never printed.
* **chore:** `.gitattributes` pins `*.sh` to LF — a CRLF checkout turns `set -euo pipefail` into a syntax error — and `app/.gitignore` now ignores the `e2e-results.json` run artifact.

### Documentation

* **docs:** `SETUP-LOCAL.md` gains the reproducible local-stack recipe (three commands) plus the local facts that matter: API `54321`, Postgres `54322` (no clash with the `5433` compose), `supabase_admin` is the real superuser, the app role password is per-run, and `ANON_KEY`/`SERVICE_ROLE_KEY` are static public defaults. `AGENTS.md` documents the lane, and the fixture, `playwright.config.ts` and the skip guard no longer describe auth as necessarily remote.

**Verification:** proven locally with the exact CI order on a wiped stack (`stop --no-backup` → `start` → provision → Playwright → guard): `Running 12 tests` → `12 passed` → `OK: 12 test(s) ejecutados, 0 salteados.` The PR's own CI run is the authoritative proof; the `e2e` environment and its four secrets are deleted only after it reports the same counts.

## [0.17.6](https://github.com/Wilfredery/SystemFact/compare/v0.17.5...v0.17.6) (2026-11-03)

### Chores

* **ci:** move the four E2E secrets (`E2E_USER`, `E2E_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) from repository scope into a GitHub **Environment** named `e2e`, and declare `environment: e2e` on **both** the `E2E preflight` job and the `E2E smoke` job. Declaring it on only one would leave the preflight reading empty values and silently skipping the suite — the exact failure mode that hid a real defect for two releases. The repository-level copies were deleted first, so the verification could not fall back to them: one copy exists now, and it can be rotated from the environment without touching the repository.
* **chore:** add `.github/CODEOWNERS` covering the two paths by which a change can read repository secrets or alter the CI gate: `.github/workflows/` and `.github/ci/`. It is **documentation only** — "Require review from Code Owners" is deliberately NOT enabled, because GitHub does not let a single maintainer approve their own PR and the rule would permanently block any PR touching those files. The file records why, and how to enable it once a second maintainer exists. It also states what CODEOWNERS cannot fix: a maintainer who edits a workflow still reaches the secrets, so the real mitigation is a dedicated, least-privilege, rotable credential.

## [0.17.5](https://github.com/Wilfredery/SystemFact/compare/v0.17.4...v0.17.5) (2026-11-03)

### Chores

* **ci:** seed the demo CREDITO client (`Comercios Clara, SRL (demo)`) in the CI-only E2E fixture. Three specs look it up by name + `tipoCliente` + `creditoHabilitado` + `activo` and were skipping without it (`cobros.spec.ts` ×2 and the credit-sale case of `confirm-venta.spec.ts`), so the E2E job reported success having executed 9 of 12 tests. Seeded in the fixture, deliberately NOT via `pnpm seed:bootstrap`: that script writes `auth.users` over a privileged connection (`PROD_PRIVILEGED_URL` first) and belongs to the real project.
* **ci:** add `app/e2e/assert-no-skips.mjs` and wire it into the E2E job. A skipped test now fails the run (the E2E secrets always exist in that job, so no skip is legitimate), a report with no tests at all fails, and a missing or unparseable report fails with a message naming the step and the expected file instead of an unhandled `JSON.parse` exception.

### Bug Fixes

* **test:** the same-day CxC test is time-injected. One `now` instantiates the fixture's `fechaEmision` and is also passed as the domain clock of `consultarSaldoCxcPaginado`/`consultarSaldoCxC`, so a Santo Domingo midnight boundary can no longer split fixture and assertions; `crearFactura` gained an optional emission date instead of a duplicated fixture helper that could drift.
* **e2e:** the board settled-state detector scopes its `role="alert"` check to the board region and throws the board's own error text, so a failed board read names its real cause instead of degrading into `Invoice N not found`; a board that settles with neither rows nor an error still fails loudly after the deadline. The walk-and-throw contract is unchanged.

### Documentation

* **docs:** the `pnpm dev` / `next/font` troubleshooting entry now records the second, transient mode — the same message failing `next build` on a fresh CI checkout and clearing on re-run, while the same tree built locally in ~22s — and says to re-run first, clearing `.next` only if the failure persists locally.

## [0.17.4](https://github.com/Wilfredery/SystemFact/compare/v0.17.3...v0.17.4) (2026-11-03)

### Bug Fixes

* **e2e:** wait for the CxC board's client island to settle before counting rows. `filaCxcEnBoard` called `page.goto("/cobros/cxc-board")` and counted immediately, but the board renders "Cargando cuentas por cobrar…" until its mount `consultarSaldoCxcAction` resolves and only renders its pagination control once loaded. On a slow first render — a cold dev compile in CI is seconds — the walk read an empty board, found no "Página siguiente" button, broke on its first iteration and threw `Invoice N not found on any board page`, a false failure that read like a product defect (issue #133). The wait observes only the island's settled state (loading copy gone plus rows or the typed alert); the walk still throws when an invoice really is missing.
* **test:** pin same-day CxC visibility deterministically. `cobros-saldo-cxc-tablero.integration.test.ts` dated every fixture invoice `2026-09-01`, so no deterministic test ever covered an invoice emitted on the current business day; the only same-day path was the Playwright spec that was failing.

### Documentation

* **docs:** `SETUP-LOCAL.md` troubleshooting entry for `pnpm dev` returning 500 on every route (`Module not found: @vercel/turbopack-next/internal/font/google/font`): an inconsistent `.next` cache, most often caused by running `pnpm build` or deleting `.next` while `next dev` is serving. Includes the rule that build and dev never run in parallel.

## [0.17.3](https://github.com/Wilfredery/SystemFact/compare/v0.17.2...v0.17.3) (2026-11-03)

### Chores

* **security:** send baseline security response headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) on every route from `app/next.config.ts`, so the proxy redirect and 404s carry them too (docs/22 T1 stage 1). Pinned by a unit test that imports the real config plus one Playwright header assertion. The nonce CSP is deliberately not here: it forces dynamic rendering and needs its own Report-Only pass.
* **security:** move the auth gate to the Next 16 `proxy` file convention (`app/middleware.ts` -> `app/proxy.ts`, `createMiddlewareClient` -> `createProxyClient`). Behavior unchanged: unauthenticated requests still redirect with `307` to `/login`, and an authenticated visit to `/login` still lands on `/dashboard`.
## [0.17.2](https://github.com/Wilfredery/SystemFact/compare/v0.17.1...v0.17.2) (2026-11-03)

### Chores

* **infra:** run local Docker and both CI Postgres service containers on `postgres:17.6`, the engine the Supabase project runs, so integration, RLS and concurrency suites certify the version production uses (parity was `16` locally and in CI). Data moved by logical dump/restore into a new volume `sf-pgdata17`, leaving the previous volume untouched for rollback.
* **infra:** add `.gitattributes` (`*.sql text eol=lf`) so Windows checkouts stop storing CRLF inside plpgsql function bodies, which made a Windows-migrated database differ from CI.
* **infra:** add `provision-integration-db.sql` plus the runbook fix, so a local volume recreate restores test-database object ownership instead of failing the harness with `permission denied for table FACTURA` (SQLSTATE 42501).
## [0.17.1](https://github.com/Wilfredery/SystemFact/compare/v0.17.0...v0.17.1) (2026-11-02)

### Bug Fixes

* **venta:** allow re-editing BORRADOR drafts that carry MONTO discounts (`EDICION_DESCUENTO_NO_DISPONIBLE` no longer fires for amount discounts), and require an admin to cancel a CONFIRMADA sale via a server-side `DESCUENTO_NO_AUTORIZADO` gate (issue #127).

## [0.17.0](https://github.com/Wilfredery/SystemFact/compare/v0.16.2...v0.17.0) (2026-10-24)

### Features

* **venta:** F0 POS restyle with the fiscal preview parity contract — light-only token surface, touch-first controls and the empty-cart guard, while every displayed figure keeps coming from the same pure domain calculators the server re-runs on save.
* **venta:** credit surfaces — `ConfirmarVentaOutput.credito` exposes the derived form (CONTADO/CREDITO) and due date as presentation-only data (ADR-017: nothing persisted), rendered as the read-only credit strip.
* **venta:** per-line discount wiring — admin-gated amount/percentage inputs compose the line money through the released calculators, with the cap and actor decided server-side (R-V21, ADR-018 preview parity).
* **venta:** vuelto panel and shared numeric keypad — reference-only VUELTO/FALTA display with an inert SIN_DATOS state; the received amount never enters any payload.
* **venta:** admin anulación dialog — CONFIRMADA rows gain an admin-only *Void sale* control that requires a reason in the UI and routes through `cancelarVentaAction`; the fiscal outcome (annulled invoice, Formato 608, restocked stock) is named in the success copy.
* **e2e:** shared POS harness (`login`, `db`, `venta-pos` helpers) reused by the four specs, plus the contado COBRO assertion and a self-skipping credit case that proves confirm settles nothing for a CREDITO client.

## [0.16.2](https://github.com/Wilfredery/SystemFact/compare/v0.16.1...v0.16.2) (2026-10-22)

### Miscellaneous Chores

* **deps:** bump @types/node to 24 to match the Node.js 24 runtime (installed 24.22.1 post-security-update); no runtime behavior change, 	sc --noEmit and 1262 jest tests green.
## [0.16.1](https://github.com/Wilfredery/SystemFact/compare/v0.16.0...v0.16.1) (2026-10-14)

### Bug Fixes

* **auth:** pin pp.current_empresa_id (two-phase) inside uscarUsuarioPorAuthSub's resolving transaction - the session resolver's relation selects (empresa/sucursal) resolved to NULL under empresa_select RLS (no login-flow exception) and crashed (app) header rendering for F1 landing; found by the ratificado E2E credential walkthrough (selector-sucursal 3/3 with the dedicated e2e-automation principal); second-phase read now also filters empresaId explicitly (defense-in-depth); suites updated to the documented 2-call contract (1262 jest green, e2e walkthrough green).
* **tools:** dedicated e2e-automation robot principal (seed:e2e-automation + prod launcher; GoTrue-correct identity semantics provider_id=email; always-rotate credential policy in the gitignored app/.env.e2e.local).

## [0.16.0](https://github.com/Wilfredery/SystemFact/compare/v0.15.0...v0.16.0) (2026-10-14)

### Features

* **tenant:** admin-only listing of active empresa sucursals (S1) — per-module error catalog (`TEN_OPS_NO_AUTORIZADO`, and the deliberately tenant-blind `TEN_SUCURSAL_NO_VALIDA`), Prisma port with the schema-pinned `activa` narrow select, and the no-scope-parameter use case `listarSucursalesDeEmpresa` (deny-before-read for non-admins; empty active set returns a valid success)
* **tenant:** switch active sucursal for admins (S2) — `cambiarSucursalActiva` with the server-side role gate, the idempotent no-op short-circuit on the current branch, foreign-empresa/inactive targets sharing ONE stable code, and the D1 rewrite of `Usuario.sucursalId` (version++, ZERO audit rows, one `withTenantTransaction`); the RLS `usuario_modify` policy is honored inside the wrapper via blank → update → re-pin GUC sequence
* **auth:** post-login landing for multi-branch admins (D2) — `AuthResult` gains `esAdmin` + `activeBranchCount`, the count piggybacking the session-audit transaction inside the same login bootstrap window; the login action routes multi-branch admins to `/selector-empresa-sucursal` while non-admins and single-branch admins keep `/dashboard`; middleware untouched
* **tenant-ui:** `/selector-empresa-sucursal` board 02 (S3) — admin-only server loader with both-way guards (no session → `/login`; non-admin → `/dashboard`), F0-only composition (Card/Select/Button/Badge), the static "free" plan badge via the new `shared/version-plan.ts` seam, and an empty state with the confirm affordance unrendered; the shell "Cambiar sucursal" placeholder is now a real ≥44px `next/link` into the selector (S5), non-admin shell unchanged
* **auth-ui:** login board-01 restyle (S4) — F0 tokens/light-only surface with exactly two credential fields (no email, no synthetic suffix on screen, ADR-014), touch-first submit, an inert but keyboard-reachable "Recuperar contraseña", and `AUTH_CREDENCIALES_INVALIDAS` pinned to the exact user-visible copy `"Credenciales inválidas"` (intentional adapter-level copy change; the silence-about-cause semantics are untouched)

### NOTES

* The branch switch is ACCOUNT-WIDE for the admin: every session of that
  `USUARIO` resolves to the new branch (`Usuario.sucursalId` remains the single
  resolution point, D1) and the path writes zero audit rows (a branch switch is
  NOT re-authentication; REQ-AUTH-AUD-001 untouched).
* Scenario traceability, design decisions (D1–D8) and per-slice verification
  live in the SDD trail at `openspec/changes/auth-tenant-selector/`.

## [0.15.0](https://github.com/Wilfredery/SystemFact/compare/v0.14.13...v0.15.0) (2026-10-13)

### Features

* **ui:** SDD ui-foundation (F0, PR #121) - presentation foundation: semantic Tailwind 4 token registry (light Penpot base + WCAG-AA dark via preferred-color-scheme + dormant .dark hook), Source Sans 3 as the sole font (Geist/Arial removed), shadcn base-nova/@base-ui registry vendored with exactly 8 touch-first primitives (44/48px hitboxes via CVA, no per-primitive dark: overrides), one shared home for DOP money (`formatearMonto`, RD$ en-US grouping) and SD dates (`formatearFechaSD`, dd/MM/yyyy America/Santo_Domingo from UTC via date-fns-tz) replacing duplicated helpers in venta/cobros/reportes (DGII fiscal formatter untouched), and the permanent App Shell over the new (app) route group: server-rendered header with always-visible empresa+sucursal, Cambiar sucursal gated server-side to Administrador (never CSS-hidden), sidebar with the 8 module entries (4 future-route placeholders) and one tiny usePathname island for active-path highlight plus a theme-hook placeholder. DraftList now renders the ratified dd/MM/yyyy contract (intentional, note #2 in the PR). SDD trail mirrored at openspec/changes/ui-foundation/; app-shell credential walkthrough deferred to openspec/PENDING.md (item 4).

## [0.14.13](https://github.com/Wilfredery/SystemFact/compare/v0.14.12...v0.14.13) (2026-10-13)

### Bug Fixes

* **cobros:** re-pin the fase-6 CxC E2E to the server-paged board (`app/e2e/cobros.spec.ts`) —
  PR #114 (v0.14.9) replaced client-side bucket navigation with server-side paged navigation
  (cut of 25, "Página anterior"/"Página siguiente" buttons), leaving the E2E naive
  `fila.waitFor` paged on page 1 only; a shared prod holding more than 25 outstanding receivables
  would strand the fresh self-seeded invoice on a later page. The spec now reaches the row by
  walking the pagination (bounded, throws on a confirmed-but-missing row instead of timing out)
  and documents the page-scoped bucket-count behavior change.

## [0.14.12](https://github.com/Wilfredery/SystemFact/compare/v0.14.11...v0.14.12) (2026-10-13)

### Code Refactoring

* **shared:** ONE canonical ConfiguracionEmpresa active-window reader seam `src/shared/infrastructure/configuracion-empresa.ts` (R-QC-08, PR5, tasks 5.1-5.8) — design D8 contract verbatim: `leerConfigActivaEnTx` (findFirst + newest-`vigenciaInicio` tie-break, R-V17) and `leerConfigsActivasEnTx` (batched `clave in` findMany, compra's serving shape) carry the single `{empresaId, clave, activa, vigenciaInicio lte fecha, vigenciaFin gte fecha}` predicate; the seam compares absolute `timestamptz` instants by design (risk #8 — every existing caller already does instant comparison; SD-date resolution stays at the callers' ratified conversions) and knows no module semantics (per-key value grammars and hard-fail/default codes remain in the consumer modules)
* **venta:** the three DESC_MAX-family readers (`DESC_MAX`, `PLAZO_DEVOLUCION`, `RETROACTIVO_FECHA_VENTA_DIAS`) consume the seam instead of re-encoding the predicate; `VentaConfigError` codes, message copy, details and grammars are byte-unchanged (R-C4; the existing arg-pin unit spec passes untouched)
* **compra:** `leerTasasRetencionEnTx` serves its 4-key batch through `leerConfigsActivasEnTx`; `CONFIG_RETENCION_FALTANTE` discipline unchanged (R-V17)
* **reportes:** `PLAZO_CREDITO` plus the DGII 607 readers (UMBRAL_CONSUMO_607 / DGII_TIPO_INGRESO_607) consume the seam; `null`-on-gap and statutory-default fallbacks unchanged. Grep guard: the window predicate is encoded only once (one seam), 4 consumer files import it

## [0.14.11](https://github.com/Wilfredery/SystemFact/compare/v0.14.10...v0.14.11) (2026-10-12)

### Bug Fixes

* **auditoria:** consolidate the 12 duplicated audit append sites on the canonical writer `registrarEventoAuditoriaEnTx` (AU-1, design D5) — the existing thin named builders keep their signatures and call sites, their bodies now delegate to the canonical repository; rows stay byte-identical (record/replay pin over a recording tx asserts every field minus the code-set `fechaHora`, delegation spied); M2 scope is net-negative LOC (site repositories −169/+142 total, canonical writer untouched); no new port/abstraction (YAGNI); `movimientoAuditoria.create` occurrences outside `registrar-evento.repository.ts` = 0 (grep guard)
* **producto:** throttle `producto.listed` to at most ONE audit row per actor per rolling 60-second window (M4, REQ-PROD-010) — a bounded `findFirst` over the existing `(empresaId, usuarioId, fechaHora, id)` index (UTC-instant comparison, no schema change, no lock) runs inside the listing's own transaction; reads inside an open window append NOTHING and their items are never retro-merged (the log is append-only: the DB-side `AUDITORIA_INMUTABLE` trigger rejects UPDATE by construction, pinned in the integration suite); the accepted race (two parallel same-actor listings may each append once) is documented in the helper. Separately seeded per-actor windows and same-tx rollback semantics pinned on real Postgres

### NOTES (payload contract change — risk #6)

* **`registrarProductoListadoEnTx` signature change:** the `count` parameter is dropped (was `page, count, total`, now `page, total` — the sole call site `listar-productos.ts` updated); the row's `valorNuevo` payload changed from `{count: items.length, total}` to `{count: total}` — the filtered total of THE read that opened the window, per the corrected REQ-PROD-010 semantics (obs 1069). The auditoria UI is display-only and unaffected
## [0.14.10](https://github.com/Wilfredery/SystemFact/compare/v0.14.9...v0.14.10) (2026-10-12)

### Features

* **reportes:** data-layer page cuts for the three remaining interactive report screens (PR3, tasks 3.1-3.9) —
  * **aging (FIN-6):** `consultarCxcAging` stops fetching the full set and slicing; the screen page is one LIMIT/OFFSET cut inside `cobros/infrastructure/saldo-cxc.repository.ts` over the canonical ADR-017 fragment (CLIENTE plazo join + `dbPlazo` bind + the SD `AT TIME ZONE` day expression) with the pinned order `diasVencido DESC, saldoPendiente::numeric DESC, facturaId ASC`, plus `resumirAgingSqlEnTx` — a SQL bucket-summary whose frozen CASE mirrors `clasificarBucketAging`; the pure `construirFilaAging` recomputes day/date/bucket on the PAGE rows only. The CSV export path (`leerCxcAgingCompleto`) stays a deliberately unbounded full read (runtime guard: a pageSize-1 filter still exports the full dataset)
  * **rentabilidad (REN-4):** the screen page is LIMIT/OFFSET-cut inside `rentabilidadFilasEnTx` (pinned `ORDER BY p."id" ASC`), the filtered total is the new `contarRentabilidadFilasEnTx` (COUNT over the ONE shared WITH + PRODUCTO universe), and REN-1 metric math stays pure per row (byte-identical across page sizes — 110-fixture page walk 1..5 + 250→100 clamp). The summary keeps `resumirRentabilidad` over the same un-paged grouped read the CSV reuses (bounded distinct-product aggregate, risk-#7 sibling), so screen-vs-CSV parity holds by construction
  * **estadoFacturas (OP-6):** the grid gains the `limitePaginaSql` tail behind the explicit deterministic `ORDER BY estado, tipoNcf`; both columns are frozen Postgres ENUMs, so the observable pin is the ENUM declaration order (VIGENTE/CANCELADA/ANULADA; B01/B02) — stronger than the design's alphabetical wording and identical to the pre-slice implicit order; page 1 at the default 25 always holds the whole ≤6-cell grid. The page-independent summary keeps its own full-grid read per documented design risk #7
  * Pins shipped with the diff: `aging-sql-pin` unit suite (boundary fixtures + CASE mirror 0..400), the aging integration suite (516-fixture order-pin page walk, SQL-vs-domain `diasVencidoEnSD` parity, ADR-017 balance probe, export guard), the rentabilidad REN-4 integration describe, and the OP-6 estadoFacturas describe; canonical ADR-017 block byte-identical (grep-verified), export paths and audit inventory untouched (diff empty)
## [0.14.9](https://github.com/Wilfredery/SystemFact/compare/v0.14.8...v0.14.9) (2026-10-12)

### Features

* **cobros:** server-side pagination of the CxC board (R-C9) — the outstanding-filtered page cut (LIMIT/OFFSET, echaEmision DESC, id DESC order pinned) executes in SQL through an outward wrapper over the canonical ADR-017 aggregate (kept byte-identical; the coupling-fragment rule follows the existing loquearYCalcularSaldoFacturaEnTx pattern); the action returns typed metadata {filas, total, page, pageSize, totalPages}; page size normalizes 0/absent→25, 250→100 before data access; the customer statement keeps its whole-account full read via the dedicated consultarEstadoDeCuentaAction (the board's outstanding filter would lose settled rows). Pins: order page-walk parity vs the canonical order at pageSize 25/100, PAGADA-boundary SQL parity (cobrosAplicados < total re-encoding ONLY the classifier's threshold — incl. cobros>total and debit-note re-inflation exclusions), 110-row clamp walk
* **auditoria:** absorb the consultation pagination helpers into the shared contract (AU-4) — local caps/normalizers/object-shape calcularOffset deleted; a non-positive pageSize now folds to the shared default 25 instead of 1 (uniform clamp; audit zod already rejects sizes below 1 transport-side)
* **reportes:** single pagina<T> assembler in 
eportes/domain/reporte-resultado.ts (D7) — the duplicated copies in operacional.ts/inanciero.ts deleted; fixtures-equivalence test pins byte-equal Pagina output; duplicated pagination helpers in the cobros board + auditoria + financiero/operacional scope = 0
* **cobros:** ACCEPTED BEHAVIOR CHANGE (design risk #3): the board's three bucket counts/rows are PAGE-SCOPED — per-bucket totals across the whole tenant would require the derived mora/estado rules re-encoded in SQL (forbidden second encoding); board page navigation is server-driven (Anterior/Siguiente honoring 	otalPages), and cobros/ui/board.ts paginar is now a composition over the server page metadata (the in-memory full-set page cut is gone)
## [0.14.8](https://github.com/Wilfredery/SystemFact/compare/v0.14.7...v0.14.8) (2026-10-12)

### Refactors

* **inventario:** batch the product-ownership guard into ONE tenant-safe query — the per-product `findFirst` ownership loop is replaced by a single `findMany` (`{id: in ids, empresaId}`) + pure set-difference; deny-by-default unchanged (single missing id keeps the `{productoId}` throw context, multi-missing names every id); the `FOR UPDATE` per-row lock loops are untouched (R-INV-B1)
* **shared:** new pure pagination contract `src/shared/domain/pagination.ts` (caps 25/100 + `normalizarTamanoPagina`/`normalizarPagina`/`calcularOffset`/`calcularTotalPages`, numeric signatures, function-only per design D3/D7) — the reportes filter (`reporte-filtro.ts`) and the cobros board `paginar<T>` now compose it; no module-local 25/100 literals remain in the absorbed sites (R-QC-07). Uniform clamp: pageSize 0 now yields the default 25 (previously 1; the HTTP zod layer already rejected 0, so no transport-visible change)
## [0.14.7](https://github.com/Wilfredery/SystemFact/compare/v0.14.6...v0.14.7) (2026-10-12)
* **ncf:** compute seed vigencia year on the Santo Domingo business calendar ([85f86b2](https://github.com/Wilfredery/SystemFact/commit/85f86b202b00ef8635ed04d9ffc66eeb785981e1))

## [0.14.7](https://github.com/Wilfredery/SystemFact/compare/v0.14.6...v0.14.7) (2026-10-12)

### Bug Fixes

* **db:** explicit RESTRICTIVE deny-all RLS policy on `_prisma_migrations` silences the Supabase `rls_enabled_no_policy` lint while keeping the implicit deny semantics (app roles never read the migration ledger)

## [0.14.6](https://github.com/Wilfredery/SystemFact/compare/v0.14.5...v0.14.6) (2026-10-12)

### Bug Fixes

* **venta:** reposicion-neta aggregates sale lines by product before netting — multi-line same-product sales no longer under-credit ([#110](https://github.com/Wilfredery/SystemFact/pull/110))
* **reportes:** csv formula neutralization checks the trimmed lead (whitespace-then-metacharacter cells covered) ([#110](https://github.com/Wilfredery/SystemFact/pull/110))
* **scripts:** stock-shape probe asserts the post-fix net reposition and hardens the audit-trigger bypass ([#110](https://github.com/Wilfredery/SystemFact/pull/110))

## [0.14.5](https://github.com/Wilfredery/SystemFact/compare/v0.14.4...v0.14.5) (2026-10-10)

### Bug Fixes

* **venta:** confirmed-cancel reposition nets against VIGENTE devoluciones — closes audit run-3 phantom-stock finding ([#109](https://github.com/Wilfredery/SystemFact/pull/109))

## [0.14.4](https://github.com/Wilfredery/SystemFact/compare/v0.14.3...v0.14.4) (2026-10-10)

### Bug Fixes

* **cobros:** refund bound counts committed refunds as net cash — audit run-3 cumulative over-refund drain ([#108](https://github.com/Wilfredery/SystemFact/pull/108))
* **reportes:** csv-writer neutralizes spreadsheet-formula metacharacter cells — audit run-3 formula injection ([#108](https://github.com/Wilfredery/SystemFact/pull/108))

## [0.14.3](https://github.com/Wilfredery/SystemFact/compare/v0.14.2...v0.14.3) (2026-10-10)

### Bug Fixes

* **e2e:** the cobros assertions no longer depend on the PaymentForm success toast surviving the canonical refetch — the parent reload legitimately unmounts the fully-paid row's form, and the R-C7 spec requires disable-on-first-click + at most one persisted collection (DB proof), not a long-lived toast. Trace-verified: one aborted action call + one `ok:true` + exactly one `PAGO` row (pagoId 22).

## [0.14.2](https://github.com/Wilfredery/SystemFact/compare/v0.14.1...v0.14.2) (2026-10-10)

### Bug Fixes

* **db:** verify-full TLS to the Supabase pooler: embed the official `prod-ca-2021.crt` (SHA-256 pinned) and pass explicit `ssl {ca, rejectUnauthorized: true, minVersion TLSv1.2}` through `@prisma/adapter-pg`, replacing the sslmode=require + uselibpqcompat (encrypted but UNVERIFIED) posture. Requires the operator launcher `tools/scripts/harden-cloud-tls.ps1` to scrub the TLS query params from the Vercel DATABASE_URL/DIRECT_URL (pg 8.23 DSN parse overrides the explicit ssl object).

## [0.14.1](https://github.com/Wilfredery/SystemFact/compare/v0.14.0...v0.14.1) (2026-10-10)

### Bug Fixes

* **db:** migration function_search_path_lockdown - pins search_path='' on both lint-0011-flagged trigger functions (systemfact_audit_readonly, systemfact_usuario_auth_user_id_no_null). Rollback via RESET search_path documented.

## [0.14.0](https://github.com/Wilfredery/SystemFact/compare/v0.13.0...v0.14.0) (2026-10-10)

### Features

* **e2e:** the cobros suite self-seeds its own credit sales through the validated POS UI (deterministic: no operator-curated prod state), proving revision with DB-ledger idempotency and a settled-own-invoice hygiene step; new READ-ONLY diag-cxc-prod tool reconciles the ADR-017 derived balances against raw rows.
* **seed-bootstrap:** provisions the demo CREDITO client (Comercios Clara, limite 10000/plazo 15d) as part of the minimum flows skeleton.

### Validation

* Full E2E suite on the private Vercel preview: **4/4 PASS** (cobros x2, confirm-venta NCF chain, devolucion B04 cycle) - 50.4s serial.

## [0.13.0](https://github.com/Wilfredery/SystemFact/compare/v0.12.2...v0.13.0) (2026-10-10)

### Features

* **e2e:** cloud validation tooling for the private Vercel preview (prod seed launchers, E2E cloud launcher with hidden-input secrets, TLS-parse fix helper); confirmed-venta + devolucion smokes PASS on prod, cobros explicit design-skips until a credit sale exists.

### Bug Fixes

* **devolucion:** drop the use-server directive from the shared helpers module (prod-only 'found object' hard-fail at first server-action invocation).
* **seed-bootstrap:** USUARIO.passwordHash now stores a dead random bcrypt placeholder instead of a replayable copy of the live GoTrue credential; idempotent remediation for existing rows.

## [0.12.2](https://github.com/Wilfredery/SystemFact/compare/v0.12.1...v0.12.2) (2026-10-10)

### Chores

* **deploy:** add .vercelignore excluding the local .env (localhost dev values) from Vercel CLI deploys, so the private preview project (wilfrederys-projects/systemfact, SSO-protected, no git connection) never carries local service credentials; cloud DB/auth values live as encrypted Vercel env vars. Closes the deferred-Vercel private-preview checklist (OpenSpec deploy-vercel-pending-frontend).

# Changelog

## [0.12.1](https://github.com/Wilfredery/SystemFact/compare/v0.12.0...v0.12.1) (2026-10-10)

### Chores

* **db:** add the production-migration operator tooling — `tools/scripts/supabase-prod-migrate.ps1` (hidden-input password launcher with session-pooler host auto-discovery) + `tools/scripts/set-prod-app-role.ts` (runtime role password via charset-whitelisted `ALTER ROLE`, never persisted), `tools/scripts/prod-connection-diag.{ts,ps1}` (verbose connection probe with AUTH/NET/DBS/OTHER failure classes), and the tsx-CJS `main()`/path fixes that made them run. Tooling only; no runtime code changes.
* **deployment:** record the deferred-Vercel resume checklist in OpenSpec (`openspec/changes/deploy-vercel-pending-frontend/proposal.md`): confirmed Supabase production state (15 migrations incl. NCF BigInt, FORCE RLS 25/25, registry-only recoveries documented in `_prisma_migrations.logs`), the exact 4 Vercel env vars, working session-pooler host and post-deploy validation sequence.

## [0.12.0](https://github.com/Wilfredery/SystemFact/compare/v0.11.38...v0.12.0) (2026-10-09)

### Features

* **ncf:** convert `NCF_SECUENCIA` range/sequence columns to BigInt (`bigint` end-to-end: schema, migration `20261009202000_ncf_secuencia_bigint`, domain rules, repository raw queries and tests; `%08d` fiscal composition unchanged). Closes the explicit deferred item H4 from the Prisma schema evaluation.

## [0.11.38](https://github.com/Wilfredery/SystemFact/compare/v0.11.37...v0.11.38) (2026-10-09)

### Chores

* **auth:** close the non-blocking review follow-ups from the native bounded review of the v2r-01 change — fix the run-together word in the tenant-runtime resolution docblock (`nuncalogueada` → `nunca logueada`), consolidate the duplicated v2r-01 rationale into the canonical narrative (`auth/infrastructure/auth-identity.ts` + `auth/README.md`; TS/schema comments now point at it, applied migration SQL stays frozen), and add direct unit coverage for `getCurrentTenantContext` (7 tests pinning sub-keyed resolution, enumerated select, login-flow RLS pin and derived `esAdmin` — `R3-002`).

## [0.11.37](https://github.com/Wilfredery/SystemFact/compare/v0.11.36...v0.11.37) (2026-10-09)

### Bug Fixes

* **auth:** pin verify-rls v2r-01 index check by the exact index name instead of the first row of an unordered `pg_indexes` scan (`R3-001`, native bounded review) ([#81](https://github.com/Wilfredery/SystemFact/pull/81)) ([c70fac9](https://github.com/Wilfredery/SystemFact/commit/c70fac9))

## [0.11.36](https://github.com/Wilfredery/SystemFact/compare/v0.11.35...v0.11.36) (2026-10-06)

### Code Refactoring

* **http:** split venta actions into lectura/escritura with shared helpers (final module of selective backend refactor) ([#94](https://github.com/Wilfredery/SystemFact/pull/94)) ([c20ac0b186f621fd66ca6fa66a13d44f858e610c](https://github.com/Wilfredery/SystemFact/commit/c20ac0b186f621fd66ca6fa66a13d44f858e610c))

## [0.11.35](https://github.com/Wilfredery/SystemFact/compare/v0.11.34...v0.11.35) (2026-10-06)

### Code Refactoring

* **http:** split reportes actions into read-only lectura/shared with barrel (no write actions exist) ([#93](https://github.com/Wilfredery/SystemFact/pull/93)) ([9118c1ddd0ba3b4a3f4c85638f5600cbf1fa3634](https://github.com/Wilfredery/SystemFact/commit/9118c1ddd0ba3b4a3f4c85638f5600cbf1fa3634))

## [0.11.34](https://github.com/Wilfredery/SystemFact/compare/v0.11.33...v0.11.34) (2026-10-06)

### Code Refactoring

* **http:** split compra actions into lectura/escritura with shared helpers ([#92](https://github.com/Wilfredery/SystemFact/pull/92)) ([e7c078fd518040ac97b18b4a68fd773dcba5d8c8](https://github.com/Wilfredery/SystemFact/commit/e7c078fd518040ac97b18b4a68fd773dcba5d8c8))

## [0.11.33](https://github.com/Wilfredery/SystemFact/compare/v0.11.32...v0.11.33) (2026-10-06)

### Code Refactoring

* **http:** split cliente actions into lectura/escritura with shared helpers ([#91](https://github.com/Wilfredery/SystemFact/pull/91)) ([06b1862de21d3f7c1b9d5527d0022e795d2d0a75](https://github.com/Wilfredery/SystemFact/commit/06b1862de21d3f7c1b9d5527d0022e795d2d0a75))

## [0.11.32](https://github.com/Wilfredery/SystemFact/compare/v0.11.31...v0.11.32) (2026-10-06)

### Code Refactoring

* **http:** split producto actions into lectura/escritura with shared helpers ([#89](https://github.com/Wilfredery/SystemFact/pull/89)) ([ae60512dc30c43f0d5885a0f0a11e26ec1e3f45b](https://github.com/Wilfredery/SystemFact/commit/ae60512dc30c43f0d5885a0f0a11e26ec1e3f45b))

## [0.11.31](https://github.com/Wilfredery/SystemFact/compare/v0.11.30...v0.11.31) (2026-10-06)

### Code Refactoring

* **http:** split cobros actions into lectura/escritura with shared helpers ([#88](https://github.com/Wilfredery/SystemFact/pull/88)) ([74670f3](https://github.com/Wilfredery/SystemFact/commit/74670f33c4712a128cbda37fb1d421b93d7c4897))

## [0.11.30](https://github.com/Wilfredery/SystemFact/compare/v0.11.29...v0.11.30) (2026-10-06)

### Code Refactoring

* **http:** split proveedor actions into lectura/escritura with shared helpers ([#87](https://github.com/Wilfredery/SystemFact/pull/87)) ([4696eeb](https://github.com/Wilfredery/SystemFact/commit/4696eebb889da82be74eadec717f8acd22a782e2))

## [0.11.29](https://github.com/Wilfredery/SystemFact/compare/v0.11.28...v0.11.29) (2026-10-05)

### Bug Fixes

* **eslint:** enforce tenant wrapper on split server action files ([#84](https://github.com/Wilfredery/SystemFact/pull/84)) ([d80bd3f](https://github.com/Wilfredery/SystemFact/commit/d80bd3fbcf0374092da9f6be05491af0ee52d9c1))

### Code Refactoring

* **http:** split inventario and categoria actions into lectura/escritura with shared helpers (slices 1, 2a) ([#84](https://github.com/Wilfredery/SystemFact/pull/84)) ([3c7c63f](https://github.com/Wilfredery/SystemFact/commit/3c7c63f048a1cd8d581765dca7d3ceed098f9cbc))

## [0.11.28](https://github.com/Wilfredery/SystemFact/compare/v0.11.27...v0.11.28) (2026-10-02)

### Code Refactoring

* **http:** split backend-pure Server Actions (auth, devolucion) into operation/shared files with barrel re-exports; behavior preserved. Fix Next.js build by making shared helpers async under Server Actions context. tsc --noEmit OK, production build OK.
## [0.11.27](https://github.com/Wilfredery/SystemFact/compare/v0.11.26...v0.11.27) (2026-10-01)

### Bug Fixes

* **auth:** close run-2 security audit finding `v2r-01` MEDIUM (ADR-014 binding hardening) -- the per-request identity no longer trusts the mutable synthetic email. `getCurrentTenantContext`, `getCurrentUser` and `resolverUsuarioDeSesion` previously decoded `nombreUsuario` back OUT of the JWT email and looked `USUARIO` up by it; because an Auth admin can change a user's email, whoever controls that attribute controlled which `USUARIO` row (and therefore which `empresa`) a request resolved to. Resolution is now keyed on the immutable Auth `sub`: bound lazily on first login by `enlazarAuthSub` (compare-and-set, idempotent, refuses both conflict directions without overwriting, translates the `P2002` violation to `AUTH_ENLACE_DUPLICADO`). `normalizarAuthSub` (pure, `auth/domain`) validates the claim is a canonical UUID before any query reaches Postgres, so a malformed claim returns `null` instead of surfacing as an opaque cast error. The synthetic email now survives only as the login-flow bootstrap, and even there it is not email-trusting: `buscarUsuarioPorNombreUsuario` receives `nombreUsuario` as an already-validated argument rather than decoding it from the session. Also removes `decodeNombreUsuario` -- the synthetic email is now built but never parsed -- and updates the module README to match the `sub`-keyed identity model. **Error taxonomy by inspection:** an absent row and a cross-tenant row are INDISTINGUISHABLE by construction (the `empresaId` filter plus RLS make both invisible), and that indistinguishability IS the defense, so both map to the single tenant-blind code `AUTH_ENLACE_NO_RESUELTO`; a row already held by a concurrent login under a different `sub` is NOT distinguishable from the different-`sub` case and stays `AUTH_ENLACE_CONFLICTO`. **`enlazarAuthSub` pins `app.current_empresa_id`** to the anchor's company before its UPDATE because the `usuario_modify` RLS policy does NOT honor `app.is_login_flow` (only `usuario_select` does), which is what makes the bind RLS-authorized for the pinned company alone. **Operational notes:** every session issued before this deploy is asked to log in exactly once (the binding is written at that login); this is not worked around with a silent email fallback, which is precisely the vulnerability being removed. A stale-session user who logs out BEFORE that re-login resolves no identity, so that single LOGOUT writes no audit row -- a transient, self-closing gap inside an already transient window, not a behavioural regression. Verified `tsc --noEmit` exit 0, lint 0 errors, `prisma validate` clean, 119/119 suites and 1154/1154 unit tests green (including the new `auth-sub`, `errors` and `auth-identity` suites, which assert the `REQ-AUTH-AUD-001` audit contract and the exact `app.current_empresa_id` GUC pin on the auth write path); CI applies the migration with `prisma migrate deploy` against real Postgres 16 before the integration suite.

## [0.11.26](https://github.com/Wilfredery/SystemFact/compare/v0.11.25...v0.11.26) (2026-10-01)

### Bug Fixes

* **db:** land the `USUARIO.authUserId` storage half of run-2 security audit finding `v2r-01` (ADR-014 binding hardening), schema only. Adds a nullable `USUARIO.authUserId UUID` column plus a hand-written `UNIQUE PARTIAL` index `usuario_auth_user_id_uk ... WHERE "authUserId" IS NOT NULL`; the Prisma DSL cannot express a partial index, and annotating `@unique` would misdescribe it as total. A second migration installs a `BEFORE UPDATE` trigger that raises when a row already carries an `authUserId` and the update tries to null it, so a bound identity can never be silently un-linked at the database level. The column is nullable and deliberately NOT backfilled: `sub` values live in Supabase Auth, not Postgres, so any offline backfill would have to fabricate UUIDs. **This PR carries no application code.** Nothing reads or writes `authUserId` yet, so the trigger is dormant and the column stays null for every existing row; the identity-resolution half that actually binds the session lands in the follow-up PR.

## [0.11.25](https://github.com/Wilfredery/SystemFact/compare/v0.11.24...v0.11.25) (2026-09-29)

### Documentation

* **schema:** document the `RETROACTIVO_FECHA_VENTA_DIAS` key in the `ConfiguracionEmpresa.clave` comment so the schema comment mirrors the full key catalog (`DESC_MAX`, `PLAZO_DEVOLUCION`, and the sale-date retroactivity horizon provisioned by migration `20260929120000_seed_retroactivo_fecha_venta_dias`); `prisma validate` clean

## [0.11.24](https://github.com/Wilfredery/SystemFact/compare/v0.11.23...v0.11.24) (2026-09-29)

### Bug Fixes

* **venta:** remove the manual `pnpm seed:venta` step as the only path for the sale-date band — new data migration `20260929120000_seed_retroactivo_fecha_venta_dias` provisions `RETROACTIVO_FECHA_VENTA_DIAS=7` (canonical window `2000-01-01…2099-12-31`) for every existing empresa at `migrate deploy` time, so sales can no longer be blocked by a forgotten manual seed after deploy; idempotent by the frozen compound unique index `("empresaId","clave","vigenciaInicio")` via `ON CONFLICT DO NOTHING` (no-ops when the seed already ran, creates exactly the missing rows when it did not — verified `INSERT 0 0` / `INSERT 0 1` against real Postgres 16), values copied from the same constants `seed-venta-config.ts` uses (one source of truth); deliberately scoped to the new key only because `DESC_MAX`/`PLAZO_DEVOLUCION` keep the seed script's R-V17 demote + fail-fast repair that a plain INSERT cannot replicate safely; `SETUP-LOCAL.md` runbook and venta README updated; verified `tsc --noEmit` exit 0 and seed unit suite 7/7

## [0.11.23](https://github.com/Wilfredery/SystemFact/compare/v0.11.22...v0.11.23) (2026-09-29)

### Bug Fixes

* **reportes,dgii:** close run-2 security audit finding `v2r-07:reportes-export-unbounded` HIGH (Phase 6 remediation) — the DGII TXT fiscal exporters no longer allow unbounded or cross-month payloads: `generarTxt606`/`generarTxt607`/`generarTxt608` enforce a single calendar month in `America/Santo_Domingo` via the pure `periodoSdDeVentana`/`periodoAprobadoDeVentana` guard in `reportes/domain/dgii/ventana.ts`, so the `PERIODO=AAAAMM` header can never be filed under a period the guard did not approve (a 31-day window `2026-04-01..2026-05-01` could previously label April rows as `202605`); oversized exports fail fast with `REPORTE_DGII_VENTANA_EXCEDIDA` / `REPORTE_DGII_TAMANO_EXCEDIDO` (50 MiB UTF-8 byte cap `verificarTamanoExportacionDgii` shared by 606/607/608) before any query, with `ReportResult.details` carrying the concrete reason to export month by month; also aligned the 607 `tipo-ingreso` grammar with the official DGII instructivo (single digit 1–6): `esCodigoTipoIngresoValido` pins `/^[1-6]$/`, `leerMapaTipoIngreso607EnTx` discards invalid configured values at the repository boundary, and the default stays `1`; verified 1104 unit tests green across 116 suites (including the new ventana/tipo-ingreso suites), `tsc --noEmit`, lint 0 errors, `prisma validate` clean, `lint:commits` clean; integration coverage runs in CI against real Postgres 16 (local run requires the out-of-band harness role password)

## [0.11.22](https://github.com/Wilfredery/SystemFact/compare/v0.11.21...v0.11.22) (2026-09-28)

### Bug Fixes

* **venta:** close run-2 security audit finding `v2r-11:fecha-venta-unbounded` MEDIUM (Phase 5 remediation) — the sale date is now bounded at the application boundary against the server clock: pure `validarFechaVenta` in `venta/domain/fecha-venta.ts` accepts only `[hoy_SD − horizonte, hoy_SD]` inclusive (America/Santo_Domingo calendar days via ICU `en-CA` compare) and always rejects the future, with the per-empresa horizon read from the DB (`RETROACTIVO_FECHA_VENTA_DIAS`, seeded default `7`, may be `0`, newest-`vigenciaInicio` tie-break); a missing config row fails loud (`RETROACTIVO_FECHA_VENTA_FALTANTE`) instead of silently widening the window; `crearVenta` and `actualizarVenta` both gate through `validarFechaVentaEnTx` (create before the client resolver, update after the existence read so a foreign id stays `VENTA_NO_ENCONTRADO`), and rejections surface stable codes `FECHA_VENTA_FUTURA` / `FECHA_VENTA_RETROACTIVA_EXCEDIDA` as typed errors without touching CF/NCF/audit/stock; integration `venta-retroactivo` replay proves the harness horizon `999` is confined to fixtures while production runs at `7` (sale exactly at max is accepted, one day beyond throws before any write); deploy-time integrity guard `pnpm config:verify` (`tools/scripts/verify-venta-config.ts`) audits every empresa for `DESC_MAX`, `PLAZO_DEVOLUCION` and `RETROACTIVO_FECHA_VENTA_DIAS` active and in force, exiting 1 with all missing pairs — it reads through `DIRECT_URL` (the app role outside a tenant transaction sees zero rows because `CONFIGURACION_EMPRESA` has RLS ENABLE+FORCE keyed on `app.current_empresa_id` default `'0'`) and runs in CI only inside the E2E seed step, never in the Jest integration job whose fixtures create empresas without business seeds; verified 1073 unit + 207 integration tests green (including the new fecha-venta, config-repository, venta-service suites), `tsc --noEmit`, lint 0 errors, `pnpm config:verify` exit 0 against the seeded DB, `git diff --check` clean

## [0.11.21](https://github.com/Wilfredery/SystemFact/compare/v0.11.20...v0.11.21) (2026-09-26)

### Bug Fixes

* **compra,reportes,dgii:** close run-2 security audit finding `dgii-606:compra-ncf-free-text-control-chars` HIGH (Phase 4 remediation) — the purchase NCF input is no longer free text: `validarNcf` in `compra/http/validations.ts` enforces the frozen grammar `/^B(?:01|11)\d{8}$/` (11 chars) plus a Decimal(12,2) unit-cost bound at the wire, `crearCompra`/`actualizarCompra` re-enforce the same grammar and the tenant scope (`empresaId`/`sucursalId`) below the transport, and the domain shares one single-source quantity/cost width rule; the DGII exporters stop emitting attacker-influenced bytes: `ensamblarDetalle607`/`ensamblarDetalle606` normalize via that grammar, compose zero-fill before sanitize (never fabricating plausible NCFs), validate the composed text instead of the raw DB text, and fail loud — `formatearMonto` rejects non-finite values and scale > 2, `validarPeriodoAAAAMM` rejects non-`AAAAMM` periods, `ensamblarEncabezado5` asserts the `codigoInformacion` is 606/607, and every width overflow throws `ReporteDomainError` with one of the stable codes (`REPORTE_DGII_ANCHO_EXCEDIDO`, `REPORTE_DGII_PERIODO_INVALIDO`, `REPORTE_DGII_MONTO_INVALIDO`, `REPORTE_DGII_CODIGO_INVALIDO`); `TIPOS_NCF` (runtime list with derived `TipoNcf` union) is pinned against the generated Prisma `TipoNcfSecuencia` enum by a parity test, and the compra tests were typed honestly with `jest.mocked`; verified 322 unit tests green (reportes + compra + ncf modules), `tsc --noEmit`, lint 0 errors

## [0.11.20](https://github.com/Wilfredery/SystemFact/compare/v0.11.19...v0.11.20) (2026-09-25)

### Bug Fixes

* **rls,env,ci:** close run-2 security audit finding `usuariorol_isolation.missing-is_login_flow-branch` MEDIUM (Phase 3 remediation) — new hand-written migration `20260925120000_fix_usuariorol_login_flow` recreates the `usuariorol_isolation` policy with the single added clause `OR COALESCE(NULLIF(current_setting('app.is_login_flow', true), ''), '') = 'true'` in USING (mirroring `usuario_select` at `20260902120000_enable_rls` line 108, per that migration's own header lines 18-20 which document the USUARIO + USUARIO_ROL `findUnique` auth pair): the policy created at lines 157-179 of the same migration never carried the exception, so the post-`signInWithPassword` lookup of the caller's own role rows could not read them before a tenant context exists; WITH CHECK is deliberately unchanged, so the exception grants login-flow READ only and never login-flow writes; `assertAppRoleUrl` in `src/lib/env.ts` replaces the `SUPERUSER_LIKE_ROLES` denylist with a `systemfact_app` ALLOWLIST that accepts only `systemfact_app` and the dotted transaction-pooler form `systemfact_app.<project-ref>`, because a denylist of superuser-looking names can never be exhaustive and in fact admitted `supabase_admin` plus every dotted pooler variant (`postgres.<project-ref>`, `supabase_admin.<project-ref>`), each of which silently disables every RLS policy; `isAppRoleUsername` and `assertAppRoleUrl` are exported for direct testing and covered by a new `src/lib/env.test.ts` (20 cases: plain, dotted and mixed-case app role accepted; `supabase_admin`, `postgres`, `postgresql`, `root`, `admin`, `dbo`, `sa` and their dotted pooler forms rejected — all of which the old denylist let through, verified red against it); the `integration` CI job now runs `pnpm rls:verify` between database provisioning and the RLS-enforced Jest suite, so the role-level guarantees that were only ever checked by hand (not `postgres`/`supabase_admin`, no BYPASSRLS, not the table owner) now gate every PR; verified 989 unit tests green (969 baseline + 20 new), `tsc --noEmit`, lint (0 errors) and `prisma validate` clean

## [0.11.19](https://github.com/Wilfredery/SystemFact/compare/v0.11.18...v0.11.19) (2026-09-25)

### Bug Fixes

* **cobros,venta,devolucion:** close run-2 security audit findings v2r-02 MEDIUM, v2r-09 MEDIUM, v2r-04 MEDIUM (Phase 2 remediation) — `registrarReembolso` now derives `cobrado = total − saldoPendiente` from the same `FOR UPDATE` locked facts used for the null-check and rejects `monto > cobrado` with the new stable code `REEMBOLSO_EXCEDE_SALDO` before writing the PAGO row (previously an unbounded REEMBOLSO/APLICADO could be committed verbatim against any VIGENTE invoice, even one with zero payments); `cancelarVentaConfirmada` now reverts every live `APLICADO` payment of the invoice to `REVERTIDO` inside the same transaction, BEFORE the ANULADA flip, with one append-only audit row per reverted payment (previously a paid CONTADO sale's single COBRO/APLICADO was orphaned: both refund sinks require FACTURA VIGENTE and the canonical CxC balance filters VIGENTE, so recorded cash vanished from every derived view); venta line input now rejects repeated `productoId` via a shared `zLineasUnicas` zod refine on both create/update schemas plus a defense-in-depth mirror gate in `prepararLineasVenta` (`LINEA_INVALIDA`), `DetalleVenta` gained `@@unique([ventaId,productoId])` (hand-written migration `20260925_detalle_venta_unique_venta_producto`, own commit, verified zero duplicates in dev+test DBs before applying) and `resolverLineasContraVentaOriginal` now groups ORIGINAL rows per productoId, SUMS quantities and throws `LINEA_INVALIDA` when `precioUnitario`/`tasaItbis` differ across rows of the same product (previously a duplicate-producto sale collapsed via `new Map` last-write-wins: first row's units became unreturnable and frozen NC money came from the wrong row); regression coverage via offline 2-case devolucion harness (2.000 and 6.000 of 7 sold units now pass, 8.000 still caps), boundary tests on both venta schemas, cancel-paid-sale integration (PAGO estado=REVERTIDO, derived balance pre-sale, stock restored), refund-bound integration (seed partial cobro then assert REEMBOLSO_EXCEDE_SALDO) and updated auditoria-cobros fixture; verified 969 unit + 199 integration tests green (sole integration failure is the pre-existing v2r-10 harness parking flake, reproduced at true baseline), `tsc --noEmit`, lint, `prisma validate` and production build clean

## [0.11.18](https://github.com/Wilfredery/SystemFact/compare/v0.11.17...v0.11.18) (2026-09-24)

### Bug Fixes

* **compra,venta:** close confirm TOCTOU races against concurrent draft edits (run-2 security audit v2r-03 HIGH, v2r-10 MEDIUM) — `confirmarCompra` now locks the `COMPRA` row (`SELECT ... FOR UPDATE`, `estado='BORRADOR'`) before re-deriving totals from a converged re-read under the held lock, so a draft edited mid-confirm can no longer persist stale header totals over its final lines (the 354.00 divergence repro); `confirmarVenta` now pins the guard `updatedAt` snapshot in `confirmarVentaFlipEnTx` (`WHERE ... estado='BORRADOR' AND updatedAt=<read value>`, mirroring `actualizarVentaBorradorEnTx`), so a draft edited between read and flip fails the flip (zero rows) and the transaction throws — un-burning its NCF consume — instead of emitting an invoice with stale totals; regression coverage via real-DB integration suites (`compra-concurrency.integration.test.ts`, `confirmar-venta.integration.test.ts`: 2-connection interleavings, pg_locks assertions, persisted-header==final-lines convergence check, NCF-unburn check 521 no-consumption) and updated unit tests; verified 951 unit + 197 integration tests green, `tsc --noEmit`, lint, `prisma validate` and production build clean

# [0.11.17](https://github.com/Wilfredery/SystemFact/compare/v0.11.16...v0.11.17) (2026-09-19)

### Documentation

* **sdd:** archive backend-quality-polish — canonical backend-code-quality spec + final gate report (8-PR chain, 63→28 issues, 0 BLOCKER/CRITICAL, dup 1.0%) (#71 pending)
## [0.11.16](https://github.com/Wilfredery/SystemFact/compare/v0.11.15...v0.11.16) (2026-09-19)

### Refactored

* **inventario,reportes:** backend quality-polish batch + dedup (SDD `backend-quality-polish` stage 5b, R-QC-02/R-QC-05) - `inventario-repository.ts`: extract the shared async `guardarPertenenciaProductosEnTx` Phase-A ownership read used by the ajustar/entrada-compra/salidas/reposicion/devolucion batches (each batch skeleton and lock/write ordering stays separate; entrances vs exits never merged) and unify the three per-path audit emitters into one `registrarAuditoriaStockEnTx` parameterized by `AccionAuditoria` (AJUSTAR/CREAR/ACTUALIZAR), removing the duplicated guard + audit blocks with zero behaviour change; `reportes/infrastructure/cxp-repository.ts` + `operacional-repository.ts`: replace the repeated raw SQL segments with business-intent named `Prisma.Sql` fragments (`joinPagosAplicadosEnTx`, `whereVentaConfirmadaEnTx`, `whereInventarioPorEmpresaSucursal`, shared `limitePaginaSql`) preserving bind order and byte-identical screen/CSV predicate parity (EXP-2); `reportes/domain/dgii/formato.ts`: `rellenarAlnum` nullish-guard ternary to `??` (S6606); no undefined-vs-null patch semantics touched; verified 945 unit + 195 integration tests green (all affected DB-backed suites unmodified), `tsc --noEmit` and lint clean

## [0.11.15](https://github.com/Wilfredery/SystemFact/compare/v0.11.14...v0.11.15) (2026-09-18)

### Refactored

* **ui:** mechanical quality-polish batch (SDD `backend-quality-polish` stage 5a) - `readonly` prop typing across the 11 venta/devolucion/login-layout component prop objects (S6759, type-only), `formatearMonto` thousands-grouping regex in `venta/ui/carro.ts` replaced with a pinned `en-US` `Intl.NumberFormat` plus a colocated `formatearMonto.test.ts` behavioural lock (S8786, presentation-only; the provably-redundant `dec === "00"` branch dropped), two nested ternaries flattened to an exhaustive `tono` badge lookup (`cobros/ui/CxcBoardScreen.tsx`) and a save-caption if/else (`venta/ui/PosScreen.tsx`) (S3358), and `venta/ui/DiscountPanel.tsx` label text wrapped in `<span>` to match the codebase's own label convention (S6772); no behaviour change - 945 unit tests green (937 baseline + 8 lock tests), `tsc --noEmit` and lint clean

## [0.11.14](https://github.com/Wilfredery/SystemFact/compare/v0.11.13...v0.11.14) (2026-09-18)

### Chores

* **deps:** override vulnerable prisma transitive bundles (SDD `backend-quality-polish` stage 4, R-QC-03) â€” `lodash` 4.17.21â†’4.18.1, `deepmerge-ts` 7.1.5â†’8.0.2 and `mysql2` 3.15.3â†’3.24.4 arrive only inside the `prisma@7.10.0` bundle and are pinned by prisma's own ranges, so they are forced to their GHSA-patched floors via `app/pnpm-workspace.yaml` `overrides` (pnpm 11+ ignores `package.json#pnpm.overrides`); Prisma is already at the newest compatible 7.x (8.x is RC-only) so no version bump applies; the open `mysql2 >=3.22.0` floor resolves to 3.24.4, which also clears the 3.23.1 decompression-bomb advisory; verified `prisma validate`/`generate` pass, `pnpm audit --prod` = 0, 937 unit + 195 integration tests green, tsc/lint clean

## [0.11.13](https://github.com/Wilfredery/SystemFact/compare/v0.11.12...v0.11.13) (2026-09-18)

### Tests

* **quality-polish:** wire honest real-database integration coverage into the Sonar lab (SDD `backend-quality-polish` slice 3) â€” add a `pnpm coverage:integration` script (`test:integration` + `--coverage --coverageReporters=lcov --coverageDirectory=coverage-integration`) and scope `jest.integration.config.js` `collectCoverageFrom` to backend `src/**` sources only (excluding the generated Prisma client, the integration/test-support harnesses and the Next.js `src/app/**` pages, which the `node`-env integration run cannot instrument), so the emitted `coverage-integration/lcov.info` merges with the unit lcov via a comma-separated `sonar.javascript.lcov.reportPaths` (documented in `app/README.md`); test-DB `DATABASE_URL` still comes from the git-ignored `app/.env.integration` (no secrets committed) and no application-code smell is touched (verified: 937 unit + 195 integration tests, `tsc --noEmit` and lint green)

## [0.11.12](https://github.com/Wilfredery/SystemFact/compare/v0.11.11...v0.11.12) (2026-09-18)

### Refactored

* **tenant:** relocate the `withTenantTransaction` GUC/RLS integration probe out of the Jest/Sonar source tree to `app/scripts/withTenantTransaction.probe.ts` (SDD `backend-quality-polish` slice 2) so the tsx-only probe is no longer flagged as a source-less test (S2187); imports rewritten to `@/modules/...`, `pnpm probe:tenant` script added, the now-redundant per-file Jest exclusion dropped (`scripts/` stays excluded), and the sibling `-options.test` header updated to the new path â€” no `.itest.ts` rename; GUC behavior coverage is unchanged (the mocked timeout/`set_config`-failure cases and the live-probe assertions both stay)

## [0.11.11](https://github.com/Wilfredery/SystemFact/compare/v0.11.10...v0.11.11) (2026-09-18)

### Refactored

* **quality-polish:** pass-2 complexity split of 5 updater/normalizer functions so every one clears the Sonar S3776 â‰¤15 cognitive-complexity ceiling â€” `actualizarProducto` 25â†’10 (pure `validarInvariantsFiscales` + async `sondarIntegridadReferencial`), `actualizarProveedor` 23â†’13 (pure `prepararPatchProveedor`/`resolverRncFinalSeguro` + async `sondaRncDuplicado` + `calcularDifAuditoria`, row guards inline to avoid non-null assertions), `actualizarCliente` 21â†’12 (pure `prepararValidacionCliente` + async `sondaFiscalDuplicada` + `calcularDifAuditoria`), `resolverRangoSD` 18â†’8 (`resolverPresetFechas` + `validarRangoPersonalizado` + `normalizarFechaCruda`, error precedence unchanged) and `confirmarVenta` 16â†’15 (PRE-consume pure `resolverRechazoCredito`; the consumeâ†’flipâ†’invoiceâ†’salidas/cobro R-V15 chain stays inline and ordered) (SDD `backend-quality-polish` slice 1f â€” behavior-preserving: the 937-test unit suite and the confirmar/cliente/reportes integration suites pass with zero golden or characterization churn)

## [0.11.10](https://github.com/Wilfredery/SystemFact/compare/v0.11.9...v0.11.10) (2026-09-18)

### Refactored

* **venta,devolucion:** extract pure pre-consume helpers `verificarDisponibilidadPreNcf` (R-V15 hard stock-preview predicate) and `resolverLineasContraVentaOriginal` (R-D5 original-line freeze) with colocated unit tests; close both S3735 `void` findings (drop the unused NCF `secuencial` capture in `confirmarVenta`; explicit if-and-return guard replaces the unreachable `void gate` dismissal in `cancelarVentaConfirmada`) and fix S6582 on the factura guard via optional chaining (SDD `backend-quality-polish` slice 1e â€” behavior-preserving; the consumeâ†’flipâ†’invoiceâ†’salidas/cobro ordering stays inline and ordered, the confirmar/devolucion and cancelar-confirmada integration suites pass unmodified)

## [0.11.9](https://github.com/Wilfredery/SystemFact/compare/v0.11.8...v0.11.9) (2026-09-18)

### Refactored

* **reportes:** dispatch-only `REPORTE_ID â€” {consultar, Panel}` registry + single dispatch in the `/reportes` page, replacing the 10 per-report action+Panel conditionals (SDD `backend-quality-polish` slice 1d â€” S3776 cognitive-complexity, behavior-preserving; authorization stays in the server actions, DB-2 integration suites untouched)

## [0.11.8](https://github.com/Wilfredery/SystemFact/compare/v0.11.7...v0.11.8) (2026-09-18)

### Refactored

* **reportes,auditoria:** extract pure `resolverRangoSD(entrada, now)` (SD-range resolve/preset/validate/UTC-convert) and pure `normalizarAccion`/`normalizarTexto` trim helpers out of the two `normalizarFiltro` functions (SDD `backend-quality-polish` slice 1c â€” S3776 cognitive-complexity, behavior-preserving; existing filter suites stay green, no test churn) (#62 pending)

## [0.11.7](https://github.com/Wilfredery/SystemFact/compare/v0.11.6...v0.11.7) (2026-09-18)

### Refactored

* **venta,proveedor:** decompose `prepararLineasVenta` into pure `validarPrecondicionesLineas`/`construirLineasPersistibles`/`colectarWarningsStock` + async `validarDescuentosAutorizadosYTopes`, and extract pure `construirPatchProveedor`/`resolverRncFinal` (SDD `backend-quality-polish` slice 1b â€” S3776 cognitive-complexity, behavior-preserving; colocated discount-branch unit tests added)

## [0.11.6](https://github.com/Wilfredery/SystemFact/compare/v0.11.5...v0.11.6) (2026-09-18)

### Chores

* **agents:** codify release conventions â€” every PR carries its own version bump, semver `refactor:`/`test:` â†’ PATCH, UTF-8 BOM rule for machine-consumed files (#59 CI root cause)

## [0.11.5](https://github.com/Wilfredery/SystemFact/compare/v0.11.4...v0.11.5) (2026-09-18)

### Refactored

* **producto,cliente:** table-driven patch + audit-diff builder, undefined-vs-null goldens pinned (SDD slice 1a) (#58) ([v0.11.5](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.5))

## [0.11.4](https://github.com/Wilfredery/SystemFact/compare/v0.11.3...v0.11.4) (2026-09-18)

### Fixed

* **db:** unconditional append-only audit trigger (AUDITORIA_INMUTABLE) + schema credit-defaults sync (#57) ([v0.11.4](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.4))
## [0.11.3](https://github.com/Wilfredery/SystemFact/compare/v0.11.2...v0.11.3) (2026-09-18)

### Fixed / Maintenance

* **test:** replace `Math.random` test-data suffixes with `crypto.randomUUID` integration fixtures (#55) ([v0.11.3](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.3))

## [0.11.2](https://github.com/Wilfredery/SystemFact/compare/v0.11.1...v0.11.2) (2026-09-18)

### Documentation

* **sdd:** archive fase-7b-reportes Ã¢â‚¬â€ 6 canonical specs synced + chain close report (#54) ([v0.11.2](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.2))

## [0.11.1](https://github.com/Wilfredery/SystemFact/compare/v0.11.0...v0.11.1) (2026-09-17)

### Chores

* release 0.11.0 Ã¢â‚¬â€ package.json bump 0.5.0 Ã¢â€ â€™ 0.11.0, manifest and CHANGELOG backfill (#53) ([v0.11.1](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.1))

## [0.11.0](https://github.com/Wilfredery/SystemFact/compare/v0.10.0...v0.11.0) (2026-09-17)

### Features

* **reportes:** slice E Ã¢â‚¬â€ IT-1 fiscal summary + DGII 606/607/608 TXT exports (#52): signed per-period ITBIS summary + IT-1 casilla self-check; DGII fixed-width exporters 607/606/608 (DB-backed B02 threshold, deterministic cap split, en-cero, U1 encoding gates); `/reportes/exportar-txt` route, fiscal panel and actions (Fiscal Admin-only, no audit rows) ([v0.11.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.11.0))
* **reportes:** slice D Ã¢â‚¬â€ per-product rentabilidad report (#51): current-cost margin math, REN-3 limitation surfaced, rentabilidad panel + CSV ([v0.10.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.10.0))
* **reportes:** slice C Ã¢â‚¬â€ CxC aging, CxP and comparativa financiera (#50): ADR-017-derived balances, aging buckets, Cobrador branch-pin, cash-flow window deltas ([v0.9.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.9.0))
* **reportes:** slice B Ã¢â‚¬â€ operational reports + CSV export + aggregation indexes (#49): product ranking, stock state, sales by period, inventory valuation, invoice state ([v0.8.0](https://github.com/Wilfredery/SystemFact/releases/tag/v0.8.0))

## [0.7.0](https://github.com/Wilfredery/SystemFact/compare/v0.6.1...v0.7.0) (2026-09-17)

### Features

* **reportes:** slice A Ã¢â‚¬â€ shared reportes infra + role-aware dashboard (#48): filter/pagination/role-gate contracts, Santo-Domingo calendar boundaries, RFC4180 CSV writer seam, company-wide read widen, dashboard KPIs, selector-first `/reportes` shell ([#48](https://github.com/Wilfredery/SystemFact/pull/48))

## [0.6.1](https://github.com/Wilfredery/SystemFact/compare/v0.6.0...v0.6.1) (2026-09-17)

### Documentation

* **sdd:** archive fase-7a-auditoria Ã¢â‚¬â€ spec sync + archive report (#47)

## [0.6.0](https://github.com/Wilfredery/SystemFact/compare/v0.5.0...v0.6.0) (2026-09-17)

### Features

* **auditoria:** fase 7a Ã¢â‚¬â€ audit consultation screen, cobros/auth write backfill, append-only audit port (#46): admin `/auditoria` screen, `AuditoriaWritePort`, LOGIN/LOGOUT/PAGAR audit events, tenant read indexes

## [0.5.0](https://github.com/Wilfredery/SystemFact/compare/v0.4.2...v0.5.0) (2026-09-15)


### Features

* **devolucion:** B04 nota de credito use case, repository seam and http action ([5a01df1](https://github.com/Wilfredery/SystemFact/commit/5a01df1f52e070071305313c00c89508a48b2518))
* **venta,devolucion:** B04 credit-note returns core (fase-5d slice 1) ([55681b7](https://github.com/Wilfredery/SystemFact/commit/55681b7325644331f94c8144dbe2378aadd50882))
* **venta,devolucion:** idempotent retry gate + critical integration tests (fase-5d slice 3) ([#33](https://github.com/Wilfredery/SystemFact/issues/33)) ([a7eb2be](https://github.com/Wilfredery/SystemFact/commit/a7eb2be4f843e43c58b051a8f9b864e63f3025ae))
* **venta,devolucion:** return UI + E2E B04 happy path (fase-5d slice 2) ([#30](https://github.com/Wilfredery/SystemFact/issues/30)) ([a05accc](https://github.com/Wilfredery/SystemFact/commit/a05accc143659f43851e6efe43155e6be03b7aad))
* **venta:** return error codes 601-604, plazo-devolucion reader and NCF B04 seed ([9a6fdda](https://github.com/Wilfredery/SystemFact/commit/9a6fddacad5c4f691d0191d40b20186cbdccd5a9))


### Bug Fixes

* **ncf:** compute seed vigencia year on the Santo Domingo business calendar ([85f86b2](https://github.com/Wilfredery/SystemFact/commit/85f86b202b00ef8635ed04d9ffc66eeb785981e1))


### Documentation

* **devolucion:** module README + JSDoc pass (fase-5d pr5d4 closure) ([#36](https://github.com/Wilfredery/SystemFact/issues/36)) ([6d20bfe](https://github.com/Wilfredery/SystemFact/commit/6d20bfe571a7bd767e7bed890637b1ea8fe6c45a))

## [0.4.2](https://github.com/Wilfredery/SystemFact/compare/v0.4.1...v0.4.2) (2026-09-15)


### Documentation

* **sdd:** archive fase-5d-devolucion-b04 (spec sync + verify envelope) ([#40](https://github.com/Wilfredery/SystemFact/issues/40)) ([ef8ff84](https://github.com/Wilfredery/SystemFact/commit/ef8ff84a2678c57191925dcd7603b175b611586b))
* **sdd:** reconcile apply-progress + verify-report (fase-5d lifecycle closure) ([#38](https://github.com/Wilfredery/SystemFact/issues/38)) ([aa08311](https://github.com/Wilfredery/SystemFact/commit/aa083111e756c9d1eaed1cf4c62459280da31846))

## [0.4.1](https://github.com/Wilfredery/SystemFact/compare/v0.4.0...v0.4.1) (2026-09-15)


### Documentation

* **devolucion:** module README + JSDoc pass (fase-5d pr5d4 closure) ([#36](https://github.com/Wilfredery/SystemFact/issues/36)) ([6d20bfe](https://github.com/Wilfredery/SystemFact/commit/6d20bfe571a7bd767e7bed890637b1ea8fe6c45a))

## [0.4.0](https://github.com/Wilfredery/SystemFact/compare/v0.3.0...v0.4.0) (2026-09-15)


### Features

* **venta,devolucion:** idempotent retry gate + critical integration tests (fase-5d slice 3) ([#33](https://github.com/Wilfredery/SystemFact/issues/33)) ([a7eb2be](https://github.com/Wilfredery/SystemFact/commit/a7eb2be4f843e43c58b051a8f9b864e63f3025ae))

## [0.3.0](https://github.com/Wilfredery/SystemFact/compare/v0.2.0...v0.3.0) (2026-09-14)


### Features

* **venta,devolucion:** return UI + E2E B04 happy path (fase-5d slice 2) ([#30](https://github.com/Wilfredery/SystemFact/issues/30)) ([a05accc](https://github.com/Wilfredery/SystemFact/commit/a05accc143659f43851e6efe43155e6be03b7aad))

## [0.2.0](https://github.com/Wilfredery/SystemFact/compare/v0.1.0...v0.2.0) (2026-09-14)


### Features

* **devolucion:** B04 nota de credito use case, repository seam and http action ([5a01df1](https://github.com/Wilfredery/SystemFact/commit/5a01df1f52e070071305313c00c89508a48b2518))
* **venta,devolucion:** B04 credit-note returns core (fase-5d slice 1) ([55681b7](https://github.com/Wilfredery/SystemFact/commit/55681b7325644331f94c8144dbe2378aadd50882))
* **venta:** return error codes 601-604, plazo-devolucion reader and NCF B04 seed ([9a6fdda](https://github.com/Wilfredery/SystemFact/commit/9a6fddacad5c4f691d0191d40b20186cbdccd5a9))


### Bug Fixes

* **ncf:** compute seed vigencia year on the Santo Domingo business calendar ([85f86b2](https://github.com/Wilfredery/SystemFact/commit/85f86b202b00ef8635ed04d9ffc66eeb785981e1))
