# Proposal: F2 — Venta/POS refinement (contado + crédito)

## Change ID: f2-venta-pos

**Phase**: sdd-propose | **Store**: hybrid (file + Engram `sdd/f2-venta-pos/proposal`) | **Date**: 2026-10-14 | **Base**: master f2e7bf2 (v0.16.1)
**Delivery strategy (session ratification)**: single PR with staged commit slices; size:exception requires explicit owner acceptance at apply time (see Review-budget forecast).

## Intent

The venta backend is complete and fiscal-solid (fase-5b/5c): draft lifecycle, confirm with NCF/stock/credit gates, CONTADO close-the-loop COBRO, confirmed-cancel with 608 annulment, structured discount (ADR-018). The POS UI, however, is a pre-F0 orphan: raw `zinc-*`/`indigo-*` classes, unstyled native `<input>`/`<select>`, sub-44px touch targets, no credit-sale mode surfaced, no vuelto, no anulación modal, no per-line discount UI, no numeric keypad. F2 closes that gap WITHOUT rebuilding any backend domain logic — it is a UI refinement + credit-mode slice + one small backend read/output touch on a verified-green backend (per the explore report `openspec/changes/f2-venta-pos/explore.md`).

## What Changes

Owner decisions resolved as recommendations (each requires explicit owner ratification before/during apply — NOT auto-ratified):

| # | Decision | Recommendation | Rationale | Ratification |
|---|----------|----------------|-----------|--------------|
| 1 | Anulación modal for CONFIRMADA rows | Minimal admin-only Dialog with mandatory `motivo`; calls existing `cancelarVentaAction({id, motivo})` which already routes both paths (R-V4 draft cancel / R-V16 confirmed-cancel with FACTURA annulment + payment revert). | Pure UI-only; backend verified. Without it, the only path to Anulada (608-required) is invisible in the POS. | ⚠️ OWNER RATIFICATION REQUIRED |
| 2 | Vuelto | Display-only client-side calc (`moneyReceived − Total`), explicitly labeled non-authoritative. Partial cash tender at POS is NOT supported (contado COBRO is always full-total server-side) — deferred to F3/cobros if ever needed. | No backend field exists; inventing a tender use case is a backend change out of scope. Label prevents the cashier treating rounding as authoritative. | ⚠️ OWNER RATIFICATION REQUIRED |
| 3 | Payment form derivation | CONFIRM the intended backend shape: contado/crédito is DERIVED from the client credit profile (`perfil.esVentaCredito`); NO sale-time `creditoToSelector` toggle. Any explicit toggle is a backend change — out of F2 scope unless the owner overrides. | Credit gate and COBRO derivation already work this way; a toggle would duplicate payment-form logic contradicting `credit-control` R-K2. | ⚠️ OWNER RATIFICATION REQUIRED |
| 4 | Credit-profile display source | Extend `listarClientesAction` lectura DTO with `creditoHabilitado` / `limiteCredito` / `plazoCreditoDias`. Small, tenant-scoped, no cross-module ORM leak; no new dedicated action (YAGNI). | UI cannot show limite/plazo/pending context otherwise; `ClienteSelector` currently renders zero credit profile. | ⚠️ OWNER RATIFICATION REQUIRED |
| 5 | Confirm output gap | One backend touch (with its test): `ConfirmarVentaOutput` MAY additionally expose the credit verdict (`forma: 'CONTADO' | 'CREDITO'` and, when CREDITO, the derived due date term). | Lets the UI give post-confirm feedback distinguishing contado-settled vs open-receivable WITHOUT touching domain state; complements the derived-due-date rule (ADR-017; display uses `fechaEmision + plazoCreditoDias`). | ⚠️ OWNER RATIFICATION REQUIRED |

## Capabilities

> CONTRACT with sdd-spec. Existing capability names verified in `openspec/specs/`.

### New Capabilities

None — all behavior lands under existing capabilities. (Explicitly "None" per contract.)

### Modified Capabilities

