# Delta for Venta

## Purpose

F2 is a UI refinement + credit-mode slice on top of the verified-green fase-5b/5c backend: POS restyle to F0, credit-mode UX derived from the client credit profile, per-line discount UI, vuelto reference panel, numeric keypad, admin anulación Dialog, E2E helper extraction — plus ONE small output-mapping touch (`ConfirmarVentaOutput`). All blocks below are ADDED: they extend R-V14 (POS UI acceptance) and compose with R-V13/R-V15/R-V16 and `credit-control` R-K2 WITHOUT altering their text or scenarios.

## Task Notes (non-runtime)

- **fase-5b/5c backend freeze**: this change MUST NOT rewrite venta domain/application logic. The ONLY permitted backend touch is the `ConfirmarVentaOutput` mapping extension (R-V25) inside the http mapping layer, with its unit test. Any other backend change (sale-time contado/crédito toggle, due-date persistence, partial cash tender) is out of scope and would need an owner override.
- **Board gate (fase-5b pattern)**: the Penpot board `02-Venta-Credito` is MISSING and is a design prerequisite. Until it lands, the requirements below define STRUCTURAL acceptance (tokens/primitives, touch floor, spacing rhythm, reachability) and stay layout-agnostic; board-dependent visual polish is a flagged follow-up, not a spec gap.
- **Fixed credit context**: `credit-control` R-K2 (mora >30d in America/Santo_Domingo, inclusive limit, canonical derived balance) and venta R-V13/R-V15/R-V16 remain untouched in this change; only their UI rendering and the output-mapping extension are specified here.

## ADDED Requirements

### Requirement: POS UI F0 token and primitive conformance (R-V18)

All venta module UI surfaces (`PosScreen`, `CartTable`, `ClienteSelector`, `Totales`, `DiscountPanel`, `DraftList`) MUST render exclusively on F0 semantic tokens and systemfact F0 primitives (Button including the `pos` size, Input, Label, Select, Card, Dialog, Table, Badge). Raw `zinc-*`/`indigo-*` class literals, arbitrary hex colors, and `dark:` variants MUST NOT appear in venta module UI files (grep-verifiable). Every interactive target MUST meet a ≥44px hitbox floor, raised to 48px for high-frequency POS controls (cart quantity controls, keypad buttons, save/confirm/cancel/anulación actions); vertical spacing MUST follow the 8px rhythm. All controls MUST be keyboard-reachable in DOM order (tab order matches visual/structural order). This is a restyle + touch-floor slice: it MUST NOT change any business flow, action call, or selector semantics the existing E2E suite depends on. The layout stays board-agnostic until the Penpot board `02-Venta-Credito` lands: structural tokens now, board-dependent polish flagged as follow-up (fase-5b gate pattern).

(Traceability: proposal Scope item 1; Success Criteria rows 1–2; slice A.)

#### Scenario: No raw color literals remain

- GIVEN the venta module UI source tree
- WHEN a grep runs for `zinc-`, `indigo-`, `dark:`, and arbitrary-hex color class literals in the venta UI files
- THEN zero matches return
- TEST: lint (grep CI gate)

#### Scenario: Touch floor and keyboard reachability on cart controls

- GIVEN a rendered CartTable line
- WHEN each interactive control is measured and tab traversal runs
- THEN every control meets the ≥44px floor (48px for quantity controls), and all controls are reachable via keyboard traversal in DOM order
- TEST: ui

#### Scenario: Restyle does not break POS flows

- GIVEN the six surfaces restyled to F0 tokens/primitives
- WHEN the existing E2E suite runs (`confirm-venta`, `cobros`, `devolucion`, `selector-sucursal`)
- THEN all four specs stay green and no business flow or selector semantics changed
- TEST: e2e

### Requirement: Credit-mode UX derived from client profile (R-V19)

