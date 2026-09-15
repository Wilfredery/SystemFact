# Design: fase-5d-devolucion-b04 — Devoluciones (Nota de Crédito B04)

## Technical Approach

Dedicated `devolucion` module (ADR-013) with full domain/application/infrastructure/http layering, mirroring the proven `cancelarVentaConfirmada` pattern from 5c: guarded reads → validation → B04 NCF consume → NC creation → inventory movement → audit, all inside a single `withTenantTransaction` with THROW-on-reject. Zero schema migrations; all tables, enums, and FKs already exist in ERD v4.7.

## Architecture Decisions

| Choice | Rejected | Rationale |
|---|---|---|
| `app/src/modules/devolucion/` as standalone module | Extending `venta` subdirectory; extending `cancelarVentaConfirmada` | ADR-013 compliance; returns have distinct domain rules, fiscal doc, and inventory effects; cancel reverses entire sale, returns are partial |
| Pure domain functions with `VentaDomainError` codes | Separate error catalog in devolucion | Reuse frozen `VentaErrorCode` catalog (adds 4 codes); single source of truth per R-V13 |
| Cumulative query inside transaction with `SELECT FOR UPDATE` | Application-level tracking or cache | CRITICAL risk: must enforce Σreturned+new ≤ original atomically; row-lock serializes concurrent same-factura returns |
| `registrarDevolucion` in `inventario/application` (same pattern as `registrarSalidasVenta`) | Inline inventory logic in devolucion app | Reuse existing seam; consistent lock-order/upsert/audit pattern |
| `PLAZO_DEVOLUCION` read via `config-repository.ts` extension | Hardcoded default or domain constant | Same pattern as `DESC_MAX_FALTANTE`; missing key hard-fails with stable code, zero writes |

## Data Flow

```
devolverVentaAction(input)
  → resolverCtx() → withTenantTransaction(ctx, async (tx) => {
      role check → crearDevolucion(tx, ctx, input)
        → leerVentaParaDevolucionEnTx(ventaId)  // CONFIRMADA + VIGENTE FACTURA
        → validarPlazoDevolucion(fechaVenta, plazoDias)
        → leerStockSucursalEnTx(productos)       // SELECT FOR UPDATE ascending productId
        → leerPriorNCsPorFacturaProducto()        // cumulative Σreturned query
        → validarCantidadDevuelta(cantidad, original - yaDevuelto)
        → consumirNcfEnTx(tx, ctx, "B04")         // atomic B04 lock+consume
        → crearNotaCreditoEnTx(...)               // NOTA_CREDITO VIGENTE
        → crearDetalleNotaCreditoEnTx(...)        // DETALLE_NOTA_CREDITO per line
        → registrarDevolucion(tx, ctx, ...)       // ENTRADA_DEVOLUCION or SALIDA_MERMA
        → registrarAuditEnTx(...)                 // append-only
    })
```

