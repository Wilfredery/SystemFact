# Exploration: fase-5b-venta-core

**Date**: 2026-09-09
**Change**: fase-5b-venta-core
**Branch**: `feat/fase-5b-venta-core` (from master `113f326`, post 5a)
**Status**: exploration-complete
**Parent map**: `openspec/changes/fase-5-venta-exploracion/exploration.md` (engram #699)

## Current State

Fase 5a shipped: `src/modules/cliente` (full domain/application/infra/http + real-DB integration suite), `src/shared/domain/fiscal-id.ts` (mod-11 RNC/cédula), race-safe `getOrCreateConsumidorFinalEnTx` (explicitly documented as the "RESERVED FASE-5b SEAM"), CF idempotent seed, canonical `openspec/specs/clientes/spec.md`. There is **no `venta` module**: `src/modules/` = auth, categoria, cliente, compra, inventario, producto, proveedor, tenant. UI is still only `login` + `dashboard`; the POS screen would be the first client-interactive page.

## 1. Schema Ground Truth for VENTA (frozen ERD v4.7 — no migration gaps)

**`EstadoVenta` enum** (`schema.prisma` L67–73): `BORRADOR | CONFIRMADA | CANCELADA`. There is **no PENDIENTE and no ANULADA** on Venta. "Pendiente/Parcial/Pagada" are *Factura* states (derived, ADR-017); the venta state machine and the document state machine stay separate (docs/03 §8).

**`Venta` (VENTA, L422–450)**: `id`, `empresaId`, `sucursalId`, `usuarioId` (registrar), `clienteId` — **required, not nullable** — `fecha timestamptz`, `estado`, `subtotal Decimal(12,2)`, `descuento Decimal(12,2)`, `descuentoTipo DescuentoTipo` (**NOT NULL even for zero discounts**), `descuentoAutorizadoPor Int?` (FK Usuario), `itbis Decimal(12,2)`, `total Decimal(12,2)`, timestamps. All FKs `onDelete: Restrict`; relations: `detalles`, `factura?` (Factura carries `@@unique([ventaId])` — one sale bills at most once), `movimientosInventario[]`.

Notable **absences vs Compra** (deliberate in the ERD, verified):
- **No `correlativoInterno`** — drafts are identified by the numeric `id` only; the FAC- counter lives on Factura (5c).
- **No `subtotalGravado`/`subtotalExento`** — the taxable/exempt split is NOT persisted on VENTA; Factura (5c) re-derives it from the frozen per-line `tasaItbis`. Drafts still store a single `subtotal/itbis/total`.
- **No `version` column** — matching Compra (also version-less): the precedent for draft concurrency is the **guarded `updateMany` predicate** (`WHERE id AND empresaId AND estado='BORRADOR'`), not optimistic locking. Keep it.
- No NCF fields on Venta at all (invoices are their own entity).

**`DetalleVenta` (DETALLE_VENTA, L452–470)**: `ventaId`, `productoId` (Restrict), `cantidad Decimal(12,3)`, **`precioUnitario Decimal(12,2)`** (note the column name — the blocker's field is `Producto.precioVenta`; the line field is `precioUnitario`), `descuentoLinea Decimal(12,2)`, `descuentoTipo` (NOT NULL), `descuentoAutorizadoPor Int?`, `tasaItbis Decimal(12,2)` (frozen at save), `itbisLinea`, `subtotalLinea`. No timestamps, no per-line branch (inherited via header).

**Relations**: Venta→empresa/sucursal/usuario/cliente; DetalleVenta→venta/producto. Cliente is reached only through the header; the sale is per-branch via `sucursalId` (inventory is per branch — the 5c debit resolves `INVENTARIO(sucursalId, productoId)`).

**App-layer-only gaps (everything for 5b)**: whole `src/modules/venta/`; venta domain calculators; draft lifecycle use cases; a client resolver wiring `getOrCreateConsumidorFinalEnTx`; config-in-tx read + seed for `DESC_MAX` (see §3); the POS UI; venta tenant/concurrency integration tests.

**RLS is already covered**: `20260902120000_enable_rls` enables policies on `VENTA` (empresaId GUC) and `DETALLE_VENTA` (join through VENTA), and `20260902130000_force_rls` FORCEs both. No DB work needed; app-layer `empresaId`+`sucursalId` filters remain mandatory.

## 2. BLOCKER — `precioVenta` Semantics (options + consequences, no guessing)

**Documentation evidence is ABSENT** (re-verified beyond engram #700): erd.md only declares `decimal(12,2) precioVenta` (L115); docs/03 §4 lists "Precio de venta" and "Tasa de ITBIS" as separate product attributes without inclusion semantics; docs/11 §Impuestos covers rates only; docs/05/06/07/16/17 and the Penpot plan mention price display, never tax inclusion. **No doc settles it.**

**In-repo evidence points to EXCLUSIVE (additive)**: `src/modules/producto/domain/calcular-itbis.ts` (shipped, maintainer-reviewed) computes `baseImponible = precioVenta × cantidad; itbis = base × tasa/100; total = base + itbis`. Its only caller today is its own test file — a dormant preview, but a **typed precedent**: the producto spec/tests treat `precioVenta` as the ex-tax base. Compra mirrors it (`costoUnitario` ex-tax + ITBIS added). Factura stores `subtotalGravado` ex-tax + separate `itbis` — the DGII-required breakdown — which the calculator already produces under the additive model.

### Options

| | (a) ITBIS-inclusive price (retail tag) | (b) ITBIS-exclusive line price (additive, like compra) | (c) per-product flag `precioIncluyeItbis` |
|---|---|---|---|
| Storage semantics of `Producto.precioVenta` | gross (tax inside) | net (tax base) | ambiguous per product |
| Calculator | reverse-compute: `base = gross × 100/(100+tasa)` → fractional cents, per-line rounding of the **base** (audit-visible) or of the **tax** with base = gross − tax | `itbis = base × tasa/100` directly (compra precedent) | both calculators + branch in every consumer |
| Rounding risk | **High**: mixed 18/16/0 reverse-division per line makes Σline ≠ Σinvoice unless a tie-break rule is frozen; DGII-visible | **Low**: identical to shipped compra policy (round per line, sum rounded values) | High + complexity |
| POS display | tag price = stored price (culturally familiar to DR cashiers) | tag shows stored price; the drawer total adds ITBIS — cashier reads `total`, not the sum of tags | best of both, at the cost of schema change |
| Discount-before-ITBIS (ADR-018) | percent discounts on gross ≠ percent on net: 4% cap semantics change (cap must be defined on net base anyway) | clean: `descuento` and `base` are same units | per-flag semantics again |
| Tax-rate change resilience | stored gross silently mis-represents the net after a reform (Law 30-26 just changed rates!) — historical prices mean different nets over time | net is invariant; only the rate/validity changes, and rates are already validity-windowed per product | flag doesn't fix the gross-drift problem |
| Schema change | none | none | **violates frozen ERD v4.7** → new column, migration, ADR deviation |
| Consistency with shipped code | contradicts `calcular-itbis.ts` + compra precedent | consistent with everything in the repo | no precedent |

### Recommendation (do NOT select — user decision)

**(b) ITBIS-exclusive storage**, POS UI displaying both: per-line net base and the final gross `total` (the amount the customer pays is identical under (a) or (b); only the *entered* product price differs). Consequences to surface to the user:
- Product masters must enter **net** prices; if the business currently tags tax-inclusive prices, the product form/UX must state this clearly (or a later tool converts tags).
- `DESC_MAX` 4% cap applies to the net base (matches docs/11 "SIEMPRE antes del ITBIS (base neta)" wording — this phrase itself weakly favors (b): the doc thinks in terms of a *net base* existing separately from ITBIS).
- If (a) were chosen, the design doc must pin the reverse-computation + rounding tie-break before any calculator code exists, and accept that historical gross prices become semantically frozen at their original rate — recalculation on reform is impossible without the net.
- (c) is rejected for V1: ERD-frozen schema + YAGNI.

## 3. Calculators — Standing Contract (ADR-018 + Mixed ITBIS)

Mirror of `compra/domain/calculators.ts` (decimal.js, `round2` = `toDecimalPlaces(2)` half-up, decimal **strings** across the boundary, never float). Inversion: ITBIS is output (charged to the client) and there are no retentions on the venta side.

**Per-line contract** (`calcularLineaVenta(input, tasaItbis)`):
1. `subtotalBruto = cantidad × precioUnitario` (round2 on persist).
2. Line discount: `descuentoLinea` interpreted by `descuentoTipo`: `PORCENTAJE` → `base × pct/100`, `MONTO` → the value itself; result rounded 2dp. (The stored `descuentoLinea` semantic — value-in-type-units vs. resolved money — is a design decision to freeze in the spec; the column is `Decimal(12,2)` for both cases.)
3. `baseLinea = subtotalBruto − descuentoLineaMonto` → `subtotalLinea`.
4. `itbisLinea = baseLinea × tasa/100` (0 when tasa = 0), round2.
5. Rate frozen from `Producto.tasaItbis` at save — **plus the venta-only rule the docs demand and compra never needed**: the rate's validity window (`itbisVigenteDesde/itbisVigenteHasta`) must cover the sale date (docs/16 §3 Validaciones "Tasa de ITBIS vigente en la fecha de la venta"), evaluated in `America/Santo_Domingo`. New error code (`TASA_ITBIS_VIGENCIA_FALTA`-style), decided in spec.

**Header contract** (`calcularTotalesVenta(lineas, headerDescuento)`): aggregate `subtotalGravado` (tasa>0) and `subtotalExento` like `calcularTotales`; then **header discount before ITBIS, prorated across gravado/exento** (ERD design note; docs/11 §Descuentos): `baseGravadoAfectada = gravado − prorate(header)`, ITBIS recomputed on affected bases, `total = (subtotal − descuentoTotal) + itbis`. Rounding order (prorate→round vs. round→prorate) must be frozen by spec with a mixed-rate test matrix (18/16/0 + PORCENTAJE/MONTO + 4% cap boundary) — this is the DGII-visible risk.
- Caveat already noted: since VENTA lacks gravado/exento columns, the draft persists only `subtotal/descuento/itbis/total`; the split is recomputed for the Factura in 5c from the same frozen lines — so the draft calculator must also **return** the split even if it isn't stored.
- **Zero-discount convention**: `descuentoTipo` is NOT NULL → always store `PORCENTAJE` with `descuento = 0.00` when there is no discount (documented in spec).
- **`DESC_MAX` from DB, never hardcoded**: no config read exists — only `seed-retencion-config.ts` + `leerTasasRetencionEnTx`. 5b adds `leerConfigVentaEnTx` (hard-fail on missing, mirroring `CONFIG_RETENCION_FALTANTE`) + `tools/scripts/seed-venta-config.ts` + a venta-side seeding spec mirroring `retencion-config-seeding`. **Sub-decision**: the `TASA_ITBIS` empresa key (schema comment) is redundant with per-product rates — recommend seeding `DESC_MAX` only in 5b and leaving `TASA_ITBIS` unseeded/unused until a consumer exists.
- **Discount authorization** (decision): docs/03 L267 + docs/04 L231 — V1: only Administrador applies discounts; Despachador "solo con permiso explícito", but **no permission table exists in the schema** — recommend 5b enforces Admin-only discount application (server-side role check in the action), `descuentoAutorizadoPor := ctx.usuarioId` when a discount is applied; the two-person authorization pattern is deferred. UI hiding is not security.

## 4. Draft Lifecycle (5b scope is draft-only — confirmation is 5c's)

Definite from the map and re-confirmed: **5b does NOT confirm, does NOT touch NCF/inventory/payments**. State machine over `EstadoVenta`:

| Transition | 5b? | Precedent |
|---|---|---|
| create → `BORRADOR` | ✅ `crearVenta` | `crearCompra` (totals computed server-side from lines; rates frozen; audit in tx) |
| edit while `BORRADOR` | ✅ `actualizarVenta` — **full line replacement** (delete-and-reinsert `reemplazarLineasEnTx`), guarded `updateMany WHERE id AND empresaId AND estado='BORRADOR'` → raced loss = `CONCURRENCIA_CONFLICTO`, non-draft = `VENTA_INMUTABLE` | `actualizarCompra` verbatim shape |
| `BORRADOR → CANCELADA` | ✅ `cancelarVenta` (draft discard; motivo optional — no fiscal effect since nothing fiscal happened) | `cancelarCompra` guarded `updateMany(desdeEstado)` |
| `BORRADOR → CONFIRMADA` | 🔒 **frozen seam for 5c** (no stub) — with `transicionarConfirmarVenta` added then, together with NCF consumption + SALIDA_VENTA + Pago | `transicionarConfirmar` shape |
| `CONFIRMADA → CANCELADA/…` | 🔒 5c (document cancellation lives on Factura, not Venta) | docs/03 §8 |

Design notes:
- Domain mirrors compra: `ESTADO_VENTA` core constant (representable: all three; only BORRADOR/CANCELADA reachable in 5b), fail-loud exhaustive `estadoVentaDesdeDb`, pure `transicionarCancelar` with coded rejections, `VentaResult<T>` typed catalog with stable codes.
- Unlike Compra, Venta has no `ncf/tipoNcf` draft-editable fields and **no correlativo** to assign — so the 5b use cases are strictly simpler than compra's confirm path (which 5b doesn't build at all).
- **Sub-decision (user-visible in spec)**: can the client be changed while `BORRADOR`? Compra forbids supplier change (cancel-and-recreate). POS reality argues for allowing client re-selection on a draft; both are implementable — recommend **allow** (guarded update of `clienteId` through the resolver), pending user confirmation in specs.

## 5. Carrito — Ground Truth and Placement

Verified again on this branch: **no `Carrito` model, column, or migration exists anywhere**. Docs mention the carrito only as a UX surface: docs/16 §3 step 3 (add/adjust qty), §13 decisions #1 (layout) and #5 (search pattern), docs/11 §"Tarjeta rechazada" ("volver al paso de método de pago, sin perder el carrito" — client-side persistence implied), `Plan_de_trabajo_penpot.md` L88 ("Ver carrito de venta" — a screen section, not a table), roadmap L225 ("Carrito de venta" one-liner). The strongest statement is `erd-guia.md` L27: the **"Ciclo de venta" group `VENTA, DETALLE_VENTA, FACTURA` is labeled "El carrito y su comprobante fiscal"** — in the ERD's own vocabulary, the carrito **is** the VENTA draft.

Options:
1. **Ephemeral client state (map's recommendation, still mine)** — React state (or sessionStorage) carrito; server touched only on explicit save-draft. Pros: zero new schema/queries, no stale-draft litter, YAGNI (no held-sale requirement exists). Cons: browser crash loses the in-progress sale (mitigated by "save draft" affordance reusing the same use case).
2. **Draft row AS the carrito** — POS creates the BORRADOR row on first add-line and updates it per interaction. Pros: crash-proof, matches erd-guia vocabulary, exercises 5b use cases from the UI. Cons: a `updateMany` replace-all-lines round-trip per item (over-writes concurrent same-terminal edits — acceptable for single-operator-per-terminal), abandoned drafts accumulate (no auto-cancel job in V1), and the "one Venta per (usuario, branch, open session)" would be a new implicit convention without a schema anchor.
Effort delta is small (both ride the same lifecycle API). **Recommend option 1 for 5b**, with the draft-save path proving option 2's API later if a held-sale requirement ever materializes.

## 6. Client Selection Flow at POS (exists vs. new)

**Exists (5a)**: cliente CRUD + listing (searchable, paginated) + `obtenerCliente`; `getOrCreateConsumidorFinalEnTx` (race-safe, documented 5b seam, CF row frozen shape: nombre "Consumidor Final", fiscal ID **null**, MINORISTA, no credit); `validarIdentificacionFiscal` (shared mod-11); credit cross-field rule `validarReglasCredito` enforced at client create/update; `desactivarCliente` already guards live sale references.

**New in 5b — a venta-side resolver use case** `resolverClienteParaVentaEnTx(tx, ctx, clienteId | null)`:
- `null` → `getOrCreateConsumidorFinalEnTx` → CF (B02 path; the docs/16 §3 "cliente opcional en contado" requirement, materialized because `Venta.clienteId` is NOT NULL).
- given → load (`clienteByIdEnEmpresa`), reject `CLIENTE_NO_ENCONTRADO` / `CLIENTE_INACTIVO`.
- **No fiscal re-validation at sale time** — the ID was validated at client create; B01-vs-B02 eligibility (contribuyente activo, RNC + razón social exact) is an **invoice-time concern → 5c**, and the credit blocking (límite/mora via derived balance) is 5c/Fase 6 because the CxC query needs invoices.
- Inline "registrar cliente nuevo" at POS = UI calling the existing `crearCliente` action, then the resolver with the new id. No venta code.
- **Inherited open item** (fiscal-id.ts header): the 11-digit corporate RNC check-digit variant is deliberately unresolved "until an accountant pins it in Fase 5b/5c" — surface to the user at proposal time; it only bites B01 issuance (5c) and RNC entry in the client form, but it is now *due* per the code comment.

## 7. Inventory Interplay in 5b

Confirmed: **no inventory writes in 5b**. docs/03 §5: "La salida de inventario se genera al confirmar la venta" — confirmation is 5c. Drafts impose no stock effects and (recommendation) **do not hard-block on insufficient stock** at draft time: no reservations exist in scope ("Las reservas de producto quedan FUERA de alcance"), and the authoritative check runs at 5c confirm inside the tx with row locks (the `ajustarStockEnTx` non-negative pattern), surfaced via the new inventario exit port `registrarSalidaVenta` (the `InventoryExitPort` seam already typed in `inventario/domain/inventario.ts`) — published **in 5c**, not before. 5b UI reads availability for display only via `obtenerInventarioPorProductoEnTx` / product listing (extend the producto search projection with quantity if needed).

## 8. First UI POS — Scope Decision for 5b

Two real forks:

**A. 5b ships a UI slice** (POS screen: product search by name/code with existence shown, ephemeral carrito with ±/numeric qty, client selector incl. "Consumidor Final" default, discount panel with role gate, always-visible totals: subtotal/descuento/ITBIS-exento/total per docs/16 §3 step 6, and "Guardar borrador" + my-drafts list/cancel). Confirmation/payment/receipt UI is NOT in this slice (it needs 5c). Pros: first interactive surface built when the domain is fresh; unblocks Penpot layout decisions #1/#5/#3/#10 with real feedback; the map already promised UI in 5b. Cons: a POS that cannot finalize a sale (fine inside a feature branch; customer value starts at 5c); ~+900–1,300 diff lines.
**B. 5b backend-only; all POS UI lands in 5c** where the flow can actually complete end-to-end. Pros: each UI PR ships a usable vertical; 5b shrinks to ~2 PRs. Cons: 5c grows to ~3–4 PRs and becomes the riskiest review unit of the phase.

Penpot reality check: `17-plan_wireframes.md` plans `02-Venta-Contado` / `02-Venta-Credito` boards (priority #2, "Operación #1 del día") and `Plan_de_trabajo_penpot.md` L70–114 enumerates the POS capabilities — but there is **no evidence the 02-Venta boards were actually designed** (docs/11's "APLICADO en Penpot" notes exist only for boards 07b/08c, and its wireframe-doubts log has no Ventas section). Before option A's PR starts, confirm the board state in the live Penpot file or run the decision points first.
**Recommendation**: A, but with the UI as a dedicated third chained PR so B remains the fallback by simply re-slicing.

## 9. Sizing + Chained PR Slicing (corrected with present-day evidence)

Calibration data from the actual tree: compra module = 3,725 LOC (domain 1,026 / application 1,385 / infra 755 / http 559, tests included) across two changes; cliente module (no calculators) = 2,996 LOC across one ~800-line change + chain. 5b is smaller than compra (no retentions, no NCF, no receipt) but adds UI. The map's 1,300–1,600 was **under-estimated** — it predates 5a's test-depth convention (unit + real-DB integration suites) and the UI scope. Corrected forecast ≈ **2,400–3,200 diff lines**, 3 chained PRs (each ≈400–1,300):

1. **PR 5b.1 — venta domain (pure)**: `venta/domain/` — `venta.ts` (enums mirror, `EstadoVenta` mapping fail-loud, `VentaResult`, error catalog), `calculators.ts` (line + totals + discount-before-ITBIS + mixed-rate proration), `descuentos.ts` rules, exhaustive unit tests incl. DGII matrix. ~550–750. **Needs user decisions: #1 precioVenta semantics, #2 proration/rounding policy sign-off, #3 discount-authorization semantics (Admin-only, autorizador = actor).**
2. **PR 5b.2 — application + infrastructure + http + config**: `crear/actualizar/cancelar/listar/obtener` use cases, `resolverClienteParaVenta`, `venta-repository` (guarded updateMany, replace-lines, RLS-scoped reads), `leerConfigVentaEnTx` + `seed-venta-config.ts` + seeding spec, `http/actions.ts` (+ validations, ESLint rule applies), unit + tenant/concurrency integration tests. ~1,100–1,400. **Needs decisions: #4 draft line-stock policy (warn vs. block), #5 client changeable on draft, #6 role gate (Despachador + Admin for sale ops).**
3. **PR 5b.3 — POS UI (option A only)**: first client component surface, ephemeral carrito, product search, client selector, discount panel, totals, drafts list. ~900–1,300. **Needs decision: #7 Penpot layout points (or explicit accept of defaults: split layout + always-visible search bar + native numeric input + 44–48px targets).**
If the user picks option B, drop PR 3 and re-forecast 5b at ~1,700–2,100 (PR 1–2), moving UI to 5c.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Rounding/proration of mixed 18/16/0 + pre-ITBIS discount mis-reports ITBIS** (DGII-visible; per-line rounded sums vs. header recompute can disagree by cents) | Freeze rounding order in spec; exhaustive domain test matrix BEFORE any DB wiring (compra `calculators.test.ts` precedent); draft recomputation at 5c confirm reads stored lines, never client totals |
| 2 | precioVenta semantics drift — choosing (a) later re-prices the entire product master | Resolve blocker #1 before specs; (b) documented as an ADR-style note in the design doc |
| 3 | Draft concurrency: two terminals editing one BORRADOR (POS + admin) | Guarded `updateMany` (compra precedent); UI re-reads after `CONCURRENCIA_CONFLICTO`; abandoned drafts surfaced via a "mis borradores" list (manual cleanup is acceptable in V1) |
| 4 | Discount applied by an unauthorized user (buttons hidden ≠ security; `descuentoAutorizadoPor` spoofed) | Server-side role gate in every action + audit of the actor/authorizer pair; discount 0 must not smuggle a non-zero `descuentoTipo` MONTO value (validate in `validarLinea`) |
| 5 | Cross-tenant leakage on the highest-traffic new tables | RLS enable+FORCE already applied; app-layer `empresaId`+`sucursalId` filters; ESLint `server-action-must-wrap-tenant`; venta integration tests mirroring `compra-tenant` / cliente PII suites |
| 6 | `DESC_MAX`/venta config missing at runtime (hard-fail blocks the counter) | Seed script + runbook note before 5b deploy (same convention as retencion-config seeding); explicit coded error, no legal-default fallback |
| 7 | ITBIS validity-window check adds a rejection path compra never had → hidden product-data debt (windows unset/expired) surfaces only at first sale | Integration test with expired-window product; dashboard KPI hook deferred but noted; error message names the product |
| 8 | First UI surface with no in-repo interactive precedent inflates estimates | Chained after backend PRs; option B fallback keeps 5b shippable without UI |

## Ready for Proposal

**Yes — conditional on one user decision.** The BLOCKER (precioVenta semantics, §2) must be resolved before the spec phase: recommend option (b) ITBIS-exclusive with full evidence above, plus the sub-decisions #2–#7 which the proposal can carry as open questions. Everything else (schema, lifecycle, seams, inventory boundary, resolver) has full ground truth and precedent coverage; no DB work is required.
