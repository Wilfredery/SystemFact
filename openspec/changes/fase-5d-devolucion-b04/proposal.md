# Proposal: fase-5d-devolucion-b04 — Devoluciones (Nota de Crédito B04)

## Intent

Fase 5c delivered the full venta confirm loop (NCF B01/B02, SALIDA_VENTA, FACTURA VIGENTE). The schema already provisions `NOTA_CREDITO`, `DETALLE_NOTA_CREDITO`, inventory seams (`ENTRADA_DEVOLUCION`/`SALIDA_MERMA`), and B04 NCF support — but zero application code exists. This change implements the return lifecycle: a customer returns goods, a B04 Nota de Crédito is issued against the original VIGENTE FACTURA, stock is conditionally restored or recorded as loss, and the derived CxC balance (ADR-017) automatically reflects the reduction. Fase 5d closes the sale lifecycle.

## Scope

### In Scope
- **Domain** (`devolucion/domain/devolucion.ts`): pure return rules — return-window validation (PLAZO_DEVOLUCION from config, default 15 days SD), cumulative quantity check across prior NCs for same factura+product, tipoReposicion validation, NC total computation from returned lines
- **Application** (`devolucion/application/crear-devolucion.ts`): orchestrates guarded venta+factura read → window/quantity validation → B04 NCF atomic consume → NC + detail creation → inventory movement (ENTRADA_DEVOLUCION or SALIDA_MERMA per line) → audit — all inside `withTenantTransaction`
- **Infrastructure** (`devolucion/infrastructure/devolucion-repository.ts`): NC/NC-detail/inventory write primitives, read helpers for ventas-by-factura and stock-per-line
- **HTTP** (`devolucion/http/actions.ts`): `devolverVentaAction` thin adapter with Zod validation, role check, `withTenantTransaction`
- **Seed**: B04 range added to `seed-ncf.ts` NCF_RANGOS_SEED
- **Config**: extend `config-repository.ts` to read `PLAZO_DEVOLUCION`
- **Tests**: unit (pure domain rules), integration (NC creation, inventory movement, cumulative quantity, concurrency), E2E (return happy path)
- **Zero schema migrations**: all tables, enums, FKs already exist in ERD v4.7

### Out of Scope
- Payment/refund processing (Fase 6 pagos — ADR-017 derived balance already reflects NC; actual PAGO REEMBOLSO is separate flow)
- Admin CRUD for NC or B04 NCF ranges (seed-only provisioning, same as B01/B02 in 5c)
- Cross-branch returns (V1 requires same-branch as original sale; explicit cross-branch is future work)
- NC itself cancellation/annulment (V1 creates VIGENTE NC only; cancel/annul NC is a follow-up)

## Capabilities

### New Capabilities
- `devolucion`: credit-note return lifecycle — B04 NC creation, line-level partial returns, cumulative quantity enforcement, conditional inventory reversal (VENDIBLE/DANADO), return-window validation from config, integration with existing NCF engine and inventory seams

### Modified Capabilities
- `venta`: add return-related error codes to VentaResult catalog (`DEVOLUCION_FUERA_DE_PLAZO`, `CANTIDAD_EXCEDE_ORIGINAL`, `FACTURA_NO_VIGENTE`, `VENTA_NO_CONFIRMADA`) — spec-level requirement added to R-V13
- `inventario`: implement return entry/exit seams (`ENTRADA_DEVOLUCION`, `SALIDA_MERMA`) via `registrarDevolucion` — spec-level seam declared but unimplemented in R-S5
- `ncf-engine`: B04 range provisioning added to seed (R-N6 update — B01/B02/B04 all seeded)

## Approach

Dedicated `devolucion` module (ADR-013) with full domain/application/infrastructure/http layering. The orchestration follows the proven `cancelarVentaConfirmada` pattern from 5c: guarded reads → validation → NCF consume → entity create → inventory movement → audit, all inside `withTenantTransaction`, throw-on-reject. Key difference from cancel: returns are partial (line-level), produce a NEW fiscal document (B04 NC), and inventory effect depends on tipoReposicion. Cumulative quantity tracking queries all prior NCs for the same factura+product inside the transaction to enforce `Σreturned ≤ original`. Row-lock serialization handles concurrent same-factura returns.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/devolucion/` | New | Full module: domain + application + infrastructure + http |
| `app/src/modules/venta/infrastructure/venta-repository.ts` | Modified | New read helpers: ventas-by-factura, stock-per-line, prior-NCs-by-factura+product |
| `app/src/modules/venta/http/actions.ts` | Modified | Wire `devolverVentaAction` |
| `app/src/modules/inventario/application/registrar-salidas-venta.ts` | Modified | Add `registrarDevolucion` primitive (ENTRADA_DEVOLUCION/SALIDA_MERMA) |
| `app/src/modules/venta/infrastructure/config-repository.ts` | Modified | Read PLAZO_DEVOLUCION config |
| `app/tools/scripts/seed-ncf.ts` | Modified | Add B04 range to seed |
| `app/prisma/schema.prisma` | None | Zero migrations — all models exist |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cumulative quantity across partial returns not enforced | High | Query all prior NCs for same factura+product inside tx; assert Σreturned+new ≤ original |
| Concurrent same-factura returns exceed original quantity | Med | Row-lock serializes inventory reads; quantity-check-then-write inside single tx |
| PLAZO_DEVOLUCION config not seeded → hard-fail with stable error code | Med | Seed must include key; same pattern as DESC_MAX missing |
| Payment effect confusion (NC reduces CxC but no refund created) | Med | Document in V1: derived balance via ADR-017; refund is Fase 6 |
| Cross-branch return attempted | Low | Reject explicitly — require same branch as original sale exit |

## Rollback Plan

3 chained PRs stacked to main, revertible independently in order:
1. **PR 1** (domain+app+repo+action+seed+tests): pure code revert, zero schema changes
2. **PR 2** (UI+E2E): UI revert only, backend unaffected
3. **PR 3** (edge cases+concurrency tests): test-only additions, revertible without behavior change

No migrations exist → rollback is pure code revert. B04 NCF consumed during exposure window remain "no utilizado" records (608-consistent, no repair needed).

## Dependencies

- 5c venta module merged (master @ eae7750)
- B04 NCF range must be seeded before any return E2E
- `PLAZO_DEVOLUCION` config must be seeded (or default-hard-fail pattern)

## Success Criteria

- [ ] Return against CONFIRMADA sale with VIGENTE FACTURA creates VIGENTE NC with correct B04 NCF
- [ ] Cumulative returned quantity per line never exceeds original (tests prove across 2+ NCs)
- [ ] VENDIBLE returns restore stock via ENTRADA_DEVOLUCION; DANADO records SALIDA_MERMA
- [ ] Original FACTURA stays VIGENTE; derived CxC balance (ADR-017) includes NC
- [ ] Return outside PLAZO_DEVOLUCION blocked with stable error, zero writes
- [ ] Return against ANULADA or BORRADOR sale blocked with stable error
- [ ] Concurrent same-factura returns serialize without exceeding original quantities
- [ ] E2E return happy path green
- [ ] Zero schema migrations
