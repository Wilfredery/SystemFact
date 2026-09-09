# Exploration: fase-5-venta-exploracion

**Date**: 2026-09-09
**Change**: fase-5-venta-exploracion
**Status**: exploration-complete
**Type**: Map-only phase exploration (docs-only, precedent: `fase-3-4-inventario`). No detailed specs/design/tasks for sub-phases are produced here.

## Current State

### Schema (frozen ERD v4.7) — Fase 5 is DB-complete

Every Fase 5 table exists in `app/prisma/schema.prisma` and in applied migrations (`20260828184924_init_erd_v47` plus follow-ups):

| Model | Fase 5 role | Key facts |
|-------|-------------|-----------|
| `Cliente` | 5a | `tipoCliente` (MINORISTA/MAYORISTA/CREDITO), `creditoHabilitado`, `limiteCredito`, `plazoCreditoDias`, `esConsumidorFinal` + partial UK "one per empresa" (migration `20260901145709`), UK `(empresaId, identificacionFiscal)` |
| `Venta` | 5b | `estado: EstadoVenta` (BORRADOR/CONFIRMADA/CANCELADA), header discount structured (ADR-018: `descuentoTipo` + `descuentoAutorizadoPor`) |
| `DetalleVenta` | 5b | `tasaItbis` frozen per line, line discount structured, `Decimal(12,3)` qty / `Decimal(12,2)` money |
| `Factura` | 5c | `tipoNcf` **only B01/B02**, `estado: EstadoDocumento` (VIGENTE/CANCELADA/ANULADA), payment status (Pendiente/Parcial/Pagada) is **derived** (ADR-017), UK `(empresaId, ncf)`, **UK `(ventaId)`** → one sale bills at most once, `Empresa.facturaAutomatica` toggles atomic vs deferred issuance |
| `NotaCredito` + `DetalleNotaCredito` | 5d | B04 as own entity, `facturaOriginalId` FK, per-line `tipoReposicion` (VENDIBLE/DANADO), `MovimientoInventario.notaCreditoId` link |
| `NotaDebito` | deferred | B03 entity exists; recargos are mora-driven → recommend Fase 6/7 (see sub-phase cut) |
| `Pago` | 5c seam | COBRO/REEMBOLSO, V1 `MetodoPago` = EFECTIVO only, `correlativoRecibo` UK per empresa (its own sequence — **not** NCF, not yet implemented) |
| `NcfSecuencia` | 5c | UK `(empresaId, tipoNcf)` over B01–B04+B11, `rangoInicio/Fin`, `secuenciaActual`, `vigenciaInicio/Fin`, `activa` |
| `Anulacion` | 5c | polimórfico (`tipoDocumento` + `documentoId`, UK = annul once), `anuladaPor`, `autorizadaPor` (2nd-level auth) |
| `ConfiguracionEmpresa` | all | keys documented: `TASA_ITBIS`, `DESC_MAX`, `PLAZO_DEVOLUCION`, `PLAZO_CREDITO`, retentions; validity-windowed |

**No migration gaps detected.** The only schema-adjacent decisions: `Carrito` has **no model anywhere** (by design gap — see 5b), and `Pago.correlativoRecibo` needs a non-NCF sequence mechanism (Fase 6, seam reserved).

### Application code — zero Fase 5 coverage

- **No `cliente` module** (`src/modules/` = auth, categoria, compra, inventario, producto, proveedor, tenant). `Proveedor` is the direct CRUD/parity precedent.
- **No venta/factura code.** `NcfSecuencia` and `esConsumidorFinal` appear only in generated Prisma — the NCF sequence engine and the Consumidor-Final auto-creation exist in **no** business logic yet.
- **No UI screens for any completed module** — `src/app` has only `login` and `dashboard`. Fase 5 introduces the **first real interactive client screen** (POS-style Venta, touch-first per directives), a qualitatively new surface.

### Established patterns venta must reuse

