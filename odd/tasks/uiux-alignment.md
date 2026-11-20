# UI/UX Alignment — factura.penpot wireframes → code

Board-by-board alignment of the SystemFact frontend to the owner's
`factura.penpot` wireframe (`design/factura/sources/`), under standing order
2026-11-18 (check/recheck/evaluate/audit before any implementation; owner
ratified per-board loop). Setup deliverable: `design/factura/system.md`.

## Specs

- S1: "Follow the rules and roles from the wireframe. Go with recommendations"
  (owner, 2026-11-18) — wireframe is source of truth for roles: **Despachador
  uses the POS screen** (header shows `Wilfredo · Despachador`; Etiqueta
  roles: Despachador, Administrador). The server role matrix must reflect it:
  `ROLES_VENTA` gains `Despachador`. Admin/Operador keep access. Despachador
  remains denied in Cobros (Etiqueta R-C6) — unchanged.
- S2: Money entry keeps the on-screen NumericKeypad (touch-first), rendered
  where the wireframe draws "Monto recibido", plus a quick-amounts row
  (exact, RD$100/200/500/1000/2000/5000) so an exact payment is 1 tap.
- S3: Each cart line shows its ITBIS rate (18/16/0%) as a small muted chip —
  ITBIS math auditable at the register.
- S4: Discount behavior unchanged: admin-only DiscountPanel (ADR-018),
  Descuento total line only. No new discount UI.
- S5: After confirming a cash sale, navigate to the generated factura/receipt
  (not 03-Cobros-Pendientes); CxC stays reachable, never a dead end.
- S6: DraftList kept as recovery path, rendered collapsed by default so the
  screen matches the wireframe's clean state.
- S7: `DraftList.tsx` hardcoded `text-indigo-600 dark:text-indigo-400` maps to
  the `--link` token; no hardcoded palette in POS screens.
- S8: Per protocol, after implementation each board gets JD dual review
  (jd-judge-a/b) before the next board starts.

## Specs — Board 03 Cobros (owner: "Go with recommendations", 2026-11-18)

- S9: Wireframe roles win — `Cobrador` joins `ROLES_COBROS`
  (Administrador, Operador, Cobrador); Despachador stays denied (R-C6);
  `ROLES_REEMBOLSO` stays Administrador-only.
