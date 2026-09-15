# Devolucion module — fase 5d (sale returns / B04 Nota de Crédito)

Four-layer modular-monolith feature (`domain / application / infrastructure /
http` + a small `ui/` slice) emitting the **Nota de Crédito B04** for a sale
return: a `CONFIRMADA` sale with a `VIGENTE` factura can be returned within the
configured `PLAZO_DEVOLUCION` window (Santo Domingo calendar days), burning one
B04 sequence value and creating a `VIGENTE` credit note whose money **freezes
the ORIGINAL sale line** (unit price + ITBIS rate — the frozen mirror, R-D5).
Restock is classified per line: `VENDIBLE` → `ENTRADA_DEVOLUCION` movement or
`DANADO` → `SALIDA_MERMA`, via the inventario seam.

> **Note on structure.** The repo has **no `index.ts` barrel in any module**
> (imports always target concrete files), so this module deliberately has no
> barrel either — this README is the module map (SDD task 4.1 interpreted as
> documentation, per repo convention and YAGNI).

## Responsibility map (four layers)

| Layer | Path | Owns |
|---|---|---|
| `domain/` | `devolucion.ts` | Pure B04 rules (ADR-013: no Next/React/Prisma/Supabase): `validarPlazoDevolucion` (R-D2, SD calendar-day window, clock-injected `now`), `validarCantidadDevuelta` (R-D3 cumulative cap), `validarReturnType` (R-D4 frozen `VENDIBLE`/`DANADO`), `calcularTotalesNotaCredito` (R-D5 frozen-order math, per-line + header money in `Decimal(12,2)`/`Decimal(12,3)` strings). Re-exports the return codes from the single venta catalog — **no separate error catalog** (design D2). |
| `application/` | `crear-devolucion.ts` | The single canonical `crearDevolucion(tx, ctx, input)` flow (numbered steps in the module doc): guarded venta+factura read → return window → line resolution against original rows → INVENTARIO locks FIRST (serialization point) → cumulative cap → 605 idempotency gate → frozen totals → `consumirNcfEnTx("B04")` → NOTA_CREDITO + details + audit → `registrarDevolucion` stock effect. Pre-write business failures return typed results; post-write failures **throw** so the wrapper aborts everything (never a partial NC). |
| `infrastructure/` | `devolucion-repository.ts` | The module's only Prisma surface: tenant+branch-scoped reads/writes inside `withTenantTransaction`. `leerPriorNCsPorFacturaEnTx` (ONE grouped `_sum` for all products, no N+1), `existeDevolucionIdenticaEnTx` (605 gate reader), `leerStockSucursalEnTx` (ascending `FOR UPDATE` lock — THE serialization point for the cap), `crearNotaCreditoEnTx` (always `VIGENTE`), `crearDetalleNotaCreditoEnTx` (batch insert), `registrarAuditNotaCreditoEnTx` (append-only). |
| `http/` | `actions.ts`, `validations.ts` | Thin `"use server"` adapter `devolverVentaAction` (Zod parse → tenant ctx → `withTenantTransaction` → role gate `Administrador`+`Operador` → use case) + `zDevolverVentaInput` transport schema (`Decimal`-string grammar, ≤100 lines; money/rates NEVER trusted from the wire). |

`ui/` (client, `"use client"`): `DevolverButton.tsx` — first-click-disable
toggle mounted from `venta/ui/DraftList.tsx` on `CONFIRMADA` rows; and
`ReturnForm.tsx` — loads the persisted sale lines via `obtenerVentaAction`,
validates with the SAME shared `zDevolverVentaInput`, single-flight submit.
All money is re-derived server-side; the form computes nothing.

## Error catalog (lives in `venta/domain/errors.ts`)

Codes 601–605 in the frozen venta catalog (now 24 codes):

| Code | Meaning |
|---|---|
| `DEVOLUCION_FUERA_DE_PLAZO` (601) | Return outside the `PLAZO_DEVOLUCION` window (boundary day inclusive) |
| `CANTIDAD_EXCEDE_ORIGINAL` (602) | Cumulative returned qty per (factura, producto) would exceed the original sold qty |
| `FACTURA_NO_VIGENTE` (603) | Original factura is not `VIGENTE` |
| `VENTA_NO_CONFIRMADA` (604) | Original sale is not `CONFIRMADA` |
| `DEVOLUCION_YA_REGISTRADA` (605) | Idempotent retry: exact `(productoId, cantidad, tipoReposicion)` triple already emitted on a prior VIGENTE NC of this factura — returns `details: { facturaId, productoId }`, consumes no write and burns **no second B04** |

`LINEA_INVALIDA` is reused for malformed lines; `NCF_AGOTADA`/`NCF_VENCIDA`/
`NCF_SEC_INEXISTENTE` map from the NCF engine consume port; `NCF_UMBRAL_90` is a
**warning** channel on the result, never an error code.

## Business rules and gotchas

- **Cumulative cap serialization (R-D3, CRITICAL):** the NCF row lock runs
  AFTER the cumulative read, so it cannot serialize the cap under READ
  COMMITTED. The real serialization point is the INVENTARIO row lock taken
  (ascending product-id) BEFORE `leerPriorNCsPorFacturaEnTx` — a concurrent
  return blocks on the stock row and re-reads the cumulative total after the
  winner commits. Sibling lines of the SAME NC also count (a product may
  legitimately appear as VENDIBLE + DANADO lines).
- **Idempotent retry (605):** identical retried returns reject BEFORE any
  write or B04 burn; a *different* quantity for the same product is legal and
  remains subject to the cap.
- **Inventory:** per AGENTS.md, stock is never edited directly — every unit
  produces a `MovimientoInventario` (`ENTRADA_DEVOLUCION` for VENDIBLE,
  `SALIDA_MERMA` for DANADO) through the `inventario` module's
  `registrarDevolucion`. A `DANADO` loss over the locked balance throws and
  rolls back the whole note.
- **Fiscal discipline:** NCs are never deleted and have no draft state —
  created `VIGENTE` in one atomic step with the consumed B04; audit rows are
  append-only and roll back with the note.
- **Validation is layered:** Zod owns the transport shape only; the return
  window, the cap and the frozen money mirror are domain/computed server-side
  (Zod is never the authorization authority).

## Tests

- `domain/__tests__/devolucion.spec.ts` — pure functions, injected clock, no DB.
- `application/__tests__/crear-devolucion.spec.ts` — orchestration mapping.
- `ui/__tests__/return-ui.spec.tsx` — jsdom component tests.
- `src/integration/devolucion-{cumulative,concurrency,idempotencia}.integration.test.ts`
  — cumulative-cap edge cases (task 3.1), same-factura race serialization
  (task 3.2) and the 605 no-second-burn guarantee (task 3.3), real DB + RLS.
- `e2e/devolucion.spec.ts` — Playwright happy path (B04 → stock restock/loss
  → NC issued).

See `openspec/changes/fase-5d-devolucion-b04/` for the full contract.
