# Venta module — fase 5b core (draft-only sale engine)

Four-layer modular-monolith feature (`domain / application / infrastructure /
http`) implementing the **draft-only** sale core: `BORRADOR` lifecycle
(create/update/cancel) with DGII-safe mixed 18/16/0 ITBIS, discount-before-ITBIS
(ADR-018), a venta client resolver defaulting to Consumidor Final, non-blocking
branch stock warnings at draft save, and `DESC_MAX`-capped admin-only discounts.
Confirmation, NCF consumption, inventory debit and payments are **reserved for
5c** — no 5b code path reaches `CONFIRMADA`.

> **PR status.** This is the **PR-1 (domain)** slice. The `application/`,
> `infrastructure/`, `http/`, POS `ui/` layers and the integration suite land in
> PR-2/PR-3 of `openspec/changes/fase-5b-venta-core/`.

## Domain layer (pure — ADR-013)

`domain/` imports NOTHING from Next.js / React / Prisma / Supabase. All money and
quantities cross the boundary as `Decimal`-compatible strings (`Decimal(12,2)`
amounts, `Decimal(12,3)` quantities); arithmetic is `decimal.js` half-up 2dp, so
**no floats appear**. Parity with `compra/domain/calculators.ts`.

| File | Responsibility |
|---|---|
| `domain/venta.ts` | `EstadoVenta`, the total `estadoVentaDesdeDb` mapper (unknown → fail loud), draft-reachability predicates, the `Descuento`/`VentaLineaInput`/`TotalesVenta` contracts and the zero-discount convention. |
| `domain/errors.ts` | Pinned stable-code catalog (`VentaErrorCode` + Spanish `messageFor`), `VentaResult<T>`, `VentaSaveResult<T>` and the `STOCK_INSUFICIENTE` `StockWarning` (a warning, never an error). |
| `domain/calculators.ts` | R-V5 computation order (`gross → line discount → net base → header proration → ITBIS`) and R-V6 header proration (half-up shares, remainder to the largest net base, ties earliest). Returns `subtotalGravado`/`subtotalExento` — never stored. |
| `domain/descuentos.ts` | R-V7/R-V8 pure rules: shape validation, the `DESC_MAX` triple-cap (per-line % of gross, header %, aggregate % of Σ gross) and the base-exceed rule. |

### Fiscal semantics

- `precioUnitario` is **ITBIS-exclusive** (ADR-018 net base): the customer pays
  `total = base + ITBIS`. The ADR-style note lives in the change design doc.
- Stored `descuento`/`descuentoLinea` hold **resolved money** (2dp), never the raw
  percentage input; `descuentoTipo` records the frozen authorization form and
  `descuentoAutorizadoPor` the admin actor. A zero discount is always
  `PORCENTAJE` / `0.00` with a `NULL` authorizer.
- The stored identity `total = subtotal − descuento + itbis` holds exactly;
  fixtures F1–F4 in `domain/__tests__/calculators.spec.ts` are the canonical
  numbers.

## Reserved 5c seam (no stubs in 5b)

`BORRADOR → CONFIRMADA`, NCF consumption, the `SALIDA_VENTA` hard stock block,
B01/B02 eligibility, and credit-limit/mora blocking. Stock at draft save is only
a structured `STOCK_INSUFICIENTE` warning (R-V9). `CONFIRMADA` exists in the
persisted enum for `estadoVentaDesdeDb` completeness but has no reachable path.

See `openspec/changes/fase-5b-venta-core/` (proposal, spec, design, tasks) for the
full contract and the enforcement/wiring that PR-2 adds.
