# Exploration: fase-5d-devolucion-b04 — Devoluciones (Nota de Crédito B04)

**Phase**: sdd-explore | **Store**: hybrid (file + Engram `sdd/fase-5d-devolucion-b04/explore`) | **Date**: 2026-09-10

## Current State

### What exists today

**Venta lifecycle** (5b+5c merged): Draft → Confirm (B01/B02 NCF consumed, SALIDA_VENTA emitted, FACTURA VIGENTE created) → Cancel (CONFIRMADA → CANCELADA, FACTURA → ANULADA, REPOSICION_CANCELACION restores stock, NCF NOT rewound). The cancellation flow (`cancelarVentaConfirmada` in `venta-service.ts`) is the canonical reversal pattern: guarded flip → invoice annul → stock reposition (THROW-on-reject) → audit.

**NCF engine** (`modules/ncf/`): `consumirNcfEnTx` accepts any `TipoNcf` ("B01" | "B02" | "B03" | "B04" | "B11") — the engine is already type-agnostic. It locks the `empresaId + tipoNcf` row FOR UPDATE, validates range active/not-exhausted/not-expired (SD calendar day), advances the pointer, composes `B<tipo><%08d>`, and attaches the 90% warning. B04 consumption is already supported by the engine — no engine changes needed.

**Schema (ERD v4.7)** already provisions everything for devoluciones:
- `NOTA_CREDITO` table: `facturaOriginalId` FK → FACTURA, `ncf` (always B04), `estado` (VIGENTE/CANCELADA/ANULADA), `motivo`, `monto`, `itbis`, `fechaEmision`, tenant/branch/user FKs
- `DETALLE_NOTA_CREDITO` table: `notaCreditoId` FK, `productoId`, `cantidad`, `precioUnitario`, `tasaItbis`, `itbis`, `subtotalLinea`, `tipoReposicion` (VENDIBLE → ENTRADA_DEVOLUCION / DANADO → SALIDA_MERMA)
- `MovimientoInventario.notaCreditoId` FK (optional) — already linked
- `TipoMovimiento` enum includes `ENTRADA_DEVOLUCION` and `SALIDA_MERMA`
- `TipoReposicion` enum: `VENDIBLE` / `DANADO`
- `ConfiguracionEmpresa` keys already include `PLAZO_DEVOLUCION` (docs/19-directivas L141)

**Zero application code** references `NotaCredito`, `DetalleNotaCredito`, or `ENTRADA_DEVOLUCION` — the schema is ready but no use case, repository, or action exists.

### What the business rules require (docs/03-reglasNegocioFact.md §10, §11)

1. **B04 Nota de Crédito** is a fiscal document that reduces the original invoice's CxC (ADR-017 derived balance formula: `FACTURA.total − Σ COBRO − Σ NC(VIGENTE) + Σ ND(VIGENTE)`)
2. Original FACTURA **never modified** — stays VIGENTE with a linked NC
3. NC only for CONFIRMADA sales (BORRADOR has no fiscal effect → no NC)
4. Return window: configurable (default 15 days from sale date, read from `ConfiguracionEmpresa` key `PLAZO_DEVOLUCION`)
5. Partial returns allowed (line-by-line, quantity ≤ original line quantity)
6. Inventory: VENDIBLE → `ENTRADA_DEVOLUCION` (restores stock); DANADO → `SALIDA_MERMA` (records loss)
7. ITBIS reversed via B04 (computed from returned lines, not a flat total)
8. Payment effect: paid → refund/credit; partial → reduce pending; unpaid → reduce/eliminate debt
9. NC itself can be VIGENTE/CANCELADA/ANULADA (same fiscal doc states as FACTURA)
10. NC against an ANULADA original is impossible (the original has no fiscal effect to reverse)
11. Audit: every NC creation, every inventory movement, append-only

## Affected Areas

- `app/src/modules/devolucion/` — **NEW MODULE** (domain + application + infrastructure + http)
- `app/src/modules/venta/infrastructure/venta-repository.ts` — new read helpers (ventas por factura original, stock por línea)
- `app/src/modules/venta/http/actions.ts` — new `devolverVentaAction` server action
- `app/src/modules/inventario/application/registrar-salidas-venta.ts` — new `registrarDevolucion` use case (ENTRADA_DEVOLUCION or SALIDA_MERMA)
- `app/src/modules/venta/ui/` — DevolverButton in sale detail/list
- `app/src/modules/venta/infrastructure/config-repository.ts` — extend to read `PLAZO_DEVOLUCION`
- `app/tools/scripts/seed-ncf.ts` — add B04 range provisioning
- `app/prisma/schema.prisma` — **ZERO migrations** needed (all models/enums already exist)

## Approaches

### 1. Dedicated `devolucion` module (ADR-013 modular monolith)