- S10: Board shows client NAME and Días (days outstanding) per row.
- S11: KPI strip: Total pendiente / Facturas pendientes / En mora — computed
  from the canonical saldo query globally (not page-scoped); mora = ≥1 full
  SD day (code's fiscal truth); the wireframe's ">30 días" label is dropped.
- S12: Search by client (or invoice) + "Próximas a vencer" panel
  (Próxima / Vence hoy / Vencida badges). Estado dropdown rejected.
- S13: New per-invoice detail route `/cobros/factura/[id]`: NCF, cliente
  name, RNC, tipo, vence, saldo, días vencida, Historial de Pagos,
  Registrar Pago form; nav from the board's Cobrar button; Volver.
- S14: Payment form gains editable Fecha del pago (server-validated band
  against the SD clock, reuse the venta fecha-venta pattern) and optional
  Referencia; método stays frozen EFECTIVO (V1).
- S15: Confirm-payment becomes an explicit modal (F0 dialog) before
  registrarCobro; amount entry via the shared NumericKeypad (touch-first,
  board-02 S2 precedent).
- S16: Full cobros UI retrofits to F0 tokens/primitives (C1) as part of
  this board; no raw palette or `dark:` overrides remain in cobros UI.

## Tasks

- T1 (S1, security) code+test — Add `Despachador` to `ROLES_VENTA`
  (venta/http/shared.ts) + authorization test proving Despachador allowed,
  outside roles still denied. Own commit.
- T2 (S2) code+test — Quick-amounts row for exact payment in money entry.
- T3 (S3) code+test — Per-line ITBIS chip in CartTable.
- T4 (S5) code+test — After confirm: navigate to receipt route.
- T5 (S6,S7) code — DraftList collapsed by default + `--link` token fix.
- T6 (S8) verify — JD dual review of the board's diff.

## Log

- L1 (user, verbatim): "continue the UI/UX work — standing order in memory"
- L2: Standing order 2026-11-18 governs this work (memory
  `systemfact/uiux-standing-order`); protocol: system.md sync → per-board
  report → owner approval → implement → test → JD → next board.
- L3: BOARD REPORT 02-Venta-Contado delivered; owner approved:
  "Follow the rules and roles from the wireframe. Go with recommendations"
  → S1–S7 above. Branch: feature/uiux-board-02-venta.
- L4: T1 committed (d6b4ab1), T2 committed (1593868) after fixing the gga
  provider timeout (config switched to opencode-go/glm-5.3-flash, owner
  asked to diagnose and fix; memory systemfact/gga-provider-config).
  T3 needed no change (chip already implemented, verified by suite).
- L5: Full unit suite 2628/2628 green before the T4/T5 commit; T4+T5 share
  one commit because the test sweep (venta/confirm/return specs) spans both.
- L6: JD dual review round 1 — Judge A: S5 FAIL (push fired on every confirm,
  unmounting the CREDITO due-date verdict and NCF_UMBRAL_90 banner) + MEDIUM
  (Despachador saw a DevolverButton that ROLES_DEVOLUCION always rejects) +
  2 LOW (toggle hitbox, DraftList zero-discount sentinel duplication).
  Judge B: all PASS + 3 SUGGESTIONs (raw "100" vs "10.00" money string,
  div-in-button hint markup, no no-navigation test on error paths).
  Reconciled: accept A's S5 FAIL + MEDIUM; B's SUGGESTIONs logged as cosmetic
  riders. Remediation: navigate only for CONTADO without ncfWarning; TenantCtx
  gains optional `roles` (deny-by-default); puedeDevolver threaded page→POS→
  DraftList. Tests: CREDITO/ncfWarning no-route + hidden-return-button added.
  Suite 2631/2631 green, tsc + eslint clean. Scoped re-judgment of S5 + the
  MEDIUM pending after the remediation commit.
- L7: Remediation commit 8ce76d8 passed gga after two blocked rounds taught
  two extra pre-existing fixes (frozen DESCUENTO_TIPO enum instead of raw
  "MONTO" strings; EDICION_DESCUENTO_NO_DISPONIBLE promoted into the frozen
  venta catalog as code #29, exhaustively censused). JD round 2 (judge A):
  S5 PASS, return gate PASS, no CRITICAL. One test-hardening rider applied
  (positive control for the hidden-return assertion). Cosmetic riders carried
  to future touches: DraftList zero-discount sentinel duplication, PosScreen
  nested ternary, stale-warnings state, quick-amount raw "100" money string,
  div-in-button hint markup, cancel single-flight guard, FacturaPrintScreen
  hardcoded palette (own board).
- T7 (S9, security) code+test — Cobrador joins ROLES_COBROS + matrix test.
- T8 (S10,S11,S12,S16) code+test — board retrofit: names, días, KPI strip,
  search, Próximas a vencer, F0 primitives on CxcBoardScreen.
- T9 (S13) code+test — per-invoice detail route with payment history.
- T10 (S14,S15) code+test — modal confirm + keypad + payment date band + referencia.
- T11 (S8) verify — JD dual review of the board 03 diff.

## Specs — Board 04 Inventario (owner: "go with recommendations" pattern, resume 2026-11-19)

- S17: B1 — Operador KEEPS access to Inventario-Consulta (server role matrix
  unchanged for consulta); adjust action stays role-gated per the Etiqueta
  card (roles that see the adjust screen).
- S18: B2 — availability column copy is "Disponible" per the wireframe.
- S19: B3 — each row gains a ⋯ menu: "Ajustar" (prefills the adjust form with
  the product) and "Historial" (opens movement history filtered to that
  product).
- S20: B4 — adjust quantity label reads "Cantidad a ajustar".
- S21: B5 — quantity entry in the adjust form uses the NumericKeypad
  (touch-first, board-02 S2 precedent).
- S22: B6 — motivo is validated server-side against the frozen enum; the
  client offers exactly the enum options.
- S23: B7 — top-right "+ Ajustar" CTA opens the adjust form.
- S24: C1 — full inventario UI retrofit to F0 tokens/primitives; a new
  `--success` foreground token is added to globals.css; no raw palette or
  `dark:` overrides remain in inventario UI.

## Specs — Board 05 Compras (owner: "go with recommendations", L17)

- S25: Header fields follow wireframe 05a: proveedor + sucursal in the
  header; sucursal stays read-only (D1) — it is assigned by context, never
  edited in the form.
- S26: Nota-fiscal banner (D3) added to the compra form per wireframe 05b:
  informational copy before confirmation — a draft has no NCF yet.
  OWNER DECISION (L21, resolves JD-B-107/JD-A N-2): the banner NCF kind
  follows the SAME source as the Comprobante line (`tipoNcfParaCompra`:
  MERCANCIA→B01, else B11) — single NCF source, the copy can never
  contradict the screen. The retention law figures ("ISR 2%", "100% del
  ITBIS") are fixed informational copy, NOT config-derived (owner-approved,
  JD-A-004); applied rates remain DB parameters on confirm; the Desglose
  carries the dynamic figures.
- S27: Roles per wireframe (D2): the purchases list is view-only for
  Operador/Despachador; write actions remain admin-gated server-side.
  UI hides what the server denies; no new grants.
- S28: NumericKeypad (P1) on Cantidad and Costo unitario entry in the compra
  form — touch-first, same keypad primitive as boards 02–04.
- S29: Full F0 retrofit (F1) of the compras UI (~38 raw-palette sites across
  ComprasScreen, CompraFormulario, CxpPanel, ConfirmarCancelacionCompra):
  all hardcoded palette colors map to system.md tokens/primitives; no
  hardcoded palette remains in the module.
- S30: Per protocol, after implementation the board 05 diff gets JD dual
  review (jd-judge-a/b) before board 06 starts.

## Specs — Board 06 Caja (owner: "go with recommendations", 2026-11-20)

- S31: F1 — full caja UI retrofit to F0 tokens (23 raw-palette sites across
  CajaScreen.tsx and the route page); negative Diferencia uses text-danger;
  guarded by a source-level no-raw-palette test.
- S32: D2 restyle — "Cerrar caja" stays disabled with the Próximamente hint
  (the close is a DERIVED report, never stored; ERD eliminated CIERRE_CAJA);
  "Exportar PDF" stays the outlined token action. [wireframe] DRIFT TAG
  (JD-B-004): the wireframe draws BOTH actions dark bottom-right with
  Exportar-PDF-first; kept outlined/disabled and Cerrar-first per the owner
  D2 decision (L23).
- S33: D1 kept beyond-wireframe — NO date control on either board; the day
  is server-derived in America/Santo_Domingo (A manual picker would expose
  derived fiscal balances outside their validity). Wireframe-wins does not
  apply here: the wireframe draws no behavior for a date control.
- S34: Roles — Administrador-only per the Etiqueta cards, unchanged (server
  gate already deny-by-default); audit found zero security/tenancy gaps.
- S35: Per protocol, the board 06 diff gets JD dual review (jd-judge-a/b).

## Tasks — Board 06

- T21 (S31,S32) code+test — F0 retrofit + token pins in caja-board06.spec.
- T22 (S33,S34) verify — no-date-control pin + role audit (no code change).
- T23 (S35) verify — JD dual review of the board 06 diff.

## Tasks — Board 05

- T16 (S27) code+test — view-only list for Operador/Despachador + admin
  write-action gating (server-side check unchanged).
- T17 (S26) code+test — nota-fiscal banner in CompraFormulario (05b copy).
- T18 (S28) code+test — NumericKeypad on Cantidad and Costo unitario.
- T19 (S29) code+test — F0 retrofit of the whole compras module UI.
- T20 (S30) verify — JD dual review of the board 05 diff.

## Tasks — Board 04

- T12 (S18,S19,S20,S23) code+test — Inventario-Consulta board: Disponible
  copy, row ⋯ menu (ajustar-prefill + history filter), label, +Ajustar CTA.
- T13 (S21,S22) code+test — Ajuste form: NumericKeypad quantities + motivo
  enum options client-side and server-side validation.
- T14 (S24) code+test — F0 retrofit of inventario UI + --success foreground
  token in globals.css.
- T15 (S8) verify — JD dual review of the board 04 diff.

- L8: BOARD REPORT 03 delivered (B1–B8 + C1–C2); owner: "Go with
  recommendations" → S9–S16. B1 resolved wireframe-wins per the board-02
  precedent; B6 approved with the server-banded date.
- L9: T7–T10 landed (518d463, d9b709d, 557d251, 46ec732 migration-only,
  a2a3d00). Suite 2713/2713. Note: KPI strip is search-scoped while a filter
  is active (flagged to owner, no objection received).
- L10: JD round 1 (A + B): S9 flagged for a stale local ROLES_COBROS copy in
  cobros-autorizacion.integration.test.ts; A's MEDIUMs (modal close during
  in-flight confirm; fecha-cobro horizon config read unconditionally) and
  B's SUGGESTIONs reconciled. Remediation (in flight): close guard, lazy
  horizon read, history take cap 100, strict /^\d+$/ id parse, real
  constants imported + Cobrador-allowed integration case added. Cosmetic
  riders logged: client-clock default payment date, statement fetch
  company-wide (R-C7 documented), errors.ts header count drift,
  Totales.tsx mixed copy. Integration-lane pins for CI: Cobrador grant,
  fecha band on real Postgres, migration apply + 81-char rejection,
  saldo parity incl. REEMBOLSO/REVERTIDO, literal %/_ search, tenant-B
  isolation.
- L11: Board 04 (Inventario Consulta + Ajuste) BOARD REPORT was delivered
  2026-11-18 before the session pause; owner's "go with recommendations"
  pattern resolves B1 (keep Operador on consulta) and the offered defaults
  B2–B7 + C1 → S17–S24. Board 04 implementation starts 2026-11-19.
- L12: T12–T14 landed: 3f9b2aa (S19 row ⋯ menu + prefill + history filter),
  ec27c2f (S20–S22 label + keypad + frozen MOTIVOS_AJUSTE enum, zod + domain,
  validated before composition; observaciones rides separately and the use
  case composes "Motivo: detalle" preserving the stored shape), 636337c (the
  F0 retrofit commit plus the puedeAjustar-forwarding integration fix gga
  caught: the page never passed the prop, so the menu would never render).
  S18/S23 verified as already matching the wireframe (Disponible copy, top-
  right +Ajustar CTA) — no change. gga riders fixed: stale idempotency header
  comment, MenuFila relatedTarget blur guard, stale "Administrador/Operador"
  action comment, errors.ts count "seven"→"eight". Suite 240/240 inventario,
  tsc + eslint clean. Note: purchase/sale flows keep their own free-text
  motivos — the frozen enum is manual-adjustment-only (S22 scope).
  Cosmetic riders logged: componerValor cross-module import (venta/ui/carro),
  ESTADOS literal duplicating StockKpi values in the consulta page, the
  permission flag named puedeAjustar also gating history, MENSAJE_STOCK_MAXIMO
  hardcoded number, select-value casts in the two screens.
- L13: JD round 1 (A + B): S17–S24 verified PASS by both judges; 2 HIGH
  (integration lanes still on free-text motivos — 4 suites; e2e ajuste spec
  still on the old "Nueva cantidad" label), 1 MEDIUM each (A: Historial
  contains matches other products; B: ⋯ menu clipped by the overflow-x-auto
  table wrapper) and LOWs. Remediation commit 7b75801: enum motivos in the 4
  integration suites, e2e label migrated, NEW exact productoCodigo history
  filter (zod + repository precedence over the free-text contains; page
  wiring + pin in follow-up 3d9985f after JD-B flagged the uncommitted
  page edit), portal-rendered fixed-position menu with Escape/outside-press
  close and "Ajustar" copy, keypad '.'-on-empty becomes "0.", new
  consulta-page.spec.tsx pinning the puedeAjustar forwarding, tautology test
  fixed. Verified locally: unit 245/245, tsc + eslint clean, integration
  ajustar-stock 8/8 + concurrency/tenant-isolation/entrada-compra 12/12 on
  the real DB. E2E lane NOT run locally (no provisioned env); its fixes are
  deterministic replaces. gga PASSED, Risk: none. Riders carried:
  componerValor in venta/ui/carro (consider shared/ui), ESTADOS literal,
  permission flag named puedeAjustar also gating history,
  MENSAJE_STOCK_MAXIMO hardcoded number, MOTIVO_NO_VALIDO unreachable on the
  HTTP path (defense in depth), version bump owed at PR time.
- L14: JD round 2: judge B verified 6/8 + 2 corroborated riders and flagged
  the uncommitted movimientos page wiring → follow-up 3d9985f (page param +
  page-level pin). Judge A round 2: HIGH-1/HIGH-2 verified; new findings →
  fixes in 2c3e05e: exact "Ajustar" e2e name (the copy change had broken the
  /^Ajustar / regex), menu focus-on-open (keyboard access restored; Escape,
  outside-press and scroll/resize close), clearable "Producto: <code>" chip
  for the sticky exact filter, exact-code pins (repository unit test +
  inventario-movimientos integration test, prefix-safe), no-match prefill
  fixture now non-empty. Verified locally: unit 247/247, tsc + eslint clean,
  integration inventario-movimientos 15/15 on the real DB. JD round 3
  (scoped, final) dispatched on 3d9985f + 2c3e05e. Pre-existing failure
  noted by judge B: devolucion-concurrency.integration.test.ts fails because
  migration 20261118120000_pago_referencia is not applied to the local test
  DB — unrelated to board 04, tracked for the cobros lane.
- L15: JD round 3 (scoped, final — the two re-judgment rounds are spent):
  judge B verified all N1–N7 fixes, no regressions; judge A verified
  N1/N4/N5/N7 and left three residuals, fixed inline in 1642acc (JD budget
  exhausted, deterministic fixes verified by suite): e2e "Ajustar" now
  `exact: true`, menu focus returns to the ⋯ button on every close (pinned),
  and the integration pin's "prefix-safe" overclaim reworded — the
  discriminating exactness assertion is the repository unit pin (toEqual on
  the where clause); a DB-level prefix sibling would need a fixture product
  (rider). BOARD 04 CLOSED: commits 3f9b2aa, ec27c2f, 636337c, 7b75801,
  3d9985f, 2c3e05e, 1642acc. Local verification: unit 248/248, tsc + eslint
  clean, integration ajustar-stock 8/8, concurrency/tenant-isolation/
  entrada-compra 12/12, inventario-movimientos 15/15 on the real DB. NOT run
  locally: E2E (no provisioned env — CI lane will run it), full integration
  sweep, full unit sweep. Riders: componerValor cross-module import,
  ESTADOS literal, puedeAjustar also gating history, MENSAJE_STOCK_MAXIMO
  hardcoded number, MOTIVO_NO_VALIDO unreachable via HTTP (defense in
  depth), chip clear does not update the URL, version bump owed at PR time.
  Next board: 05 Compras.
- L16: v0.38.0 shipped end-to-end 2026-11-19 (PR #253 merged as af7dc36; tag
  + release; prod deploy; Pago.referencia migration applied on production via
  the supabase MCP; prod smoke 10/0/0 after PR #255 fixed the smoke census and
  board-03 markup; demo lane 5/0/0 after PRs #256–#259 aligned the demo/smoke
  helpers to the shipped flows and amended the version-bump guard with the
  browser-lane exemption, bumps 0.38.1/0.38.2). NCF counters by SELECT:
  B01 35/100, B02 141/200, B04 228/300 — every delta accounted for. Real
  product bugs fixed by the lanes: server-side buttonVariants() RSC crash,
  payment-modal Confirm unreachable on short viewports. Patches tagged
  v0.38.1/v0.38.2 (test-only, no redeploy).
- L17 (owner, 2026-11-19): "go with recommendations" resolves the BOARD
  REPORT 05 items: D1 sucursal stays read-only, D2 view-only list keeps
  Operador/Despachador, D3 nota-fiscal banner added, F1 F0 retrofit, P1
  NumericKeypad on quantity/cost. Board 05 implementation is the first task
  of the next session (S25+ to be written at that time).
- L18: Board 05 (Compras) implemented: S25–S29 landed in one work unit —
  nota-fiscal banner (compra-nota-fiscal, B01/B11 kind + Art. 106/339 CT
  copy, warn token styling), NumericKeypad on Cantidad (3 dec) and Costo
  unitario (2 dec) focus-activated per line, full F0 retrofit of
  ComprasScreen/CompraFormulario/CxpPanel/ConfirmarCancelacionCompra/
  compra-form-utils/page.tsx (59 raw-palette sites → tokens, all dark:
  variants dropped). S27 verified already satisfied by the capability gate
  (puedeGestionar hides Acciones column + manage controls) — existing
  compras-ui/compras-page pins cover it; no code change. New
  compra-board05.spec.tsx (5 tests: banner B01 copy, keypad qty + cost
  typing/CLR, source-level no-raw-palette guard over the 5 UI files).
  compra README gained a UI (board 05) section. Verification: compra UI+HTTP
  suites 96/96, full unit sweep 2746/2746, tsc + eslint clean. Keypad rule:
  quantity default "1" / empty cost behave as the keypad base (first digit
  replaces), lone "." → "0.", BSP/CLR delete; componerValor reused from
  venta/ui/carro. JD dual review (T20) pending.
- L19: JD round 1 (board 05, commit 64bf370): judge A 5 MEDIUM + 6 LOW, judge
  B 1 HIGH + 4 LOW. Consolidated remediation: JD-B-101/A-010 keypad base
  snapshot at focus (first tap REPLACES the focused-at value — stored draft
  can never be silently extended; later taps append); JD-A-001 "." on the
  untouched quantity now yields "0." (both fields); JD-A-002 "Ver detalle"
  rendered for every read role (Acciones column always present; Editar/
  Confirmar/Recibir/Cancelar stay puedeGestionar-gated; view-only tests
  updated in compras-ui/compras-page); JD-A-003 banner kind from the
  SUPPLIER class (esInformal → B11, aligned with Desglose); JD-A-004
  retention figures recorded as owner-approved static copy (S26 exception
  + README); JD-A-005/B-102 tautology fixed (real B11 assertions via
  informal supplier + back-to-B01 switch test); JD-A-006/B-104 banner
  ring-1 ring-warn; JD-A-007 role="note"; JD-A-008/B-105 keypad closes on
  focus of supplier/fecha/tipo/product-search; JD-A-009/B-103 guard
  broadened (extra palette families, arbitrary hex, page.tsx included);
  JD-A-011 log keypad note corrected here. Verified: compra module
  215/215, tsc + eslint clean. JD round 2 re-judgment pending.
- L20: JD round 2 re-judgment: both judges verified all 4 JD-B + 7 JD-A
  fixes but found the remediation itself defective — JD-B-106/A-010-N1
  (HIGH): value-equality base re-created itself (fresh "1" + taps 1,2 →
  "2"; draft "5" + taps 5,0 → "0"). Root cause: the untouched flag was
  compared by value instead of consumed once. Fix: pristinoRef consumed
  SYNCHRONOUSLY by the first tap (or any keyboard change) — ref, not render
  closure, so batched taps chain correctly. New pins: 1,0→10; 1,.→1.5 (cost);
  draft 5,0→50; keyboard-then-tap appends. JD-B-107/109/N-6 (dual NCF
  source + page-1 supplier dependency): banner reverted to the wireframe
  05b STATIC copy verbatim (the option JD-A-003 originally offered); one
  NCF source = the Comprobante line; dynamic figures stay in the per-line
  amounts and Desglose. The static copy is exactly what L17 D3 approved
  ("static copy from wireframe 05b") — N-3 owner-evidence resolved by that
  approval; S26 exception note updated. JD-A-008/N-4: keypad also closes on
  focus of the receive checkbox, Agregar producto and Quitar buttons.
  JD-B-108/N-5 pins: role="note", ring-1 ring-warn asserted. Verified:
  compra module 218/218, tsc + eslint clean. JD round 3 (scoped, final)
  dispatched on the round-2 fix commit.
  Full unit sweep after the round-2 fix: 2754/2754 green (245 suites).
- L21: JD round 3 (scoped, final): N-1 (HIGH keypad) VERIFIED FIXED via
  dynamic simulation (9 scenarios, batched+unbatched); N-4 code fixed (pin
  added); N-5 verified; N-2 corroborated (static banner vs dynamic
  Comprobante line) and N-3 corroborated (stale S26/README). JD budget
  exhausted → deterministic fixes verified by suite. Owner decided the N-2
  wording ("professional, recent, practical, safe and security option"):
  banner NCF kind DYNAMIC from tipoNcfParaCompra (same source as the
  Comprobante line — B01 for MERCANCIA, B11 otherwise); retention law
  figures stay fixed informational copy (owner-approved). S26 + README
  rewritten to match; contradiction test replaced by same-source test
  (type change flips banner AND comprobante in lockstep); checkbox-close
  pin added. BOARD 05 CLOSED pending final suite run: compra module
  219 tests. Commits: 64bf370, e3d8307, a45c634, + this fix. Riders:
  componerValor → shared/ui (gga advisory), keyboard "05" composition
  pre-existing venta behavior (informational).
- L22: v0.39.0 shipped end-to-end 2026-11-20 (PR #260 squash-merged as
  b7c19e9; tag + GitHub Release; Vercel prod deploy — new Vercel CLI
  promotes directly, "already the current production deployment" 409
  confirmed it; no migration needed, UI-only). CI gate 9/9 after two real
  fixes: e2e/compras view-only expectation updated to the shipped S27
  markup (Acciones column with only Ver detalle), and effect ReDoS
  GHSA-7589-6fvf-x4pw lifted via 'effect@3': '>=3.22.1 <4' override
  (patch-level floor with major selector — a bare floor dragged effect@4
  and broke @prisma/config; audit + prisma validate re-verified, upstream
  note in PR comment). Prod smoke 10/0/0 (51s). Demo lane 5/0/0 (1.9m).
  NCF counters by SELECT: B01 36/100, B02 142/200, B04 229/300 — every
  delta +1 accounted. Local integration lane remains down (sf-postgres
  stack not running) — pre-existing env rider, CI lane is authoritative.
  Riders for later: componerValor → shared/ui, draft fecha not persisted,
  chip-clear URL sync, banner rates static (config could drift), local
  integration stack restart.
- L23: BOARD REPORT 06 (Caja) delivered with the check/recheck/evaluate/audit
  pass; owner "go with recommendations" pre-approved. Module already matches
  the wireframes closely — all labels/copy verbatim matches pinned by
  existing tests. Recommendations: D1 kept today-only (no date control, S33);
  D2 behavior kept (Cerrar caja disabled/derived, Exportar PDF outlined);
  F1 retrofit of 23 raw-palette sites → tokens (CajaScreen + route page);
  no keypad (no amount entry); role audit clean (server-side
  Administrador-only gate, deny-by-default). Implemented: S31–S34, new
  caja-board06.spec.tsx (5 tests: no-raw-palette guard incl. page.tsx +
  arbitrary hex, text-danger negative Diferencia pin, disabled Cerrar caja +
  hint, outlined Exportar PDF token classes, no date input); caja-screen
  spec migrated text-red → text-danger. Caja suites 162/162, tsc + eslint
  clean. JD dual review (T23) pending.
- L24: JD round 1 (board 06, commit 15da26d): judge A 1 HIGH + 1 MEDIUM +
  LOWs; judge B 1 WARNING + SUGGESTIONs. Consolidated remediation: the
  negative-Diferencia class appended text-danger to a string containing
  text-ink — same-specificity conflict, text-ink wins in the compiled CSS
  (verified by the judge compiling the project's Tailwind), so the value
  rendered ink; fixed with a dedicated constant without text-ink, pinned
  token-exactly (must NOT include text-ink). Dead arbitrary-hex guard fixed
  ([^\]] inside a regex literal requires ]]); palette class stops at
  whitespace; substring assertions → token-exact matching; typed fixtures
  without double casts; scope=col + aria-describedby on the disabled
  button; disabled contrast adopts the compras recipe; S32 [wireframe]
  drift tag recorded (both-actions-dark, Exportar-PDF-first kept per
  owner D2). Verified: caja 162/162, tsc + eslint clean; regex negative
  check: hex and palette guards both fire. JD round 2 re-judgment
  dispatched on the remediation commit.
