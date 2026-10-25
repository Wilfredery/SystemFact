# Exploration: f2-venta-pos — Fase F2 (Venta/POS refinement, contado + crédito)

**Phase**: sdd-explore | **Store**: hybrid (file `openspec/changes/f2-venta-pos/explore.md` + Engram `sdd/f2-venta-pos/explore`) | **Date**: 2026-10-14 | **Master**: f2e7bf2 (v0.16.1)

## Executive Summary

The venta backend is COMPLETE and fiscal-solid (fase-5b/5c/6): draft lifecycle, confirm with NCF/stock/credit gates, CONTADO close-the-loop COBRO, confirmed-cancel with 608 annulment, structured discount (ADR-018). The POS UI exists but is a pre-F0 orphan: raw `zinc-*`/`indigo-*` classes, unstyled native `<input>`/`<select>`, no F0 primitives, no credit-sale mode, no vuelto. F2 is primarily a UI refinement + credit-mode slice on a stable backend; the only true backend gap is that `confirmarVentaAction` does not surface `credito.forma` / credit terms to the client.

## Area 1 — Venta module ground truth

### Backend (complete, DO NOT rebuild)
- `domain/`: `venta.ts` (estados BORRADOR/CONFIRMADA/CANCELADA frozen; Descuento PORCENTAJE/MONTO; fail-loud `estadoVentaDesdeDb`), `calculators.ts` (round2 half-up, line discount → base → header proration → ITBIS; `VentaLineaFinal` carries FINAL per-line base+ITBIS), `descuentos.ts`, `errors.ts` (19-code catalog), `fecha-venta.ts`, `reposicion-neta.ts`.
- `application/`: `venta-service.ts` (crear/actualizar/cancelar incl. CONFIRMADA→CANCELADA with invoice annulment R-V16 + payment revert v2r-09), `confirmar-venta.ts` (gates: emission → NCF eligibility → HARD stock preview → CREDIT GATE pre-consume → NCF consume → guarded flip → FACTURA → `registrarSalidasVenta` → CONTADO full COBRO), `preparar-lineas-venta.ts` (server-side DESC_MAX/admin pipe), `resolver-cliente-venta.ts` (null → Consumidor Final), `elegibilidad-ncf.ts`, `venta-guardado.ts`.
- `infrastructure/`: `venta-repository.ts`, `config-repository.ts` (DESC_MAX/PLAZO_DEVOLUCION/RETROACTIVO_FECHA_VENTA_DIAS).
- `http/`: split `actions.lectura.ts` (`listarVentasAction`, `obtenerVentaAction`) / `actions.escritura.ts` (`crearVentaAction`, `actualizarVentaAction`, `cancelarVentaAction`, `confirmarVentaAction`) + Zod `validations.ts`.
- Credit support IS in the domain: `cobros/application/credit-port.ts` `evaluarCreditoCliente` returns `{forma:"CONTADO"} | {forma:"CREDITO", permitido, code?, message?}`; rejects CREDITO_NO_HABILITADO / LIMITE_CREDITO_EXCEDIDO / CLIENTE_EN_MORA (>30d). Client credit profile in schema: `creditoHabilitado`, `limiteCredito`, `plazoCreditoDias` (schema.prisma:308-321; DB `PLAZO_CREDITO` fallback param used by reportes aging).

### Gap (backend, small)
- The credit DECISION is made in-tx at confirm but the ACTION's output (`ConfirmarVentaOutput`) does not return whether the sale settled CONTADO or CREDITO (only NCF/estado/totales). The credit rejection DOES surface (typed error codes). Due-date/credit-term is NOT a venta field: receivable due date is DERIVED from `fechaEmision + plazoCreditoDias` on the CxC board (ADR-017). → "créditoToSelector" (a sale-time contado/crédito toggle) does NOT exist; payment form is DERIVED from who the CLIENT is (`perfil.esVentaCredito`). This is a F2 UI-shape constraint, not a backend defect.

## Area 2 — Current POS UI (what the refino touches)