- `venta`: (a) POS UI acceptance requirements extended beyond R-V14 — F0 token/primitive migration, touch-floor hitboxes, numeric keypad seam, vuelto panel, per-line discount UI wiring (server-authoritative DESC_MAX per R-V8 preserved), contado/crédito indicator + derived due-date display, credit gate error rendering (CLIENTE_EN_MORA / LIMITE_CREDITO_EXCEDIDO / CREDITO_NO_HABILITADO distinct surfaces), admin anulación Dialog with mandatory motivo for CONFIRMADA rows; (b) `ConfirmarVentaOutput` MAY expose credit-form verdict/term terms (display-only; no state change — R-V15 semantics untouched).
- `cliente`: `listarClientesAction` (lectura) DTO extended with credit-profile fields (`creditoHabilitado`, `limiteCredito`, `plazoCreditoDias`), tenant-scoped, Decimal money representation, still no credential exposure (ADR-014 rule untouched).

## Scope

### In Scope

1. POS surface restyle to F0 tokens + shadcn primitives (`PosScreen`, `CartTable`, `ClienteSelector`, `Totales`, `DiscountPanel`, `DraftList`) with ≥44px (48px high-frequency) touch floors and 8px spacing rhythm.
2. Credit surfaces: credit-profile DTO extension + display in ClienteSelector, derived contado/crédito indicator, derived due-date display (no venta field added), distinct credit-gate error surfacing.
3. Per-line discount UI wiring in `carro.ts`/`CartTable` respecting ADR-018 (discount before ITBIS) and the server DESC_MAX pipe.
4. Vuelto panel: money-received input → display-only calc, non-authoritative label.
5. Numeric keypad shared client component for quantity entry (48px targets) — the ONE new shared component; its visual design comes from the pending Penpot board.
6. Anulación Dialog (admin, mandatory motivo, CONFIRMADA rows in DraftList).
7. E2E hygiene: extract shared `e2e/utils` login + precondition helpers (explore Area 6 found 3 duplicate copies); extend `confirm-venta.spec.ts` with credit-path coverage.
8. One small backend touch: `ConfirmarVentaOutput` credit-form exposure + its unit test.

### Out of Scope (explicit non-goals)

- NO backend domain/use-case rewrite — fase-5b/5c logic is frozen for this change.
- NO sale-time `creditoToSelector` toggle (backend change, needs owner override).
- NO CxC module changes — due date stays DERIVED (ADR-017); no receivable persistence touched.
- NO partial cash tender at POS (deferred to F3/cobros if ever ratified).
- NO new vendored UI primitives beyond the keypad client component; no Toast/command-palette speculative work (banners stay Card+Badge composition).
- Keypad/board-agnostic visual polish: layout fidelity awaits `02-Venta-Credito` board (see Dependencies) — spec stays layout-agnostic like fase-5b.
- No credit profile editing in the POS (that is `cliente` CRUD, already specced).

## Approach

Single-PR staged work with commit slices A→E, each a coherent, independently verifiable unit (conventional commits; one work unit per commit per AGENTS.md):

