# Delta Spec — tenant-selector-ui (auth-tenant-selector, S3 + S5 Frontend)

Board 02 "Selector Empresa-Sucursal" + header slot wiring. Binding scope: proposal §S3, §S5.
Constraint: ONLY F0 primitives (`app/src/components/ui/*`: button, input, label, card, select,
badge), F0 tokens (globals.css `@theme`), and the shared format home (`shared/ui/format` —
`formatearMonto`, `formatearFechaSD`). No raw zinc/indigo classes, no dark-mode variants (light-only).

### Requirement: S3 — `/selector-empresa-sucursal` route, admin-only with login-out guard

A page `/selector-empresa-sucursal` SHALL exist inside `(app)`, rendered within AuthShell. Its
server loader SHALL guard BOTH ways: no session (tenant header read resolves null) ⇒ redirect to
`/login` (the existing `(app)/layout.tsx` seam); session present but `esAdmin = false` ⇒ the
non-admin user is redirected to `/dashboard` — board 02 is never reachable by
despachador/cobrador, per docs 17 §5 / 04 (server routing branch, not UI hiding).

#### Scenario: SEL-ROUTE-01-A — unauthenticated user is bounced to login

- **GIVEN** a request to `/selector-empresa-sucursal` without a valid session
- **WHEN** the `(app)` layout's tenant resolution returns `null`
- **THEN** the user is redirected to `/login` (no selector markup ever renders)
- TEST: integration

#### Scenario: SEL-ROUTE-01-B — non-admin is redirected away, zero selector markup

- **GIVEN** a despachador session
- **WHEN** they open `/selector-empresa-sucursal` directly (URL typed, bookmark, stale link)
- **THEN** the server branch redirects them to `/dashboard` (17 §5 fast path preserved)
- **AND** the response contains no branch-list markup (server branch, not CSS)
- TEST: integration

### Requirement: S3 — screen renders board 02 with F0 primitives only; empresa shown read-only (P6)

The selector screen SHALL render per ratified board 02 `Selector-Empresa-Sucursal`: the caller's
empresa name displayed READ-ONLY (never rendered as a selectable option — P6), the list of active
branches returned by S1 rendered as selectable option cards/rows (id + nombre only; no deep tenant
data), the CURRENT branch visually marked, and a confirm affordance built from the F0 `Button`/
`Select`/`Card` primitives. Styling SHALL use F0 tokens exclusively (ink/surface/line/accent…) —
zero raw palette classes; light-only.

#### Scenario: SEL-RENDER-02-A — empresa is displayed, never selectable

- **GIVEN** the selector renders for empresa "Colmado XYZ"
- **WHEN** the screen DOM is inspected
- **THEN** the empresa name appears exactly once as static/inert content (no select/option/card is
  interactive for it)
- TEST: E2E

#### Scenario: SEL-RENDER-02-B — option set is exactly the S1 result

- **GIVEN** S1 returned B1 and B2 active
- **WHEN** the selector renders
- **THEN** exactly B1 and B2 appear as selectable options (nombre + active state), the current
  branch carries the "current" marker, and B3 (inactive) is absent
- TEST: E2E

#### Scenario: SEL-RENDER-02-C — primitives/tokens only

- **GIVEN** the page and its child components
- **WHEN** their sources are reviewed
- **THEN** every control is an F0 primitive (`@/components/ui/*` or shell), every color routes
  through semantic token classes, no `zinc-*`/`indigo-*`/hex literals, no dark-mode variants
- TEST: unit

### Requirement: S3 — version badge "free" is static; premium seam reserved (version-plan cut)

The board's version-plan element SHALL render a STATIC "free" badge through a single reserved
invocation seam (a typed constant/loader like `resolvePlanForVersion()` returning a fixed
`"free"` classification) so a later Plan model can grow the function list per plan WITHOUT
structural change. F1 SHALL NOT add a Plan model/schema, no premium persistence, no premium UI
branches beyond the static badge.

#### Scenario: SEL-PLAN-03-A — static free badge via reserved seam

- **GIVEN** the selector screen
- **WHEN** the version badge renders
- **THEN** it reads "free" from the reserved seam (not inlined in the page), and no Plan/`premium`
  schema or polymorphic plan branching exists in the diff
- TEST: unit

### Requirement: S3 — empty list renders an empty state, no switch possible

When S1 returns an empty active-branch list, the screen SHALL render the board's empty state
(no options to select, confirm disabled/unrendered) and no navigation into a stateless selector.

#### Scenario: SEL-EMPTY-04-A — zero active branches

- **GIVEN** S1 returned `[]` for an admin of empresa E
- **WHEN** the selector renders
- **THEN** an explicit empty-state message appears and no confirm action is reachable
- TEST: unit

### Requirement: S5 — AuthShell "Cambiar sucursal" slot becomes the selector trigger; non-admin menus unchanged

The placeholder span at `app/src/shared/ui/app-shell/shell.tsx:49` SHALL be replaced with an
admin-only link into `/selector-empresa-sucursal`, reusing the existing server `esAdmin` branch
(no new auth surface). Non-admin responses keep their current shell EXACTLY: no "Cambiar
sucursal" node at all, sidebar unchanged (eight modules, same placeholders).

#### Scenario: SEL-SLOT-05-A — admin gets a real navigable trigger

- **GIVEN** an admin session on any `(app)` page
- **WHEN** the header renders
- **THEN** the `data-testid="cambiar-sucursal"` control is an accessible link to the selector (not
  `aria-disabled`), and activating it navigates to `/selector-empresa-sucursal`
- TEST: E2E

#### Scenario: SEL-SLOT-05-B — non-admin shell is byte-equivalent in behavior

- **GIVEN** a despachador or cobrador session
- **WHEN** any `(app)` page renders
- **THEN** the header has NO "Cambiar sucursal" node and the sidebar is unchanged from F0
- TEST: integration

### Requirement: S5 — navigation after switch targets the designated admin post-login landing (design-pending anchor)

After a successful switch, the selector SHALL navigate to the designated admin landing route —
the dashboard-adjacent page ratifiable by `design` under the post-login routing decision
(proposal defers "who routes to selector on first visit" to design). The landing route MUST be one
of the eight sidebar modules' routes (Venta, Cobros, Reportes, Auditoría, Dashboard or a future
enabled module) — NO final value is hard-pinned here; `design` fixes the concrete route and
`tasks` documents it. What is fixed NOW: after switch the user does NOT remain on the selector
and cannot land on a dead/nonexistent route.

#### Scenario: SEL-NAV-06-A — post-switch navigation lands on the designated module page

- **GIVEN** an admin confirms a switch from B1 to B2
- **WHEN** the switch action returns success and navigation fires
- **THEN** the browser lands on the designated admin landing route (as fixed by design; a member
  of the eight sidebar modules), and the header now shows "Sucursal B2"
- TEST: E2E

#### Scenario: SEL-NAV-06-B — switching from the header slot keeps the session, no re-login

- **GIVEN** the admin entered via the header "Cambiar sucursal" link
- **WHEN** the switch completes
- **THEN** the user stays authenticated (no new login, no synthetic email flow on screen per
  ADR-014)
- TEST: E2E

## Out of scope (testable anti-requirements)

- NO client business logic: the page never calls Prisma, computes balances or fiscal math; the
  loader is a thin server data read; stamps actions delegate to S1/S2 via a thin adapter.
- NO Plan model or premium schema (static "free" only).
- NO Empresa selector anywhere (P6).
- NO new dark-mode styling, no theme changes, no token churn beyond F0.
- NO new bar/sidebar entries, no role filtering of nav in F1.