- `app/src/app/(app)/venta/page.tsx` — server shell, passes `esAdmin` only.
- `ui/PosScreen.tsx` (350 lines) — two-column draft orchestrator. English copy, raw Tailwind one-offs (`indigo-600` save button, `zinc-*` panels) → must be migrated to F0 semantic tokens + shadcn primitives. Renders banner (NCF 90%, stock warnings), ClienteSelector, ProductSearch, DiscountPanel (admin), CartTable, Totales, DraftList (BORRADOR+CONFIRMADA rows, confirm single-flight, DevolverButton seam).
- `ui/carro.ts` — pure immutable cart + live preview via the SAME domain calculators; lines preview with `descuento: DESCUENTO_CERO` (per-line discount NOT wired into the cart model).
- `ui/CartTable.tsx` — per-line ITBIS at rate + base ALREADY displayed. NOT yet: per-line discount inputs (domain supports `VentaLineaInput.descuento`); h-8/h-9 targets below the 44/48px touch floor; no numeric keypad.
- `ui/Totales.tsx` — Subtotal/Discount/Gravado/Exento/ITBIS/Total. NOT rendered: vuelto (no cash-received state anywhere in venta), no money-structure with prominent total for tender.
- `ui/DiscountPanel.tsx` — header discount only (admin-gated UI, server authoritatively). Per-line discount UI missing though domain/type carry `descuento` per line.
- `ui/ClienteSelector.tsx` — native `<select>`, inline MINORISTA/MAYORISTA quick-add (CREDITO intentionally excluded). No credit-profile display (limite, plazo, pending), no mandatory-client enforcement for crédit paths.
- Missing UI capabilities vs doc 17 board 02 intent: credit-sale mode indicator (contado/crédito derived from client), credit gate error surfacing (codes already flow), vuelto calc, anulación modal (`cancelarVentaAction` on CONFIRMADA exists; UI's DraftList cancel button does not distinguish motivo for CONFIRMADA/crédito), numeric keypad for quantities (touch rule).

## Area 3 — Credit-sale UI needs

1. Cliente selection contado OPTIONAL (CF default), crédito MANDATORY client — enforced by derivation, not a toggle: choosing a credit-bearing client makes the sale credit. UI must show the client's credit profile (limiteCredito, plazoCreditoDias, current pending) — new read: `listarClientesAction` DTO does not carry credit fields → needs a small lectura action extension or dedicated profile read.
2. Due date: do NOT add a venta field. Display derived `fechaEmision + plazoCreditoDias` (client term else DB `PLAZO_CREDITO`, same rule as reportes/domain/aging.ts FIN-2).
3. Credit gate errors map to existing codes; UI renders CLIENTE_EN_MORA / LIMITE_CREDITO_EXCEDIDO / CREDITO_NO_HABILITADO distinctly (stable-code catalog already relayed through `venta/http/shared.ts`).
4. Anulación modal (608, motivo) for CONFIRMADA rows in DraftList — `cancelarVentaAction({id, motivo?})` already routes both paths (venta-service `cancelarVenta`).

## Area 4 — F0 primitives coverage

Available (`app/src/components/ui`): Button (with `pos` size h-12 — POS-target variant already exists), Input, Label, Select, Card, Dialog, Table, Badge. Shared: `formatearMonto`, `formatearFechaSD`, AuthShell/Sidebar.
Gaps for board 02: (a) numeric keypad component (touch rule) — no primitive exists; (b) Toast/inline-alert primitive — current banners are hand-rolled divs (could stay as Card+Badge composition); (c) CommandPalette-style product search is optional. Verdict: NO new vendored primitives strictly required; keypad is the one candidate for a new shared client component.

## Area 5 — Penpot gap (prerequisite)

Board `02-Venta-Credito` is MISSING in Penpot (per design/penpot-frontend-map #1086); `02-Venta` was evaluated board-agnostic in 5b (README.md "Penpot gate"). Authority: `docs/17-plan_wireframes.md` boards 01/02 = cash AND credit sale. Prerequisite for F2 design: author/export the 02-Venta-Credito board first (client crédito badge + derived due date + credit rejection states). F2 spec must stay layout-agnostic until the board lands, same gate pattern as 5b.

## Area 6 — Tests / E2E

- Unit: `venta/domain/__tests__` (calculators, descuentos, transitions), `application/confirmar-venta.test.ts`, `venta-service.test.ts` (incl. CONFIRMADA cancel matrix), `ui/__tests__/venta-ui.spec.tsx` + `confirm-ui.spec.tsx` (jsdom RTL; mock action DTOs are the contract).
- E2E: `app/e2e/confirm-venta.spec.ts` (login → /venta → cart → draft → confirm → DB assertions; login helper accepts landing routes `/dashboard|/selector-empresa-sucursal`), `devolucion.spec.ts` (reuses login+draft+confirm), `cobros.spec.ts` (login at /venta for the credit-sale seed), `selector-sucursal.spec.ts`. No shared helper module — each spec re-declares its `login(page)` + pg precondition check. F2 should extract `e2e/utils` login/precondition helpers, not fork a third copy.

## Risks / Open questions (max 5, with recommendations)

1. **Anulación modal scope (owner product decision)** — CONFIRMADA cancel = Anulada (fiscal effect, 608). Does F2 need an admin-only anulación with mandatory motivo, or is the current draft-list cancel enough?
   Rec: include a minimal Dialog-based anulación (motivo required, admin gate) in F2 — `cancelarVentaAction` already supports both paths; UI work only.
2. **Vuelto rounding / tender input policy** — no backend field exists; vuelto is display-only (contado COBRO is always the full total server-side). Partial cash at POS is NOT supported today.
   Rec: F2 renders vuelto = montofrom an input minus Total, purely client-side, explicitly labeled non-authoritative; any partial-cash tender needs a new backend use case — defer to F3/cobros, flag as owner decision.
3. **créditoToSelector ambiguity (owner confirmed?)** — payment form is DERIVED from client profile; there is no sale-time contado/crédito selector in the backend. If the owner wants an explicit toggle (cash sale billed to a CREDITO client), that is a backend change.
   Rec: confirm with owner that derivation is intended (docs 17 implies contado=CF/cash-eligible, crédito=credit-bearing client); do NOT build the toggle without a decision.
4. **Credit-profile DTO gap** — UI cannot show limite/plazo/pending without extending `listarClientesAction` or adding a `obtenerPerfilCreditoAction`.
   Rec: extend the cliente lectura action with `creditoHabilitado/limiteCredito/plazoCreditoDias` — small, tenant-scoped, no cross-module ORM leak.
5. **400-line review-budget** — PosScreen + carro + ClienteSelector + CartTable restyle plus credit surfaces and keypad likely exceed one PR.
   Rec: pre-declare chained/stacked slices in tasks (e.g. PR-1 restyle to tokens/primitives; PR-2 credit mode + anulación; PR-3 keypad + vuelto + E2E).

## Ready for Proposal

Yes — backend is verified green; F2 = UI refino + credit surfaces + missing display features, with the 02-Venta-Credito Penpot board flagged as a design prerequisite and risks 1–3 as owner decisions to resolve in specify/design.