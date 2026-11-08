# frontend-screens-plan — audit of the frontend gap and proposed build order

Objective: finish the screens the business needs to run (products, customers, suppliers, inventory,
purchases, administration, daily close) in a safe order, with each screen tested like the sales flow was.
Status: **AUDIT AND PLAN ONLY (2026-11-07). No code has been written for this plan.** Coding starts only after
the owner approves the build order below (see "Open questions" and the Log).

## How to resume this work (for any model or session)

1. Read `AGENTS.md` (engineering rules, communication rule, standing orders) and this file down to `## Log`.
2. The sales, collections, reports and audit screens already exist and are tested. Copy their patterns, do not invent new ones.
3. One screen = one PR (code + its tests + its docs), Conventional Commits, native review when the assessment says it is due,
   CI gate green, the owner approves any production deploy by naming the commit.
4. Update the **Status** table below and append to the Log whenever a screen ships.

## Specs (owner words, quoted verbatim, do not paraphrase)

- **S1 (2026-11-07)** — "Before to start coding, I like what u recommend me and propuse the order, so do an evaluation and a audit, cause you're going to check a important step and sounds good if we have the info in a .md so u can read later or if I use other models. Before to continue the process that I just interrupted u"
- **S2 (2026-11-07)** — the owner chose "Missing-screens plan (recommended)" when asked what to start with, after being told the biggest gap is product work (screens), not security.
- **S3 (inherited, binding)** — `AGENTS.md`: multi-tenancy with `empresaId` on every query and `withTenantTransaction` in every Server Action; server-side role checks (hiding a button is not security); server components by default; money as Decimal; inventory changes only through `MovimientoInventario`; master entities are never deleted (`activo=false`); lists paginated (25 default, 100 max); typed errors with stable codes; tests by priority; no code before the owner approves the plan.

## Evidence legend

- **VERIFIED** = I checked it directly on 2026-11-07 (file read, `find`, or a read-only SELECT).
- **READ** = a read-only explorer read it in code or docs; nothing was run. Treat as a lead, re-check before relying on it.

## Audit

### A. What exists (VERIFIED)

Pages (`find app/src/app -name page.tsx`): `login`, `(app)/dashboard`, `(app)/venta`, `(app)/cobros/cxc-board`,
`(app)/cobros/estado-cuenta/[clienteId]`, `(app)/cobros/recibo/[correlativo]`, `(app)/reportes`, `(app)/auditoria`,
`(app)/selector-empresa-sucursal`. Returns (devoluciones) live inside the sales screen (READ: `venta/ui/DraftList.tsx`).

Modules with backend actions and **no screen** (VERIFIED by folder): `producto`, `categoria`, `inventario`, `cliente`, `proveedor`,
`compra`, `tenant`, `auth` (only login/logout/current user). `ncf` has no actions of its own.

### B. Findings to act on first

| # | Finding | Evidence | Size |
|---|---------|----------|------|
| F1 | **Dead menu link:** the menu has "Cobros" pointing to `/cobros`, but there is no `(app)/cobros/page.tsx` (only 3 sub-routes). Clicking it gives a not-found page. | VERIFIED: `shared/ui/app-shell/shell.tsx:22`, `ls (app)/cobros` | S |
| F2 | **Menu has no entries** for Productos, Categorías, Clientes, Proveedores, Usuarios. Inventario, Compras, Caja and Administración exist but are `disabled: true`. | VERIFIED: `shell.tsx:23-27` | S (wire as each screen ships) |
| F3 | **Role names disagree.** Production `ROL` has 4 roles: `Administrador`, `Operador`, `Cobrador`, `Despachador`. The roles document (`docs/04`) describes 3: Administrator, Dispatcher, Collector. `Operador` is not in `docs/04`. In code, `Operador` is the role that can sell, collect and return (the demo lane runs as `Operador`); `Cobrador` and `Despachador` are refused by those gates. | VERIFIED: ROL table (names + counts), `cobros/http/shared.ts:32`, `odd/tasks/prod-demo-lane.md` role matrix; `docs/04` lines 21-23 | decision needed (Q1) |
| F4 | **Product role gate differs from the doc.** Code lets only `Administrador` and `Operador` manage/list products; `docs/04` §7 says Dispatcher can view products. | VERIFIED: `producto/http/shared.ts:10` | decision needed (Q1) |
| F5 | **The wireframe plan has no page for Productos, Categorías, Clientes or Proveedores** (it lists Raíz, Venta, Cobros, Inventario, Compras, Caja, Reportes, Administración, Auditoría). No `design/` folder exists in the repo; the Penpot file is external; brand tokens are still pending. | READ: `docs/17-plan_wireframes.md` §4, §6; `docs/14-design_guidelines.md` §3 | planning gap (Q2) |
| F6 | No TODO/FIXME or "not implemented" stubs in `app/src`. | READ (grep) | none |

