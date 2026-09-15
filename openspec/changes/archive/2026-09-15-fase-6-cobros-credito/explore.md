# Exploration: fase-6-cobros-credito — Cobros y Crédito (Collections & Credit)

**Phase**: sdd-explore | **Store**: hybrid (file `openspec/changes/fase-6-cobros-credito/explore.md` + Engram `sdd/fase-6-cobros-credito/explore`) | **Date**: 2026-09-15

## Current State

### Payments exist in the schema but not in the application layer

The `PAGO` model is fully provisioned in ERD v4.7 (`app/prisma/schema.prisma:579-602`) — schema-only. A codebase-wide search proves there is **zero application code that creates or reads a `Pago`**: the only hits for `COBRO`/`REEMBOLSO`/`correlativoRecibo` are inside `app/src/generated/prisma/**` (the generated client). There is no `pago`/`cobros` module. Phase 6 therefore owns the **entire payment lifecycle from scratch**: collections, partial payments/abonos, receipts, refunds, CxC, credit enforcement.

Relevant frozen schema pieces (already present, no core migration required):
- `Pago`: `facturaId` FK→FACTURA, `metodoPago` (enum `MetodoPago` = **only `EFECTIVO`**), `monto Decimal(12,2)`, `estado EstadoPago`, `tipo TipoPago`, `autorizadoPor Int?` (FK→USUARIO, authorizer of a `REEMBOLSO`), `correlativoRecibo Int` with `@@unique([empresaId, correlativoRecibo])` (the printable receipt number).
- `enum EstadoPago { REGISTRADO, APLICADO, REVERTIDO }`, `enum TipoPago { COBRO, REEMBOLSO }` (frozen — AGENTS.md).
- `Factura.estado` is fiscal-only (`VIGENTE/CANCELADA/ANULADA`); the payment state (`PENDIENTE/PARCIAL/PAGADA`) is **derived, never stored** (schema comment line 482, ADR-017).
- `Cliente` carries the credit terms already: `creditoHabilitado Boolean`, `limiteCredito Decimal(12,2)`, `plazoCreditoDias Int` (`schema.prisma:308-310`), plus `TipoCliente.CREDITO`. Defaults are pinned in `cliente/domain/cliente.ts:74-75` (`LIMITE_CREDITO_DEFAULT = "0.00"`, `PLAZO_CREDITO_DIAS_DEFAULT = 30`). `ConfiguracionEmpresa` key `PLAZO_CREDITO` exists.

### Derived balance — the canonical formula (ADR-017, exact)

From `docs/12-decisiones_de_arquitectura.md:485-488`:
> CxC per invoice = `FACTURA.total` − Σ `PAGO.monto`(`tipo=COBRO` **AND** `estado=APLICADO`) − Σ `NOTA_CREDITO.monto`(VIGENTE) + Σ `NOTA_DEBITO.monto`(VIGENTE), for `FACTURA.estado=VIGENTE` only.

Two consequences that drive phase 6 design:
1. A collection only reduces CxC once it is `APLICADO`. The `REGISTRADO → APLICADO` semantics are **undefined in code today** — phase 6 must decide (recommend: a payment bound to a single `facturaId` is `APLICADO` at creation inside the same transaction, or `REGISTRADO` then atomically `APLICADO`; a two-phase allocation is not needed under YAGNI given the per-invoice FK).
2. `REEMBOLSO` is **not** in the CxC formula (only `COBRO`). A refund is a separate ledger row (money out to the customer after a paid invoice is returned/credited) feeding cash-close and audit — it does not re-open a receivable. This separates the refund flow from balance derivation.

A single canonical query/service must feed the CxC board, aging, mora and credit-blocking (ADR-017: "consulta canónica única"; AGENTS.md perf: SQL aggregation via `aggregate`/`groupBy`, no N+1).

### Explicit deferrals from prior fases point here

