# Design: fase-5b-venta-core

## Technical Approach

Implement a four-layer `venta` module mirroring `compra`: pure Decimal-string fiscal math, transaction-oriented draft use cases, then thin Server Action/UI adapters. Use the frozen ERD without migration: writes are tenant/branch scoped, rates freeze from products, and 5b never confirms, consumes NCF, or writes inventory. `DESC_MAX` is read only for positive discounts and never defaulted.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Exclusive `precioVenta` | Additive ITBIS; matches producto/compra and avoids reverse rounding | Use net base; document ADR-018 note |
| Calculator boundary | Decimal.js strings; no floats | `calcularLineaVenta(input, tasa)` and `calcularTotalesVenta(lines, headerDiscount)` in `domain/calculators.ts` |
| Header proration | Round each share, then remainder can drift | Prorate post-line-discount net bases across all lines; half-up shares; remainder to largest base, ties earliest |
| Draft cart | Persist each edit or ephemeral state | Ephemeral client cart; VENTA `BORRADOR` is saved explicitly |
| Resolver | Duplicate CF/client logic or compose 5a | `app/src/modules/venta/application/resolver-cliente-venta.ts`, `resolverClienteParaVentaEnTx(tx, ctx, clienteId: number | null)`; null calls `getOrCreateConsumidorFinalEnTx(tx, ctx.empresaId)`, given IDs are empresa/active checked and mapped to the pinned venta codes |
| Discount enforcement | UI-only or configurable permissions | Server-side Administrador check, actor stored in `descuentoAutorizadoPor`; `validarDescuentosContraMaximo` runs in the use case before writes |
| UI totals | Trust browser or add a separate fiscal algorithm | Client may invoke the pure calculator for responsive preview; save actions recompute authoritatively server-side |

## Data Flow

`POS cart → zod Action → withTenantTransaction → resolver/products/config/stock → domain calculations → guarded Prisma write + audit → DTO (data + warnings[])`

Line calculation is `gross → resolved line discount → net base → header share → ITBIS`; F1–F4 are canonical fixtures. `leerConfigVentaEnTx` validates `DESC_MAX` only for positive discounts using the Santo Domingo date; missing/expired data returns `DESC_MAX_FALTANTE`.

### ADR-018 note — `precioVenta` / line `precioUnitario` are ITBIS-exclusive (net base)

Product and line prices are **net of ITBIS**: `subtotalBruto = round2(cantidad ×
precioUnitario)` is the fiscal BASE, and the buyer pays `total = base + ITBIS`. A
discount is applied to that net base **before** ITBIS (ADR-018), so `itbisLinea =
round2((bruto − descuento) × tasa/100)`. This matches `producto.calcular-itbis` and
the shipped `compra` engine (which store `subtotalLinea` = net base + `itbisLinea`
separately), and avoids the reverse-rounding drift of an ITBIS-inclusive price
(`base = total / (1 + tasa)` reintroduces rounding). Combined header-%-on-gross plus
line-% proration is pinned by unit fixture **F5** in
`domain/__tests__/calculators.spec.ts` (the header-% money basis is Σ GROSS
subtotal; the proration denominator is Σ NET base), because F1–F4 never carry both a
line discount and a header percentage at once. `subtotalGravado`/`subtotalExento`
are returned by the calculator and **never stored** (no `VENTA` columns; 5c
re-derives them for the Factura).

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/venta/domain/{venta,calculators,descuentos,errors}.ts` | Create | States, typed results, pinned codes, frozen line/totals contracts and cap rules. |
| `app/src/modules/venta/application/*.ts` | Create | crear/actualizar/listar/obtener/cancelar, line preparation, resolver, config orchestration. |
| `app/src/modules/venta/infrastructure/{venta-repository,configuracion-repository}.ts` | Create | Prisma projections, tenant/branch filters, guarded `updateMany`, replace-lines, audit and stock reads. |
| `app/src/modules/venta/http/{validations,actions}.ts` | Create | Zod boundary; thin actions; CRUD roles Administrador+Operador; positive discounts Administrador-only. |
| `app/tools/scripts/seed-venta-config.ts`, `app/package.json`, `app/SETUP-LOCAL.md` | Create/Modify | Idempotent `pnpm seed:venta`, one active `DESC_MAX=4.00` row per empresa, wide validity window and runbook. |
| `app/src/app/venta/page.tsx`, `app/src/modules/venta/ui/*` | Create | Client POS, ephemeral cart, client picker/CF, discount gate, warning banner, totals and drafts list; no confirm control. |

## Interfaces / Contracts

```ts
type VentaResult<T> = { ok: true; data: T } | { ok: false; code: VentaErrorCode; message: string };
type VentaSaveResult<T> = VentaResult<T> & { warnings?: readonly StockWarning[] };
type StockWarning = { code: "STOCK_INSUFICIENTE"; productoId: number; available: string; requested: string };
```

Create/update inputs use Decimal-compatible strings. Persist resolved money, `PORCENTAJE/0.00` for zero, frozen `tasaItbis`, and returned-only gravado/exento totals. The 14 pinned venta business codes (R-V13: 12 venta-owned + 2 re-emitted
`CLIENTE_*`; the earlier "13" counted the CLIENTE re-emit family as one group) are
exhaustive; unknown DB states fail loudly. `DESC_MAX_FALTANTE` is NOT a domain
code — it is owned by the `venta-config` read path
(`infrastructure/config-repository.ts`) and composed into the sale-save contract by
the application layer (`application/venta-guardado.ts`), so the domain catalog stays
frozen at its 14 codes (ADR-013 purity).

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Calculators, proration, caps, state mapping | F1–F4 exact assertions plus property-style rate/discount/line-order matrix; no DB |
| Integration | Isolation, CF resolver, lifecycle races, validity, config hard-fail, seed idempotency, stock warnings | Jest against `sf-postgres:5433` and existing tenant/product fixtures; parallel guarded updates/cancels |
| UI/E2E | Cart, live totals, CF/client selection, admin discount, warning, save/list/cancel, no confirm | Component tests for first interactive UI; one Playwright smoke path if harness is stable, otherwise defer full E2E to 5c |

## Threat Matrix

| Boundary | Applicability | Response / RED test |
|---|---|---|
| Documentation-like paths | N/A — no executable documentation | No task/test |
| Git repository selection | N/A — no Git automation | No task/test |
| Commit state | N/A — no commit automation | No task/test |
| Push state | N/A — no push automation | No task/test |
| PR commands | N/A — no PR automation | No task/test |

Actions and `pnpm seed:venta` are application entry points, not shell/VCS/process boundaries; they still receive zod, role, tenant-wrapper and seed-idempotency tests.

## Migration / Rollout

No migration required. Deliver as chained PRs: PR-1 domain ~650 lines; PR-2 application/config/http/integration ~1,350; PR-3 POS/UI ~1,050; total ~3,050, high against the 400-line review budget. Seed configuration before enabling discounted drafts. Roll back by reverting PR-3, then PR-2, then PR-1; seeded rows are harmless.

## Open Questions

- [ ] PR-3 must verify the live Penpot `02-Venta` board before visual implementation; design remains board-agnostic if unavailable.
- [ ] Corporate 11-digit RNC semantics remain a 5c/accountant decision; 5b does not alter `shared/domain/fiscal-id.ts`.