### C. Roadmap versus reality (`docs/10-roadmap_del_sistema.md`)

| Phase | Deliverable | Status |
|---|---|---|
| 1 Base | Login, auth gate | DONE with screen (VERIFIED) |
| 2 Administration | Company/branch selector | DONE (VERIFIED) |
| 2 Administration | Users and roles | NOT STARTED (only `getCurrentUserContext`) |
| 2 Administration | Company configuration, branch CRUD | BACKEND ONLY (READ) |
| 3 Catalog/inventory | Categories, Products, Suppliers, Inventory | BACKEND ONLY, nav entry disabled |
| 4 Purchases | Purchases (6 actions), retention calculators | BACKEND ONLY |
| 4 Purchases | Accounts payable (CxP) | backend repository exists, no screen |
| 5 Sales | Sales, returns | DONE (returns inside the sales screen) |
| 5 Sales | Customers, invoice history | BACKEND ONLY (`ClienteSelector` partly used by sales) |
| 6 Collections | Receivables board, customer statement, receipt | DONE |
| 6 Collections | Daily cash close ("Caja") | NOT STARTED, **no backend either** |
| 7 Reports/audit | Dashboard, reports, audit | DONE |

All READ unless marked VERIFIED; "DONE" means the route exists in code, not that it was exercised in this audit.

### D. Backend readiness per module (READ)

| Module | Actions that exist | Tests that exist | Missing for a screen |
|---|---|---|---|
| producto | listar, crear, actualizar, desactivar | unit tests, `calcular-itbis` | `obtenerProducto` |
| categoria | listar, crear, actualizar, desactivar | unit + repository tests, no integration | `obtenerCategoria` |
| inventario | listar, ajustar | unit + 3 integration (adjust, purchase entry, guard) | movement-history list (to confirm) |
| cliente | obtener, listar, crear, actualizar, desactivar | unit, domain, tenant integration | — |
| proveedor | listar, crear, actualizar, desactivar | unit, repository, deactivate-with-purchases integration | `obtenerProveedor` |
| compra | listar, obtener, crear, actualizar, confirmar, cancelar, recibir | many integration tests | — |
| tenant | `cambiarSucursalActiva` only | unit + integration | branch list action (use case exists, no action); user/role CRUD |
| auth | login, logout, current user | login + throttle tests | — |

Pagination default 25, max 100 in the validations (READ). End-to-end specs today: auth-gate, cobros, confirm-venta, csp-authenticated, devolucion, security-headers, selector-sucursal. **None for products, categories, inventory, purchases, customers or suppliers.**

### E. Reusable UI (READ)

`app/src/components/ui/` (badge, button, card, dialog, input, label, numeric-keypad, select, table), `app/src/shared/ui/app-shell/`
(shell, sidebar), `app/src/shared/ui/format/` (date, money), `app/src/shared/domain/pagination.ts`. Existing screens are server
components with client islands (`CxcBoardScreen.tsx`, `PosScreen.tsx`); user-visible errors come from fixed codes in each module's `domain/errors.ts`.
Design tokens in use: `bg-surface`, `border-line`, `text-ink`, `bg-surface-muted`; hit targets 44px minimum, 48px preferred, 8px spacing.

### F. Not determined

Penpot boards (external). Business rules `03`, flows `06`, `07`, `11`, `18`, `19` were not read in full. Whether the seed defines
`Cobrador`/`Despachador`. Whether `producto`, `compra`, `inventario` validations and `version` locking match the rules. Nothing was run.

## Proposed build order (recommended; the owner may reorder)

Principle: smallest and lowest risk first, so the first screens fix the pattern that the large ones reuse.