New `src/modules/devolucion/` with full layering:
```
src/modules/devolucion/
  domain/           # devolucion.ts (pure: return rules, quantity validation, window check)
  application/      # crear-devolucion.ts (use case: validate → consume B04 → create NC → inventory → payment effect)
  infrastructure/   # devolucion-repository.ts (NC/NC-detail/inventory writes, audit)
  http/             # actions.ts, validations.ts
```

- **Pros**: Follows ADR-013 exactly (domain purity, thin adapters, no N+1); clear ownership; testable domain layer; consistent with how venta/compra are structured
- **Cons**: New module boundary (but it IS a distinct business domain — returns ≠ sales ≠ purchases)
- **Effort**: Medium

### 2. Extend `venta` module with `devoluciones/` subdirectory

Place devolucion use cases inside `modules/venta/` as a sibling to `application/`:
```
src/modules/venta/
  devoluciones/     # domain + application + infrastructure
  http/             # extend actions.ts
```

- **Pros**: Closer to the source data (venta reads, factura reads); fewer import hops
- **Cons**: Blurs module boundaries; venta module grows; harder to reason about venta-only vs return behavior; violates ADR-013 per-module isolation
- **Effort**: Low

### 3. Minimal: extend `cancelarVentaConfirmada` pattern directly

Add a `devolverVenta` function to `venta-service.ts` following the exact cancel pattern.

- **Pros**: Lowest effort; mirrors proven code
- **Cons**: venta-service.ts becomes a god module; domain logic leaks into the service; no testability for pure return rules; violates ADR-013
- **Effort**: Low

## Recommendation

**Option 1: Dedicated `devolucion` module.** This is the correct choice because:

1. **ADR-013 compliance**: The roadmap explicitly scopes devoluciones as a distinct feature in Fase 5, not a sub-concern of venta. Returns have their own domain rules (window check, quantity limits, line-level granularity, partial returns), their own fiscal document (B04), and their own inventory effects.
2. **Schema is ready**: Zero migrations needed — every table, enum, and FK already exists in ERD v4.7. The module just writes to existing tables.
3. **NCF engine is ready**: `consumirNcfEnTx("B04")` works out of the box — same engine, same contract.
4. **Proven orchestration pattern**: Follow `cancelarVentaConfirmada` exactly — guarded reads → NCF consume → entity create → inventory movement → audit, all inside `withTenantTransaction`, THROW-on-reject.
5. **The cancel pattern is NOT reusable for returns**: Cancel reverses the ENTIRE sale (ANULADA + full stock restore). Returns are partial, produce a NEW fiscal document (B04 NC), and may or may not restore stock (VENDIBLE vs DANADO). These are fundamentally different operations.

### First slice scope (PR #1)

**Core return flow — domain + application + repository + server action:**

1. **Domain** (`devolucion/domain/devolucion.ts`):
   - Pure functions: `validarPlazoDevolucion(fechaVenta, now, plazoDias)`, `validarCantidadDevuelta(cantidadDevuelta, cantidadOriginal)`, `validarReturnType(tipoReposicion)`, `calcularTotalesNotaCredito(lineas)`
   - Error codes: `DEVOLUCION_FUERA_DE_PLAZO`, `CANTIDAD_EXCEDE_ORIGINAL`, `FACTURA_NO_VIGENTE`, `VENTA_NO_CONFIRMADA`, `DEVOLUCION_YA_REGISTRADA`