| Slice | Content | Gate command (per-slice) | Review note |
|-------|---------|--------------------------|-------------|
| **A** | Restyle `PosScreen` + `CartTable` + `ClienteSelector` + `Totales` + `DiscountPanel` + `DraftList` to F0 semantic tokens and F0 primitives (Button `pos` size, Input, Select, Card, Dialog, Badge); 44/48px touch floor; 8px rhythm. Penpot-gated visual finish. | `pnpm test venta-ui` (unidad RTL) + lint + typecheck | Largest diff slice; restyle-only, no logic change — E2E green proves nothing broke. |
| **B** | Credit surfaces: extend `listarClientesAction` DTO (rec #4), ClienteSelector profile display + derived indicator + due-date display, credit-gate error rendering, OPTIONAL backend touch `ConfirmarVentaOutput.credito` (rec #5, + test). | venta unit tests (`confirm-ui.spec.tsx`, `venta-service.test.ts`, cliente lectura tests) + lint + typecheck | Backend touch is small and additive; no R-V15 semantics change. |
| **C** | Per-line discount UI: wire `VentaLineaInput.descuento` through `carro.ts` (pure, immutable) + CartTable inputs, admin-gated, client shows preview only — server `preparar-lineas-venta` DESC_MAX pipe stays authoritative (R-V8). | `carro.ts` unit tests + venta domain calculators tests | Touches the pure cart model — highest logic risk slice; tests pin the DESCUENTO_CERO → user-supplied transition. |
| **D** | Vuelto panel (rec #2, display-only) + numeric keypad shared component (48px targets). Visual-heavy → board-gated polish acceptable behind board landing. | venta-ui unit tests (`Totales`, keypad) | New one client component only. |
| **E** | Anulación Dialog (rec #1) + extract `e2e/utils` helpers + update/extend `confirm-venta.spec.ts` credit-path E2E. | `pnpm e2e` (confirm-venta, cobros, devolucion, selector-sucursal) | E2E utility extraction is the riskless cleanup; the four existing specs must be green before and after to prove non-regression. |

Backend touch (slice B) follows module boundaries: lectura action change in `cliente/http`, output change in `venta/http/venta-action` mapping layer only — zero domain imports cross; both via `actions.lectura` split + Zod validations, `EmpresaId` scoped, no `any`, Decimal strings for money.

All work-in-PR is `ask-on-risk`: the executor MUST NOT start oversized slices without the owner having answered the Review-budget forecast below at apply time.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/app/(app)/venta/ui/PosScreen.tsx` | Modified | Token/primitive migration + credit indicator + vuelto wiring + anulación Dialog composition (slices A, B, D). |
| `app/src/app/(app)/venta/ui/CartTable.tsx` | Modified | Touch floor + per-line discount inputs + column alignment (slices A, C). |
| `app/src/app/(app)/venta/ui/carro.ts` | Modified | Per-line `descuento` in cart model + preview wiring (slice C). |
| `app/src/app/(app)/venta/ui/ClienteSelector.tsx` | Modified | Credit-profile display, derived indicator, mandatory-client emphasis (slices A, B). |
| `app/src/app/(app)/venta/ui/Totales.tsx` | Modified | Vuelto panel + keypad mount point (slice D). |
| `app/src/app/(app)/venta/ui/DraftList.tsx` | Modified | CONFIRMADA anulación Dialog gate (slice E). |
| `app/src/components/ui/` (shared) | Modified | New numeric-keypad client component ONLY (slice D). |
| `app/src/modules/cliente/http/actions.lectura.ts` | Modified | DTO extension with credit fields (slice B). |
| `app/src/modules/venta/http/actions.escritura.ts` (mapping) | Modified | Optional `ConfirmarVentaOutput.credito` exposure (slice B). |
| `app/e2e/utils/` (new) + existing specs | Modified | Login/precondition helper extraction + credit-path E2E (slice E). |
| `app/src/modules/venta/domain/*`, application/use cases | Untouched | Backend is green; zero domain rewrite (explicit non-goal). |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Single PR exceeds the 800-line review budget (config.yaml `review_budget_lines: 800`) but slices may still total >400-line threshold known from prior session agreement | High | Staged slices A–E with per-slice gate commands; forecast below forces explicit owner `size:exception` at apply time; slices are reorderable/revertible independently. |
| Per-line discount wiring desyncs client cart math from server calculators (R-V5/R-V8) | Medium | Cart model reuses the SAME domain calculators (existing pattern); client preview stays non-authoritative; DESC_MAX cap remains server-enforced; unit tests pin the fixture F2/F4 shapes. |
| Owner decisions 1–4 not ratified before apply | Medium | Proposal marks each ⚠️; apply phase MUST NOT start any ratification-gated slice without the owner's explicit yes; behavior slices (C, E backend bits) pause on ratification; restyle (A) can proceed. |
| Penpot board `02-Venta-Credito` absent → layout drift without a wireframe | Medium | Board-agnostic gate (fase-5b pattern): visual-heavy slices A/D ship structural tokens now, final polish flagged as board-dependent follow-up; board authoring assigned to the owner as a PARALLEL design step. |
| E2E helper extraction breaks 4 existing specs | Low | Extraction is a pure refactor; all 4 specs run before/after; no selector changes to prod code. |
| Credit DTO exposure leaks credit data to non-permitted roles | Low | Lectura action already tenant-scoped + authorization-checked; credit fields are HR-nonsensitive (already Admin-crud); Decimal + no email/credential exposure (ADR-014). |

## Rollback Plan

Per slice: each slice is one standalone commit; `git revert <slice>` restores behavior (no schema migrations in this change, so no data rollback).
- Slice A/D (restyle/vuelto): revert = cosmetic only, no state toggle.
- Slice B (DTO/output): revert DTO fields in BOTH cliente lectura and venta mapping in ONE revert commit if the developer chose them coupled; otherwise revert cliente and venta separately (they are independent features: only the display depends on BOTH simultaneously).
- Slice C (per-line discount): if the cart-model regression escapes, revert the slice; server authority means a sales-order rollback cannot persist overshoot (any overshoot would have hit the server-side DESC_MAX pipe).
- Slices are sequenced A→E so that reverting C keeps D/E coercible (D/E do not touch `carro.ts`).
- Master rollback: single squashed PR; revert the merge commit.

## Dependencies

- **Penpot board `02-Venta-Credito` MISSING** (Engram observation #1086): prerequisite for F2 final polish. The OWNER must author/export the board (cash + credit sale, per docs/17 boards 01/02) as a PARALLEL design step; `design/penpot-frontend-map` is updated when it lands. Until then, F2 spec/design stay layout-agnostic (fase-5b gate pattern).
- Owner ratification of recommendations 1–4 above.
- Explore report `openspec/changes/f2-venta-pos/explore.md` is the sole binding input (read fully).
- Engram `design/penpot-frontend-map` (#1086) — no re-derivation.
- No schema migrations; no new npm runtime deps expected (`carro.ts` reuses the domain calculators and decimal-string helpers already in the codebase — verify before adding anything).

## Success Criteria

- [ ] POS renders exclusively on F0 + systemfact primitives (zero raw `zinc-*`/`indigo-*` classes in the venta module; grep-verified).
- [ ] All interactive venta targets meet ≥44px (48px high-frequency) hitboxes.
- [ ] Credit-bearing client selection shows limiteCredito / plazoCreditoDias / derived indicator + derived due-date; a confirmed CREDITO sale surfaces distinct code-based errors CLIENTE_EN_MORA / LIMITE_CREDITO_EXCEDIDO / CREDITO_NO_HABILITADO in the UI (no raw code string rendering).
- [ ] Per-line discount UI respects ADR-018 (discount before ITBIS) with client preview derived from domain calculators, never escalated beyond `DESC_MAX`, and the server remains authoritative on confirm.
- [ ] Vuelto calc is display-only, subtracts money-received from Total, and is explicitly labeled non-authoritative; no backend tender field is added.
- [ ] Anulación of CONFIRMADA rows requires admin role + mandatory motivo; the draft-cancel path still accepts empty motivo unchanged (R-V4/R-V16 unmodified).
- [ ] `ConfirmarVentaOutput` (if ratified) exposes credit-form verdict with a unit test; no R-V15 confirm-semantics change, no DOMAIN import into UI.
- [ ] E2E uses shared `e2e/utils` login helpers (no third fork of login/page landing logic); `confirm-venta.spec.ts` + `cobros.spec.ts` + `devolucion.spec.ts` + `selector-sucursal.spec.ts` are all green before and after.
- [ ] Zero `any`, zero ESLint violations, zero `prisma.*` imports outside `infrastructure/`, everything tenant-scoped via RLS GUC path.
- [ ] Unit tests pin the `carro.ts` per-line discount fixtures (F2/F4 shapes re-derived from the venta spec) to avoid calculator drift.
- [ ] Review-budget forecast acknowledged; every slice gate green before the next slice starts.

## Review-budget forecast (carried into sdd-tasks)

- **Decision needed before apply**: Yes (per config policy `ask-on-risk`).
- **Chained PRs recommended**: No — session-ratified strategy is ONE PR with internal commit slices.
- **400-line budget risk**: High — explore flagged the full set (restyle of 6 files + credit surfaces + keypad + dialog + e2e extraction) realistically exceeds even the 800-line workspace budget.
- **Owner-required handling**: at apply time the owner MUST explicitly accept `size:exception` (do NOT auto-claim), OR the slices A–E MAY be split into chained PRs PR-1..3 if the owner flips strategy; the proposal pre-declares both paths (slices are self-verifiable and therefore also chain-ready). No slice starts before the owner answers.

## Sequencing Note

Slices B and C are behavior-bearing (credit/discount/rules); they MUST NOT begin before owner ratification of the recommendation table. Slice A (pure restyle) is safe to start immediately against the current board-absent state, and slice D's vuelto/keypad logic likewise (polish is board-gated). This is the same sequencing discipline fase-5b used for its Penpot gate.
