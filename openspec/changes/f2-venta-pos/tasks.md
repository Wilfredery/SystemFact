# Tasks: f2-venta-pos (F2 — Venta/POS refinement, contado + crédito)

SDD phase: tasks. Binding inputs: `openspec/changes/f2-venta-pos/design.md` (D1–D9, primary) + `specs/venta/spec.md` (R-V18..R-V26) + `specs/cliente/spec.md` (R-V27) + `proposal.md` (slices A–E, decisions #1–#5 OWNER-RATIFIED) + Engram `sdd/f2-venta-pos/*`. All code paths below verified against master `f2e7bf2` (v0.16.1).

**Delivery**: SINGLE PR (session-ratified). Branch `feature/f2-venta-pos` off current `master` f2e7bf2. Commits = slices A–E in order + final version-bump commit. **Final commit is version bump ONLY** (`app/package.json` 0.16.1 → **0.17.0** MINOR — `feat` change, pre-1.0; `.release-please-manifest.json` (`"app": "0.17.0"`); `app/CHANGELOG.md` new `## [0.17.0]` section). The apply report MUST end with the literal line `bump validated: 0.17.0`.

Global constraints (every task):

- **Board-agnostic**: Penpot board `02-Venta-Credito` is pending — structural F0 tokens/primitives only; no layout/visual “polish” beyond D9's token map. No flow change, no action-call change, no `data-testid`/`aria-label` changes in slice A — the four E2E specs are the non-regression gate (R-V18).
- **No contado/crédito toggle anywhere** (R-V19 scenario 2; derivation only by D6). Cards/transferencia excluded (docs/11 V1). Banners stay Card+Badge composition — NO Toast/CommandPalette/inline-alert primitives (numeric-keypad.tsx is the ONLY new shared component, D4).
- **fase-5b/5c backend freeze**: the ONLY backend delta is D7's additive `ConfirmarVentaOutput.credito` chain (+ the one-column `select` extension) and its tests. `venta/domain/*`, `venta-service`, `preparar-lineas-venta`,venta-guardado,`descuentos`, cobros module, `venta/http/validations.ts` (zod defaults verified: per-line `descuento` at validations.ts:63-65, optional `motivo` at :109-111) — all byte-untouched.
- **ADR-017**: due date stays DERIVED; no venta field/column/parameter; `dineroRecibido`/vuelto never in any payload; balances never materialized.
- Strict TS (zero `any`), Decimal-string money, `prisma.*` only inside `infrastructure/`, multi-tenancy filters intact (zero new server reads beyond D7's one column on the already-executed eligibility read).
- Conventional commits, one work unit per commit, no AI attribution.

Test-harness notes (exact commands, real paths):

- Unit jest: `pnpm test` = jest (jest.config.js matches `src/**/*.spec.ts[x]` + `src/**/*.test.ts`). jsdom suites opt in via `@jest-environment` docblock (existing `venta-ui`/`confirm-ui` pattern). Targeted slices use real test-file paths below.
- Integration (when referenced): `pnpm test:integration` = `node --experimental-vm-modules node_modules/jest/bin/jest.js -c jest.integration.config.js --runInBand --forceExit` — plain `pnpm jest`/`pnpm test` on the integration config FAILS with a dynamic-import callback error. F2 adds NO new integration tests: R-V15 byte-identity is proven by the existing `confirmar-venta.integration.test.ts` + `venta-service` suites staying green in CI (real Postgres 16); the R-V25 chain is covered by mocked-unit tests only, per design §Testing Strategy.
- E2E: `pnpm e2e` (Playwright, from `app/`) — env-gated locally (skips with a notice when `E2E_USER`/`E2E_PASSWORD`/Supabase secrets absent, repo-standard).
- No `"typecheck"` script — invoke `pnpm exec tsc --noEmit` directly.

Honest normalizations (design typos resolved here, once, for apply):

- `design.md` says "Plain vitest" for `carro.spec.ts` — the repo is Jest-only (AGENTS.md; jest.config.js). Tests run via jest.
- `design.md`'s state identifiers `nanoObjetivo` / `campo: "vuelo"` are typos. Apply uses: PosScreen state `keypadObjetivo: { campo: "vuelto" } | { campo: "cantidad" | "precioUnitario"; productoId: number }`, helper `calcularVuelto(total, recibido)` in `venta/ui/credito.ts`, `componerValor(actual, tecla, maxDecimales)` in `venta/ui/carro.ts` (D4 keeps composition in carro.ts; D3 keeps all other F2 pure display math in credito.ts — `calcularVuelto` lives there).

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,300–2,600 additions+deletions (per-slice table below) |
| 400-line budget risk | High |
| Chained PRs recommended | No (session-ratified single PR with commit slices A–E) |
| Suggested split | PR 1 = slices A+B, PR 2 = slice C, PR 3 = slices D+E+bump (chain-ready if owner flips) |
| Delivery strategy | single-pr (session-ratified) |
| Chain strategy | pending (owner answers at apply) |

| Slice | Est. changed lines | Notes |
|---|---|---|
| A (F0 restyle) | ~±450 | mechanical class churn across 7 UI files; grep + e2e gates carry the review |
| B (credit surfaces) | ~+550/−20 | credito.ts + tests + D7 chain + selector/profile + spec prose normalization |
| C (per-line discount) | ~+460 | carro model + CartTable inputs + new carro.spec.ts |
| D (vuelto + keypad) | ~+420 | keypad component + Totales panel + PosScreen coupling + tests |
| E (anulación + e2e) | ~+540 | Dialog + 3 e2e util files + 4 spec import-swaps + credit-path/COBRO e2e additions |
| 6 (version bump) | ~+25 | 3 release files ONLY |
| **Total** | **~2,300–2,600** | exceeds the 400-line review budget AND the workspace `review_budget_lines: 800` |

```text
Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: High
```

**PRE-APPLY DECISION NOTE (OWNER GATE — not a task; no slice work starts before answered)**: the forecast is High and exceeds even the workspace 800-line budget. The owner MUST explicitly answer at apply time: **`size:exception`** (single stands as session-ratified; standard exception note: "PR exceeds 400/800 lines; slices A–E are individually gated commits — slice A follows the ui-foundation vendored-churn model where review focuses on the grep gate + e2e non-regression, not per-line class churn") **OR flip-to-chained** (then use the suggested split: PR 1 = A+B → PR 2 = C → PR 3 = D+E+bump; stacked-to-main since master is the integration target). Do NOT auto-claim the exception.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 (slices A+B) | F0 restyle + credit surfaces | PR 1 | `pnpm exec jest src/modules/venta/ui src/modules/cliente/http/actions.test.ts src/modules/venta/application/confirmar-venta.test.ts src/modules/venta/http/actions.test.ts` | `pnpm e2e` (4 spec non-regression) | revert commits 1–2; UI-only + additive output field; backend logic untouched |
| 2 (slice C) | per-line discount cart wiring | PR 2 | `pnpm exec jest src/modules/venta/ui/__tests__/carro.spec.ts src/modules/venta/ui/__tests__/venta-ui.spec.tsx src/modules/venta/domain/__tests__/calculators.spec.ts` | unit-only (pure model + mocked DTO) | revert commit 3; server DESC_MAX pipe is the backstop; D/E untouched by carro changes |
| 3 (slices D+E+bump) | vuelto/keypad + anulación + e2e hygiene + release | PR 3 | `pnpm exec jest src/modules/venta/ui` + `pnpm e2e` | Playwright against env-gated stack | revert commits 4–5(+6); D/E do not touch carro.ts; banner/panel/UI-gate only |

---

## Phase 0 — Branch setup (no commit)

- [x] 0.1 From repo root: `git checkout master && git pull && git checkout -b feature/f2-venta-pos`. Baseline is master f2e7bf2 (v0.16.1); confirm `app/package.json` reads `"version": "0.16.1"` before any work.

## Phase 1 — Slice A (Commit 1): POS F0 restyle + touch floor

**Commit title**: `refactor(venta): POS surfaces to F0 tokens and primitives (touch floor)`

Mechanical, file-by-file migration per D9 — no logic edits, no flow changes, DOM/JSX order preserved (tab order byte-equivalent, R-V18). Panel sections → `<Card>` (+ existing heading text and `aria-label` preserved verbatim: `Cart`, `Totals`, `Client`, `My drafts`, `Product search`, `Discount`, `NCF range warning`); native `<input>` → F0 `Input` (`@/components/ui/input`); native `<select>` → F0 `Select` (same `aria-label`, same values, same change payloads — E2E anchors `getByRole("combobox", { name: "Client selection" })` etc. must survive); hand-rolled `<button>` → F0 `Button` (variants: save/confirm/create = default; cancel/void = outline + destructive; row draft controls = `size="pos"` 48px high-frequency). Raw palette reconciliation: `bg-indigo-600` → Button default; `emerald-*`/`red-*`/`amber-*` → success/destructive/warning semantic tokens; every `zinc-*`/`dark:*` → F0 semantic tokens (`bg-background`/`bg-card`, `text-foreground`/`text-muted-foreground`, `border-border`, `text-primary`…). Spacing: 8px rhythm (`gap-4`/`space-y-4`/`p-4`); non-key interactive inputs get `min-h-11` (44px floor); table row padding keeps ≥44px row hitboxes.

- [x] 1.1 Migrate `app/src/modules/venta/ui/PosScreen.tsx` to F0 tokens/primitives: status banner `<p role="status">` and warning `<div role="alert">` blocks become Card+Badge compositions (same `aria-label`s), action buttons (`Save draft`/`Discard edit`/etc.) → F0 `Button` (`size="pos"` for save; outline for discard) — guard/disabled semantics and `Mensaje` state machine untouched (D1, D9).
- [x] 1.2 Migrate `app/src/modules/venta/ui/CartTable.tsx`: Card + Table primitives; quantity controls → Button-based controls at the 48px floor (`size="pos"`), all controls ≥44px; quantity/price/min unit-price rows keep `aria-label` pattern `Quantity for ${linea.nombre}` / `Unit price for ${linea.nombre}` / `Remove ${linea.nombre}` byte-identical (E2E anchors). NO per-line discount inputs yet (slice C) (D9).
- [x] 1.3 Migrate `app/src/modules/venta/ui/ClienteSelector.tsx`: Select/Button migration only — combobox label `"Client selection"`, quick-add form labels unchanged, `TIPOS_ALTA_RAPIDA` semantics untouched; no credit fields in this slice (D9; credit block is slice B).
- [x] 1.4 Migrate `app/src/modules/venta/ui/Totales.tsx` and `app/src/modules/venta/ui/DiscountPanel.tsx`: Card/Input/Select/Button migration; Totales stays `{ totales }`-only (vuelto slot props arrive in slice D); DiscountPanel admin gate copy and `DESC_MAX` caption untouched (D9).
- [x] 1.5 Migrate `app/src/modules/venta/ui/DraftList.tsx`: Card/Button migration; BORRADOR row controls (`Edit draft`/`Cancel draft`/`Confirm draft`) and CONFIRMADA `Cancel sale` affordance keep handlers and flow copy byte-for-byte (the anulación Dialog work is slice E) (D9; R-V24 draft-path contract).
- [x] 1.6 Migrate `app/src/modules/venta/ui/ProductSearch.tsx`: Card/Input/Button migration (added by design Verification note 5 — the slice A grep gate covers the whole `venta/ui` tree including it) (D9, R-V18).
- [x] 1.7 Existing suites stay green unmodified (restyle-only contract): `pnpm exec jest src/modules/venta/ui/__tests__/venta-ui.spec.tsx src/modules/venta/ui/__tests__/confirm-ui.spec.tsx` (D1, R-V18 TESTs).
- [x] 1.8 GREP GATE (R-V18 scenario 1): zero raw-color/token literals in the venta UI tree —
  ```powershell
  Get-ChildItem app\src\modules\venta\ui -Recurse -File | Select-String -Pattern "zinc-|indigo-|dark:|#[0-9a-fA-F]{3,6}"
  ```
  Expect ZERO matches (includes `ProductSearch.tsx`). Also `pnpm exec tsc --noEmit` clean.
- [ ] 1.9 E2E flow-proof: `pnpm e2e` — all four specs (`confirm-venta`, `cobros`, `devolucion`, `selector-sucursal`) green with zero selector drift; record the run in the slice gate report (R-V18 scenario 3).

## Verification (Slice A)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm exec jest src/modules/venta/ui/__tests__     # venta-ui + confirm-ui green unmodified
pnpm build
# Grep gate (1.8): zero zinc-/indigo-/dark:/hex across app/src/modules/venta/ui (recursive)
pnpm e2e                                           # 4 specs green (env-gated)
```

**Rollback boundary**: revert commit 1 → cosmetic only, no state/flow change; no other slice depends on class names.

---

## Phase 2 — Slice B (Commit 2): credit surfaces

**Commit title**: `feat(venta): credit surfaces — profile display, derived indicator, verdict exposure (R-V19/R-V20/R-V25/R-V27)`

- [ ] 2.1 Create `app/src/modules/venta/ui/credito.ts` (pure, hookless, no React imports) exporting exactly (D6): `FormaVenta = "CONTADO" | "CREDITO"`; `derivarFormaVenta(p: { esConsumidorFinal: boolean; tipoCliente: string } | null): FormaVenta` MIRRORING the backend rule `esVentaCredito = !esConsumidorFinal && tipoCliente === "CREDITO"` (see `leerPerfilCreditoEnTx` in `app/src/modules/cobros/infrastructure/saldo-cxc.repository.ts` — NOT the `creditoHabilitado` flag; R-V19 indicator must never promise crédito for a credit-flagged MINORISTA); `derivarVencimiento(fechaEmisionISO: string, plazoCreditoDias: number): string` — `YYYY-MM-DD`, emission day + N calendar days in `America/Santo_Domingo` via `Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" })` (the ratified `en-mora.ts` pattern); `superficieRechazoCredito(code: string): SupersurfaceRechazoCredito | null` where the interface is `{ titulo: string; texto: string; variante: "deuda-vencida" | "limite-excedido" | "credito-no-habilitado" }`, covering EXACTLY `CLIENTE_EN_MORA` / `LIMITE_CREDITO_EXCEDIDO` / `CREDITO_NO_HABILITADO` with fixed copy per D6 (mora: "Client has overdue invoices" + overdue-gate text; limit: "Credit limit exceeded" + would-exceed text; not-enabled: "Credit not enabled for this client" + the contado-alternative guidance text), rejection strings pinned locally `as const` against `CREDITO_RECHAZO_CODES` from `app/src/modules/cobros/domain/credito.ts` (read-only import; vendored strings may not drift) (D6; R-V20).
- [ ] 2.2 Create `app/src/modules/venta/ui/__tests__/credito.spec.ts` (node env, jest): (a) `superficieRechazoCredito` literal-equality vs `CREDITO_RECHAZO_CODES` (import from `@/modules/cobros/domain/credito` — test-only cross-module import, allowed since the runtime module never imports cobros); (b) `derivarVencimiento` fixture 2026-03-01 + 15 → **2026-03-16** and equality with `fechaVencimiento` from `app/src/modules/cobros/domain/en-mora.ts` (read-only import) on the same inputs (drift guard); (c) `derivarFormaVenta` grid: null/not-set → CONTADO; `esConsumidorFinal=true` → CONTADO regardless of flags; MINORISTA+creditoHabilitado → CONTADO (the backend-mirror rule pinned); CREDITO (not CF) → CREDITO (D6; R-V19/R-V20 TESTs).
- [ ] 2.3 Extend the existing listing contract test `app/src/modules/cliente/http/actions.test.ts` (existing `listarClientesAction` mock-DTO harness at :63-:212): assert the DTO row carries `creditoHabilitado: true`, `limiteCredito` as the Decimal-string `"20000.00"` (`typeof === "string"`, no float), `plazoCreditoDias: 15`, and that NO mapped field is email/auth-related over the whole row key-set (ADR-014). ZERO production-code change — `ClienteDto`/`toDto` (`app/src/modules/cliente/http/shared.ts:29-59`) and `clienteSelect` (`app/src/modules/cliente/infrastructure/cliente-repository.ts:61-75`) already ship all three fields (design Verification note 2) (R-V27 = DTO contract test ONLY).
- [ ] 2.4 D7 chain — application output. First extend `app/src/modules/venta/application/confirmar-venta.test.ts` (existing mock harness, :37/:164): pin BOTH `ConfirmarVentaOutput.credito` shapes — CONTADO `{ forma: "CONTADO" }` beside the existing NCF/estado/totales fields; CREDITO `{ forma: "CREDITO", plazoCreditoDias: 15, fechaEmision: <ISO UTC string> }`; then add ONE additive field in `app/src/modules/venta/application/confirmar-venta.ts`: `readonly credito: { forma: "CONTADO" } | { forma: "CREDITO"; plazoCreditoDias: number; fechaEmision: string }` built from existing locals only — `forma` from the step-5c `credito.forma` local (no re-derivation, no extra cobros read), `plazoCreditoDias` from D7's select extension, `fechaEmision` from the FACTURA emission instant materialized at step 8 (`factura.fechaEmision` → `.toISOString()`; NOT `venta.fecha`) (D7; R-V25).
- [ ] 2.5 D7 chain — repository select extension: in `app/src/modules/venta/infrastructure/venta-repository.ts` extend `leerClienteParaElegibilidadEnTx` (:643-655) — return type and `select` gain `plazoCreditoDias: true` on the SAME already-executed single-row read; no new query, no cobros import (D7; R-V25 boundary sentence).
- [ ] 2.6 D7 chain — http relay: in `app/src/modules/venta/http/actions.escritura.ts` the `confirmarVentaAction` inline `ActionResult<{...}>` type (:98-107) and the `ok({...})` literal (:123-135) both gain `credito: data.credito` — verbatim relay, no transformation, no validation (display-only). Create `app/src/modules/venta/http/actions.test.ts` (new file; there is no existing non-validations action test in `venta/http`) mocking `confirmarVenta` (and the `withTenantTransaction`/ctx harness per the existing `cliente/http/actions.test.ts` action-module pattern) asserting the mapping relays `credito` UNCHANGED for both shapes + `ncfWarning` passthrough stays green (D7; R-V25 "exposure lives in the venta http mapping layer with unit test").
- [ ] 2.7 Selector consumption: extend `app/src/modules/venta/ui/ClienteSelector.tsx` — internal option type becomes `ClienteOpcion { id; nombre; tipoCliente; esConsumidorFinal; creditoHabilitado; limiteCredito: string; plazoCreditoDias: number }` (mapping from the EXISTING `listarClientesAction` call — no extra fetch); add `onPerfilSeleccionado?: (p: Omit<ClienteOpcion, "id" | "nombre"> | null) => void` so PosScreen derives from owned state (selection callback stays `{ id; nombre }`-shaped); quick-add created row extends the local list with zero-credit literal defaults `creditoHabilitado:false, limiteCredito:"0.00", plazoCreditoDias:30` (quick-add only offers MINORISTA/MAYORISTA → definitionally contado; `TIPOS_ALTA_RAPIDA` untouched); render the profile block inside the selector next to the selection for a derived-credit client: `Badge` "CREDITO", `Limite: <formatearMonto(limiteCredito)>` (import `@/shared/ui/format`), `Plazo: N días`; CF selections show CF context with no credit facts (D6; R-V19 + R-V27 consumer side).
- [ ] 2.8 PosScreen consumption: in `app/src/modules/venta/ui/PosScreen.tsx` render the derived indicator Badge in the credit context strip (beside the status area, above Totales): no client selected → "Cash (Consumidor Final)"; derived crédito (via `derivarFormaVenta` on the selector-reported profile) → "Crédito · N días"; otherwise → "Cash". NO toggle control rendered anywhere (grep-assert `Selector|selector|toggle`-style contado/crédito control absence in the venta UI task review). After a CREDITO confirm, render the derived due date from the relayed verdict: `derivarVencimiento(r.data.credito.fechaEmision, r.data.credito.plazoCreditoDias)` as presentation-only text — nothing persisted, nothing sent (D1/D6; R-V19). Read the new `credito` output field defensively (absent/CONTADO → no due-date block) so a later slice-B revert cannot break the UI (design §Migration).
- [ ] 2.9 R-V20 rejection surfacing: extend `app/src/modules/venta/ui/__tests__/confirm-ui.spec.tsx` (mock-DTO pattern) — the three rejection codes each render their DISTINCT Card+Badge surface from `superficieRechazoCredito` (distinct heading + fixed copy + server `message` in the muted slot; never raw-code-only copy), a non-cataloged code falls back to the generic `[CODE] text` banner, and the sale stays BORRADOR with zero artifact assertions. In `PosScreen.tsx` the confirm error path checks `superficieRechazoCredito(mensaje.code)` FIRST and renders the dedicated Card+Badge surface on match (D6; R-V20).
- [ ] 2.10 R-V19 profile-flag tests: extend `app/src/modules/venta/ui/__tests__/venta-ui.spec.tsx` — profile fixtures use `tipoCliente: "CREDITO"` clients so both the flag and the derivation readings agree (design Verification note 4); assertions: the three profile fields render on selection; indicator states (contado default / crédito derived); fresh screen has NO contado/crédito toggle; derived due date shows post-confirm 2026-03-01+15 → 2026-03-16 for the CREDITO fixture (R-V19 scenarios 1–3).
- [ ] 2.11 R-V19 spec-prose normalization (documentation-only, allowed IN the slice B commit per task contract): edit the R-V19 prose in `openspec/changes/f2-venta-pos/specs/venta/spec.md` ONLY to align the derivation wording with the authoritative backend rule (`tipoCliente === "CREDITO" && !esConsumidorFinal`, mirroring `esVentaCredito`); scenario text, GIVEN/WHEN/THEN bullets, and TEST lines stay untouched — no other spec file in the change is edited (design Verification note 4 + Open Question 2; explicitly ratified at session level).
- [ ] 2.12 R-V15 regression net: `pnpm exec jest src/modules/venta/application --runInBand` — existing `confirmar-venta.test.ts` + `venta-service.test.ts` suites green; the confirm integration regression stays CI-covered — NO new integration tests are added (design §Testing Strategy; if integration must be run locally: `pnpm test:integration` documented above — plain `pnpm jest` on the integration config fails with a dynamic-import callback error).

## Verification (Slice B)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm exec jest src/modules/venta/ui src/modules/cliente/http/actions.test.ts src/modules/venta/application/confirmar-venta.test.ts src/modules/venta/http/actions.test.ts
pnpm build
# Gates: no toggle control in venta/ui (manual grep: "creditoToSelector|toggle" → zero in src/modules/venta/ui)
# 2.11 diff check: spec prose edit confined to openspec/changes/f2-venta-pos/specs/venta/spec.md R-V19 prose
```

**Rollback boundary**: revert commit 2 → additive output field gone and UI drops the indicator profile/due-date blocks (UI reads `credito` defensively by 2.8 so later-slice state stays coherent); cliente module untouched; zero persisted/transaction semantic change to undo.

---

## Phase 3 — Slice C (Commit 3): per-line discount wiring

**Commit title**: `feat(venta): per-line discount cart wiring (ADR-018 preview parity, R-V21)`

- [ ] 3.1 RED: create `app/src/modules/venta/ui/__tests__/carro.spec.ts` (jest, node env, pure model — runs via the unit jest config) pinning BEFORE implementation: (a) fixture F2 — line 7 × 3.33 @18% carrying `descuentoTipo: MONTO, descuentoValor: "5.00"` → preview `baseLinea "18.31"`, `itbisLinea "3.30"`; (b) the multi-line totals fixture triangulated against the SAME constants used in `app/src/modules/venta/domain/__tests__/calculators.spec.ts` (read-only reference): subtotal 69.86 / descuento 5.62 / itbis 6.52 / total 70.76 with no header discount; (c) zero-discount default: a fresh line carries `DESCUENTO_CERO` (`PORCENTAJE`, `"0.00"` — R-V7 carrier form); (d) `editarDescuentoLinea` merges `Partial<Descuento>` onto the touched line immutably; `limpiarDescuentoLinea` restores `DESCUENTO_CERO`; (e) over-cap input is NEVER decided locally: a cap-exceeding discount still flows into `calcularVistaPrevia` (the preview is non-authoritative by construction) (R-V21 scenarios; config `strict_tdd: false` — test-first is guidance, both halves must exist in the slice).
- [ ] 3.2 Extend `app/src/modules/venta/ui/carro.ts`: `CarroLinea` gains `readonly descuento: Descuento` (import type from `../domain/venta`); `agregarAlCarrito` seeds `DESCUENTO_CERO` (only user input transitions the shape); new pure transitions `editarDescuentoLinea(carro, productoId, parcial: Partial<Descuento>): CarroLinea[]` and `limpiarDescuentoLinea(carro, productoId): CarroLinea[]`; `calcularVistaPrevia` and `lineaComputable` stop hardcoding `DESCUENTO_CERO` at carro.ts:120/153 and pass each line's OWN `descuento` into `calcularLineaVenta`/`validarLineaVenta` verbatim (same released calculators → preview parity by construction; non-computable skip contract unchanged) (D2; R-V21).
- [ ] 3.3 CartTable inputs: in `app/src/modules/venta/ui/CartTable.tsx` add the `puedeDescontar: boolean` prop (PosScreen passes `esAdmin`); when admin, each row renders a per-line discount `Select` (PORCENTAJE/MONTO; per-line `aria-label` e.g. `Discount type for ${linea.nombre}`) + value `Input` (`Discount value for ${linea.nombre}`) driving `editarDescuentoLinea`/`limpiarDescuentoLinea`; non-admin renders NO per-line discount input (UI parity with DiscountPanel; server R-V8 remains the backstop for a crafted payload). NO local accept/reject verdict: over-cap rejects surface ONLY via the server's stable codes (`DESCUENTO_EXCEDE_MAXIMO`/`DESCUENTO_NO_AUTORIZADO`/`DESCUENTO_EXCEDE_BASE`) through the existing `Mensaje` banner (Card+Badge) (D2; R-V21 scenarios 2–3).
- [ ] 3.4 Payload: in `app/src/modules/venta/ui/PosScreen.tsx` the save/confirm payload builder sends `descuento: l.descuento` per line — `zCrearVentaInput` already accepts and defaults per-line `descuento` at `app/src/modules/venta/http/validations.ts:63-65` (read-only; byte-untouched), so actions/preparar-lineas pipes stay untouched (D2; R-V21 zero-shape scenario).
- [ ] 3.5 GREEN + admin-gate/assertion tests: extend `app/src/modules/venta/ui/__tests__/venta-ui.spec.tsx` — non-admin session renders no per-line discount input; admin renders it; over-cap server error message renders code+message through the existing banner (mocked action DTO contract); guardar payload includes per-line `descuento` matching the model (and defaults to the zero shape for untouched lines) (R-V21 scenarios).

## Verification (Slice C)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm exec jest src/modules/venta/ui/__tests__/carro.spec.ts src/modules/venta/ui/__tests__/venta-ui.spec.tsx src/modules/venta/domain/__tests__/calculators.spec.ts
pnpm build
# Grep gate: zero DESC_MAX accept/reject logic in the UI layer —
Get-ChildItem app\src\modules\venta\ui -Recurse -File | Select-String -Pattern "DESCUENTO_EXCEDE_MAXIMO\s*===|DESC_MAX\s*<|DESC_MAX\s*>"
# expect zero (the literal may appear only in DiscountPanel's descriptive caption as shipped)
```

**Rollback boundary**: revert commit 3 → server authority means no persisted overshoot risk; slices D/E do not touch `carro.ts` and stay coercible (proposal rollback plan).

---

## Phase 4 — Slice D (Commit 4): vuelto panel + numeric keypad

**Commit title**: `feat(venta): vuelto panel and numeric keypad (display-only, R-V22/R-V23)`

- [ ] 4.1 Totales vuelto slot: extend `app/src/modules/venta/ui/Totales.tsx` with optional props `dineroRecibido?: string`, `onDineroRecibidoChange?: (v: string) => void` (absent props = today's Totales shape: existing unit behavior stays meaningful) plus the control wiring — money-received `Input` (48px `min-h-12`, `aria-label="Money received"`, keypad-coupled below), ANOTHER updated by another (D3; R-V22).
- [ ] 4.2 Pure vuelto math: in `app/src/modules/venta/ui/credito.ts` add `calcularVuelto(total: string, recibido: string): { estado: "SIN_DATOS" | "VUELTO" | "FALTA"; monto: string }` using `decimal.js` only (`new Decimal(recibido).minus(total).toFixed(2)`; unparseable → `SIN_DATOS`, panel inert) — clustered with the other F2 pure display math per D3/D4 ("single location" rule). Copy contract (R-V22, fixed in design): `VUELTO` → `Vuelto <monto>` + badge "Reference only" + caption "The sale records the full invoice total. Not a payment."; `FALTA` (received < Total) → `Falta <monto>` + the SAME badge/caption plus "Shortfall shown as a reference; the confirmed sale always records the full total." — never blocks, never sends, never implies partial tender (D3).
- [ ] 4.3 Vuelto unit tests: extend `app/src/modules/venta/ui/__tests__/venta-ui.spec.tsx` — VUELTO state renders 29.24 for Total 70.76 / received 100.00 with the non-authoritative label; FALTA state renders `Falta <monto>` with the reference-only caption (never implies partial-tender acceptance); `SIN_DATOS` leaves the panel inert; the guardar/confirm action payloads contain NO `dineroRecibido`/vuelto fields at all (applies regardless of panel use) (D3; R-V22 scenarios 1–3).
- [ ] 4.4 Keypad component: create `app/src/components/ui/numeric-keypad.tsx` (`"use client"`), contract per D4: `export type TeclaNumerica = "0"… "9" | "." | "BSP" | "CLR"`; `NumericKeypadProps { onTecla; ariaLabel?: string; className?: string }`; grid rows 789 / 456 / 123 / `0 . BSP` / CLR = 13 `<Button>` primitives at `size="pos"` (verified `h-12` 48px variant in `app/src/components/ui/button.tsx:37`) inside a `role="group"` container; `onPointerDown` handlers run with `preventDefault()` AND `onClick` — pointer presses never steal focus from the paired input; DOM order tabbable for keyboard users. Visual design stays structural (F0 outline buttons on a Card) — board-gated polish is a flagged follow-up (D4; R-V18/V-V23).
- [ ] 4.5 Keypad composition (pure, testable without DOM): in `app/src/modules/venta/ui/carro.ts` add `componerValor(actual: string, tecla: TeclaNumerica, maxDecimales: 2 | 3): string` — appends/drops overdigits per `maxDecimales` and the same line-validity regexes the domain validates (`^\d{1,9}(\.\d{1,3})?$` for quantity→3, `^\d{1,9}(\.\d{1,2})?$` for money→2; `.` inserted at most once), `BSP` strips the last char, `CLR` yields `""`. Extend `app/src/modules/venta/ui/__tests__/carro.spec.ts` with a `componerValor` describe block: both decimal-max variants, overdigits dropped, single-dot rule, BSP/CLR actions (D4; R-V23).
- [ ] 4.6 Keypad mount + coupling: in `app/src/modules/venta/ui/PosScreen.tsx` (a) own `const [dineroRecibido, setDineroRecibido] = useState("")` (client state only, never a payload) and pass the optional Totales slot (D3); (b) own `keypadObjetivo: { campo: "vuelto" } | { campo: "cantidad" | "precioUnitario"; productoId: number }` set by each numeric input's `onFocus` AND by an explicit visible 48px keypad-target button on cart rows; default to the first line's quantity; (c) mount ONE `<NumericKeypad instance beside Totales; its single `onTecla` handler maps the active target through `componerValor` → `editarLinea` (quantity/price) or `setDineroRecibido` (vuelto) — a one-instance pool (rendered once) whose edits re-run `calcularVistaPrevia` and thereby the domain calculators (D4; R-V23 scenarios). CartTable accepts the small `keypadObjetivo` + `onSetKeypadTarget` props (display affordance only).
- [ ] 4.7 Keypad UI tests: extend `app/src/modules/venta/ui/__tests__/venta-ui.spec.tsx` (jsdom — no layout engine; define the class-level size gate as the deterministic size-gate proxy): (a) exactly 13 keypad buttons exist inside `role="group"` "Numeric keypad" accessible container, each carrying the `h-12` (48px) class from the pos variant and reachable in DOM order: `getByRole("group", { name: "Numeric keypad" })`; (b) keying a digit sequence onto a target cart-line quantity updates the model and triggers the preview recompute (R-V23 scenario 2): assert the targeted quantity input's value reflect the composed string; (c) `BSP` removes the last typed char / `CLR` clears the vuelto input; (d) the vuelto input changes flow into the Totales slot prop (R-V22 UI reroute; only ONE keypad instance exists on the screen).

## Verification (Slice D)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm exec jest src/modules/venta/ui/__tests__
pnpm build
# Grep gate: money-in-payload exists nowhere —
Get-ChildItem app\src\modules\venta -Recurse -File | Select-String -Pattern "dineroRecibido" | Measure-Object -Line
# expect: matches ONLY in PosScreen.tsx / Totales.tsx / credito.ts / venta-ui.spec.tsx (UI-only, never an action payload build/assertion site)
```

**Rollback boundary**: revert commit 4 → Totales reverts to the no-slot shape (props optional by construction); keypad file removed; payloads were never affected — no persisted or wire-facing change to unwind.

---

## Phase 5 — Slice E (Commit 5): anulación Dialog + shared E2E helpers + credit-path coverage

**Commit title**: `feat(venta): anulación dialog and shared e2e helpers with credit-path coverage (R-V24/R-V26)`

E2E helper extraction (D8 first — extraction is the pure refactor that all new specs cases build on; the suite must be green BEFORE and AFTER the swap):

- [ ] 5.1 Baseline proof: `pnpm e2e` — record all four existing specs (`app/e2e/confirm-venta.spec.ts`, `app/e2e/cobros.spec.ts`, `app/e2e/devolucion.spec.ts`, `app/e2e/selector-sucursal.spec.ts`) green; this pre-state is the non-regression baseline for 5.4 (resolve env gating per the documented secrets contract before counting this as evidence) (R-V26 scenario 1).
- [ ] 5.2 Create `app/e2e/utils/login.ts`: `export type LoginUser = { user: string; password: string }`; `export async function login(page: Page, creds: LoginUser): Promise<void>` — helper body moved VERBATIM from the login function at `app/e2e/confirm-venta.spec.ts` (`login` at :108-117 with the `/dashboard|/selector-empresa-sucursal` landing tolerance regex) (D8).
- [ ] 5.3 Create `app/e2e/utils/db.ts`: `export function openDb(): Pool` using `connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL` (identical to all four specs' post-connections); `export type UsuarioPrecond = { usuarioId; empresaId; sucursalId; rol }` + `usuarioPrecond(pool, user)` — the shared user+rol precondition query moved verbatim (the superset shared by confirm-venta/devolucion; cobros' variant folds in since it is a subset) (D8).
- [ ] 5.4 Create `app/e2e/utils/venta-pos.ts`: `E2E_PRODUCT` / `E2E_USER` / `E2E_PASSWORD` env-reading constants; `buscarYAgregar(page, producto): Promise<void>`; `guardarYConfirmar(page): Promise<{ ventaId: number; ncf: string }>`; `export const CLIENTE_CREDITO_DEMO_NOMBRE` moved from `app/e2e/cobros.spec.ts:39`; `idClienteCreditoDemo(pool, empresaId): Promise<number>` — moved from the cobros credit-lookup (query + skip contract byte-for-byte) (D8).
- [ ] 5.5 Import-swap only: update the four specs' helper references — `confirm-venta.spec.ts`, `cobros.spec.ts`, `devolucion.spec.ts` swap login/precondition helpers for the utils imports with ZERO body changes; `app/e2e/selector-sucursal.spec.ts` swaps ONLY its login helper (it keeps its own extra landing waits — it is ABOUT landing routes). Spec-local queries that are actually SPEC-specificSuperset (facturaAutomatica gate, NCF ranges, product stock checks; company/product/ncf facts) stay local (D8).
- [ ] 5.6 Post-swap proof: `pnpm e2e` — all four specs green again (R-V26 scenario 1; helper dedupe only).

Anulación Dialog (D5; implemented only after the e2e refactor halves of this slice are green):

- [ ] 5.7 DraftList affordance: in `app/src/modules/venta/ui/DraftList.tsx` add `puedeAnular: boolean` + `onAnular: (id: number) => void` props; CONFIRMADA rows swap `Cancel sale` for a `Void sale` control (`Button` `size="pos"`, outline+destructive token) that triggers `onAnular` instead of the direct action call; BORRADOR row controls (`Edit draft`/`Cancel draft`/`Confirm draft`) keep handlers and copy byte-for-byte; non-admin sessions never see the Void control (UI gate; `cancelarVentaAction`'s role path remains the true authorization) (D5; R-V24).
- [ ] 5.8 Dialog (inline in PosScreen or a sibling component — File Changes keeps it inside `PosScreen.tsx` state/JSX; a sibling `app/src/modules/venta/ui/ConfirmarAnulacionDialog.tsx` is acceptable if inline size bites): PosScreen owns `anulacion: { id: number; total: string; ncf: string | null } | null` + `motivo: string` state; Dialog body (F0 `Dialog` + `Label` + `Input`) — title "Void sale #N", copy per design verbatim: "This annuls invoice NCF X (the Anulada fiscal state — Formato 608) and restocks the sale. This cannot be undone." (note: the design's literal string reads "…(Formats the Anulada fiscal state — Formato 608)…" — apply renders THAT frozen string, typo-or-not; reportting the literal is the safer-than-fixing path. Corrected-c grammar is a board-gated follow-up, NOT a task edit.)
- [ ] 5.9 Mandatory motivo wiring: the Dialog's invoicing submit `Button` carries `disabled={motivo.trim() === ""}`; on submit `await cancelarVentaAction({ id, motivo: motivo.trim() })` — NO zod/action validation change: `zCancelarVentaInput.motivo` stays OPTIONAL (verified validations.ts:111; making it server-mandatory would be an R-V16 semantic change = out of scope). Dialog closes on success; `recargarBorradores()` refresh (the row's disappearance matches the unchanged CANCELADA filter) (D5; R-V24).
- [ ] 5.10 Distinguish fiscal-outcome copy: success for anulación → set the `Mensaje` "ok" text to `Sale #N voided — invoice annulled (Formato 608), stock restocked.`; the BORRADOR draft-cancel path keeps its existing "Sale #N cancelled." text byte-for-byte (R-V12 untouched at the handler) — both render through the existing Card+Badge status surface, no Toast (D5; R-V24 scenarios 2–3; fiscal outcomes stay fixed R-V16 backend behavior).
- [ ] 5.11 Dialog unit tests: extend `app/src/modules/venta/ui/__tests__/venta-ui.spec.tsx` — admin CONFIRMADA row opens the Dialog; empty motivo BLOCKS submission and `cancelarVentaAction` is NEVER invoked (asserted against the mock); submitting with motivo calls `cancelarVentaAction({ id, motivo: <trimmed> })`; BORRADOR cancel still works with empty motivo (no dialog) (R-V24 scenarios 1–2). Design-frozen scope note: R-V24 scenario 3 (outcome-copy fiscal distinction) TEST:E2E — the design's E2E plan (D8) adds ONLY credit-path coverage + the contado COBRO assertion, so the fiscal-distinction copy is pinned at unit level here and the anulación flow stays manually verifiable; do NOT invent an extra anulé e2e spec beyond the frozen design plan (flag as future polish).

Credit-path E2E coverage (D8; R-V26 scenario 2 + the contado COBRO-gap):

- [ ] 5.12 Extend `app/e2e/confirm-venta.spec.ts` — contado happy-path test GAINS a DB assertion: after confirm, exactly ONE `PAGO` row exists with `tipo='COBRO' AND estado='APLICADO'` for the created `facturaId` and `monto = <factura.total>` (billing the existing contado COBRO-gap; DB reads stay DIRECT_URL superuser read-only per repo E2E contract) (D8).
- [ ] 5.13 Add the credit-path test to `app/e2e/confirm-venta.spec.ts` (self-skipping when the demo credit client is absent, mirroring the `cobros.spec.ts` skip pattern): login → `/venta` → select the credit-bearing client in the combobox by `CLIENTE_CREDITO_DEMO_NOMBRE` ("Comercios Clara, SRL (demo)" via `idClienteCreditoDemo`) → `buscarYAgregar(E2E_PRODUCT)` → `guardarYConfirmar` → assert the confirmation banner shows "confirmed — invoice B.."-style NCF; DB asserts `VENTA` `CONFIRMADA`, its `FACTURA` `VIGENTE`, and ZERO `PAGO (COBRO/APLICADO)` rows for that `facturaId` (credit edge diverges — no auto-cobro; fixed 5c semantics) — two divergences proved from the SAME spec file (D8; R-V26).
- [ ] 5.14 Full gate: `pnpm e2e` (all four specs + newly gained cases) + `pnpm exec jest src/modules/venta src/modules/cliente --runByBand` (unit suites stay green) + lint + tsc + build on the branch.

## Verification (Slice E)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm exec jest src/modules/venta src/modules/cliente
pnpm build
pnpm e2e                                            # env-gated; all four specs green pre/post extraction + new cases
# Import-dedupe gate: zero duplicated login/openDb/precondition helpers across the 4 specs —
Get-ChildItem app\e2e -Filter *.spec.ts | Select-String -Pattern "async function login"
# expect matches ONLY inside app\e2e\utils\login.ts (via the specs' imports), plus selector-sucursal keeping only the import-swap
```

**Rollback boundary**: revert commit 5 → dialog/utils/additions un-wind to pre-slice state; the 4 specs are byte-identical to their slice-5.5 state (imports can revert without rebase risk); no prod-code path was touched besides DraftList/PosScreen rows (revert restores the old affordances).

---

## Phase 6 — Final version bump (Commit 6, bump ONLY)

**Commit title**: `chore(release): 0.17.0`

- [ ] 6.1 `app/package.json`: `"version": "0.16.1"` → `"version": "0.17.0"` (MINOR: `feat` change while pre-1.0). Write with `[IO.File]::WriteAllText(path, text, [Text.UTF8Encoding]::new($false))` style UTF-8-no-BOM handling — NEVER `Set-Content -Encoding UTF8` or any PowerShell default-encoding writer on machine-consumed files (AGENTS.md BOM rule; root cause of the PR #59 CI break).
- [ ] 6.2 `.release-please-manifest.json` (repo root): `"app"` → `"0.17.0"` (same BOM-free write discipline; key verified shipping `"app"`).
- [ ] 6.3 `app/CHANGELOG.md`: prepend a `## [0.17.0](https://github.com/Wilfredery/SystemFact/compare/v0.16.1...v0.17.0) (2026-10-…) <today's>` section — `### Features` bullets summarizing F2 (F0 POS restyle, credit surfaces incl. `ConfirmarVentaOutput.credito`, per-line discount UI, vuelto/keypad, anulación dialog, shared e2e utils + credit-path coverage), the usual link line updates at the bottom of the section stack; BOM-free write (never `Set-Content -Encoding UTF8`).
- [ ] 6.4 BOM byte-check gate for all three release files (run from repo root):
  ```powershell
  foreach ($f in @('app\package.json', '.release-please-manifest.json', 'app\CHANGELOG.md')) {
    $b = [IO.File]::ReadAllBytes($f)
    if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { Write-Error "BOM found in $f"; exit 1 }
  }
  # Expect silent pass (exit 0)
  ```
- [ ] 6.5 These three files ONLY in the commit gate: `git diff --stat HEAD~1` (or pre-commit `git status --short` staging check) shows exactly `app/package.json`, `.release-please-manifest.json`, `app/CHANGELOG.md` — bump commit NEVER mixes feature files (binding release guard).
- [ ] 6.6 Final verification on the branch (before PR): `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` all green + the e2e evidence from slice E stands on the same head.
- [ ] 6.7 PR: push `feature/f2-venta-pos` → open a single PR → `master` referencing the SDD trail (`openspec/changes/f2-venta-pos/`). PR description records the resolved apply decision (size:exception wording OR chained-split mapping),mirroring the Review Workload Forecast verdict above. CI matrix note: `.github/workflows/ci.yml` runs ESLint, strict typecheck, `prisma validate`, unit tests, integration tests on real Postgres 16 (RLS via `systemfact_app`), production build, and the Conventional Commits guard; the aggregate `CI gate` job is the single required status check; the Playwright E2E job skips with a notice (not a failure) when secrets are absent.
- [ ] 6.8 Apply report's LAST line (literal): `bump validated: 0.17.0`.

---

## Traceability quick map (R-V18..R-V27 → tasks)

- **R-V18** (F0 tokens/primitives, 44/48px floor, DOM-order keyboard reach, no raw colors, no flow change, board-agnostic): D9/D1 → **1.1–1.6** (restyle incl. `ProductSearch.tsx` per design Verification note 5), **1.7–1.9** (grep gate + suites + e2e non-regression). R-V23's 48px keypad gate lands with **4.4/4.7**; per-line floors at **1.2**.
- **R-V19** (credit-mode UX derived, no toggle, profile display, derived due date display-only; backend-mirror via `tipoCliente` rule per Task Notes): D6 → **2.1–2.2** (pure derivations + drift guards), **2.7** (selector profile block + quick-add zero-credit shape), **2.8** (indicator + post-confirm due date, defensive `credito` read), **2.10** (UI flags), **2.11** (spec prose normalization, documentation-only).
- **R-V20** (three credit-gate codes, distinct Card+Badge surfaces, no raw-code-only copy): D6 → **2.1** (`superficieRechazoCredito` fixed copy + `CREDITO_RECHAZO_CODES` pin), **2.9** (confirm-ui distinctness + fallback), consumed by **2.8**'s banner branch.
- **R-V21** (per-line discount, admin-gated, preview = same calculators, non-authoritative, zero-shape default, F2/F4 fixture parity): D2 → **3.1–3.2** (model + fixtures), **3.3** (CartTable inputs, admin gate), **3.4** (payload; zod defaults pre-verified), **3.5** (gating/banner tests).
- **R-V22** (vuelto display-only, moneyReceived − Total, non-authoritative label, Falta convention, no backend tender): D3 → **4.1–4.2** (slot + `calcularVuelto`), **4.3** (states + no-payload proof), **4.6** (PosScreen state; payload never carries it).
- **R-V23** (ONE shared NumericKeypad, 48px, quantity seam, MAY vuelto, a11y, no other new primitives): D4 → **4.4** (component), **4.5** (pure composition in `carro.ts` + regex cases), **4.6** (single mount + target coupling), **4.7** (13-button group + composition tests).
- **R-V24** (anulación Dialog admin + mandatory motivo, action unchanged, draft path untouched, 608 outcome copy; backend fixed R-V16): D5 → **5.7–5.10** (affordance + Dialog + wiring + copy), **5.11** (unit tests; outcome-copy e2e deliberately out of the frozen D8 plan — flagged).
- **R-V25** (`ConfirmarVentaOutput` MAY expose verdict; mapping layer; both-shape unit test; R-V15 untouched): D7 (+ the design's honest minimal-chain deviation note) → **2.4** (output field + both shapes), **2.5** (one-column select extension), **2.6** (http verbatim relay + mapping test), **2.12** (regression net; no new integration per design; `pnpm test:integration` = `node --experimental-vm-modules …` documented in the header when needed).
- **R-V26** (shared E2E utils; four specs green pre/post; credit-path coverage; contado path keeps proving COBRO): D8 → **5.1–5.6** (extraction + import swaps), **5.12** (contado COBRO assertion), **5.13** (credit-path case, zero COBRO), **5.14** (full gate).
- **R-V27** (listing DTO exposes credit profile; read-only; additive; tenant-scoped; no email; Decimal-string money): verified ALREADY satisfied in prod (`cliente/http/shared.ts` + `cliente-repository.ts`) → **2.3** is the ONLY deliverable (DTO contract test; zero code change), consumed by **2.7**.

Untouched-by-design (protected surfaces): `venta/domain/*`, `venta/application/{venta-service,preparar-lineas-venta,venta-guardado,descuentos}`, `venta/http/validations.ts`, ALL cobros module files, cliente use cases/escritura, the BORRADOR draft cancel flow, Penpot-gated visual polish (board `02-Venta-Credito` follow-up).
