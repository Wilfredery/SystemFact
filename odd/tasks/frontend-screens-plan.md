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
| 0 | Housekeeping | **dead `/cobros` link DONE** (PR #192, v0.19.7, deployed, prod-smoke 7 passed); role names half-decided: Despachador views products (yes), the meaning of `Operador` is not explicitly confirmed (the code treats it as the sales operator) | `787d13f`, `tools/config/nav-routes.test.ts` |
| 1 | **Inventario / Productos list** (replaces the stand-alone Categorías screen; owner confirmed 2026-11-08, L7) | not started | read wireframe page `04-Inventario` in detail first |
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

## Owner answers (2026-11-07, quoted verbatim) and how they are read

| Q | Owner's words | Reading (agent) | Status |
|---|---|---|---|
| Q1 design source | "I do have a wireframe of the project the name is: Factura.penpot, can u check it out?" | The wireframe is the design source. **Readable:** `Factura.penpot` is at the repo root (git-ignored, local only, ~10 MB zip, 3,061 files). Pages: `01-Raíz`, `02-Venta`, `03-Cobros`, `04-Inventario`, `05-Compras`, `06-Caja`, `07-Reportes`, `08-Administración`, `09-Auditoría`. There are no pages named Productos, Categorías, Clientes or Proveedores, so **finding F5 must be re-checked against `04-Inventario` and `05-Compras`** (the acceptance criteria put products under Inventario and suppliers under Compras). | confirmed readable; layouts not yet read |
| Q1 roles | "The roles operador and the despatcher will be good idea to add when u do the test local and in production." | Tests (the local end-to-end lane **and** the production demo lane) should exercise **Operador and Despachador**, besides Administrador, not one role only. Proposed default until told otherwise: follow `docs/04` (Despachador **views** products and inventory; Administrador manages; Cobrador none) and deny by default for anything else. A Despachador demo user in production needs its own owner approval and the same safeguards as `demo-operador` (company 5 only). | assumption, confirm product-view rule |
| Q3 administration | "Ye, the admin will get a lot of permissions." | Agreed with the proposed scope: broad Administrador permissions, and the Administración screen shows users, assigns roles and branches to **existing** accounts and activates/deactivates them. **Assumption:** creating Auth users or setting passwords inside the app stays out (T4 withdrawn) unless the owner says otherwise. | assumption, confirm |
| Q4 priorities | "Yeah I think will be get a filters." | Unclear; read as: list screens need **filters** (search plus status/active and similar) besides pagination. Which filters per screen to be taken from the wireframe. The build order is unchanged. | unclear, confirm |

### Follow-up answers (2026-11-07, later the same day)

- **Despachador and products: NOT decided yet.** The owner asked what this file says: it holds the proposed default (view-only, per `docs/04`) as an assumption. The agent recommends yes. Waiting for a yes/no, then mark it decided.
- **User creation in the app: decided for now.** Owner, verbatim: "Yes for now, the devs are only able but probably in the future we change to the admin has that option (keep it in mind)." For now only the developers (operator-side, `app/USER-PROVISIONING.md`) create users and set passwords; the app does not. **Keep in mind:** the Administrador may get that option later. **Revisit trigger:** when a real company with several employees is onboarded (the same trigger as `docs/22` T4: operator-mediated passwords stop scaling). It needs a security decision first, because creating Auth users from the app needs the service-role key on the server, which bypasses RLS and every tenant guard.
- **Filters on list screens: re-opened.** Owner, verbatim: "oH NO, THX FOR CONFIRM ME THAT in the list creens no, that doesnt make sense, right?" The agent did not simply agree. Proposal: pagination on every list (required by `AGENTS.md`); a simple search box and an active/inactive switch only on lists that can grow (products, customers, suppliers, purchases, inventory); no filters on categories (short list); reports keep their own filters, as the roadmap says. Waiting for the owner's yes/no.

### Decisions and wireframe findings (2026-11-07, third round)

- **Despachador viewing products: DECIDED, YES.** Owner, verbatim: "Depachador viewing products yes". View-only on products and inventory, per `docs/04`; Administrador manages; deny by default for anything else.
- **Filters on growing lists: owner pointed to the wireframe.** Owner, verbatim: "the filters on growing litsts( i think in the frimeware u can check it)". The agent read `Factura.penpot` (layer names and text labels of pages 03, 04, 05, 08; **not a visual review**; extracted into a new empty temp folder, nothing from it is in the repo). What the wireframe shows:

| Wireframe page | Filters / search it shows |
|---|---|
| `03-Cobros` | `Barra-Filtros`: search "Buscar factura o cliente...", status "Estado: Todos", date range, due-date filter; KPIs |
| `04-Inventario` | `Barra-Filtros`: search "Buscar por nombre o código...", category "Todas las categorías", status "Todos los estados"; stock-status badges (Disponible, Bajo stock, Agotado); columns code (P001...), name, category, unit, stock, minimum stock, status; KPIs |
| `05-Compras` | A purchase **form** (supplier + RNC, date, type Formal → B01, branch, lines with product, quantity, unit, unit cost); no list filters seen |
| `08-Administración` | Users: "Buscar usuario...", columns user, name, role, company/branch, status (Activo/Inactivo), actions; companies: "Buscar empresa...", with branches and status |

  So the rule is: **filters follow the wireframe per screen** (search + status/category/date where drawn), plus pagination on every list. `06-Caja`, `07-Reportes`, `09-Auditoría` and `02-Venta` were not scanned for this.
- **Finding that changes the plan (F5 resolved):** the wireframe has **no stand-alone Categorías, Clientes or Proveedores pages**. Products live **inside `04-Inventario`** and categories appear only as a filter selector; suppliers appear as a field in the purchase form. So Step 1 "Categorías as its own screen" is **not wireframe-backed**. **Proposal (owner to reconfirm):** Step 1 becomes the **Inventario / Productos list** (read-only for Despachador, with the filters above); category create/edit and the customer and supplier management screens stay as later, explicitly agreed additions, because no wireframe exists for them.
- **`08-Administración` shows user "Alta" (create).** The owner decided user creation stays out of the app for now (see above), so the first build of that screen leaves the create action out; the wireframe supports adding it later when the admin gets that option.

The owner also asked to keep these in this file because the session budget is nearly used up: **this file is the hand-off.**

## Next action when resuming

1. Confirm the three assumptions above with the owner in one short message (product-view rule for Despachador; no in-app user/password creation; what "filters" means).
2. Read the wireframe page for the next screen before coding it: extract `Factura.penpot` into a **new empty directory outside the repo** (or read single files with `unzip -p`); never commit it.
3. Step 0 (fix the dead `/cobros` link, agree role names), then Step 1 (now the Inventario/Productos list, see L7). One screen per PR, tests as in the definition of done, and add the new roles to the local end-to-end tests (the local seed has only an admin and an `Operador` today).

## Log

- L1 (2026-11-07): owner request, verbatim in S1. The agent first told the owner the biggest gap is screens (verified by `find`), offered a plan, and the owner chose "Missing-screens plan (recommended)".
- L2 (2026-11-07): a read-only explorer audited roadmap, docs, backend modules and reusable UI; the agent then verified the load-bearing findings F1-F4 directly (menu file, folder listing, role gate lines, read-only SELECT of role names and counts in production). Nothing else in production was read or changed.
- L3 (2026-11-07): the owner answered Q1-Q4 (verbatim in "Owner answers") and said the budget is nearly used up, so the answers and the next action are recorded here. The agent confirmed `Factura.penpot` is readable (valid Penpot export, 9 pages named like the wireframe plan) by listing the zip and reading page names only; nothing was extracted or modified. Layouts were NOT read yet.
- L4 (2026-11-07): owner follow-up recorded under "Follow-up answers". Decided for now: no user/password creation in the app (admin may get it in the future, trigger noted). Still open: Despachador view-only on products (recommended yes) and filters on growing lists (recommended search + active switch, none on categories).
- L5 (2026-11-07): third round. Decided: Despachador views products (yes). Filters: the owner pointed to the wireframe; the agent read pages 03, 04, 05, 08 (labels only) and recorded the filters per screen. Found that the wireframe has no stand-alone Categorías/Clientes/Proveedores pages (products are inside 04-Inventario), so the proposed Step 1 is now the Inventario/Productos list; the owner must reconfirm this change. Wireframe user "Alta" is deferred per the owner's earlier decision.
- L6 (2026-11-08): Step 0 shipped. The dead `/cobros` menu link is fixed (a real page serving the receivables board, plus a guard test that fails when an enabled menu link has no page): PR #192 (`787d13f`), deployed by hand with the owner's approval, production smoke 7 passed / 0 failed / 0 skipped on that commit, tag and release `v0.19.7`. The guard that visits every page under `(app)` covers `/cobros` in CI; the production smoke does not open it. **Still waiting for the owner:** reconfirm that Step 1 is the Inventario/Productos list (the wireframe has no stand-alone Categorías page). No Step 1 code before that.
- L7 (2026-11-08): the owner confirmed Step 1. Owner, verbatim: "Yes, sound good... Before to continue save in engram and close session. Im going to create another session right away." **Step 1 is the Inventario / Productos list** (not a stand-alone Categorías screen): read-only for Despachador, Administrador manages; filters from the wireframe (search by name or code, category selector, status selector); columns code, name, category, unit, stock, minimum stock, status (stock-status badges Disponible / Bajo stock / Agotado). **Start of the next session:** read `AGENTS.md`, this file, then extract wireframe page `04-Inventario` from `Factura.penpot` into a new empty directory outside the repo and read it before writing code; follow the definition of done (one PR, tests, one local end-to-end spec, add the new route to `e2e/csp-authenticated.spec.ts`, enable the menu entry in the same PR).
