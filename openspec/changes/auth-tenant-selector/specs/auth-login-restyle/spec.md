# Delta Spec — auth-login-restyle (auth-tenant-selector, S4 Optional Slice)

Board 01 "Login" parity pass. Binding scope: proposal §S4. Optional/cheap-only: this slice is
CKERNEL cuttable if its cost rises above trivial — board 01 key behavior already works
(`useActionState`, `nombreUsuario` + `password`); this is a pure presentational restyle, no
function changes, no auth logic changes. Files stay OUTSIDE `(app)` (`src/app/login/`).

### Requirement: S4 — login screen renders board 01 fields only: nombreUsuario + password (ADR-014)

The login screen SHALL present exactly two credential fields — `nombreUsuario` (label "Usuario",
`autoComplete="username"`) and `password` (label "Contraseña", `autoComplete="current-password"`,
type password) — per ratified board 01. NO email field, NO placeholder foreseeing synthetic
emails (`@users.systemfact.internal` is never displayed in any capacity), NO email-recovery
implication. The synthetic-email mechanism must stay INVISIBLE end-to-end (ADR-014).

#### Scenario: LOG-01-A — exactly the two board fields, no email anywhere

- **GIVEN** the rendered `/login` DOM
- **WHEN** inputs and copy are inspected
- **THEN** the only text/password fields are nombreUsuario and password
- **AND** zero occurrences of `@` followed by the synthetic suffix, or of the word "correo"/
  "email" as a field label/placeholder exist in the page
- TEST: E2E

### Requirement: S4 — credential-failure copy is EXACTLY "Credenciales inválidas"

For `AUTH_CREDENCIALES_INVALIDAS`, the error box SHALL display the EXACT string "Credenciales
inválidas" (board 01 binding copy; single error surface — no per-cause variants). The stable
catalog code (`AUTH_CREDENCIALES_INVALIDAS`) and its silence-about-cause semantics stay untouched:
the failure neither confirms a user exists nor leaks the inactive/enlazado distinction. INACTIVE
user rejection and enlace failures keep their existing catalog copy.

#### Scenario: LOG-02-A — failed login shows the exact board copy

- **GIVEN** wrong credentials (or a disabled user)
- **WHEN** the server action returns its typed failure
- **THEN** the screen shows ONE alert whose visible text is exactly "Credenciales inválidas"
- TEST: E2E

#### Scenario: LOG-02-B — error still hides whether the user exists

- **GIVEN** a nonexistent `nombreUsuario` versus an existing one with a wrong password
- **WHEN** each submits
- **THEN** both render the same string with no distinguishing detail (cross-enumeration guard intact)
- TEST: E2E

### Requirement: S4 — "Recuperar contraseña" link is visible

Board 01's "Recuperar contraseña" link SHALL be visible on the login screen. The recovery flow
itself does NOT exist in F1: the link's destination/behavior (placeholder route, notice dialog, or
inert anchor) is decided at DESIGN — this slice implements only its VISIBILITY and touch
conformant hitbox; no recovery email, no password-reset screen, no backend recovery endpoint in
this change.

#### Scenario: LOG-03-A — link present and reachable

- **GIVEN** the rendered login screen
- **WHEN** the DOM is inspected
- **THEN** a link/action labeled "Recuperar contraseña" exists within touch-conformant size (≥44px
  hitbox per the docs 14/16 hardware rules) and is reachable by keyboard tab order
- TEST: E2E

### Requirement: S4 — F0 tokens/primitives only; light-only; touch rules carry over

The login page and its layout SHALL be restyled exclusively with F0 semantic tokens
(ink/surface/line/accent) and accepted primitives (Button/Input/Label/Card): ZERO raw
`zinc-*`/`indigo-*`/hex classes and ZERO dark-mode variants (the dark media-query block they
presuppose does not exist in F0's light-only registry — no `dark:` classes survive the restyle).
Touch-first carry-over: submit button ≥44px height, spacing rhythm in 8px steps, `nombreUsuario`
auto-focused, Enter submits the form.

#### Scenario: LOG-04-A — no raw palette classes, no dark variants

- **GIVEN** `src/app/login/page.tsx` + `layout.tsx` after the slice
- **WHEN** their sources are grepped
- **THEN** zero `zinc-*`, `indigo-*`, `slate-*`, hex-literal or `dark:` occurrences remain for the
  login surface; all colors route through semantic token classes
- TEST: unit

#### Scenario: LOG-04-B — touch + keyboard behavior conforms

- **GIVEN** the login form at board-01 restyle completion
- **WHEN** tested by touch and keyboard
- **THEN** the submit action is ≥44px high with ≥8px separation from the error box, Enter submits,
  `nombreUsuario` has initial focus, and `isPending` still disables the submit with "Ingresando…"
- TEST: E2E

### Requirement: S4 — zero behavior change in auth logic (cheap-only escape hatch)

No `login` Server Action, catalog, ADR-014 mapping, middleware or redirect behavior SHALL be
modified by this slice — it is purely presentational. If the restyle's implementation cost rises
above the trivial band the proposal defines, the slice MAY be dropped entirely (its absence does
not block S1-S3/S5).

#### Scenario: LOG-05-A — action contract untouched

- **GIVEN** the diff of this slice
- **WHEN** the auth module's sources are compared
- **THEN** no signature, error code, or login/redirect behavior changed (only presentational
  files under `src/app/login/`)
- TEST: typecheck + unit

#### Scenario: LOG-05-B — cuttable without blocking

- **GIVEN** the change scope check
- **WHEN** S4 is dropped before apply
- **THEN** S1/S2 (tenant) and S3/S5 (selector ui) remain fully implementable and testable
- TEST: review

## Out of scope (testable anti-requirements)

- NO password recovery implementation (backend or screen) in F1.
- NO email field, no synthetic email exposure (ADR-014).
- NO login-flow widening, no `app.is_login_flow` change, no new auth codes beyond the existing
  catalog (`AUTH_CREDENCIALES_INVALIDAS` mapping pinned to board copy stays in the adapter).
- NO audit writes from failed attempts (REQ-AUTH-AUD-001 unchanged: only successful sessions audit).
- NO rebranding beyond board 01 (logo/wording outside the ratified board stays untouched).