- `withTenantTransaction(ctx, fn)` + RLS GUCs (ADR-019 defense-in-depth), `PrismaTx` composition (no nesting), project-local ESLint rule `systemfact/server-action-must-wrap-tenant`.
- **Atomic internal numbering precedent**: `asignarCorrelativoSiguienteEnTx` (compra) — `SELECT id FROM EMPRESA ... FOR UPDATE`, MAX+1 under the empresa lock, then one guarded `UPDATE ... WHERE estado='BORRADOR'` (`updateMany`) as the optimistic-lock/idempotency predicate (`CMP-%06d`).
- Guarded domain state machines: pure transition functions returning coded rejections (`transicionarConfirmar`, `estadoCompraDesdeDb` fails loud on unrepresentable states).
- Pure fiscal calculators with `decimal.js` and half-up 2dp money rounding (`compra/domain/calculators.ts`: `calcularLinea`, `calcularTotales`, `requiredRetentionKeys`, `calcularRetenciones`).
- Inventory ports: `registrarEntradasCompra` (tx-scoped use case called from the compra use case, not an HTTP-level integration), company-wide weighted-avg cost (`calcularNuevoCostoPromedioPorValor`), ownership-guard-before-write phases A/B/C.
- Config reads inside the transaction with hard failure on missing keys (`leerTasasRetencionEnTx` → `CONFIG_RETENCION_FALTANTE`, no legal-default fallback).
- Role gating in actions: `tieneRolPermitidoEnTx` with explicit role lists (`["Administrador","Operador"]`); `"Despachador"` exists in role vocabulary (tenant tests/docs) but **no action authorizes it yet**.
- Typed results `{ ok, code, message }` with stable error-code catalogs per module; audit rows in the same transaction.

## Phase-Level Inventory (roadmap Fase 5 → reality)

| Roadmap item | DB | Code | UI | Sub-phase |
|---|---|---|---|---|
| Clientes | ✅ complete | ❌ module missing | n/a (parity: no screens yet) | 5a |
| Carrito de venta | ❌ no model (deliberate — client-side TBD) | ❌ | ❌ first interactive screen | 5b |
| Facturas B01/B02 | ✅ | ❌ | ❌ list/detail/receipt | 5c |
| B04 devoluciones | ✅ | ❌ | ❌ | 5d |
| B03 nota débito | ✅ entity | ❌ | — | recommend **defer** (see cut) |
| B11 | ✅ | ✅ done in compra | — | — |
| Estados de factura | ✅ stored + derived | ❌ derived query not implemented | ❌ | 5c |
| Descuentos | ✅ ADR-018 fields | ❌ | ❌ | 5b (draft) + 5c (freeze on confirm) |

## Cross-Cutting Fiscal Contract

This is the contract every Fase 5 sub-phase must honor — it belongs in the phase-level proposal so sub-phase specs inherit it.

### NCF sequence engine (5c — the riskiest primitive in the project)