- L25: JD round 2: judge B PASS (all 4 verified with direct evidence); judge
  A PASS (all 6 round-1 findings verified, compile check confirms
  text-danger now the only colour rule on the negative Diferencia).
  Deterministic round-2 residuals fixed inline: N1 hex guard widened to
  rgb/hsl/oklch; N2 disabled button adopts the full compras recipe
  (min-h-11 + border-line + text-ink + opacity-40); N3 redundant cast
  removed; N4 CLASE_KPI_VALOR_NEGATIVO derived from the base constant so it
  cannot drift. Verified: caja 162/162, tsc + eslint clean.
  BOARD 06 CLOSED: commits 15da26d, 921c75b, 983d6cd, + this fix. Next:
  board 07 Reportes.
- L26: v0.40.0 shipped end-to-end 2026-11-20 (PR #261 squash-merged as
  c05f0f3; tag + GitHub Release; Vercel prod deploy; no migration,
  UI-only). CI: one infra flake — the workflow_dispatch run I raced against
  the auto-trigger collided on the local Supabase port 54322; rerun of the
  failed E2E job went green (rider: add a concurrency group to ci.yml).
  One merge conflict in the three version files + the feature doc
  (master's squash rewrote them); resolved with the branch's versions.
  Prod smoke 10/0/0 (36.2s). NO demo lane: board 06 touches only the
  read-only Caja view (no sales/payments/returns/login surface). BOARD 06
  shipped. Next: BOARD REPORT 07 pending owner approval (explorer map
  already gathered in session context).
## Specs — Board 07 Reportes (owner: "Go", 2026-11-20, recommendations pre-approved)

- S36: D1 — the 07a table adopts the wireframe's nine columns (Producto |
  P. costo | P. salida | Cant. vendida | Cant. comprada | Ventas | Costo |
  Margen | Margen %); Inversión/Capital move to the KPI tiles. New domain
  field `costo` (the same term the margen subtracts — one definition, no
  re-derivation) on RentabilidadFila + resumirRentabilidad; CSV contract
  unchanged.