Lock ordering: stock rows (ascending `productoId`) → NCF sequence row (`empresaId+tipoNcf` FOR UPDATE) → NC write.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/devolucion/domain/devolucion.ts` | Create | Pure functions: `validarPlazoDevolucion`, `validarCantidadDevuelta`, `validarReturnType`, `calcularTotalesNotaCredito`; error code constants |
| `app/src/modules/devolucion/application/crear-devolucion.ts` | Create | `crearDevolucion(tx, ctx, input)` orchestration use case |
| `app/src/modules/devolucion/infrastructure/devolucion-repository.ts` | Create | `leerVentaParaDevolucionEnTx`, `crearNotaCreditoEnTx`, `crearDetalleNotaCreditoEnTx`, `leerPriorNCsPorFacturaProductoEnTx`, `registrarMovimientoDevolucionEnTx` |
| `app/src/modules/devolucion/http/actions.ts` | Create | `devolverVentaAction` thin server action with Zod + `withTenantTransaction` |
| `app/src/modules/devolucion/http/validations.ts` | Create | Zod schema `zDevolverVentaInput` |
| `app/src/modules/devolucion/index.ts` | Create | Barrel exports |
| `app/src/modules/venta/domain/errors.ts` | Modify | Add 4 codes: `DEVOLUCION_FUERA_DE_PLAZO`, `CANTIDAD_EXCEDE_ORIGINAL`, `FACTURA_NO_VIGENTE`, `VENTA_NO_CONFIRMADA` |
| `app/src/modules/venta/infrastructure/venta-repository.ts` | Modify | Add `leerVentaParaDevolucionEnTx`, `leerPriorNCsPorFacturaProductoEnTx`, `leerStockSucursalEnTx` helpers |
| `app/src/modules/venta/http/actions.ts` | Modify | Import and wire `devolverVentaAction` |
| `app/src/modules/venta/infrastructure/config-repository.ts` | Modify | Add `leerPlazoDevolucionEnTx` (same pattern as `leerConfigVentaEnTx`) |
| `app/src/modules/inventario/application/registrar-salidas-venta.ts` | Modify | Add `registrarDevolucion` primitive |
| `app/src/modules/inventario/infrastructure/inventario-repository.ts` | Modify | Add `registrarDevolucionEnTx` (ENTRADA_DEVOLUCION/SALIDA_MERMA) |
| `app/tools/scripts/seed-ncf.ts` | Modify | Add `{tipoNcf: "B04", rangoInicio: 201, rangoFin: 300}` to `NCF_RANGOS_SEED` |
| `app/tools/scripts/seed-venta-config.ts` | Modify | Add `PLAZO_DEVOLUCION` key (default 15 days) |

## Interfaces / Contracts

```typescript
// domain/devolucion.ts — pure, testable, no imports
export function validarPlazoDevolucion(fechaVenta: Date, plazoDias: number, now: Date): void
export function validarCantidadDevuelta(cantidadDevuelta: Decimal, cantidadOriginal: Decimal, yaDevuelto: Decimal): void
export function validarReturnType(tipoReposicion: TipoReposicion): void
export function calcularTotalesNotaCredito(lineas: DetalleNotaCreditoInput[]): { monto: string; itbis: string }

// application/crear-devolucion.ts
export async function crearDevolucion(tx: PrismaTx, ctx: TenantCtx, input: CrearDevolucionInput): Promise<DevolucionResult>

// repository contract
export async function leerPriorNCsPorFacturaProductoEnTx(tx, ctx, facturaId, productoId): Promise<Decimal>  // Σ returned
export async function registrarDevolucionEnTx(tx, ctx, input): Promise<MovimientoAplicado[]>

// HTTP action signature (mirrors cancelarVentaAction pattern)
export async function devolverVentaAction(input: unknown): Promise<ActionResult<{ id: number; estado: string; ncf: string }>>
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `validarPlazoDevolucion`, `validarCantidadDevuelta`, `validarReturnType`, `calcularTotalesNotaCredito` | Pure functions, no DB, clock injection |
| Integration | NC creation, cumulative quantity across 2+ NCs, inventory movement (VENDIBLE/DANADO), idempotent retry, concurrent same-factura returns, cross-branch rejection, missing PLAZO_DEVOLUCION hard-fail | Prisma test client inside `withTenantTransaction`, concurrency fixture with parallel `crearDevolucion` calls |
| E2E | Return happy path: CONFIRMADA sale → return → NC visible, stock restored, balance reduced | Playwright against seeded test DB |

## Threat Matrix

The seed script (`seed-ncf.ts`) is a shell entry point, but there is no VCS/PR automation or repository/process selector. Documentation-like paths, Git selection, commit state, push state and PR commands are all `N/A`. RED coverage is seed argv/exit behavior plus idempotency.

## Migration / Rollout

No migration required. All schema already exists. 3 chained PRs stacked to main (400 lines/PR budget):
- **PR 1**: Domain + application + repository + HTTP action + config read + seed + tests (~350-400 lines)
- **PR 2**: UI (DevolverButton, return form, first-click disable) + E2E (~200-250 lines)
- **PR 3**: Cumulative quantity edge cases + concurrency tests + partial-return overflow (~150-200 lines)

## Open Questions

- [ ] Payment/refund processing deferred to Fase 6 (ADR-017 derived balance sufficient for V1)
- [ ] Confirm `PLAZO_DEVOLUCION` seed value in `seed-venta-config.ts` (15 days matches docs)
