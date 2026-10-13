# Delta Spec — app-shell (F0.4)

`(app)` route group + server-rendered application shell. Binding scope: proposal §F0.4.

### Requirement: (app) route group with server shell

The app SHALL define a `(app)` route group at `app/src/app/(app)/` holding `venta`, `cobros`, `reportes`, `dashboard`, `auditoria` (files relocated, page code unchanged), with `(app)/layout.tsx` rendering the shell at `app/src/shared/ui/app-shell/`. `login/` SHALL remain outside the group, at `app/src/app/login`, with no shell chrome. The shell component SHALL be a Server Component; the ONLY permitted `"use client"` code is (a) a tiny sidebar nav island for active-path highlighting (reads `usePathname`, zero business logic) and (b) a theme-toggle hook placeholder consistent with the tokens class hook.

#### Scenario: All five app routes render inside the shell

- **GIVEN** the compiled route tree under `(app)`
- **WHEN** `/venta`, `/cobros`, `/reportes`, `/dashboard`, `/auditoria` are requested
- **THEN** each response HTML contains the shell header (empresa + sucursal) and sidebar, since the layout wraps the group.

#### Scenario: Login renders bare

- **GIVEN** the `login` route lives outside `(app)`
- **WHEN** `/login` is requested
- **THEN** the response contains no shell header/sidebar.

#### Scenario: Shell stays a server component

- **GIVEN** `app/src/shared/ui/app-shell/` sources
- **WHEN** its files are reviewed
- **THEN** the shell/module has no `"use client"` at its top level; only the isolated nav-highlight island (and, optionally, the theme hook placeholder) carry `"use client"` with no mutation, fetch, or business logic inside.

### Requirement: Persistent header (empresa + sucursal always visible)

The shell header SHALL render, on every `(app)` page, the current empresa name and the current sucursal name, always visible — the invariant is presence in the DOM; it is never toggled off by scroll, viewport size, or role. The values derive from the existing session/tenant context actually available server-side (the same data the screens already consume); F0 invents no new data machinery.

#### Scenario: Header shows tenant context everywhere

- **GIVEN** an authenticated session with `empresa: "Colmado XYZ"`, `sucursal: "Sucursal 27"`
- **WHEN** any `(app)` route renders
- **THEN** the header displays both strings; shrinking the viewport or scrolling does not remove the empresa/sucursal nodes from the DOM.

### Requirement: Cambiar sucursal is server-gated, Administrador only

The "Cambiar sucursal" affordance SHALL be rendered server-side ONLY when the session role is Administrador, resolved with the EXISTING server authorization surface (the same `esAdmin` pattern `PosScreen` already receives). For non-Admins the control's markup SHALL NOT be present in the response HTML at all — authorization by server branch, never CSS-hidden. F0 SHALL NOT invent new auth APIs, role tables changes, or any sucursal-switch mutation (the control may be a placeholder link/target into F1's selector flow if a destination does not exist yet).

#### Scenario: Admin sees the switch affordance

- **GIVEN** a session whose role is Administrador (`esAdmin === true` server-side)
- **WHEN** an `(app)` page renders
- **THEN** the header contains the "Cambiar sucursal" control in the HTML.

#### Scenario: Non-admin gets no markup, not just hidden styling

- **GIVEN** a session whose role is NOT Administrador
- **WHEN** an `(app)` page renders
- **THEN** the response HTML contains no "Cambiar sucursal" node (no `hidden` class, no `display:none` — the branch never rendered it).

### Requirement: Sidebar eight modules, exact names, placeholders for future routes

The sidebar SHALL contain exactly eight entries in this order with these exact labels: **Venta, Cobros, Inventario, Compras, Caja, Reportes, Administración, Auditoría**. Entries whose routes exist (Venta, Cobros, Reportes, Administración→F8/Roles route as current `admin` target if present — else placeholder, Auditoría, Dashboard anchoring: Venta/Cobros/Reportes/Auditoría link existing pages) navigate; entries whose routes don't exist yet — **Inventario, Compras, Caja, Administración** — SHALL render as clearly non-link placeholders (explicitly disabled/visually reserved, e.g. `<span>` with a reserved-state style or `aria-disabled`), with NO fake routes/pages created. Administrator-only visibility beyond Cambiar sucursal is out of scope for F0 (sidebar shows all modules; role filtering of nav is a later-phase decision).

#### Scenario: Module labels are exactly the ratified eight

- **GIVEN** the compiled sidebar markup of any `(app)` page
- **WHEN** it is extracted
- **THEN** it contains exactly the labels `Venta, Cobros, Inventario, Compras, Caja, Reportes, Administración, Auditoría` once each.

#### Scenario: Built modules navigate; future modules are inert

- **GIVEN** the sidebar
- **WHEN** entries are inspected
- **THEN** Venta/Cobros/Reportes/Auditoría are real `<Link>`/anchors to existing routes, while Inventario/Compras/Caja (and Administración if no route exists yet) are non-navigable placeholders (no `href` to a non-existent route); requesting those future URLs is unnecessary because no page/handler was created for them.

#### Scenario: No fake routes were created

- **GIVEN** the tree under `app/src/app/(app)/` after the change
- **WHEN** the directories are listed
- **THEN** only the five relocated sections exist — no `inventario`, `compras`, or `caja` page directories with stub content.

### Requirement: Admin-only hamburger/navigation gating rule (stability of the invariant)

The shell SHALL make the "Cambiar sucursal" visibility decision in server code (single source), such that any future client interactivity (e.g. a hamburger menu) cannot re-expose the control to non-admins. Concretely: the role verdict reaches the shell as a plain prop from server evaluation; the nav island possesses no admin knowledge and cannot toggle the sucursal control.

#### Scenario: Role verdict lives server-side only

- **GIVEN** the shell component's props and the client island's props
- **WHEN** they are reviewed
- **THEN** the island receives no `esAdmin` prop (and can't compute one); only the server shell branch conditionally renders the sucursal control.

### Requirement: YAGNI / out-of-scope for app-shell

F0.4 SHALL NOT: create fake pages/routes for missing modules, add any Server Action, mutation, or authorization logic, redesign any screen, nor implement sidenav collapsible persistence, breadcrumbs, notifications, or user-profile UI (only the theme hook seam from F0.1 is wired).

#### Scenario: No scope creep in the shell slice

- **GIVEN** the diff of this sub-slice
- **WHEN** reviewed
- **THEN** it contains no Server Action, no new route directories for unbuilt modules, no screen restyling beyond mechanical relocations, and no client component beyond the sanctioned nav/theme islands.
