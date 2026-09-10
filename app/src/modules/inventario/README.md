# Inventario module — stock, movements and average cost

Four-layer modular-monolith feature (`domain / application / infrastructure /
http`) owning every stock invariant: the per-branch inventory row, the
append-only `MovimientoInventario` ledger, the tenant-scoped paginated listing,
the manual adjustment path, and — since fase-3-4b — the purchase-receipt entry
and the company-wide weighted-average cost.

- **Domain is pure** (ADR-013): no Next.js / React / Prisma / Supabase imports.
  Quantities (`Decimal(12,3)`) and money/cost (`Decimal(12,2)`) cross the
  boundary as `Decimal`-compatible strings and are computed with `decimal.js`
  (exact, DB-free).
- **Multi-tenancy**: `INVENTARIO` has no own `empresaId`; its only tenant anchor
  is `sucursal.empresaId`, so every read/write pins the company via that
  navigation and the concrete `sucursalId`. All DB work runs inside the caller's
  `withTenantTransaction` (this module never opens its own transaction).
- **Inventory is never edited directly**: every change produces a
  `MovimientoInventario` with before/after quantities. Stock is PER BRANCH.

## Capabilities

| Layer | What it does |
|---|---|
| Manual adjustment (`ajustar-inventario`) | Authorized signed-delta correction → row-locked stock change + `AJUSTE` movement + audit. **Never touches `costoPromedio`.** |
| Listing (`listar-inventario`) | Branch-scoped, paginated, KPI-classified stock view. |
| Purchase entry (`registrar-entrada-compra`) | **Implemented in fase-3-4b.** Realizes the reserved `InventoryEntryPort`: adds stock at the session branch, appends an `ENTRADA_COMPRA` movement carrying `compraId`, and updates the company-wide `costoPromedio`. |
| Sale exit + reposition (`registrar-salidas-venta`) | **Implemented in fase-5c pr5c3.** Realizes the reserved `InventoryExitPort`: `registrarSalidasVenta` debits branch stock with one `SALIDA_VENTA` movement per line (carrying `ventaId`) and HARD-blocks a shortage; `registrarReposicionCancelacion` reverses a confirmed-sale cancel with one `REPOSICION_CANCELACION` movement. **Neither touches `costoPromedio`.** |

## Sale exit and reposition (fase-5c pr5c3)

`registrarSalidasVenta` is the authoritative post-consume stock block invoked as
the FINAL step of `confirmarVenta`, and `registrarReposicionCancelacion` is its
inverse on confirmed-sale cancellation. Both run inside the caller's `PrismaTx`
(no nested transaction) and are **throw-on-reject** — a shortage aborts the whole
confirm (un-burning the NCF) or the whole cancel, never a partial apply.

`registrarSalidasVentaEnTx` mirrors the three-phase entry ordering so a concurrent
confirm and exit on the same branch can never deadlock:

1. **Ownership guard** — every distinct product must belong to `ctx.empresaId`;
   the first foreign product throws `INVENTARIO_NO_ENCONTRADO` before any lock,
   so a cross-tenant batch persists zero changes.
2. **Hard availability** — per product in **ascending product-id order**, upsert +
   `SELECT ... FOR UPDATE` the session branch's row and throw
   `STOCK_INSUFICIENTE_BLOQUEO` `{productoId, available, requested}` when the
   aggregate requested exceeds the now-locked quantity. Negatives are impossible.
3. **Debit** — per line, reduce the running balance and append one immutable
   `SALIDA_VENTA` movement (negative delta, before/after, `ventaId`) + audit.

`registrarReposicionCancelacionEnTx` keeps the SAME lock order but the delta is
positive (stock is credited), requires a **non-empty reason**, appends one
`REPOSICION_CANCELACION` movement per line, and performs no availability check.
Duplicate product lines accumulate into the aggregate check while still emitting
one movement per line.

## Purchase entry and the cost boundary (fase-3-4b)

`registrarEntradaCompra` is the inventario-side realization of the port the
compra module reserved. It is invoked INSIDE the caller's `PrismaTx` — there is
no nested transaction. `registrarEntradasCompra` runs a three-phase, all-or-
nothing batch:

1. **Ownership guard** — every product must belong to `ctx.empresaId`; the first
   foreign product throws `INVENTARIO_NO_ENCONTRADO` before any write, so a
   cross-tenant batch persists zero changes.
2. **Cost** — per product in ascending product-id order: `SELECT ... FOR UPDATE`
   on `PRODUCTO` (serializes concurrent receipts of the same product), read the
   pre-receipt company-wide stock summed across ALL branches, and write ONE
   `costoPromedio` using the aggregate received quantity and ITBIS-exclusive
   value (duplicate lines accumulate into a single, drift-free reweight).
3. **Stock** — per line: upsert + `SELECT ... FOR UPDATE` the session branch's
   row, add the positive quantity, append one `ENTRADA_COMPRA` movement
   (`compraId`, before/after) and the audit row.

The weighted-average cost (frozen by the fase-3-4b spec):

```
nuevoCP = (stockTotalEmpresa × CP + valorRecibidoSinITBIS) / (stockTotalEmpresa + cantidadRecibida)
```

- The denominator is **company-wide** (all branches), because `costoPromedio` is
  a single company column. To sum other branches' `INVENTARIO` rows the reader
  narrows only the `app.current_sucursal_id` GUC transaction-locally for that
  aggregate READ (still pinned to `app.current_empresa_id`, never crossing
  tenant), restoring the session branch immediately so **entry writes still land
  only at `ctx.sucursalId`**.
- The cost basis is the ITBIS-EXCLUSIVE net unit cost; the domain performs no
  fiscal gross-up, so a mixed 18/16/0 receipt simply feeds net costs.

### Cost boundary (unchanged)

The manual-adjustment path (`ajustarStockEnTx`) still never reads or writes
`costoPromedio`; nor does the sale exit or the reposition batch — only the
purchase-entry path does. Locked by `ajustar-inventario.test.ts` and the
integration "manual-adjustment never mutates costoPromedio" + "exit/reposition
never mutates costoPromedio" cases.

## Seams still unimplemented

Return and transfer callers and the `TipoReposicion` (VENDIBLE/DANADO) flows
remain declared-only typed seams. fase-5c implements the **sale exit** and its
**cancellation reposition**; the return/transfer consumers land in later fases.

## Tests

- **Domain unit (no DB)**: `domain/costo-promedio.test.ts` (weighted cost,
  all-branch denominator, mixed net rates, half-up rounding), `inventario.test.ts`,
  `errors.test.ts`.
- **Application unit (no DB)**: `registrar-entrada-compra.test.ts` (repository
  mocked — validation + typed-error mapping + batch delegation).
- **Integration (real DB `systemfact_test`, container `sf-postgres:5433`)**:
  `src/integration/inventario-entrada-compra.integration.test.ts` (unseen product,
  all-branch denominator, duplicate-line single cost, cross-tenant rejection,
  mid-line rollback, cost boundary),
  `src/integration/salidas-venta.integration.test.ts` (batch debit + `ventaId`,
  mid-batch shortage rollback, concurrent-exit serialization, reposition restore +
  reason, cross-tenant + cost boundary) and
  `src/integration/seed-retencion-config.integration.test.ts`.

See `openspec/changes/fase-3-4b-compra-inventario/` for the contract and design.
