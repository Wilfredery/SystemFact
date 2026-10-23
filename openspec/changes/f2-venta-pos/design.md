# Design: F2 — Venta/POS refinement (contado + crédito)

**Change ID**: f2-venta-pos | **Store**: hybrid (file + Engram `sdd/f2-venta-pos/design`) | **Date**: 2026-10-14
**Inputs (binding)**: `proposal.md` (decisions #1–#5 OWNER-RATIFIED), `specs/venta/spec.md` (R-V18..R-V26), `specs/cliente/spec.md` (R-V27), `explore.md` (ground truth), plus fresh code verification of every referenced symbol.

## Code-verification notes (checked against master, honest deviations)

1. **UI path correction**: the POS components do NOT live under `app/src/app/(app)/venta/ui/*`. They live in **`app/src/modules/venta/ui/*`** (`PosScreen.tsx`, `carro.ts`, `CartTable.tsx`, `ClienteSelector.tsx`, `Totales.tsx`, `DiscountPanel.tsx`, `DraftList.tsx`, `ProductSearch.tsx`); the route shell is `app/src/app/(app)/venta/page.tsx` (server, passes only `esAdmin`). All references below use the real paths.
2. **R-V27 is ALREADY satisfied by code**: `ClienteDto` (`app/src/modules/cliente/http/shared.ts:29-42`) already exposes `creditoHabilitado: boolean`, `limiteCredito: string` (`toFixed(2)` Decimal-string), `plazoCreditoDias: number`, and the listing projection (`clienteSelect`, `cliente-repository.ts:61-75`) already reads them. The explore report ("listarClientesAction DTO does not carry credit fields") is stale against current master. F2's slice-B deliverable for R-V27 is therefore a **DTO contract unit test** pinning the serialization (Decimal-string, no email), NOT a mapping change.
3. **R-V25 strictly "http-mapping-only" is impossible**: the application `ConfirmarVentaOutput` (`confirmar-venta.ts:75-87`) carries neither the credit `forma` verdict nor a term, `CreditResult` (`credit-port.ts:56-64`) carries no `plazoCreditoDias` for an allowed CREDITO, and `leerClienteParaElegibilidadEnTx` (`venta-repository.ts:643-655`) reads only `esConsumidorFinal`+`identificacionFiscal`. A mapping that derives the verdict post-hoc would either duplicate the R-K1 credit-profile rule or import cobros infrastructure (both forbidden by R-V25's "no cross-module import beyond the existing action boundaries"). D7 therefore documents the **minimal additive venta-module-only chain** (application output field + one repository `select` extension + the http relay). No cobros change. This is the faithful reading of "ConfirmarVentaOutput exposure"; flagged here and in the proposal review.
4. **R-V19 derivation prose vs backend truth**: spec prose says a credit sale is made "when the client is credit-enabled (`creditoHabilitado=true`)", but the AUTHORITATIVE backend derivation (`leerPerfilCreditoEnTx` → `esVentaCredito = !esConsumidorFinal && tipoCliente === "CREDITO"`, `saldo-cxc.repository.ts:578-579`) derives from `tipoCliente`, not the flag. The UI indicator MUST mirror the server rule, or the indicator will promise crédito for a `creditoHabilitado=true` MINORISTA that the gate treats as contado. Design D6 mirrors the backend rule; test fixtures use `tipoCliente=CREDITO` clients so both readings agree. Residual prose mismatch is a spec-wording nuance, not a code gap — the gate itself is frozen 5c behavior and is NOT touched.
5. **Slice A must include ProductSearch**: R-V18's grep gate ("zero `zinc-`/`indigo-`/`dark:`/hex in the venta module UI files") covers the WHOLE `venta/ui` tree, and `ProductSearch.tsx` carries raw `indigo-`/`zinc-` classes like the other six. The proposal's six-file list misses it; the restyle slice covers all seven files (see File Changes).
6. **`zCrearVentaInput` already accepts per-line `descuento`** (defaults `{PORCENTAJE, "0.00"}` at `validations.ts:63-65`) and `zCancelarVentaInput` already accepts optional `motivo` (`validations.ts:109-111`). Both server surfaces are verified untouched by F2.

---

## Technical Approach

F2 is a single-PR staged change (slices A→E, per proposal) executed as:

- **Restyle (A/D visual base)**: migrate all `venta/ui` surfaces to F0 semantic tokens and the existing F0 primitives (`@/components/ui/{button,card,input,label,select,table,badge,dialog}`), with the mechanical 44px/48px touch floor applied per control class. No business flow, action call, `data-testid`, `aria-label`, or heading copy changes — the four E2E specs are the non-regression gate.
- **Credit surfaces (B)**: ClienteSelector maps the already-shipped DTO credit fields into the selection state; a pure `venta/ui/credito.ts` owns the three display derivations (forma indicator mirroring `esVentaCredito`, owed-date derivation, per-code rejection surface map); one additive output field relays the confirm verdict from application → http mapping → UI.
- **Cart discount wiring (C)**: `carro.ts` gains the per-line `descuento` in its immutable model; the preview pipes each line's real `Descuento` through the SAME `calcularLineaVenta`/`calcularTotalesVenta` the server uses; the server `preparar-lineas-venta` DESC_MAX/admin pipe stays the only accept/reject authority.
- **Vuelto + keypad (D)**: display-only money-received panel in Totales plus ONE new shared client component (`NumericKeypad`) mounted once, focus-coupled to the active numeric input.
- **Anulación + E2E hygiene (E)**: admin Dialog with mandatory motivo for CONFIRMADA rows; login/precondition helpers extracted to `app/e2e/utils` and re-imported verbatim by the four specs; credit-path coverage added to `confirm-venta.spec.ts`.

No schema migrations, no new runtime deps (`decimal.js` already imported by `carro.ts`), no domain/application rewrite (the fase-5b/5c freeze holds; the only backend delta is D7's additive chain + its tests).

## Architecture Decisions

### D1 — PosScreen composition target (slices A, B, D, E)

**Choice**: Keep the exact two-boundary composition. `page.tsx` stays the only server component; `PosScreen` stays the single client orchestrator owning ALL screen state; every visible sub-surface remains a client island inside it.

```
app/src/app/(app)/venta/page.tsx            SERVER (unchanged; esAdmin → PosScreen)
└─ PosScreen                                 CLIENT — all state lives here
   ├─ ClienteSelector                        CLIENT — adds credit-profile display block (B)
   ├─ ProductSearch                          CLIENT — restyle only (A)
   ├─ DiscountPanel                          CLIENT — restyle only (A), admin-gated (unchanged)
   ├─ CartTable                              CLIENT — restyle (A) + per-line discount inputs (C)
   ├─ Totales                                CLIENT — restyle (A) + vuelto panel (D)
   ├─ NumericKeypad (new shared)             CLIENT — ONE mount beside Totales (D)
   ├─ DraftList                              CLIENT — restyle (A) + anulación row affordance (E)
   ├─ ConfirmarAnulacionDialog (inline in PosScreen or sibling) (E)
   ├─ status/warning banners                 inline Card+Badge composition (restyle A; credit rejection map B)
   └─ venta/ui/credito.ts helpers            PURE (no hooks) — consumed by A/B/E renderers
```

**Alternatives considered**: (a) server-render the client list/profile and pass it down — rejected: `ClienteSelector` already obtains the tenant-scoped DTO through `listarClientesAction` with its own action-level authorization; converting it to a server read changes the authorization wiring mid-restyle and the selector needs re-fetch after inline quick-add, which is a client round-trip by nature. (b) split PosScreen into a context/reducer architecture — rejected for this change: the screen already passes YAGNI-scale state; the restyle contract says no flow change.

**Rationale**: smallest diff with a single owner for derived state. The derived credit context (R-V19) is a pure function of state PosScreen already owns (`cliente` selection + the DTO list inside ClienteSelector). **Placement rule**: profile facts (badge CREDITO / `limiteCredito` money / `plazoCreditoDias` days) render inside `ClienteSelector` next to the selection; the derived contado/crédito indicator and, after confirm, the derived due date render in PosScreen's credit context strip (badge beside the status/credit area, above Totales). `esAdmin` from the shell gates the per-line discount inputs (D2) and the anulación affordance (D5), mirroring the existing DiscountPanel gate.

### D2 — `carro.ts` per-line discount model (slice C)

**Choice**: extend the immutable cart model with the domain `Descuento` per line; preview pipes it through the released calculators verbatim; the payload sends it explicitly.

Mechanism (all in `app/src/modules/venta/ui/carro.ts`):

- `CarroLinea` gains `readonly descuento: Descuento`.
- `agregarAlCarrito` seeds `DESCUENTO_CERO` (the existing canonical zero-shape = `PORCENTAJE 0.00`, R-V7) — a fresh line carries the zero-discount carrier form and only user input transitions it.
- New pure transition `editarDescuentoLinea(carro, productoId, parcial: Partial<Descuento>): CarroLinea[]` (merge onto the current shape; used by CartTable's type/inputs) and `limpiarDescuentoLinea(carro, productoId)` (back to `DESCUENTO_CERO`).
- `calcularVistaPrevia` passes `descuento: linea.descuento` into `calcularLineaVenta` (today it hardcodes `DESCUENTO_CERO` at carro.ts:120,153); non-computable lines keep the existing skip contract; `lineaComputable` likewise validates with the line's own discount.
- `PosScreen.guardar()` builds `lineas` with `descuento: l.descuento` — zod already accepts and defaults it, so **the validations/actions/preparar-lineas pipes are byte-untouched**.

**Alternatives considered**: (a) client-side DESC_MAX pre-check to spare a server round-trip — rejected: R-V21 says the UI must not hold any accept/reject verdict; DESC_MAX lives in CONFIGURACION_EMPRESA read server-side (the client has no reliable copy), and the existing `DiscountPanel` header path already relies on server verdicts. (b) store the discount as resolved money in the cart — rejected: the input form (PORCENTAJE/MONTO) is what the user supplies and what `VentaLineaInput.descuento` carries; money resolution is the calculator's job (ADR-018 resolution order: line discount BEFORE header proration BEFORE ITBIS).

**Rationale**: the preview stays non-authoritative BY CONSTRUCTION because it calls the same pure functions over the same input shape; the server verifies authorization + cap at save/confirm and the UI surfaces `DESCUENTO_EXCEDE_MAXIMO` / `DESCUENTO_NO_AUTORIZADO` / `DESCUENTO_EXCEDE_BASE` through the existing `Mensaje` error banner (code badge + message — the Card+Badge surface, no Toast). Admin gating: CartTable gains a `puedeDescontar` prop (passed `esAdmin` from PosScreen); inputs render only for admins; server R-V8 remains the backstop for a crafted non-admin payload.

### D3 — Vuelto panel (slice D, R-V22)

**Choice**: display-only client-side subtraction inside `Totales`, non-authoritative by label, no backend field anywhere.

Mechanism:

- PosScreen owns `const [dineroRecibido, setDineroRecibido] = useState("")`; Totales gains an optional slot: `{ totales, dineroRecibido?: string, onDineroRecibidoChange?: (v: string) => void }` — absent slot = today's Totales shape (keeps existing unit tests meaningful; PosScreen always passes it).
- Module-local pure exported helper `calcularVuelo(total: string, recibido: string): { estado: "SIN_DATOS" | "VUELTO" | "FALTA"; monto: string }` inside `Totales.tsx` (or `venta/ui/credito.ts`'s neighbouring pure module — single location: `venta/ui/credito.ts` exports all F2 pure display math to keep the "pure, hookless, testable" cluster together). Uses `decimal.js` (`new Decimal(recibido).minus(total).toFixed(2)`) — never a float; unparseable input yields `"SIN_DATOS"` with panel inert.
- Rendering contract (copy fixed in design, board-agnostic):
  - `VUELTO`: `Vuelto <monto>` + badge "Reference only" + caption "The sale records the full invoice total. Not a payment."
  - `FALTA` (received below Total): heading `Falta <monto>` + the SAME non-authoritative badge/caption. The caption explicitly states "Shortfall shown as a reference; the confirmed sale always records the full total." — the convention fixed here is: **never block, never send, never imply partial tender**.
- `moneyReceived` never appears in any action payload; D8's E2E (`no backend tender state exists`) asserts the wire stays venta-shaped.

**Alternatives considered**: blocking save when received < total — rejected: invents a contado tender gate no backend supports; gray-only display — rejected by R-V22's "exact `falta`/negative-vuelto display convention is fixed in design": an explicit short-fall state with reference-only copy IS that convention.

**Rationale**: the contado COBRO is always the full total server-side (R-V15); any richer model needs a backend tender field (out of scope, deferred to F3/cobros).

### D4 — `NumericKeypad` shared client component (slice D, R-V23)

**Choice**: ONE new shared component under F0 primitives, mounted once in PosScreen beside Totales, focus-coupled to the active numeric input.

Contract (`app/src/components/ui/numeric-keypad.tsx`, `"use client"`):

```ts
export type TeclaNumerica = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "BSP" | "CLR";

export interface NumericKeypadProps {
  readonly onTecla: (tecla: TeclaNumerica) => void;
  /** Accessible group name; default "Numeric keypad". */
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function NumericKeypad(props: NumericKeypadProps): JSX.Element;
```

- Grid: rows `789 / 456 / 123 / 0 . BSP / CLR` — 13 `<Button>` primitives in `size="pos"` (h-12 = 48px, the existing POS variant) inside a `role="group"` container. Every button ≥48px both axes (spec's TEST pins measurement).
- **Focus management**: key handlers run on `onPointerDown` with `preventDefault()` AND on `onClick` (keyboard) — pointer presses never steal focus from the paired input, so the focused quantity/price/vuelto field keeps its caret and screen-reader context; keyboard users tab to the keypad buttons in DOM order (R-V18).
- **Pure digit composition lives in `carro.ts`** (testable without DOM): `componerValor(actual: string, tecla: TeclaNumerica, maxDecimales: 2 | 3): string` — appends respecting the same line-validity regexes (`^\d{1,9}(\.\d{1,3})?$` for quantities, `^\d{1,9}(\.\d{1,2})?$` for money: overdigits are dropped, `.` is inserted at most once), `BSP` strips the last char, `CLR` yields `""`. A keypad write to a line quantity invokes `editarLinea(prev, productoId, "cantidad", compor)` → `calcularVistaPrevia` re-runs through the domain calculators (R-V23 scenario).
- **Target coupling**: PosScreen state `nanoObjetivo: { campo: "vuelo" } | { campo: "cantidad" | "precioUnitario"; productoId: number }` set by each numeric input's `onFocus` and by an explicit visible 48px keypad-target button on cart rows (satisfies "quantity-entry seam" without requiring focus tracking alone; defaults to the first line's quantity). One handler maps `onTecla` to the composition + state update for whichever target is active; one `<NumericKeypad>` instance serves CartTable quantity/price editing AND the vuelto money input (the MAY-mount of R-V23).
- **Visual design board-gated**: structural token styling now (F0 outline buttons on a Card), final layout awaits the Penpot board `02-Venta-Credito` (flagged follow-up).

**Alternatives considered**: per-row popup keypad — rejected: two focus regimes (popup + input) break DOM-order keyboard traversal (R-V18) and multiply the a11y surface; browser-only `inputMode="decimal"` — rejected: spec explicitly demands the shared component with 48px targets as the quantity seam.

**Rationale**: a single mounted group keeps tab order linear (inputs first, then keypad), satisfies the measurement test once, and is the ONLY new vendored primitive (R-V23 no-Toast/CommandPalette constraint honored).

### D5 — Anulación Dialog for CONFIRMADA rows (slice E, R-V24)

**Choice**: admin UI-gated F0 `Dialog` with mandatory motivo, calling the EXISTING `cancelarVentaAction({ id, motivo })`; draft-cancel path untouched.

Mechanism:

- `DraftList` gains `puedeAnular: boolean` (from PosScreen's `esAdmin`) and the CONFIRMADA branch exits with a new `onAnular(id: number)` instead of `onCancel(d.id)`. The row control label becomes "Void sale" (48px, F0 Button outline/destructive token). BORRADOR rows keep their existing cancel affordance and handler byte-for-byte (R-V4: motivo optional, no dialog).
- PosScreen state: `anulacion: { id: number; total: string; ncf: string | null } | null` (row data snapshot for the dialog copy) + `motivo: string`. Dialog body (F0 `Dialog` + `Label` + `Input`): title "Void sale #N", copy "This annuls invoice NCF X (Formats the Anulada fiscal state — Formato 608) and restocks the sale. This cannot be undone."
- Submit `<Button size="pos">` `disabled={motivo.trim() === ""}` — client-side block; on submit: `await cancelarVentaAction({ id, motivo: motivo.trim() })`. **Server unchanged**: `zCancelarVentaInput.motivo` stays optional (a server-side mandatátory case would be an R-V16 semantic change — not allowed); the mandatory motive is enforced at the UI surface per R-V24's own wording ("gated … in the UI; the server remains the authorization and state authority").
- Outcome copy distinguishes fiscal effect: success for an anulación → "Sale #N voided — invoice annulled (Formato 608), stock restocked."; draft cancel keeps "Sale #N cancelled.". Both render through the existing `Mensaje` status banner (Card+Badge surface, no Toast); the dialog closes, `recargarBorradores()` refreshes (row drops from the list per the CANCELADA filter — unchanged behavior).
- Non-admin sessions: `puedeAnular=false` hides the Void control (UI gate only; `cancelarVentaAction`'s ROLES path stays the real authorization — R-V16 untouched).

**Alternatives considered**: reusing the draft-cancel confirmless path for CONFIRMADA — rejected: it is exactly the invisible-608 problem the proposal closes; server-side required `motivo` — rejected: changes a frozen contract shape for a UI-only need.

### D6 — Credit surfaces: profile display, derived indicator, gate-error mapping, due-date rule (slice B, R-V19 + R-V20 + R-V27 consumer side)

**Choice**: one pure module `app/src/modules/venta/ui/credito.ts` owns all F2 credit display derivations; `ClienteSelector` owns the profile data flow; PosScreen owns the indicator and the rejection banner.

- **Data flow (R-V27 → selector)**: `ClienteSelector` maps `listarClientesAction` items to an extended option type:

```ts
interface ClienteOpcion {
  readonly id: number;
  readonly nombre: string;
  readonly tipoCliente: string;
  readonly esConsumidorFinal: boolean;
  readonly creditoHabilitado: boolean;
  /** Decimal-string money (DTO contract) — never parsed to number/float. */
  readonly limiteCredito: string;
  readonly plazoCreditoDias: number;
}
```

  No extra fetch: the fields ride the call the selector already makes at mount and after quick-add (`crearClienteAction` result extends the local list with zero-credit defaults — flag `creditoHabilitado:false, limiteCredito:"0.00", plazoCreditoDias:30` for the freshly created row so the shape never diverges; quick-add only offers MINORISTA/MAYORISTA, so a shortcut-add client is definitionally contado — consistent with the frozen `TIPOS_ALTA_RAPIDA`).
- **Profile block** (inside ClienteSelector, shown only when the selected client is the derived-credit one per the backend mirror rule below): `Badge` "CREDITO" (destructive/secondary variant per board polish), `Limite: <formatearMonto(limiteCredito)>`, `Plazo: N días`. `esConsumidorFinal` selections show CF context with no credit facts.
- **Derived indicator** (positively mirrored to the server): `ventra/ui/credito.ts` exports

```ts
export type FormaVenta = "CONTADO" | "CREDITO";
export function derivarFormaVenta(p: {
  readonly esConsumidorFinal: boolean;
  readonly tipoCliente: string;
} | null): FormaVenta;
// mirrors leerPerfilCreditoEnTx.esVentaCredito = !esConsumidorFinal && tipoCliente === "CREDITO"
```

  PosScreen renders a `Badge` next to the status/credit strip: "Cash (Consumidor Final)" when no client is selected (R-V19 scenario 2 — no toggle control exists anywhere), "Crédito · N días" when derived credit, "Cash" otherwise. **No contado/crédito toggle is rendered** (derivation only).
- **Derived due date**: `derivarVencimiento(fechaEmision: string, plazoCreditoDias: number): string` (ISO date `YYYY-MM-DD`: fechaEmision + N days, Santo-Domingo calendar day; implemented with `Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" })` — the ratified pattern already used by `cobros/domain/en-mora.ts`). Unit test pins the R-V19 scenario (2026-03-01 + 15 → 2026-03-16) and asserts equality with `fechaVencimiento` from `cobros/domain/en-mora.ts` on the same fixture dates (drift guard; the test file may import codomain code even though the runtime module may not). Rendered as presentation-only in the confirmation context after a CREDITO verdict (D7 supplies `fechaEmision` + `plazoCreditoDias`); NO venta field, column, or action parameter exists (ADR-017).
- **R-V20 rejection mapping**: `venta/ui/credito.ts` exports

```ts
export interface SuperficieRechazoCredito {
  readonly titulo: string;
  readonly texto: string;
  /** Distinct Badge/Card treatment per code (no raw code as sole copy). */
  readonly variante: "deuda-vencida" | "limite-excedido" | "credito-no-habilitado";
}
export function superficieRechazoCredito(code: string): SuperficieRechazoCredito | null;
```

  covering exactly `CLIENTE_EN_MORA`, `LIMITE_CREDITO_EXCEDIDO`, `CREDITO_NO_HABILITADO` (stable strings pinned locally as `as const`; a unit test asserts literal equality against `CREDITO_RECHAZO_CODES` from `cobros/domain/credito.ts` so the UI map cannot drift from the catalog). Composed fixed copy:

  - `CLIENTE_EN_MORA` → title "Client has overdue invoices"; text "Sales on credit are blocked while the client keeps invoices past their due term." Card treatment: overdue variant.
  - `LIMITE_CREDITO_EXCEDIDO` → title "Credit limit exceeded"; text "This sale would exceed the client's authorized credit limit."
  - `CREDITO_NO_HABILITADO` → title "Credit not enabled for this client"; text "Sell cash instead: select a non-credit client or keep Consumidor Final, which stays un-gated." (the contado-alternative guidance R-V20 requires).
  The PosScreen error path checks `superficieRechazoCredito(mensaje.code)` FIRST — on match it renders the dedicated Card+Badge surface (heading + fixed copy + the server message in the muted slot: `message` from the ActionResult is always present alongside, satisfying "message copy from the stable error's user message"); the generic `[CODE] text` fallback stays for everything else. Sale remains BORRADOR (fixed 5c backend).

**Alternatives considered**: client-side mora/limit pre-checks from the DTO — rejected: the DTO has no pending balance and duplicating any cobros rule violates R-K1; a Toast primitive — explicitly excluded (banners stay Card+Badge).

### D7 — R-V25: credit verdict exposure through `ConfirmarVentaOutput` (slice B)

**Choice**: one additive display field on the application output, built from data the confirm already computes, relayed verbatim by the http mapping; ships with its unit tests; no R-V15 semantics touched.

Shape (all display-only):

```ts
export interface ConfirmarVentaOutput {           // confirmar-venta.ts (additive field)
  // ...existing fields, untouched order serves tests by name not position...
  readonly credito:
    | { readonly forma: "CONTADO" }
    | { readonly forma: "CREDITO"; readonly plazoCreditoDias: number; readonly fechaEmision: string };
}
```

- `forma` comes from the already-computed `credito.forma` local (step 5c of `confirmarVenta`) — zero re-derivation, zero extra reads of cobros state.
- `plazoCreditoDias` and `fechaEmision`: `leerClienteParaElegibilidadEnTx`'s `select` gains `plazoCreditoDias: true` (same module `venta/infrastructure/venta-repository.ts`, same row/route already read at step 4 — the applied-term truth for a confirmed CREDITO sale is the client's term, the same value the mora window and the CxC-derived aging rule use); `fechaEmision` is the FACTURA's emission instant (`factura.fechaEmision`, already materialized as `new Date()` at step 8) — NOT `venta.fecha`, because the FIN-2/ADR-017 due-date rule is anchored on the invoice emission date. `fechaEmision` is returned as an ISO UTC string; the SD calendar-day conversion for the display is done by `derivarVencimiento` (D6) so due-date math runs once, in the pure display layer.
- **Why `fechaEmision` rides the shape**: R-V25 requires the UI to DERIVE the due date from emission + applied term; without the emission timestamp the POS couldn't produce the R-V19 scenario date deterministically. One additive field, same tradeoff-free reasoning as `forma`.
- **http mapping** (`actions.escritura.ts:95-136`): the inline `ActionResult<{...}>` type and the `ok({...})` literal gain `credito: data.credito` — verbatim relay, no transformation, no new validation (display-only output needs none).
- **Why R-V15 is untouched**: no transaction-order step reorders, no gate added/removed, no extra NCF, no COBRO change, no persisted field. The select extension adds one column to an already-executed single-row prisma read (cost-identical pattern); `confirmarVenta`'s observable chain is regressed by the existing confirm integration tests staying green (TEST contract in R-V25 scenario 3).
- **Unit tests**: `confirmar-venta.test.ts` gains two cases pinning both output shapes (CONTADO verdict beside NCF/estado/totales; CREDITO verdict carrying applied term + emission timestamp) plus one case asserting the mapping in `actions.escritura` relays `credito` unchanged for both shapes (mocked `confirmarVenta` result — the mock-DTO-contract pattern the UI specs already use).
- **Deviation note (honest)**: spec R-V25 says the exposure "lives in the venta http mapping layer (`actions.escritura` mapping)". Read literally, the mapping alone cannot produce the term/the emission date without a duplicate profile read or a cobros-infrastructure import (both violate the same requirement's boundary sentence). The implemented chain keeps ALL module boundaries intact: venta application computes, venta http relays; the change to cobros is ZERO; the domain kernels are untouched. This is filed here as the resolved reading for tasks/apply.

### D8 — E2E utils extraction + credit-path coverage (slice E, R-V26)

**Choice**: a `app/e2e/utils/` module set with verbatim-moved helpers; the four specs switch to imports with ZERO body changes; `confirm-venta.spec.ts` gains the credit-path case plus the contado COBRO assertion.

```
app/e2e/utils/
├── login.ts      export type LoginUser = { user: string; password: string };
│                 export async function login(page: Page, creds: LoginUser): Promise<void>
│                 // body moved VERBATIM from confirm-venta.spec.ts:108-117 (incl. the
│                 // /dashboard|/selector-empresa-sucursal landing tolerance regex)
├── db.ts         export function openDb(): Pool          // DIRECT_URL ?? DATABASE_URL
│                 export type UsuarioPrecond = { usuarioId; empresaId; sucursalId; rol };
│                 export async function usuarioPrecond(pool, user): Promise<UsuarioPrecond>
│                 // the shared user+rol query @45-61 supersets the cobros variant
└── venta-pos.ts  export const E2E_PRODUCT / E2E_USER / E2E_PASSWORD (env-reading constants)
                  export async function buscarYAgregar(page, producto): Promise<void>
                  export async function guardarYConfirmar(page): Promise<{ ventaId: number; ncf: string }>
                  export const CLIENTE_CREDITO_DEMO_NOMBRE     // moved from cobros.spec.ts:39
                  export async function idClienteCreditoDemo(pool, empresaId): Promise<number>
```

- **Non-regression contract**: helper bodies move byte-for-byte (same queries, same regexes, same skip semantics); each spec's TEST-LOCAL precondition queries that are actually spec-specific (facturaAutomatica gate, NCF ranges, product stock — confirm-venta; credit-client lookup — cobros) either move to `utils` (credit lookup, user/rol) or stay local (company/product/ncf facts). Suite runs green BEFORE and AFTER (recorded in the slice gate).
- `selector-sucursal.spec.ts` keeps its own extra landing waits (it is ABOUT landing routes) and only swaps the shared login helper.
- **Credit-path coverage** (new test in `confirm-venta.spec.ts`, self-skipping when the demo credit client is absent, exactly like `cobros.spec.ts:91-97`): login → /venta → select `Comercios Clara, SRL (demo)` in the client combobox → `buscarYAgregar(E2E_PRODUCT)` → `guardarYConfirmar` → assert poster "confirmed — invoice B.."; DB asserts VENTA `CONFIRMADA`, FACTURA VIGENTE, and **zero rows** in `PAGO` (`tipo='COBRO' AND estado='APLICADO'`) for that `facturaId` (the credit path diverges — no auto-cobro). The contado happy-path test GAINS an assertion that exactly ONE `COBRO/APLICADO` PAGO row exists for its factura with `monto = <factura.total>` (closes the existing contado COBRO-gap while proving the two paths diverge from the same test file).

**Alternatives considered**: a single `utils/index.ts` barrel — rejected: three named files keep import paths greppable in specs; extracting spec-specific company/product/ncf preconditions — rejected (YAGNI; only the duplicated identities move).

### D9 — F0 restyle mechanics (slice A; the touch floor and the token map)

**Choice**: mechanical, file-by-file migration table (executed per file, no logic edits).

- **Panel sections** (each component's hand-rolled `rounded-lg border … bg-white … dark:*` `<section>`) → `<Card>` + `CardHeader`/`CardTitle`/`CardContent` with the existing heading text and `aria-label` PRESERVED (aria-labels are E2E anchors: "Cart", "Totals", "Client", "My drafts", "Product search", "Discount").
- **Native `<input>`** → F0 `Input` (with `aria-label` preserved verbatim); **native `<select>`** (ClienteSelector + DiscountPanel + quick-add) → F0 `Select` (same `aria-label`, same values, same change payloads — E2E uses `getByRole("combobox", { name: "Client selection" })`).
- **Hand-rolled `<button>`** → F0 `Button` with variants: save/confirm/create = default; cancel/void = outline + destructive token; edit = outline; row draft controls = `size="pos"` (48px, high-frequency). All other standalone interactive inputs (`Valor` discount field, quantities) get `min-h-11` (44px floor); cart quantity controls get `min-h-12` (48px high-frequency floor).
- **Raw palette reconciliation** (verified greps): `bg-indigo-600` → Button default; `text-emerald-*`/`bg-emerald-*` confirmed/draft-green → success semantic token (Badge success / status success surface token); `bg-red-*`/`text-red-*` → destructive token class; `bg-amber-*` warning banners → warning token class; every `zinc-*`/`dark:*` literal → F0 semantic tokens (`bg-background`/`bg-card`, `text-foreground`/`text-muted-foreground`, `border-border`, `text-primary`…). The grep gate (`zinc-|indigo-|dark:|#[0-9a-f{3,6}]i` over `src/modules/venta/ui/**`) must return zero matches — including `ProductSearch.tsx` (see Verification note 5).
- **Spacing**: 8px rhythm on gaps/paddings (`gap-4`, `space-y-4`, `p-4`) replacing the mixed py-0.5/px-3 ad-hocs inside card bodies; table row padding raised to keep the ≥44px row hitboxes.
- **DOM order**: no reorders — JSX children keep their current sequence so tab order stays byte-equivalent (R-V18 keyboard reachability contract; also protects `getByRole`/`getByLabel` resolution).
- **Board baseline**: layout stays the existing `grid lg:grid-cols-2` two-column shape (board-agnostic), consistent with page.tsx's documented 5b evaluation.

## Data Flow

```
                    SERVER BOUNDARY (page.tsx: esAdmin only)
                                     │
                                     ▼
PosScreen (client, all screen state) ──────────────────────────────────────────────┐
   │ listarClientesAction ── action (tenant-scoped, Rolle-gated)                  │
   │    └→ ClienteOpcion{id,…,creditoHabilitado,limiteCredito,plazoCreditoDias}   │  VERIFIED
   │       (DTO fields ALREADY shipped — R-V27 test-only deliverable)             │  shipped
   │                                                                              │
   │.setUserState: lineas(+descuento) / cliente / devez / dineroRecibido          │
   │      │                                                                       │
   │      ▼                                                                       │
   │ carro.calcularVistaPrevia ── calcularLineaVenta / calcularTotalesVenta       │ SAME pure
   │      (Descuento per line; server recomputes authoritatively at save/confirm) │ calculators
   │      ▼                                                                       │
   │ UI preview (Totales, CartTable, vuelo) — non-authoritative display           │
   │                                                                              │
   │ crear/actualizar venta action (lineas carry descuento; zod default held)     │
   │ confirmar venta action ──▶ application ──▶ CREDITO verdict/term/emision     │ D7 relay
   │           └→ UI: derived due date via derivarVencimiento (SD calendar day)   │ ADR-017-safe
   │                                                                              │
   │ cancelarVentaAction({id, motivo?}) — Dialog reason mandatory for CONFIRMADA  │ R-V24
   │ credit rejection code ──▶ superficieRechazoCredito (Card+Badge surface)      │ R-V20
   └──────────────────────────────────────────────────────────────────────────────┘
```

Server-tenant guarantees: every venta/cliente action already runs `withTenantTransaction(ctx, …)` with the RLS GUCs; F2 adds ZERO new server reads beyond D7's one-column select extension on the existing eligibility read.

## File Changes

| File | Action | Descriptions | Slices |
|------|--------|--------------|--------|
| `app/src/modules/venta/ui/PosScreen.tsx` | Modify | Token/primitive migration; vuelo/dineroRecibido state + Totales props; keypad target state + handler; CREDITO indicator badge; `superficieRechazoCredito` banner; anulación Dialog state + submit; payload sends per-line descuento; `puedeAnular` pass. | A, B, C, D, E |
| `app/src/modules/venta/ui/CartTable.tsx` | Modify | Card/Table/Input/Button migration; 48px quantity controls; per-line discount `Select` type + `Input` value (admin-only via `puedeDescontar` prop); keypad-target affordance button. | A, C, D |
| `app/src/modules/venta/ui/carro.ts` | Modify | `CarroLinea.descuento` + seeds; `editarDescuentoLinea` / `limpiarDescuentoLinea`; `calcularVistaPrevia`/`lineaComputable` pass real discounts; `componerValor(tecla)` keypad composition; guardar payload. | C, D |
| `app/src/modules/venta/ui/ClienteSelector.tsx` | Modify | Select/Button migration; extended option mapping (credit DTO fields); profile block (badge CREDITO, limit money, plazo). | A, B |
| `app/src/modules/venta/ui/Totales.tsx` | Modify | Card migration; vuelo panel (input + non-auth label + calcular variant); `dineroRecibido` slot props. | A, D |
| `app/src/modules/venta/ui/DiscountPanel.tsx` | Modify | Card/Input/Select/Button migration only (admin gate copy untouched). | A |
| `app/src/modules/venta/ui/DraftList.tsx` | Modify | Card/Button migration; `puedeAnular` + `onAnular` for CONFIRMADA rows (Room 48px); draft branch byte-kept. | A, E |
| `app/src/modules/venta/ui/ProductSearch.tsx` | Modify | Card/Input/Button migration only. (Added by verification note 5 — grep gate includes it.) | A |
| `app/src/modules/venta/ui/credito.ts` | Create (new) | Pure display cluster: `derivarFormaVenta`, `derivarVencimiento`, `superficieRechazoCredito`, rejection-code const pinning cobros strings. | B |
| `app/src/components/ui/numeric-keypad.tsx` | Create (new) | Shared `NumericKeypad` client component (48px targets, pointer+keyboard, `role="group"`). | D |
| `app/src/modules/venta/application/confirmar-venta.ts` | Modify, additive | `ConfirmarVentaOutput.credito` field built from existing locals; shape D7. | B |
| `app/src/modules/venta/infrastructure/venta-repository.ts` | Modify, one column | `leerClienteParaElegibilidadEnTx` select adds `plazoCreditoDias`. | B |
| `app/src/modules/venta/http/actions.escritura.ts` | Modify, mapping only | `confirmarVentaAction` output literal + inline type gain `credito: data.credito`. | B |
| `app/src/modules/cliente/http/actions.lectura.ts` | **No code change** | DTO already exposes the three fields; R-V27 verified-done (see note 2). | B (test only) |
| `app/src/modules/cliente/http/actions.test.ts` | Modify | DTO contract test: `creditoHabilitado`/`limiteCredito`-string/`plazoCreditoDias`, no email field, tenant-scoped existing guarantee docs. | B |
| `app/src/modules/venta/ui/__tests__/carro.spec.ts` | Create | Per-line discount F2/F4 preview triangulation; zero-shape default; keypad composition regex cases. | C |
| `app/src/modules/venta/ui/__tests__/venta-ui.spec.tsx` | Modify | Discount-input admin gating + over-cap banner passthrough; vuelo panel states; keypad mock wiring; profile block flags (R-V19 tests). | B, C, D |
| `app/src/modules/venta/ui/__tests__/confirm-ui.spec.tsx` | Modify | Credit-rejection banner distinctness per code; CONTADO/CREDITO post-confirm surface. | B |
| `app/src/modules/venta/application/confirmar-venta.test.ts` | Modify | Both cntado/credit verdict shapes + applied-term contract; R-V15 sequence-untouched regressions stay green. | B |
| `app/src/modules/venta/http/actions.test.ts` (or extend existing action test) | Create/Modify | Mapping relay test for `credito` (mock DTO contract). | B |
| `app/e2e/utils/login.ts` / `db.ts` / `venta-pos.ts` | Create | Shared E2E helpers (D8). | E |
| `app/e2e/{confirm-venta,cobros,devolucion,selector-sucursal}.spec.ts` | Modify | Helper imports swap (byte-kept bodies); nothing else. | E |
| `app/e2e/confirm-venta.spec.ts` | Modify | + credit-path case; + contado COBRO assertion. | E |

Untouched (explicit): all `venta/domain/*` except nothing; `venta/application/{venta-service,preparar-lineas-venta,venta-guardado,descuentos}`; all cobros module files; cliente use cases; `validations.ts`; the DraftList flow copy for BORRADOR rows.

## Interfaces / Contracts

1. **Confirm output** (additive, display-only):

```ts
readonly credito:
  | { readonly forma: "CONTADO" }
  | { readonly forma: "CREDITO"; readonly plazoCreditoDias: number; readonly fechaEmision: string };
```

2. **ClienteDto** (already shipped; the unit contract test must enforce): `creditoHabilitado: boolean`, `limiteCredito: string` (canonical `Decimal(12,2)` string, never float), `plazoCreditoDias: number`, no email/auth-relevant field.

3. **Carro additions** (pure, immutability-preserving):

```ts
const editarDescuentoLinea: (carro: readonly CarroLinea[], productoId: number, parcial: Partial<Descuento>) => CarroLinea[];
const limpiarDescuentoLinea: (carro: readonly CarroLinea[], productoId: number) => CarroLinea[];
const componerValor: (actual: string, tecla: TeclaNumerica, maxDecimales: 2 | 3) => string;
```

4. **`NumericKeypad`**: see D4 for the full TS contract (`TeclaNumerica` union, `onTecla` single-prop callback, 48px, `role="group"`).

5. **UI pure helpers** (`venta/ui/credito.ts`, plain exports, hookless):

```ts
export type FormaVenta = "CONTADO" | "CREDITO";
export function derivarFormaVenta(p: { esConsumidorFinal: boolean; tipoCliente: string } | null): FormaVenta;
export function derivarVencimiento(fechaEmisionISO: string, plazoCreditoDias: number): string; // YYYY-MM-DD (SD)
export function superficieRechazoCredito(code: string): SuperficieRechazoCredito | null;
```

6. **E2E utils contracts**: `login(page, creds)`, `openDb()`, `usuarioPrecond(pool, user)`, `buscarYAgregar(page, producto)`, `guardarYConfirmar(page) → { ventaId, ncf }`, `CLIENTE_CREDITO_DEMO_NOMBRE` string constant, `idClienteCreditoDemo(pool, empresaId) → number`.

## Testing Strategy

| Layer | What to test | How |
|-------|--------------------|-----|
| Unit (domain/package) | Nothing new — bạc F2 does not touch domain files; existing `calculators.signup`, `descuentos`, `confirmar-venta.integration` act as F2's frozen-backend regression net | Existing suites must stay green (CI gate; no changes) |
| Unit `carro.spec.ts` (new) | Per-line discount model + preview parity: F2 class (7 × 3.33 @18% MONTO 5.00 → `baseLinea 18.31`, `itbisLinea 3.30`; multi-line fixture totals `subtotal 69.86 / descuento 5.62 / itbis 6.52 / total 70.76`), triangulated against the SAME fixture constants in `venta/domain/__tests__` (F2 multi-line and F4-class header+line interplay) so the cart can never drift from the released calculators; zero-discount default (R-V21 zero-shape); seed/limpo transitions; `componerValor` regex cases (decimals=2 money vs 3 quantity, overdigits, BSP/CLR) | Plain vitest (`venta/ui/__tests__/carro.spec.ts`), same tooling as the existing jsdom suite's pure helpers |
| Unit mock-DTO contracts (jest, existing pattern) | (1) `actions.lectura` DTO carries the credit fields with `limiteCredito` as a string ("20000.00") and no email (R-V27) — `cliente/http/actions.test.ts`; (2) confirm mapping relays `credito` in both shapes (R-V25) — venta http test mocking `confirmarVenta`; (3) `superficieRechazoCredito` literal-equals `CREDITO_RECHAZO_CODES`; `derivarVencimiento` fixture 2026-03-01+15 → 2026-03-16 and equality with `cobros/domain/en-mora.ts` `fechaVencimiento` on the same input (drift guard) | Existing action/src test file (same infrastructure; `venta-ui` jest project) |
| Unit UI (jsdom RTL) | (1) R-V18 grep gate = jest file-level lint? — actual enforcement: `pnpm lint` + typed grep script verifying zero `zinc-|indigo-|dark:` in `venta/ui`; plus the touch-floor + keyboard traversal assertions in `venta-ui.spec.tsx` where jsdom can read sizes via CSS vars; (2) R-V21 admin gating → non-admin renders no per-line discount input; over-cap error shows code+message (mocked DTO); (3) R-V22 vuelo states (`VUELTO 29.24` + labels ; `FALTA` view; no POST), (4) R-V19 profile block identifiers + indicator bay states (contado default, crédito derived); (5) R-V20 three-code banner distinctness incl. non-graded fallback for other codes; (6) R-V23 keypad renders 13 buttons at 48px targets and quantity composition updates the model; (7) R-V24 dialog empty-motivo blocks submission and `cancelarVentaAction` is not invoked | `venta-ui.spec.tsx` + `confirm-ui.spec.tsx` (mock action DTO contract — the suite's whole existing pattern) |
| Integration | R-V15 byte-identity of confirm chain (the select extension is read-only); existing `confirmar-venta.test.ts` + `venta-service.test.ts` suites must all stay green; the R-V25 test-added cases align shapes | Existing application suite (real-Postgres CI covers) |
| E2E (slice E) | Four specs green pre/post helper extraction; `confirm-venta.spec.ts` credit case (no COBRO for credito sale); contado COBRO == factura total exact row; all four existing specs no selector drift | `pnpm e2e` per proposal (env-gated locally per prior convention) |

**Per-slice gate commands** (from the proposal table, verbatim policy: every slice gate green before the next slice starts):

- A: `pnpm test venta-ui` + `pnpm lint` + script `pnpm typecheck` (+ grep gate for raw classes) — plus the four E2E specs re-run before merge as slice A's flow-proof (`pnpm e2e`, env-gated).
- B: `pnpm test venta-ui` + cliente lectura + `venta/application` test suites + `pnpm lint` + typecheck.
- C: `pnpm test venta-ui` (incl. new `carro.spec.ts`) + `pnpm lint` + typecheck.
- D: `pnpm test venta-ui` (Totales + keypad) + `pnpm lint` + typecheck.
- E: `pnpm e2e` (confirm-venta, cobros, devolucion, selector-sucursal — green before AND after the helper extraction) + unit suites.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation beyond the existing CI gate, executable-file classification, or process-integration boundary. The E2E helper files are read-only DB asserts (`DIRECT_URL` superuser reads) and UI flows, pre-existing in the repo, only MOVED (no new permission surfaces).

## Migration / Rollout

No data migration, no feature flag, no phased runtime rollout (single PR, slice-revertable per the proposal's rollback plan; slice order A→E so reverting C keeps D/E coercible and reverting B reverts the additive output field without breaking the UI — UI already reads `credito` defensively).

## Open Questions

- [ ] **Board-gated polish** (owner parallel step, accepted): Penpot board `02-Venta-Credito` authoring/export; when it lands, final keypad placement, indicator palette variants, and the vuelo panel layout are the flagged follow-up — the structural contracts above do not move (layout-agnostic gate per fase-5b).
- [ ] **R-V19 prose vs backend derivation** (spec wording nuance, not a code gap; D6 mirrors the backend `esVentaCredito` rule — spec team may want the prose aligned during the next spec revision without touching this change).
- [ ] Owner confirmation (apply-time gate per proposal) of `size:exception` OR the chained-PR split; no slice starts before answered already recorded in the proposal.

## NON-Designs (explicit omissions)

| Omission | Statement | Follow-up / owner path |
|----------|-----------|------------------------|
| Board-dependent visual polish | Keypad final layout, indicator palette, panel proportions, responsive column shapes — structural tokens only now | Penpot board `02-Venta-Credito` (owner) → `design/penpot-frontend-map` update → follow-up polish slice |
| Toast / CommandPalette / inline-alert primitives | None introduced; banners stay Card+Badge composition — permanent constraint of this change unless a future change proposes the primitive | None in F2 |
| Partial cash tender at POS | No backend tender field, no money-received persistence, no blocking gate; the `Falta` state is a reference only | F3/cobros if ever needed (owner decision) |
| Sale-time contado/crédito toggle | Not rendered anywhere (R-V19 scenario 2); derivation only | Owner override would be a backend change — out of F2 |
| Credit profile editing at the POS | Quick-add intentionally offers MINORISTA/MAYORISTA only | cliente CRUD (existing capability; frozen `TIPOS_ALTA_RAPIDA`) |
| Derived pending balance in the profile block | The lectura DTO has no pending field; R-V19 does NOT require it — the CxC gate owns pending. Do NOT add a read for it | CxC/board surfaces own pending display (ADR-017) |
| CxC / receivables persistence changes | None; due-date stays derived; no venta column | ADR-017 holds permanently for this change |
| Server-side required motivo for anulación | zCancelarVentaInput stays optional; the UI enforces mandatory at the dialog | If the owner wants server enforcement, that is an R-V16 semantic change needing an SDD of its own |
| `ClienteDto` code changes | Already expose the credit profile; F2 adds only the contract test | None |

## Traceability

| Req | D-decision(s) that implement it | Slice |
|-----|----------------------------------|-------|
| R-V18 (F0 tokens/primitives, touch floor, keyboard order, no raw colors, board-agnostic, no flow change) | D9 (token/primitive map, 44/48px floors, DOM-order preservation) + D1 (composition unchanged); grep gate plus E2E non-regression suite as TEST | A + E proof |
| R-V19 (credit-mode UX derived, no toggle, profile display, derived due date display-only) | D6 (profile data flow, `derivarFormaVenta` mirroring `esVentaCredito`, `derivarVencimiento`, no toggle rendered) + D1 indicator placement | B |
| R-V20 (credit-gate distinct rendering, three codes, Card+Badge only, no raw-code-only copy) | D6 `superficieRechazoCredito` + PosScreen banner branch (still Card+Badge) | B |
| R-V21 (per-line discount UI, admin-gated UI, preview = same calculators, non-authoritative, zero-shape default, F2/F4 fixtures) | D2 carro model + CartTable inputs + `EditarDescuentoLinea` + preview through `calcularLineaVenta`/`calcularTotalesVenta`; server pipes untouched (VERIFIED defaults at validations.ts:63-65) | C |
| R-V22 (vuelo display-only, moneyReceived − Total, non-authoritative label, `Falta` convention, no backend tender) | D3 Totales vuelo panel + PosScreen-only `dineroRecibido` state (never in a payload, E2E-asserted) | D |
| R-V23 (single shared NumericKeypad, 48px, quantity seam, MAY for vuelo, a11y, no other new primitives) | D4 component + PosScreen focus-coupled single mount + `componerValor` pure helper | D |
| R-V24 (anulación Dialog admin + mandatory motivo, action unchanged, draft path untouched, 608 outcome copy) | D5 (`puedeAnular`, Dialog composition, `cancelarVentaAction({id, motivo})` byte-reuse, distinct success copy) | E |
| R-V25 (ConfirmarVentaOutput MAY expose verdict, mapping layer, unit test, R-V15 untouched) | D7 (additive output field, one-column select extension, verbatim http relay, both-shape unit tests; integrity of R-V15 preserved by zero transaction changes — VERIFIED) + honest deviation note | B |
| R-V26 (shared E2E utils; four specs green pre/post; credit-path coverage; contado path keeps proving COBRO) | D8 (`app/e2e/utils/{login,db,venta-pos}.ts`, verbatim-move extraction, welcome credit case + contado COBRO assertion) | E |
| R-V27 (lectura DTO exposes credit profile; read-only; additive; tenant-scoped; no email; Decimal-string money) | Verified ALREADY satisfied by `ClienteDto`/`toDto`/`clienteSelect` — deliverable reduced to the DTO contract unit test (D6 consumes it) | B (test only) |
