# Design: fase-5a-clientes

## Technical Approach

Implement a four-layer `cliente` module by porting the proven proveedor patterns: pure domain rules, transaction-oriented application use cases, tenant-filtered Prisma infrastructure, and thin Server Actions. Add one dependency-free shared fiscal validator, credit cross-field validation before any write, real `Venta` deactivation probing, and hidden Consumidor Final provisioning. This satisfies the 13 requirements/20 scenarios in the two delta specs without adding sale or CxC behavior.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Fiscal validator location | `app/src/shared/domain/fiscal-id.ts`, exports `validarRnc`, `validarCedula`, `validarIdentificacionFiscal`; weights are constants, not configurable. | Keep it under `cliente`; copy into proveedor/venta. | The contract explicitly requires cross-module reuse while keeping the code pure and ORM-free. 11 digits use cédula only; corporate 11-digit RNC DV remains an explicit accountant-confirmation open item for 5b/5c. |
| Credit rule | Pure `validarReglasCredito` in `domain/cliente.ts`, called by create/update before probes or writes. Stable code: `CREDITO_REQUIERE_FISCAL_IDENTIDAD`. | Zod-only or HTTP-only enforcement. | Domain/application enforcement covers actions and future callers and guarantees zero mutation on failure. |
| Error catalog | `ClienteErrorCode` constants in `domain/errors.ts`: `CLIENTE_IDENTIFICACION_DUPLICADA`, `IDENTIFICACION_FISCAL_INVALIDA`, `CLIENTE_NO_ENCONTRADO`, `CLIENTE_YA_INACTIVO`, `CLIENTE_TIENE_VENTAS`, `CONCURRENCIA_CONFLICTO`, `CREDITO_REQUIERE_FISCAL_IDENTIDAD`, `NO_AUTORIZADO`, `SESION_INVALIDA`, `VALIDATION_ERROR`, `CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO`; `messageFor` supplies stable Spanish user messages and optional minimal details. | Adapter-defined strings or proveedor error reuse. | Error codes are versioned with this domain and preserve module ownership; the CF-protected code distinguishes reserved-row CRUD violations. |
| Deactivation guard | `tieneVentasNoCanceladas` counts `Venta` rows by `empresaId`, `clienteId`, `estado != CANCELADA`; `Venta` and `Factura` already exist in `schema.prisma`, so this is a real probe, not a stub. | Probe `Factura`, or defer until 5b. | The requirement is about sale state; `Venta.estado` is authoritative and already available. |
| CF provisioning and boundary | Seed shape: `Consumidor Final`, `N/A` telephone/address, `identificacionFiscal=null`, `tipoCliente=MINORISTA`, credit disabled, limit `0.00`, term `30`, active. `seedConsumidorFinalParaEmpresa` is idempotent and script-mirrored. `getOrCreateConsumidorFinalEnTx` fetches, inserts, catches `P2002`, then refetches. Seed only is called in 5a; lazy get-or-create is a reserved 5b sale seam. Regular list/detail/update/deactivate exclude/protect `esConsumidorFinal`. | Lazy-only provisioning; expose CF to CRUD. | Seed makes tenant state explicit; the partial unique index makes races safe; hiding/protection prevents accidental fiscal-record mutation. |
| Credit authorization | Same update action accepts credit fields but checks Administrator in-transaction; ordinary fields remain Admin+Operador. | Separate credit action. | One optimistic-lock command preserves atomic patch/audit semantics and server-side authorization without duplicating update flow. |

## Data Flow

`Action (Zod transport)` → `getCurrentTenantContext` → `withTenantTransaction`/role gate → `use case` (normalize, fiscal + credit rules, tenant probes) → `Prisma repository` → audit row in the same transaction → explicit HTTP DTO.

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/shared/domain/fiscal-id.ts` + tests | Create | Pure mod-11 validator and fixtures `131045677` / `00123456795`. |
| `app/src/modules/cliente/**` | Create | Domain, catalog, four CRUD use cases, CF get-or-create, repository, Zod, actions, unit tests; mirror proveedor conventions. |
| `app/tools/scripts/seed-consumidor-final.ts` | Create | Idempotent per-empresa seed/backfill, direct-URL script guard. |
| `app/src/integration/cliente-tenant.integration.test.ts` | Create | Real DB tenant, PII, CRUD, race, audit and guard coverage. |
| `app/prisma/migrations/YYYYMMDDHHMMSS_cliente_credit_defaults/migration.sql` | Create | `ALTER TABLE "CLIENTE" ALTER COLUMN "limiteCredito" SET DEFAULT 0;` and `..."plazoCreditoDias" SET DEFAULT 30;`. Own migration commit; no schema change. |
| Empresa provisioning/seed hook | Modify | Invoke the CF seed for newly provisioned empresas. |

## Interfaces / Contracts

```ts
validarIdentificacionFiscal(value: string): { ok: true; value: string } | { ok: false };
validarReglasCredito(input: { creditoHabilitado: boolean; limiteCredito: Decimal; tipoCliente: TipoCliente; identificacionFiscal: string | null }): void;
```

All repository operations include `empresaId`; updates use `updateMany({id, empresaId, version})`; P2002 maps to the duplicate code. Decimal values remain strings/`Prisma.Decimal`, never floats.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Domain normalization, ranges, credit⇒RNC, all catalog paths, mod-11 success/failure matrix and open-item contract. | Jest, no DB. |
| Integration | CRUD, optimistic lock, admin-only credit audit, PII isolation, CF idempotency/race, partial-UK reuse, real `Venta` guard, rollback audit. | Jest real DB harness at `sf-postgres:5433`, `crearEmpresa`/tenant fixtures, RLS enabled. |
| E2E | No new UI scope. | Existing HTTP/action tests cover DTO and role boundaries. |

## Threat Matrix

N/A — no routing changes, shell/subprocess execution, VCS/PR automation, executable classification, or process integration boundary.

## Migration / Rollout

Apply the defaults migration as a separate first commit, then deliver two stacked slices: **PR-5a.1** domain/validator/repository/unit tests (~550–700 authored lines); **PR-5a.2** use cases/HTTP/integration/CF seed/docs (~550–700). Total forecast remains >800, so tasks must retain chained-PR handling and the `ask-on-risk` guard. Backfill is additive and idempotent.

## Open Questions

- [ ] Accountant must pin the modern 11-digit corporate RNC check-digit variant in 5b/5c; until then 11-digit values are cédula-only.