The POS MUST derive contado/crédito exclusively from the selected client's credit profile. By default the sale resolves to Consumidor Final (contado OPTIONAL); a sale is credit when the derivation — mirroring the authoritative backend rule `esVentaCredito = !esConsumidorFinal && tipoCliente === "CREDITO"` (see `leerPerfilCreditoEnTx`, `cobros/infrastructure/saldo-cxc.repository.ts`; NOT the `creditoHabilitado` flag) — resolves to crédito on the selected client, so the credit path therefore requires a client whose `tipoCliente === "CREDITO"` and who is not Consumidor Final, enforced BY DERIVATION (such a client cannot bill contado; an optional contado remains available for non-credit clients). The UI SHOULD NOT render a sale-time contado/crédito toggle (no such control exists today; any explicit toggle is a backend change out of F2 scope unless the owner overrides). After the `cliente` lectura DTO extension (companion delta), ClienteSelector MUST display the selected derived-credit client's credit facts — `creditoHabilitado`, `limiteCredito` (money-formatted), and `plazoCreditoDias` (the term falls back to the client DB default per the companion profile). For a derived credit sale the UI MUST show a contado/crédito indicator and display a derived due date computed as `fechaEmision + plazoCreditoDias` (client term, else DB `PLAZO_CREDITO` — same rule as reportes aging FIN-2) as PRESENTATION ONLY: no venta field, column, or parameter for the due date is added or persisted (ADR-017 untouched).