2. **Application** (`devolucion/application/crear-devolucion.ts`):
   - `crearDevolucion(tx, ctx, input)` orchestrates:
     a. Read venta + factura (must be CONFIRMADA + VIGENTE)
     b. Validate return window (PLAZO_DEVOLUCION from config, default 15 days)
     c. Validate quantities (each line ≤ original line qty; no duplicates)
     d. Compute NC totals (mirror venta calculators for returned lines only)
     e. Consume B04 NCF atomically via `consumirNcfEnTx(tx, ctx, "B04")`
     f. Create `NOTA_CREDITO` + `DETALLE_NOTA_CREDITO` rows
     g. Create inventory movements (ENTRADA_DEVOLUCION or SALIDA_MERMA per line's `tipoReposicion`)
     h. Audit: NC creation + inventory movements

3. **Infrastructure** (`devolucion/infrastructure/devolucion-repository.ts`):
   - `crearNotaCreditoEnTx`, `leerVentaParaDevolucionEnTx`, `registrarMovimientoDevolucionEnTx`
   - Reuses existing inventario repository primitives for stock changes

4. **HTTP** (`devolucion/http/actions.ts`):
   - `devolverVentaAction` — thin server action with `withTenantTransaction`, role check, Zod validation

5. **Config** — extend `config-repository.ts` to read `PLAZO_DEVOLUCION` (same pattern as `DESC_MAX`)

6. **Seed** — add B04 range to `seed-ncf.ts` `NCF_RANGOS_SEED`

### DB migrations needed

**None.** ERD v4.7 already has all tables, enums, and FKs. The only data provisioning is adding B04 to the NCF seed script (runtime data, not DDL).

### NCF / inventory / fiscal effects coverage

| Effect | How it's covered |
|--------|-----------------|
| B04 NCF consumed atomically | `consumirNcfEnTx(tx, ctx, "B04")` — existing engine, zero changes |
| NC VIGENTE created | `tx.notaCredito.create(...)` with `estado: VIGENTE` |
| NC detail per line | `tx.detalleNotaCredito.createMany(...)` with `tipoReposicion` |
| Stock restored (VENDIBLE) | `ENTRADA_DEVOLUCION` movement via inventario repo |
| Stock recorded as loss (DANADO) | `SALIDA_MERMA` movement via inventario repo |
| Original FACTURA untouched | No UPDATE on FACTURA — balance derived via ADR-017 formula |
| Audit | Append-only `MOVIMIENTO_AUDITORIA` for NC + each inventory movement |
| Return window enforcement | Pure domain function against `PLAZO_DEVOLUCION` config |
| NC against ANULADA blocked | `FACTURA.estado = VIGENTE` precondition in the use case |

## Risks

- **CRITICAL: Quantity tracking across partial returns** — If a customer returns 3 of 5 units, then later wants to return 2 more, the system must track per-line returned quantities. The `DETALLE_NOTA_CREDITO` table stores each return's quantities, but there's no aggregate "returned so far" column. The use case MUST query all prior NCs for the same factura+product to enforce cumulative ≤ original. This is the highest-risk edge case.
- **HIGH: Payment effect deferred** — The docs require payment adjustment (refund/credit reduction), but ADR-017 derived balances mean this happens automatically IF the NC is written. However, actual refund processing (creating a PAGO REEMBOLSO) requires Fase 6 pagos. For V1, the NC reduces the derived CxC balance; actual refund is a separate flow.
- **HIGH: Inventory per branch** — The return MUST happen in the SAME branch as the original sale's inventory exit. Cross-branch returns need explicit handling (reject or require branch context).
- **MEDIUM: NCF seed provisioning** — B04 range must be seeded before any return can happen. The seed script update is trivial but must not be forgotten.
- **MEDIUM: Concurrency on same-factura returns** — Two operators returning from the same invoice simultaneously must not exceed the original quantities. The quantity-check-then-write must be serialized inside the transaction (existing row-lock pattern from inventario repo).
- **LOW: `PLAZO_DEVOLUCION` config missing** — Same pattern as `DESC_MAX_FALTANTE`: hard-fail with a stable error code, zero writes.

## Open Questions

1. **Payment effect scope**: For V1, should the NC creation also trigger a `PAGO REEMBOLSO` record (if the invoice was fully paid), or is derived balance sufficient until Fase 6 pagos lands? Recommendation: derived balance only for V1; document that refund processing is Fase 6 scope.
2. **Partial return UI flow**: Should the POS show individual line-level return selection (pick product + qty), or is whole-document return the V1 scope? Recommendation: line-level (the schema supports it via `DETALLE_NOTA_CREDITO`), but the UI can be a follow-up PR.
3. **Maximum return quantity per line**: Should there be a configurable cap (e.g., max 100% of original), or is "≤ original quantity" sufficient? Recommendation: ≤ original quantity, enforced cumulatively across all prior NCs for the same factura+product.

## Suggested Delivery Slices

| Slice | Scope | Est. Lines |
|-------|-------|-----------|
| **PR 1** | Domain + application + repository + server action + config read + seed update + unit tests + integration test | ~350-400 |
| **PR 2** | UI (DevolverButton in sale detail, return form, first-click disable) + E2E smoke | ~200-250 |
| **PR 3** | Cumulative quantity tracking edge cases + concurrency tests + partial-return overflow scenarios | ~150-200 |

## References

- `app/src/modules/ncf/application/consumir-ncf.ts` — B04 consumption (no changes needed)
- `app/src/modules/venta/application/venta-service.ts:302` — `cancelarVentaConfirmada` (reversal pattern)
- `app/src/modules/inventario/application/registrar-salidas-venta.ts` — inventory movement patterns
- `app/src/modules/venta/infrastructure/config-repository.ts` — PLAZO_DEVOLUCION read pattern
- `app/prisma/schema.prisma:507-551` — NotaCredito + DetalleNotaCredito models
- `app/prisma/schema.prisma:675-696` — MovimientoInventario with notaCreditoId FK
- `docs/03-reglasNegocioFact.md:228-247` — Devolucion business rules §10
- `docs/12-decisiones_de_arquitectura.md:485-494` — ADR-017 derived balances (B04 in formula)
- `docs/16-flujos_ux.md:190-218` — UX flow for devoluciones
- `docs/15-criterios_de_aceptacion.md:401-426` — Acceptance criteria §8.8
- `openspec/changes/archive/2026-09-10-fase-5c-ncf-confirm/exploration.md` — fase-5c deferred notes (D4 deferred cancellation to 5d)
