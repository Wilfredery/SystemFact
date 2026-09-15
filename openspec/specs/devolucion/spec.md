# Devolucion Specification

## Purpose

Credit-note return lifecycle (B04 NC): line-level partial returns against CONFIRMADA sales, cumulative quantity enforcement, conditional inventory reversal (VENDIBLE/DANADO), return-window validation from config, and atomic B04 NCF consumption. All inside `withTenantTransaction` with multi-tenancy RLS GUCs.

## Requirements

### Requirement: Return only against CONFIRMADA sales with VIGENTE FACTURA (R-D1)

`crearDevolucion` MUST reject any return where the source sale is not `CONFIRMADA` or the linked FACTURA is not `VIGENTE`. The original FACTURA MUST remain `VIGENTE` after return — never modified or deleted. BORRADOR and ANULADA sales MUST produce stable typed errors (`VENTA_NO_CONFIRMADA` / `FACTURA_NO_VIGENTE`) with zero writes.

#### Scenario: Full return against CONFIRMADA sale with VIGENTE FACTURA

- GIVEN a `CONFIRMADA` sale with a `VIGENTE` FACTURA
- WHEN `crearDevolucion` runs with valid input
- THEN the NC is created, the original FACTURA stays `VIGENTE`, and a VIGENTE B04 NCF is assigned
- TEST: integration

#### Scenario: Return against BORRADOR sale rejected

- GIVEN a `BORRADOR` sale
- WHEN return is attempted
- THEN `VENTA_NO_CONFIRMADA` returns and no row is written
- TEST: unit

#### Scenario: Return against ANULADA sale rejected

- GIVEN a sale whose FACTURA is `ANULADA`
- WHEN return is attempted
- THEN `FACTURA_NO_VIGENTE` returns and no row is written
- TEST: unit

### Requirement: Line-level partial returns with cumulative quantity cap (R-D2)

Each return line specifies a `cantidad` that MUST NOT cause `Σreturned + new ≤ original` for the same `facturaId + productoId`. The use case MUST query all prior NCs for the same `facturaId + productoId` inside the transaction and assert the cumulative cap. A second partial return MUST be allowed only if capacity remains.

#### Scenario: Partial return within cap

- GIVEN a sale line of 5 units, 3 already returned across prior NCs
- WHEN a return of 1 more unit is requested
- THEN cumulative returned = 4 ≤ 5, the return succeeds
- TEST: integration

#### Scenario: Cumulative quantity cap violation

- GIVEN a sale line of 5 units, 5 already returned across prior NCs
- WHEN a return of 1 more unit is requested
- THEN `CANTIDAD_EXCEDE_ORIGINAL` returns and no row is written
- TEST: integration

#### Scenario: Concurrent same-factura returns serialize

- GIVEN stock 10 at branch, two parallel returns on the same factura+product line
- WHEN both run inside the same transaction with row-lock serialization
- THEN exactly one succeeds; the loser blocks or rejects without exceeding original quantity
- TEST: integration (concurrency fixture)

### Requirement: Return window enforcement from PLAZO_DEVOLUCION config (R-D3)

The system MUST read `PLAZO_DEVOLUCION` from `ConfiguracionEmpresa` (default 15 days SD). A return MUST be rejected with `DEVOLUCION_FUERA_DE_PLAZO` when `todaySD − venta.fecha > plazoDias`. If `PLAZO_DEVOLUCION` is missing, the system MUST hard-fail with a stable error code and zero writes (same pattern as `DESC_MAX`).

#### Scenario: Return within window accepted

- GIVEN a sale dated 10 days ago, `PLAZO_DEVOLUCION` = 15
- WHEN return is attempted
- THEN the return proceeds past the window check
- TEST: integration

#### Scenario: Return outside window rejected

- GIVEN a sale dated 20 days ago, `PLAZO_DEVOLUCION` = 15
- WHEN return is attempted
- THEN `DEVOLUCION_FUERA_DE_PLAZO` returns and no row is written
- TEST: integration

#### Scenario: Missing PLAZO_DEVOLUCION hard-fails

