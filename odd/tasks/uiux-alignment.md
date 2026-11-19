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

- L8: BOARD REPORT 03 delivered (B1–B8 + C1–C2); owner: "Go with
  recommendations" → S9–S16. B1 resolved wireframe-wins per the board-02
  precedent; B6 approved with the server-banded date.
