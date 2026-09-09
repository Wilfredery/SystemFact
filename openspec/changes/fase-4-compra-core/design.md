# Design: Compra Core

## Technical Approach

Add `app/src/modules/compra/` as a four-layer modular-monolith feature. Domain code owns pure Decimal-as-string validation, mixed-rate totals, retention rules, the `BORRADOR → PENDIENTE → CANCELADA` state contract, and stable errors. Application use cases orchestrate typed results; infrastructure performs tenant-scoped Prisma work through `PrismaTx`; HTTP actions validate with Zod, resolve the session context, enforce `Administrador`, and call `withTenantTransaction`. This implements the proposal/spec without migrations, inventory writes, receipt, payments, or B11 generation.

## Architecture Decisions

| Decision | Choice | Rejected alternative | Rationale |
|---|---|---|---|
| Internal correlativo | Lock the tenant `EMPRESA` row with `SELECT ... FOR UPDATE`, then compute `MAX(CAST(SUBSTRING(correlativoInterno FROM '\\d+$') AS bigint)) + 1` for that empresa and format `CMP-%06d`. | Reuse `NcfSecuencia`, application-only MAX, or add a counter table. | Schema has no internal-counter table. The empresa row is an existing durable serialization anchor; every confirm in this module locks it before reading MAX, preventing duplicate CMP values without a migration. `NcfSecuencia` is fiscal and must remain separate. |
| Transition idempotency | One guarded `UPDATE Compra ... WHERE id, empresaId, estado=expected`, then check affected rows. | Version column or read-then-write. | Matches the frozen schema and proven concurrency pattern; losers receive a typed conflict and cannot create audit/correlativo effects. |
| Retention configuration | Read active, validity-window-matching `ConfiguracionEmpresa` rows inside the confirm transaction and pass parsed rates to pure calculators. | Hardcoded legal defaults or fallback values. | First-ever config read path must honor tenant configuration; missing applicable keys must block confirmation. |

## Data Flow

```text
Action (Zod/session/role) → withTenantTransaction → use case
                                      ├→ config + supplier/product repository
                                      ├→ pure totals/retentions
                                      ├→ guarded Compra write + audit
                                      └→ typed HTTP result
```

Confirm locks `EMPRESA`, reads retention config and the draft, recalculates from frozen lines, allocates the next CMP value, performs the guarded transition, and appends one audit row. If any step fails, the transaction rolls back.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/compra/domain/compra.ts` | Create | Const-derived enums/types, draft/line/totals contracts, state transition guards, typed seams (`InventoryEntryPort`, `INVENTORY_SOURCE.PURCHASE`). |
| `app/src/modules/compra/domain/calculators.ts` | Create | Decimal-string line totals, mixed 18/16/0 ITBIS, gross total, and parameterized ISR/ITBIS retention calculators. |
| `app/src/modules/compra/domain/errors.ts` | Create | Stable catalog: `VALIDATION_ERROR`, `COMPRA_NO_ENCONTRADA`, `PROVEEDOR_NO_ENCONTRADO`, `PRODUCTO_NO_ENCONTRADO`, `PROVEEDOR_INACTIVO`, `LINEA_INVALIDA`, `COMPRA_INMUTABLE`, `TRANSICION_INVALIDA`, `CONFIG_RETENCION_FALTANTE`, `CORRELATIVO_CONFLICTO`, `CONCURRENCIA_CONFLICTO`, `NFC_DUPLICADO`, `NO_AUTORIZADO`, `SESION_INVALIDA`. |
| `app/src/modules/compra/application/*.ts` | Create | `crear-compra`, `actualizar-compra`, `confirmar-compra`, `cancelar-compra`, `listar-compras`, `obtener-compra`; all return `{ok:true,data}` or `{ok:false,code,message}`. |
| `app/src/modules/compra/infrastructure/compra-repository.ts` | Create | Tenant-filtered CRUD, line replacement, guarded transitions, Empresa row lock/MAX correlativo, audit writes, deterministic pagination/detail. |
| `app/src/modules/compra/infrastructure/configuracion-repository.ts` | Create | Reads four retention keys by empresa and current Santo Domingo validity window; rejects missing/invalid applicable values with the stable config error. |
| `app/src/modules/compra/http/validations.ts`, `actions.ts` | Create | Zod input schemas and thin admin-only Server Actions wrapped in `withTenantTransaction`. |
| `app/src/integration/setup/fixtures.ts` | Modify | Seed active suppliers, retention config, and purchase-ready products; expose them through `TenantFixture`. |
| `app/src/modules/compra/**/*.test.ts`, `app/src/integration/*compra*.test.ts` | Create | Domain, mocked-transaction application, and real-DB coverage. |

## Interfaces / Contracts

```ts
type CompraResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: CompraErrorCode; readonly message: string };

interface RetentionRates { isr15: string; isr2: string; itbis100: string; itbis30: string }
```

`PENDIENTE` has no edit path. Core use cases can only create/update `BORRADOR`, confirm to `PENDIENTE`, or cancel `BORRADOR/PENDIENTE` to `CANCELADA`; no code accepts `RECIBIDA` or `PAGADA`. Future receipt code consumes the documented `InventoryEntryPort` and `MovimientoInventario.compraId` seam only.

## Testing Strategy

| Layer | Coverage |
|---|---|
| Unit | Mixed 18/16/0 totals; formal/informal × física/jurídica retention matrix; missing applicable rate; state guards; base-unit and invalid-line errors. |
| Application | Mocked tx tests for draft CRUD, immutable PENDIENTE, guarded conflict, config failure, audit orchestration, pagination, and typed errors. |
| Integration | `compra-confirm.integration.test.ts` happy path/no inventory; `compra-concurrency.integration.test.ts` same draft race and two drafts with unique sequential CMP values; `compra-config.integration.test.ts` missing-key block; `compra-tenant.integration.test.ts` isolation/detail; `compra-cancel.integration.test.ts` motivo, audit, and retained NCF slot; extend fixture and supplier deactivation coverage. |
| E2E | Admin purchase draft/confirm/cancel and non-admin rejection when purchase screens are wired. |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary is introduced.

## Migration / Rollout

No migration required. Retention configuration is an operational prerequisite; absent keys intentionally block confirmation. Receipt/payment rollout remains a later additive phase.

## Review Workload Forecast

Estimated authored change: **900–1,200 lines** including module, tests, fixtures, and UI adapters. `400-line budget risk: High`. `Chained PRs recommended: Yes` (domain/tests; application/infrastructure/integration; HTTP/UI). `Decision needed before apply: Yes` — resolve chained delivery or explicitly accept `size:exception`.

## Open Questions

None; confirmed decisions and schema constraints close the design choices.