- GIVEN `PLAZO_DEVOLUCION` is not seeded
- WHEN return is attempted
- THEN a stable hard-fail error returns and zero writes occur
- TEST: integration

### Requirement: Conditional inventory reversal by tipoReposicion (R-D4)

For each return line, `tipoReposicion` determines the inventory effect: `VENDIBLE` MUST produce an `ENTRADA_DEVOLUCION` movement restoring branch stock; `DANADO` MUST produce a `SALIDA_MERMA` movement recording loss. The branch MUST match the original sale's inventory exit branch — cross-branch returns MUST be rejected.

#### Scenario: VENDIBLE returns restore stock via ENTRADA_DEVOLUCION

- GIVEN a returned line with `tipoReposicion = VENDIBLE`
- WHEN `registrarDevolucion` runs
- THEN an `ENTRADA_DEVOLUCION` movement appends with correct before/after quantities at the original branch
- TEST: integration

#### Scenario: DANADO records loss via SALIDA_MERMA

- GIVEN a returned line with `tipoReposicion = DANADO`
- WHEN `registrarDevolucion` runs
- THEN a `SALIDA_MERMA` movement appends with correct before/after quantities
- TEST: integration

#### Scenario: Cross-branch return rejected

- GIVEN a sale whose inventory exit was at branch A1
- WHEN return is attempted from session branch A2
- THEN a typed branch-mismatch error returns and no row is written
- TEST: integration

### Requirement: Atomic B04 NCF consumption (R-D5)

B04 NCF MUST be consumed atomically via `consumirNcfEnTx(tx, ctx, "B04")` inside the same tenant transaction. The NCF string MUST follow the standard `B04%08d` composition. The NC row MUST reference the consumed NCF. Retries on already-confirmed returns MUST NOT consume a second B04 (idempotency).

#### Scenario: B04 consumed atomically on return

- GIVEN an active B04 range
- WHEN `crearDevolucion` runs
- THEN exactly one B04 NCF is consumed and attached to the NC
- TEST: integration

#### Scenario: Idempotent retry does not double-consume

- GIVEN a return already confirmed with a B04 NCF
- WHEN the same return is retried
- THEN `DEVOLUCION_YA_REGISTRADA` returns and no second NCF is burned
- TEST: integration

### Requirement: NC creation with correct totals and audit (R-D6)

The NC MUST be created with `estado = VIGENTE`, `monto` and `itbis` computed from the returned lines using the same ITBIS calculators as the original sale. Each `DETALLE_NOTA_CREDITO` MUST carry `productoId`, `cantidad`, `precioUnitario`, `tasaItbis`, `itbis`, `subtotalLinea`, `tipoReposicion`. Audit rows MUST append for NC creation and each inventory movement inside `withTenantTransaction`.

#### Scenario: NC totals computed correctly

- GIVEN return lines totaling 100.00 base with 18% ITBIS on gravado lines
- WHEN the NC is created
- THEN `monto` and `itbis` match the calculator output and the NC is `VIGENTE`
- TEST: unit

#### Scenario: Audit rows appended for NC and movements

- GIVEN a return creating one NC and two inventory movements (2 lines, mixed tipoReposicion)
- WHEN the transaction commits
- THEN exactly one NC audit row and two movement audit rows append
- TEST: integration

### Requirement: Tenant isolation and idempotency (R-D7)

Every return read and write MUST be scoped to session `empresaId` (+ `sucursalId`) inside `withTenantTransaction` with RLS GUCs. The same return request MUST be idempotent: retrying MUST NOT produce a duplicate NC or double-effect inventory. Payment/refund effects are deferred to Fase 6; the derived CxC balance (ADR-017) MUST automatically reflect the NC.

#### Scenario: Cross-tenant return blocked

- GIVEN empresa A context referencing a venta owned by empresa B
- WHEN return is attempted
- THEN typed not-found with zero effects
- TEST: integration

#### Scenario: Return reduces derived CxC balance via ADR-017

- GIVEN a confirmed sale with total 500.00, no payments
- WHEN a VIGENTE NC of 100.00 is created
- THEN the derived balance becomes 400.00 (formula: total − Σreceipts − ΣNC(VIGENTE))
- TEST: integration