- `resolver-cliente-venta.ts:13-15`: "credit-bearing clients are allowed at draft (B01/B02 eligibility + **credit/mora blocking are deferred to 5c/Fase 6**)". So the **credit-sale gate at confirm is unbuilt** — `venta/domain/errors.ts` (frozen 24-code catalog, max code 605) contains **no credit / limit / mora / overdue codes**.
- Archived `fase-5d` exploration (HIGH risk #2 + Open Question #1): "actual refund processing (creating a `PAGO REEMBOLSO`) requires Fase 6 pagos". This is the **mandatory-flagged REEMBOLSO idempotency gap**.
- Fase-5 `confirmarVenta` never writes a `Pago` — not even for a cash ("contado") sale. A cash sale today produces a VIGENTE invoice whose derived balance equals the full total, i.e. it would surface as **PENDIENTE** unless phase 6 registers a `COBRO` at confirm. This is a real cross-phase correctness seam to resolve (see Risks).

### Proven patterns to reuse (do not reinvent)

- **Idempotency gate template (R-D5)** — `devolucion/application/crear-devolucion.ts:224-245` + `devolucion/infrastructure/devolucion-repository.ts:92-128` (`existeDevolucionIdenticaEnTx`) + `integration/devolucion-idempotencia.integration.test.ts`. An identity re-check run **inside the caller's transaction, BEFORE any write and BEFORE the sequence burn**, returns a coded rejection (`DEVOLUCION_YA_REGISTRADA`) with a minimal locator. The directive that governs it (`docs/19-directivas_desarrollo.md §10`, line 196) is explicit: *"Toda acción que CONFIRMA o muta dinero/inventario/NCF es idempotente: reenviar el mismo intento NO duplica efectos. Las Server Actions de confirmación exigen **clave de idempotencia generada antes del primer envío**."*
- **Collection concurrency** (`docs/19 §10`, line 200): "Two concurrent collections on the same invoice: the second recomputes the pending balance **inside its transaction**; if it exceeds the outstanding amount, it is rejected." Requires a new stable code (e.g. `COBRO_EXCEDE_SALDO`).
- **Per-tenant sequence generator** — `compra/infrastructure/compra-repository.ts:401-433` (`asignarCorrelativoSiguienteEnTx`): `MAX(numeric-suffix)+1` under an `EMPRESA ... FOR UPDATE` row lock, cross-branch via clearing only the sucursal GUC, int-cast to avoid BigInt. `correlativoRecibo` is an `Int` unique per empresa → needs the analogous lock-serialized integer generator (no NCF; a receipt is not a fiscal document — `docs/06-flujos:169`).
- **NCF engine** — `ncf/application/consumir-ncf.ts` (`consumirNcfEnTx`) is already type-agnostic over `TipoNcf`; `B03` (Nota de Débito) is in `TipoNcfSecuencia` but has **no emission flow** (5d shipped only B04 credit notes).
- **Thin adapter** — `devolucion/http/actions.ts` (zod → session ctx → `withTenantTransaction` → coarse role check → delegate → typed envelope), enforced by ESLint rule `systemfact/server-action-must-wrap-tenant`.
- **Reversal orchestration** — `venta/application/venta-service.ts` `cancelarVentaConfirmada` (guarded flip → annul → stock restore THROW-on-reject → audit), inside `withTenantTransaction`.

### Business rules that define phase 6 scope (`docs/03`, `docs/16`, `docs/05 §12`)

- Payments are separate from sales; a single invoice may be paid by multiple payments/abonos (e.g. 5,000 + 10,000 = 15,000).
- V1 payment method: **EFECTIVO only**; NO cheques, NO card/terminal (confirmed by the business; do not widen `MetodoPago`).
- A `recibo de cobro` is issued per payment, reprintable; no additional fiscal document.
- Credit: only `TipoCliente.CREDITO` generates an outstanding balance; configurable `limiteCredito` (default 0), `plazoCreditoDias` (default 30, range 15-30); **alerts at 80-90% of limit and in mora (≥ 1 day)**; **block new credit sales** for clients with invoices **overdue > 30 days** or **over limit**; RNC/cédula mandatory for credit clients.
- Refund effect of a B04 on a paid invoice: **saldo a favor o reembolso with authorization** (`Pago.autorizadoPor`).
- Invoice state catalog visible in Cobros: **Pendiente / Parcial / En Mora** (red > 30 days).

## Affected Areas

- `app/src/modules/cobros/` (NEW module, ADR-013: `domain/` + `application/` + `infrastructure/` + `http/`) — owns the `Pago` aggregate: register collection (`COBRO`), partial/abono, refund (`REEMBOLSO`), receipt `correlativoRecibo` generation, derived balance/payment-state, credit eligibility & blocking, CxC/aging queries. (Naming decision: `cobros` vs `pago` — the business module is "Cobros"; the model is `Pago`.)
- `app/src/modules/venta/application/confirmar-venta.ts` + `application/resolver-cliente-venta.ts` — add the deferred credit/mora/limit gate calling a cobros/credit use case; possibly register a `COBRO` at confirm for the cash ("contado") hybrid flow.
- `app/src/modules/venta/domain/errors.ts` — either extend (devolucion piggybacked here) or, preferred, keep collection codes in a **new cobros catalog**; keep single-source, no ad-hoc codes.
- `app/prisma/schema.prisma` + migration — core is schema-ready; a migration is required **only if** the REEMBOLSO idempotency uses a stored idempotency key (Approach A2 below) or if an `EstadoPago`/allocation column is needed. Money/quantity types already `Decimal(12,2)`/`Decimal(12,3)`.
- `app/src/modules/venta/infrastructure/venta-repository.ts` or new cobros repo — read helpers: `tieneRolPermitidoEnTx` reuse; Cobrador/Administrador role gate for collections (Despachador is denied `Cobros`, `docs/04:176,190`).
- `app/tools/scripts/seed-*` / config seeding — confirm `PLAZO_CREDITO` config row is seeded per tenant; no NCF seed needed for receipts (optionally B03 if debit-note emission is scoped in).
- `app/src/modules/cobros/ui/` — Cobros board (pendientes + "próximas a vencer"), payment form (first-click disable), receipt view/print, customer estado de cuenta.
- `app/src/integration/*` — new integration tests (RLS-enforced, real Postgres): collection over-payment rejection, refund idempotency, credit-block, derived-balance correctness incl. mixed `APLICADO`/`REVERTIDO`.

## Approaches

### 1. REEMBOLSO idempotency gate (MANDATORY surfaced item)

| Option | Mechanism | Pros | Cons | Effort |
|--------|-----------|------|------|--------|
| **A1 — Identity-based dedup (mirror R-D5)** | Inside tx, before insert + receipt burn, reject a prior `REEMBOLSO` Pago with same (facturaId, monto, autorizadoPor/window) | Zero migration; proven pattern; single source | Legitimate **second equal refund** is mis-classified as retry; money semantics differ from a return line | Low |
| **A2 — Client idempotency key (directive-aligned)** *(recommended)* | Add nullable `(empresaId, idempotencyKey)` unique column to `PAGO`; action generates the key before first submit (docs/19 §10 literal requirement); insert is upsert-guarded | True double-submit safety; allows repeated legitimate refunds; matches the written directive | One additive migration + adapter key plumbing; needs conflict code | Medium |
| **A3 — State-machine + row lock** | Model a second refund as reversal; lock the FACTURA row `FOR UPDATE`, derive, reject | No new column; strong serialization | `REVERTIDO` is for reversing a payment, not blocking a duplicate; conflates two concerns | Medium |

**Recommendation: A2**, optionally hardened with an A1 identity fallback for the same-key replay. The directive explicitly mandates an idempotency **key** generated before the first submit for money mutations, and refunds can legitimately repeat with equal amounts — identity-only dedup would over-block. It must carry a stable rejection code (new catalog entry, continuing the 600-series if the venta catalog is reused, e.g. `REEMBOLSO_YA_REGISTRADO`/`PAGO_IDEMPOTENCIA_CONFLICTO`).

### 2. Collections module placement

- **B1 — Dedicated `cobros` module** *(recommended)*: full ADR-013 layering, owns `Pago`, its own error catalog; venta/compra are precedents with their own catalogs.
- B2 — Extend `venta`: fewer hops but blurs boundaries (venta module becomes a god module for money); violates per-module isolation.

### 3. Credit-sale enforcement location

- **C1 — Gate inside `confirmarVenta`** *(recommended)*: at confirm (not draft, honoring the deferral note) call a cobros/credit use case that runs the canonical CxC query + `limiteCredito` + overdue `plazoCreditoDias` (computed in `America/Santo_Domingo`) and rejects with a stable code; keep it a thin cross-module port (no ORM leak).
- C2 — At POS draft: rejected — the frozen note says drafts must stay open for credit clients.

### 4. Derived balance & payment state

- **D1 — Canonical SQL aggregate query/service** reused by CxC board, aging, mora and blocking (perf: aggregate on the DB, no N+1) **+ D2 pure domain classifier** `clasificarEstadoPago(balance, total)` → `PENDIENTE/PARCIAL/PAGADO` and `enMora(fechaVencSD, nowSD)` for single-invoice logic and unit tests (domain stays DB-free). This split satisfies both ADR-017 (single canonical source) and the pure-domain rule.

## Recommendation

Build a dedicated **`cobros`** module that owns the `Pago` aggregate: (1) collections with partial/abono + lock-serialized `correlativoRecibo` + in-tx over-payment rejection; (2) refunds (`REEMBOLSO`) with an **explicit idempotency-key gate (Approach A2)** surfaced as a first-class task from the proposal onward; (3) derived balance/payment-state via one canonical aggregate query plus a pure classifier, in Santo Domingo time; (4) credit eligibility/limit/mora gate added at `confirmarVenta`, consuming that canonical query through a thin port. Core needs **no schema change except the optional idempotency-key column**; do not widen `MetodoPago`; keep money in `Decimal` end-to-end and every mutation inside `withTenantTransaction`.

## Risks

### CRITICAL
- **REEMBOLSO double-spend (mandatory flag)**: without the gate, a re-submitted refund writes two `Pago(REEMBOLSO)` rows and mints two receipts. The proposal MUST carry an explicit idempotency task + stable error code; recommend the A2 idempotency key per `docs/19 §10`.
- **Derived-balance filter correctness**: CxC must count **only** `tipo=COBRO AND estado=APLICADO` and exclude `REVERTIDO`. A wrong state filter silently mis-states every receivable and every credit block. Cover with an integration test across mixed payment states.
- **Cash-sale correctness seam**: today a "contado" sale creates no `Pago`, so its derived balance equals the full total → it looks PENDIENTE. Phase 6 must either register a `COBRO` at confirm (retrofit `confirmarVenta`) or the CxC board will misclassify cash invoices. **Needs a user decision.**
- **Receipt sequence atomicity**: `correlativoRecibo` is `Int` `@@unique([empresaId, correlativoRecibo])`; concurrent payments must serialize the `MAX+1` under a row lock (reuse `asignarCorrelativoSiguienteEnTx`), else duplicate-key abort. The reject-before-burn ordering (idempotency) must precede receipt allocation, mirroring R-D5.
- **Cross-module coupling for the credit gate**: `confirmarVenta` must reach CxC/limit/mora without leaking the ORM or duplicating the canonical query; expose it as a narrow use-case port and keep both sides tenant-scoped.

### WARNING
- **`EstadoPago` two-phase semantics undefined**: `REGISTRADO` vs `APLICADO` has no code yet; decide APLICADO-at-create vs a separate apply/allocation step (YAGNI: per-invoice FK argues for create→APLICADO).
- **Scope — daily cash close**: roadmap lists "Cierre diario de caja" in Fase 6, but there is **no CIERRE_CAJA entity** (V1) and acceptance/design place it as a derived report in module Caja (`efectivo esperado = cobros − devoluciones`). Decide in-slice vs defer to phase 7 reports.
- **Scope — Nota de Débito B03**: schema + `TipoNcfSecuencia.B03` exist and B03 raises CxC in the ADR-017 formula, but there is **no emission flow** (5d shipped only B04). Include debit-note emission or explicitly defer; otherwise the `+ Σ NOTA_DEBITO` term is always empty.
- **Error-catalog home**: devolucion extended the venta catalog (cross-module reuse); prefer a new cobros catalog for cohesion. Whichever is chosen, keep a single source and forbid ad-hoc codes (directivas §9).
- **Concurrency of two collections** on one invoice must recompute pending inside the tx and reject overpayment (`COBRO_EXCEDE_SALDO`), per `docs/19 §10` line 200 — not check-then-write outside the transaction.
- **Money/rounding & locale**: `Decimal(12,2)` throughout, no float; `Intl es-DO` formatting only at the UI boundary.
- **Multi-tenancy**: every CxC/payment query pins `empresaId` (+ `sucursalId` where applicable) and runs under the RLS GUCs; collections are per-branch (Cobrador operates on assigned branch).

## Ready for Proposal

**Yes** — proceed to `sdd-propose`. Three scope decisions should be confirmed with the user during proposal:
1. **Idempotency approach for REEMBOLSO**: A2 idempotency-key (recommended, migration) vs A1 identity-only dedup (no migration).
2. **Cash-sale flow**: does phase 6 register a `COBRO` at `confirmarVenta` for "pago de contado" (retrofit fase-5), or is that handled elsewhere?
3. **Slice scope**: include daily-cash-close report and/or Nota-de-Débito B03 emission in fase-6, or defer them (cash-close → phase 7 reports; B03 → separate change)?

The REEMBOLSO idempotency gate (mandatory flag) is reflected above as a CRITICAL risk and must appear as an explicit task from the proposal onward.
