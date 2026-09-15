# Delta for inventario

## ADDED Requirements

### Requirement: Return inventory primitive (registrarDevolucion) (R-S5-add)

The module MUST expose `registrarDevolucion` as the implemented return-inventory port, callable only inside the caller's tenant transaction. For each return line, in deterministic ascending-`productoId` lock order: verify product ownership by the tenant, upsert and lock the branch `INVENTARIO` row with `SELECT ... FOR UPDATE`, apply `ENTRADA_DEVOLUCION` when `tipoReposicion = VENDIBLE` (restore stock) or `SALIDA_MERMA` when `tipoReposicion = DANADO` (record loss), append exactly one `MovimientoInventario` carrying `notaCreditoId` with before/after quantities and branch/actor context, and audit. The branch MUST match the original sale's exit branch; cross-branch MUST be rejected. Any rejection MUST throw a typed error so the ENTIRE return rolls back atomically. Manual-adjustment rules and `costoPromedio` semantics are unchanged (returns never touch average cost).

#### Scenario: VENDIBLE line restores stock via ENTRADA_DEVOLUCION

- GIVEN a return line with `tipoReposicion = VENDIBLE` and 3 units at branch A1
- WHEN `registrarDevolucion` runs
- THEN branch A1 stock increases by 3 and exactly one `ENTRADA_DEVOLUCION` movement with `notaCreditoId` appends
- TEST: integration

#### Scenario: DANADO line records loss via SALIDA_MERMA

- GIVEN a return line with `tipoReposicion = DANADO` and 2 units at branch A1
- WHEN `registrarDevolucion` runs
- THEN branch A1 stock decreases by 2 and exactly one `SALIDA_MERMA` movement with `notaCreditoId` appends
- TEST: integration

#### Scenario: Cross-branch return inventory rejected

- GIVEN a return whose original sale exit was at branch A1, session branch A2
- WHEN `registrarDevolucion` attempts it
- THEN a typed branch-mismatch error returns and no movement persists
- TEST: integration

## MODIFIED Requirements

### Requirement: Tenant isolation and typed future seams

All reads and writes MUST be constrained by the authenticated tenant and branch, including movement history. The module exposes typed entry and exit interfaces for purchase, sale, return, and transfer callers; the purchase entry seam is implemented via `registrarEntradasCompra`/`registrarEntradaCompra` and MUST update `costoPromedio`; the sale exit seam is implemented via `registrarSalidasVenta` plus the cancellation reposition batch; the return seam is now implemented via `registrarDevolucion` (`ENTRADA_DEVOLUCION`/`SALIDA_MERMA` per `tipoReposicion`); transfer callers remain unimplemented. The seams MUST return typed success/error results.
(Previously: return/transfer callers and `TipoReposicion` flows were declared but unimplemented.)

#### Scenario: Cross-tenant access

- GIVEN an inventory or movement identifier belonging to another tenant
- WHEN a caller requests it or attempts an adjustment
- THEN the result is not-found or forbidden without disclosure
- AND no row is changed
- TEST: integration

#### Scenario: Schema and cost boundary updated

- GIVEN the 5d return path is applied
- WHEN the change is reviewed
- THEN no Prisma migration exists (enum values `ENTRADA_DEVOLUCION`/`SALIDA_MERMA` already ship in ERD v4.7)
- AND the manual adjustment path still never mutates `costoPromedio` while purchase entry always does and sale exit/return never does
- AND future transfer callers can type-check against the remaining published seams
- TEST: integration