- S37: D2 — 07a KPIs render as the wireframe's five tiles (Inversión,
  Entrada (unid.), Salida (unid.), Capital en mercancía, Margen de ganancia
  + %) from the page-independent summary (EXP-2).
- S38: D3 — 07b renders PER-PERIOD rows (Período actual / Período anterior)
  with Variación (RD$) and Variación (%) columns + TOTAL row (current +
  variación, the FIN-5 convention); the per-day detail stays in the CSV.
- S39: D4/D5 — 07b gets the four wireframe KPI tiles; per-board footer
  strips ("Filtrado por período y sucursal" / "Filtrado por empresa y
  sucursal activa"). D5 kept: single Exportar CSV link (the DGII split
  menu belongs to the fiscal family) — [wireframe] drift tag. D6 kept:
  no Empresa filter (one empresa per tenant) — [beyond-wireframe].
- S40: F1 — F0 retrofit of 31 raw-palette lines across rentabilidad-panel,
  financiero-panel, report-selector and the route page; guarded by a
  source-level no-raw-palette test (rgb/hsl/oklch included). Panels stay
  pure server components; the selector keeps its client island.
- S41: Per protocol, the board 07 diff gets JD dual review.

## Tasks — Board 07

- T24 (S36,S37) code+test — domain costo field + 07a columns/tiles.
- T25 (S38,S39) code+test — 07b per-period table + tiles + strips.
- T26 (S40) code+test — F0 retrofit + guard.
- T27 (S41) verify — JD dual review of the board 07 diff.

## Tasks — Board 06