| Step | Screen | Size | Why here |
|---|---|---|---|
| 0 | **Housekeeping:** fix the dead `/cobros` link (F1) and agree the role mapping (F3/F4) | S | Removes a visible defect and unblocks every role gate |
| 1 | **Categorías** | S | Warm-up: list + create/edit dialog + deactivate; fixes the CRUD pattern, pagination, error display and audit wiring |
| 2 | **Productos** | M | Depends on categories; Decimal price and ITBIS per product; audit on price change |
| 3 | **Clientes** | M | Used by sales and credit; credit fields admin-only; RNC/cédula validation |
| 4 | **Proveedores** | S/M | Needed before purchases |
| 5 | **Inventario** | M | Stock per branch, adjustments with a reason, movement history (may need a new list action) |
| 6 | **Compras** (+ CxP view) | L | State machine, average cost on receipt, retentions, cancel reverses inventory |
| 7 | **Administración** (branches, assignment of existing users, roles) | L | Security-sensitive; see Q3: no creating Auth users or setting passwords in the app |
| 8 | **Caja** (daily close) | L | No backend yet: domain and backend first (`America/Santo_Domingo` day boundaries, cash only) |

### Definition of done for each screen

1. Acceptance criteria from `docs/15-criterios_de_aceptacion.md` for that module are listed in the PR and met.
2. Server-side role gate on every action; multi-tenancy proven by an existing or new integration test; money as Decimal; soft delete only.
3. Tests: unit for new logic, integration for anything that writes through several tables, and **one end-to-end spec in the local lane** (the lane CI runs on every PR).
4. Menu entry enabled in the same PR; no dead links.
5. Native review when the assessment says it is due; CI gate green; docs and this file's Status table updated.
6. A production deploy needs the owner's explicit approval naming the commit; run the production demo lane afterwards only when the screen touches sales, payments, returns or login (standing order in `AGENTS.md`).

### Risks to keep in mind (from `AGENTS.md`)

Multi-tenancy (`empresaId`, `withTenantTransaction`); inventory only through `MovimientoInventario`; fiscal rules (NCF, ITBIS);
optimistic locking with `version`; idempotent confirm actions; Decimal money; soft delete (`activo=false`); audit log append-only;
CSP is enforced, so new screens must not need inline scripts or `eval` (the local guard `e2e/csp-authenticated.spec.ts` lists pages: add new routes to it).

## Status

| Step | Screen | State | PR / evidence |
|---|---|---|---|
| 0 | Housekeeping | not started | |
| 1 | Categorías | not started | |
| 2 | Productos | not started | |
| 3 | Clientes | not started | |
| 4 | Proveedores | not started | |
| 5 | Inventario | not started | |
| 6 | Compras | not started | |
| 7 | Administración | not started | |
| 8 | Caja | not started | |

## Open questions for the owner

1. **Roles.** Production has `Administrador`, `Operador`, `Cobrador`, `Despachador`; `docs/04` has Administrator, Dispatcher, Collector. What is `Operador` meant to be? My reading from the code: the point-of-sale operator (sells, collects, returns). Who may view/manage products and inventory: only `Administrador` and `Operador` (as the code does today), or also `Despachador` (as `docs/04` says)?
2. **Design.** There are no wireframes for Productos, Categorías, Clientes or Proveedores. My suggestion: reuse the existing components and the 44/48px, 8px rules, keep one consistent list + dialog pattern, and have the owner review each screen on the demo company. Agree?
3. **Administración and users.** The owner withdrew in-app password/user creation (`T4`: it would need the service-role key on the server). So the first version of that screen should only show users, assign roles and branches to **existing** accounts, and activate/deactivate. Agree, or is creating users in the app wanted anyway (with the risk that implies)?
4. **Priorities and dates.** The roadmap lists dates, owners and priorities as undefined. Is there a business priority that should move purchases, inventory or the daily close earlier than proposed?

## Log

- L1 (2026-11-07): owner request, verbatim in S1. The agent first told the owner the biggest gap is screens (verified by `find`), offered a plan, and the owner chose "Missing-screens plan (recommended)".
- L2 (2026-11-07): a read-only explorer audited roadmap, docs, backend modules and reusable UI; the agent then verified the load-bearing findings F1-F4 directly (menu file, folder listing, role gate lines, read-only SELECT of role names and counts in production). Nothing else in production was read or changed.