(Traceability: proposal decision #3 and #4 output side (both owner-ratified); Scope item 2; explore Area 3 items 1–2; slice B.)

#### Scenario: Credit-bearing client selection

- GIVEN ClienteSelector lists a client with `creditoHabilitado=true`, `limiteCredito` 20,000.00, `plazoCreditoDias` 15
- WHEN the client is selected (no toggle exists anywhere on the screen)
- THEN the three profile fields render, the contado/crédito indicator resolves to crédito, and the derived due-date context (fechaEmision + plazoCreditoDias) is shown or becomes showable
- TEST: ui

#### Scenario: Consumidor Final default without toggle

- GIVEN a fresh POS screen
- WHEN a sale starts with no client selected
- THEN the sale resolves to Consumidor Final as contado, and no contado/crédito toggle control exists anywhere in the UI (derivation only)
- TEST: ui

#### Scenario: Due date stays derived

- GIVEN a confirmed derived-credit sale with `fechaEmision` 2026-03-01 and `plazoCreditoDias` 15
- WHEN the credit context renders
- THEN the UI displays 2026-03-16 as a derived DISPLAY ONLY value, and no sale field, column, or parameter was added or persisted for the due date (ADR-017 holds; R-V15 semantics untouched)
- TEST: unit (mock DTO contract)

### Requirement: Credit-gate error distinct rendering (R-V20)

When confirm returns the stable credit rejection codes, the UI MUST surface each with a DISTINCT human-readable surface (message copy from the stable error's user message + distinct visual/state treatment), mapped per code — never the raw code string as the only user-facing copy: (a) `CLIENTE_EN_MORA` — overdue-debt surface (distinct overdue treatment); (b) `LIMITE_CREDITO_EXCEDIDO` — distinct limit-exceeded surface; (c) `CREDITO_NO_HABILITADO` — distinct not-enabled surface with contado-alternative guidance (selecting a non-credit client or Consumidor Final keeps the sale contado and un-gated). Rendering MUST stay within the existing Card+Badge banner composition (no Toast/inline-alert primitive is introduced). The codes on the wire stay stable per R-V13; only the presentation maps distinctly. Backend behavior (when each code can fire, gate ordering before NCF) is fixed 5c semantics — this requirement pins RENDERING only.

(Traceability: Scope item 2; explore Area 3 item 3; slice B.)

#### Scenario: Mora rejection renders distinctly

- GIVEN a draft for a client blocked by overdue receivables
- WHEN confirm is pressed and `CLIENTE_EN_MORA` returns
- THEN a distinct panel states the overdue reason in human-readable copy (not only the raw code string), the sale remains `BORRADOR`, and no NCF/FACTURA/salida/COBRO artifact is produced (fixed 5c behavior)
- TEST: ui

#### Scenario: Over-limit rejection renders distinctly

- GIVEN a draft whose client pending balance + total exceeds `limiteCredito`
- WHEN confirm returns `LIMITE_CREDITO_EXCEDIDO`
- THEN a distinct limit-exceeded surface renders with human-readable copy, the sale stays `BORRADOR`, and backend remains byte-identical to today's confirmed behavior
- TEST: ui

#### Scenario: Not-enabled rejection renders distinctly

- GIVEN a draft whose confirm evaluates `CREDITO_NO_HABILITADO`
- WHEN confirm returns that code
- THEN a distinct surface renders with contado-alternative guidance and no raw-code-only copy
- TEST: ui

### Requirement: Per-line discount UI wiring (R-V21)

The cart model (`carro.ts`) and CartTable MUST support a per-line discount wired to `VentaLineaInput.descuento` (`descuentoTipo` PORCENTAJE/MONTO per the venta domain vocabulary). Rules:

- The per-line discount UI MUST inherit the same Administrador gating semantics as the existing header DiscountPanel (admin-only visibility/enablement); a non-admin MUST NOT see or submit per-line discount inputs (UI is not the control — server R-V8 authorization remains the backstop).
- The client cart preview MUST be computed by calling the SAME venta domain calculators the server uses (round2 half-up, line discount resolved BEFORE header proration and BEFORE ITBIS — ADR-018/R-V5) and MUST be non-authoritative display only.
- The server `preparar-lineas-venta` DESC_MAX/admin pipe (R-V8) MUST remain the sole acceptance authority: the UI MUST NOT treat any local check as the accept/reject verdict; over-cap input surfaces only the server's stable error (`DESCUENTO_EXCEDE_MAXIMO`/`DESCUENTO_NO_AUTORIZADO`/`DESCUENTO_EXCEDE_BASE`) at save/confirm.
- The cart model MUST stay pure and immutable; a fresh line carries the zero-discount shape (equivalent to PORCENTAJE 0.00 per R-V7, the existing `DESCUENTO_CERO` carrier form) and transitions to the user-supplied structure on input.
- Cart-model unit tests MUST pin the per-line discount preview to the released calculator fixture shapes (fixture F2/F4 class re-derived from this spec) — the existing Header DiscountPanel behavior itself is unchanged.

(Traceability: Scope item 3; Success Criteria rows 4 and 10; ADR-018; slice C.)

#### Scenario: Cart preview matches released calculators (fixture F2 class)

- GIVEN line 7 × 3.33 @18% carrying MONTO 5.00 discount (plus the F2 sibling lines, no header discount)
- WHEN the cart preview runs through the domain calculators
- THEN the line shows net base 18.31 / ITBIS 3.30 and the totals row mirrors the released fixture values (subtotal 69.86, descuento 5.62, itbis 6.52, total 70.76)
- TEST: unit

#### Scenario: Non-admin sees no per-line discount UI

- GIVEN an Operador session
- WHEN CartTable renders per-line rows
- THEN no per-line discount input renders (parity with the DiscountPanel admin gate; server R-V8 remains the authorization backstop)
- TEST: ui

#### Scenario: Over-cap line only rejected by the server

- GIVEN an admin enters a line discount exceeding the DB `DESC_MAX`
- WHEN the draft save (or confirm) action returns `DESCUENTO_EXCEDE_MAXIMO`
- THEN the stable server error message renders in the affected context and no local accept/reject verdict replaced it
- TEST: unit (mock action DTO)

#### Scenario: Zero-discount default preserved

- GIVEN a new cart line with no discount entered
- WHEN the draft is built and saved
- THEN the line carries the cart's zero-discount shape (equivalent to PORCENTAJE 0.00) and persisted semantics stay per R-V7
- TEST: unit

### Requirement: Vuelto panel — display-only reference (R-V22)

The Totales surface MUST offer a vuelto panel: a money-received input (client state only) with the returned amount displayed as `vuelto = moneyReceived − Total`, computed client-side only. The panel MUST carry an explicit non-authoritative label (copy stating it is a tender reference, never the authoritative record — it MUST NOT be construable as payment registration; R-V14's prohibition on payment-registration controls stays in force and this panel adds none). No backend tender field, use case, or partial-cash-tender path may be introduced: contado COBRO continues to register the full invoice total server-side per R-V15, and nothing about the vuelto input ships to or persists in the backend. When money received is below Total, the display MUST NOT imply the server accepted partial tender (the label and copy prevent an authoritative reading; the exact `falta`/negative-vuelto display convention is fixed in design). Partial cash tender at POS remains explicitly unsupported (deferred to F3/cobros unless ever ratified).

(Traceability: proposal decision #2 (owner-ratified); Scope item 4; explore Risk 2; slice D.)

#### Scenario: Vuelto computes against current total

- GIVEN a cart whose Total resolves to 70.76 and money received entered as 100.00
- WHEN the vuelto panel renders
- THEN it displays vuelto 29.24 together with the explicit non-authoritative label
- TEST: ui

#### Scenario: No backend tender state exists

- GIVEN any sale flow with the vuelto panel used
- WHEN the draft/confirm actions run
- THEN no moneyReceived/vuelto field is sent to or stored by the backend (only the existing venta inputs ship)
- TEST: unit + e2e

#### Scenario: Under-received stays reference-only

- GIVEN money received below Total
- WHEN the panel renders
- THEN the display never implies the server accepted partial tender (label and copy prevent an authoritative reading)
- TEST: ui

### Requirement: Shared numeric keypad component (R-V23)

A single NEW shared client component (numeric keypad) MUST be created under `app/src/components/ui/` for POS numeric entry, with 48px button targets; it MUST be the quantity-entry seam for cart quantity editing, and MAY also be mounted for the vuelto money input. Keyboard and assistive operation must work (each button reachable and tagged appropriately). No other new vendored UI primitives (Toast, CommandPalette, inline-alert) are introduced by this change — banners remain Card+Badge composition. Keypad visual design stays board-agnostic until the Penpot board lands (same R-V18 gate).

(Traceability: Scope item 5; explore Area 4 verdict; slice D.)

#### Scenario: Keypad targets sized

- GIVEN a rendered keypad
- WHEN each button is measured
- THEN every button meets ≥48px in both dimensions and is keyboard/assistive operable
- TEST: ui

#### Scenario: Quantity entry writes the cart model

- GIVEN a cart line quantity control served by the keypad
- WHEN the operator keys a digit sequence for quantity 4
- THEN the cart model updates the line quantity and the preview re-runs through the domain calculators
- TEST: ui

### Requirement: Anulación Dialog for confirmed sales (R-V24)

DraftList rows MUST distinguish BORRADOR cancel from CONFIRMADA anulación:

- Cancelling a CONFIRMADA sale MUST open a Dialog (F0 Dialog primitive) gated to Administrador in the UI (parity with the existing `esAdmin` session plumbing; the server `cancelarVentaAction` remains the authorization and state authority — R-V16 semantics untouched), with a MANDATORY motivo: submit MUST be blocked while motivo is empty.
- The Dialog MUST call the existing `cancelarVentaAction({id, motivo})` — no backend change.
- The draft path MUST remain unchanged: cancelling a BORRADOR row keeps motivo OPTIONAL (empty allowed) per R-V4.
- Outcome copy MUST distinguish fiscal effect: a confirmed anulación renders the invoice-annulled (`ANULADA`, Formato 608) fiscal context, distinct from the non-fiscal draft-cancel copy. The underlying outcomes (ANULADA invoice never deleted, stock reposición via `REPOSICION_CANCELACION`, unchanged NCF sequence, audit rows) are fixed R-V16 behavior — this requirement pins the UI surface only.

(Traceability: proposal decision #1 (owner-ratified); Scope item 6; explore Risk 1; slice E.)

#### Scenario: Admin anulación requires motivo

- GIVEN an Administrador session and a CONFIRMADA DraftList row
- WHEN the anulación Dialog is submitted with an empty motivo
- THEN submit is blocked and `cancelarVentaAction` is not invoked
- TEST: ui

#### Scenario: Draft cancel stays optional-motivo

- GIVEN a BORRADOR row using the existing cancel control
- WHEN cancel runs without motivo
- THEN cancel succeeds (R-V4 unchanged; no dialog-gated motivo for drafts)
- TEST: ui

#### Scenario: Anulación outcome copy distinguishes fiscal effect

- GIVEN a CONFIRMADA sale anulación submitted with motivo
- WHEN the action completes to `CANCELADA`
- THEN the row/state copy reflects the invoice-annulled 608 fiscal context, distinct from draft-cancel copy (backend fiscal outcomes follow fixed R-V16)
- TEST: e2e

### Requirement: Confirm output may expose credit-form verdict (R-V25)

`ConfirmarVentaOutput` MAY additionally expose the credit-form verdict of the confirm: a CONTADO shape, or a CREDITO shape carrying the applied term (`plazoCreditoDias` — the credit term actually applied at confirm, from which the UI derives the due-date display). The exposure lives in the venta http mapping layer (`actions.escritura` mapping) with no cross-module import beyond the existing action boundaries. WHEN the exposure ships it MUST be display-only for post-confirm feedback (contado-settled vs open-receivable), MUST NOT alter R-V15's transaction semantics (no state toggle, no new gating decision, no extra NCF consumption, no COBRO change), and MUST ship with a unit test pinning both output shapes. The exposure is the ONLY backend touch permitted in F2.

(Traceability: proposal decision #5 (owner-ratified — ratified as the optional MAY-exposure with mandatory constraints and test); Scope item 8; slice B.)

#### Scenario: CONTADO verdict shape when shipped

- GIVEN the exposure is shipped and a contado sale confirms
- WHEN the output maps
- THEN the verdict resolves CONTADO alongside the existing fields (NCF/estado/totales) with display-only intent
- TEST: unit

#### Scenario: CREDITO verdict carries the applied term when shipped

- GIVEN the exposure is shipped and a credit sale confirms
- WHEN the output maps
- THEN the verdict resolves CREDITO and the applied credit term (`plazoCreditoDias`) is exposed for the derived due-date display
- TEST: unit

#### Scenario: R-V15 confirm semantics unchanged

- GIVEN the exposure shipped
- WHEN a sale confirms (any contado/credit case)
- THEN the transaction order, NCF count, invoice/debit/COBRO outcomes are byte-identical to pre-F2 behavior (constraint-mapping addition only; existing confirm tests stay green)
- TEST: integration

### Requirement: Shared E2E helpers and credit-path coverage (R-V26)

The E2E suite MUST consolidate the shared login + precondition helpers into a single shared module (`app/e2e/utils`): the login helper MUST preserve the existing landing-route tolerance (`/dashboard` or `/selector-empresa-sucursal`), and the four existing specs (`app/e2e/confirm-venta.spec.ts`, `app/e2e/cobros.spec.ts`, `app/e2e/devolucion.spec.ts`, `app/e2e/selector-sucursal.spec.ts`) MUST run green BEFORE and AFTER the extraction (pure refactor — no selector or prod-code behavior change; no third fork of login/page-landing logic). `confirm-venta.spec.ts` MUST additionally gain credit-path coverage: a draft built for a credit-bearing client confirming successfully as a derived CREDIT sale, with DB assertions proving the contado full-total `COBRO/APLICADO` is NOT registered (the paths diverge — fixed 5c semantics), while the contado path closely keeps proving its own COBRO.

(Traceability: Scope item 7 and Success Criterion "E2E uses shared helpers"; explore Area 6; slice E.)

#### Scenario: Helpers swapped without regression

- GIVEN the four existing specs running against master before the extraction
- WHEN login/precondition helpers move to `app/e2e/utils` and every spec imports them
- THEN each spec stays green with no behavior change beyond helper dedupe
- TEST: e2e

#### Scenario: Credit-path E2E coverage

- GIVEN a draft on a credit-bearing client (credit profile seeded)
- WHEN the operator saves and confirms via the POS flow (login → /venta → cart → draft → confirm)
- THEN the sale confirms as a derived CREDIT sale and the DB asserts NO contado full-total `COBRO/APLICADO` exists for it
- TEST: e2e