1. One row per `(empresaId, tipoNcf)` (`NCF_SECUENCIA` UK) — B01/B02 for invoices, B03/B04 for notes, B11 (already used by compra reads? no — unused to date).
2. **Atomic consumption**: row-lock (`SELECT ... FOR UPDATE` on the `NCF_SECUENCIA` row) inside `withTenantTransaction`, then guarded increment. The compra empresa-level lock precedent must be **narrowed** to the per-type row (higher branch concurrency: two branches sharing one empresa must not serialize on one another's type row, and never collide).
3. **Consume on CONFIRM, never on draft**; the correlativo stays consumed even when the document is later Cancelada/Anulada — **NCFs are never recycled**.
4. Rango exhaustion and vigencia expiry **block** issuance (`vigenciaInicio/Fin`, evaluated in `America/Santo_Domingo` per the date directives — never server-local or device time).
5. Warning at **90%** of the authorized range — surfaced in the confirm flow and (later) dashboard KPIs.
6. 19-digit DGII string composition (tipo + emisor RNC + sucursal/terminal + 8-digit sequence): **not specified in any current doc** (`docs/11` only says "según especificación DGII"). The exact mask must be pinned in the 5c design.
7. Document-level uniqueness is already guaranteed at DB level (`UK (empresaId, ncf)` on Factura/NotaCredito/NotaDebito/Compra).

### Inverted totals: venta side vs compra

- Compra: `costoUnitario` + ITBIS = credit fiscal. Venta: `precioUnitario` + per-line `tasaItbis` (18/16/0 mixed, frozen at save, validity-checked) = output ITBIS. Same calculator shape, opposite fiscal meaning; both report into IT-1/606/607 (Fase 7 consumes — Fase 5 only needs to store the correct breakdown: `subtotalGravado`, `itbis`, `subtotalExento`, `total`).
- **Open product decision**: whether `Producto.precioVenta` is stored ITBIS-exclusive (additive model, consistent with Compra lines) or tax-inclusive (B02 retail convention). No doc settles it; the domain calculator and the POS display depend on the answer. Must be asked before 5b specs.
- Discount before ITBIS (ADR-018): header discount proration across `subtotalGravado`/`subtotalExento` before computing ITBIS (ERD design note), line discounts per ADR-018, `DESC_MAX` (default 4%, DB param) enforced with `descuentoAutorizadoPor` capture; post-invoice discounts are **only** B04s.

### B04 reversal (5d)

- Never modifies the original invoice; always references `facturaOriginalId`; reverts ITBIS per line (`DetalleNotaCredito.tasaItbis` frozen at return time).
- Inventory effect per line: `VENDIBLE` → `ENTRADA_DEVOLUCION`, `DANADO` → `SALIDA_MERMA`, both linked via `MovimientoInventario.notaCreditoId`.
- Term: `PLAZO_DEVOLUCION` param (default 15 days, SD-timezone arithmetic); returned quantity per line must never exceed sold quantity **accumulated across all B04s of that invoice** (derived, no new table).
- Cash effect (paid invoice → reembolso/saldo a favor) is Fase 6 — 5d writes the B04 + inventory only, and the derived-balance formula (ADR-017) automatically reduces CxC.

### Estado transitions (Cancelada vs Anulada — the 607/608 fork)

- `VIGENTE → CANCELADA`: internal operation discarded, **no fiscal effect** — not reported in 607; NCF stays consumed ("no utilizado"); stock re-enters via `REPOSICION_CANCELACION`; motivo required.
- `VIGENTE → ANULADA`: **fiscal effect** — NCF consumed and reported in **608**; requires Admin (or explicit role), motivo from catalog, `Anulacion` row (UK = annul-once), 2nd-level `autorizadaPor` for amounts > RD$10,000 **or** outside the same SD-timezone day; if the document already reached the customer, the correct instrument is a B04 instead.
- Venta `CANCELADA` (draft discarding) vs Factura `CANCELADA/ANULADA` are distinct lifecycles; `EstadoVenta` has no ANULADA — the document state machine and the operation state machine must stay separate, mirroring `compra/domain/compra.ts` (fail-loud exhaustive mapping).

## Proposed Sub-Phase Cut

Dependency order is strict: 5a → 5b → 5c → 5d. Sizes calibrated against precedents (compra-core ≈1,400 lines; router change ≈1,000; project review budget 800 lines/change → chained PRs where noted).

| Sub-phase | Scope (map) | Est. size | PR shape |
|---|---|---|---|
| **5a — Clientes** | Cliente module mirroring Proveedor: CRUD + paginated listing, per-empresa fiscal-ID uniqueness, credit fields, Consumidor-Final provisioning, RNC/cédula mod-11 validation (shared validator — prove/compra parity), audit. No UI. | ~700–900 | single PR |
| **5b — Venta core (draft-first, no NCF)** | Venta domain (draft lifecycle, ADR-018 discount calculators, mixed-ITBIS sale calculators reusing the compra calculator shape), draft create/edit/void-draft use cases + actions, stock-availability reads, **first POS UI** with client-side carrito. | ~1,300–1,600 (UI-heavy) | 2 chained PRs (domain+actions, then UI) |
| **5c — NCF engine + fiscal confirm** | Sequence consumption (atomic, 90%/exhaustion/vigencia), invoice issuance on confirm (respect `Empresa.facturaAutomatica`), SALIDA_VENTA inventory debit via a new inventario exit port, in-sale cash payment (contado → Pago + derived Pagada) or Pending for credit customers (incl. credit-limit/mora blocking via the canonical derived-balance query), Cancelada/Anulada transitions + Anulacion + REPOSICION_CANCELACION, invoice listing/detail + receipt presentation. | ~1,500–1,900 | 2–3 chained PRs (engine, confirm+inventory, states/anulación+UI) |
| **5d — Devoluciones B04 (+ post-invoice discount)** | Original-invoice search, plazo validation, per-line partial returns with `tipoReposicion`, B04 sequence consumption, inventory reversal, derived-balance effect, returns UI. | ~900–1,200 | single or 2 PRs |

**Why this cut**: it mirrors the fase-3-4 precedent exactly (domain first, integration second, fiscal-mutating last), isolates the two highest-risk primitives (5c NCF engine; 5b fiscal math) into reviewable units, and each boundary ships independently usable product. **B03 (Nota de Débito) is recommended deferred** to Fase 6/7: recargos arise from mora, which needs collections + aging that ship there; the entity/sequence already exist so nothing is retrofitted.

### Product decisions required per sub-phase

- **5a**: (1) Consumidor Final: lazy-create on first anonymous sale vs seed per empresa on creation; (2) edit rules for credit fields (`limiteCredito`, `plazoCreditoDias`) — who may change, audit expectations.
- **5b**: (3) `precioVenta` net vs ITBIS-inclusive (blocking for calculators + UI); (4) carrito persistence: ephemeral state vs localStorage vs "held sale" (roadmap says only "Carrito de venta" — recommend ephemeral, YAGNI); (5) whether anonymous (no-client) sales are allowed in draft — docs §3 says client optional for contado → maps to Consumidor Final.
- **5c**: (6) NCF string mask (DGII composition incl. sucursal/terminal digits) — needs the accountant/DGII reference pinned; (7) is `facturaAutomatica=false` (deferred invoicing) UI/workflow in V1 scope or always-atomic in 5c?; (8) confirm-time idempotency key (docs/19 demands a pre-generated key for confirm actions; compra satisfied it with the guarded predicate — decide the stricter reading for multi-table money writes); (9) receipt/print format (Penpot decision #7) — browser print acceptable?; (10) credit-sale blocking thresholds wiring (mora >30 days param — confirm config key).
- **5d**: (11) paid-invoice return UX in V1: B04 + "saldo a favor" only (no reembolso without cash module) — confirm; (12) mixed vendible/damaged per-line input pattern (Penpot).

## Seams Strategy

### Consumed from compra/inventario (reuse, don't reinvent)

| Primitive | Source | Venta use |
|---|---|---|
| Guarded-confirm + atomic correlativo under row lock | `compra-repository.asignarCorrelativoSiguienteEnTx` / `confirmarCompraEnTx` | shape of `consumirSecuenciaNcf` (narrowed to NCF_SECUENCIA row per tipo+empresa) |
| `registrarEntradasCompra` (tx-scoped cross-module port) | inventario | **new inventario exit port** `registrarSalidaVenta` (SALIDA_VENTA, non-negative guarded update — the `ajustarStockEnTx` non-negative pattern), plus `registrarEntradaDevolucion` (ENTRADA_DEVOLUCION/SALIDA_MERMA by `tipoReposicion`, `notaCreditoId` link) and `reponerPorCancelacion` (REPOSICION_CANCELACION) — published **in** the sub-phase that needs them (5c/5d), same composition style compra 3.4b used |
| Pure calculators with decimal.js + half-up | `compra/domain/calculators.ts` | venta calculators incl. discount-before-ITBIS proration |
| Config-in-tx with hard-fail | `leerTasasRetencionEnTx` | `leerConfigVentaEnTx` (`TASA_ITBIS`, `DESC_MAX`, `PLAZO_DEVOLUCION`, credit params) + a venta-side seeding spec mirroring `retencion-config-seeding` |
| Role gate + audit helpers | `tieneRolPermitidoEnTx`, `registrarAuditCompraEnTx` | Despachador becomes the **first real non-Admin operational role** in actions (also requires confirming role seeds exist per deployment) |

### Reserved for later (do not build now)

- **Fase 6 (Cobros)**: `Pago` writes are minimal in 5c (in-sale contado payment + derived status display); collections UI, partial abonos, caja close, `correlativoRecibo` sequence mechanism, B03 recargos, IR-17/tarjeta methods (payment "strategy/extensibility" structure per docs/19 §code-practices) stay out — the ADR-017 canonical derived-balance query is the **published seam** Fase 6 consumes, so locate it as a shared read service in 5c, not buried in venta internals.
- **Fase 7**: nothing fiscal-data-shape-wise beyond the stored breakdown (607/608 need `estado`, NCF consumed flags, ITBIS split — already satisfied).
- **e-CF**: out of V1 (docs/03 §15) — but keep the ComprobanteFiscal-ready mindset: don't store derived NCF strings in a way that can't be re-derived/serialized later. Minor: Factura has no `descuentoTipo/autorizadoPor` (they live on Venta) — fine for venta-origin invoices; flag in 5c design if invoice-without-venta ever surfaces.

## Risks → Sub-phase Mapping

| # | Risk | Severity | Sub-phase mitigation |
|---|---|---|---|
| 1 | NCF sequence exhaustion/vigencia blocks the sales counter (no fallback path) | **Critical/fiscal** | 5c: block must be explicit and tested; 90% warning visible in confirm flow + dashboard KPI hook |
| 2 | Mixed 18/16/0 + discount proration mis-rounds ITBIS (DGII-visible errors) | **High/fiscal** | 5b: pure calculators with exhaustive unit tests before any DB wiring; freeze at confirm, recompute server-side from stored lines (compra precedent) |
| 3 | Double-confirm / two registers racing the same sequence or stock row | **High** | 5c: row-locked consumption + guarded `UPDATE...WHERE estado` + idempotency decision (#8); integration tests on Supabase (compra-concurrency precedent) |
| 4 | B04 over-return (quantity > sold, across multiple notes) | Medium/fiscal | 5d: derived per-line accumulator test matrix |
| 5 | Cancelada-vs-Anulada conflated (wrong 607/608 reporting) | Medium/fiscal | 5c: two distinct use cases + state-machine tests; naming in code mirrors doc vocabulary |
| 6 | Cross-tenant leakage on high-surface new tables (ventas/facturas per-cashier traffic) | **Critical/security** | all: RLS (already enabled/forced) + ESLint tenant-action rule + `empresaId`/`sucursalId` filters + integration isolation tests (venta equivalents of `compra-tenant.integration.test.ts`) |
| 7 | First interactive UI (POS) without in-repo precedent — touch-first, fiscal ops never optimistic | Medium/delivery | 5b/5c: UI PRs chained after domain PRs; disable-confirm-once patterns; Penpot decisions listed above |
| 8 | `precioVenta` semantics ambiguity propagates through all calculators and UI | Medium | resolve before 5b specs (decision #3) |
| 9 | Credit-sale blocking needs CxC derived query which needs invoices (build order) | Low | 5c ships the canonical query; 5a only stores credit fields |
| 10 | Consumidor-Final lazy creation races (partial UK) | Low | 5a/5b: upsert under empresa lock or catch-unique-retry pattern |

## Ready for Proposal

**Yes.** This change (docs-only) can proceed to `sdd-propose` as the phase-level map + sub-phase cut, exactly like the `fase-3-4-inventario` precedent. After it archives, the orchestrator should launch the standard SDD cycle per sub-phase starting at **5a (Clientes)**, and surface the 12 product decisions above to the user — decisions #3 (precioVenta net vs gross) and #6 (NCF string mask) are the two that must not be guessed by the implementing agent.
