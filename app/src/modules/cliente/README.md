# Cliente module

Tenant-isolated CRUD for clients (PII): fiscal-ID (RNC/cédula) validation,
credit-field storage under an Admin-only audited policy, and per-empresa
Consumidor Final provisioning. It mirrors the proveedor-parity layering
(ADR-013 modular monolith) and unblocks venta (5b/5c) and CxC (Fase 6) as
storage-only seams — no sale or CxC behavior lives here yet.

## Responsibility map (four layers)

| Layer | Path | Owns |
|---|---|---|
| `domain/` | `cliente.ts`, `errors.ts` | Pure entity + `TipoCliente`, fiscal-ID normalization, credit defaults (`0.00` / `30`) and limits (`≥0` / `>0`), the cross-field `validarReglasCredito` (credit ⇒ valid fiscal ID, R5), and the eleven-code error catalog with stable Spanish messages. No Prisma/Next/React/Supabase. |
| `application/` | `crear-cliente.ts`, `obtener-cliente.ts`, `listar-clientes.ts`, `actualizar-cliente.ts`, `desactivar-cliente.ts`, `consumidor-final.ts` | Typed use cases (success/business-error): create (defaults + credit rule + duplicate probe, version 1), optimistic-lock update (credit rule on the *merged* effective state), detail, bounded paginated listing (25/cap 100, CF-excluded, name/fiscal-digit search), guarded soft deactivate (ventas probe + idempotency + CF-protection), and the reserved 5b `getOrCreateConsumidorFinalEnTx` seam (fetch→insert→catch→refetch). |
| `infrastructure/` | `cliente-repository.ts` | Tenant-filtered Prisma only: active-only + CF-excluded `buildWhere`, active-only duplicate probe (P2002 → `CLIENTE_IDENTIFICACION_DUPLICADA`), optimistic `updateMany` (`{updated:false}` → `CONCURRENCIA_CONFLICTO`), idempotent soft-deactivate, real `Venta` `tieneVentasNoCanceladas` guard, in-transaction audit. Money crosses as `Decimal(12,2)` strings / `decimal.js` `Decimal`, never a float. |
| `http/` | `validation.ts`, `actions.ts` | Zod transport shapes only (no fiscal/credit *format* logic) + thin Server Actions (tenant ctx → `withTenantTransaction` → role gate → use case → DTO). |

## Fiscal-validator reuse contract

Fiscal-ID format is validated by the SHARED, dependency-free
`@/shared/domain/fiscal-id` (`validarRnc`, `validarCedula`,
`validarIdentificacionFiscal`) — the same import compra/venta will use, so
results are identical across modules (client-validators R1–R4):

- Normalization strips `-`/spaces; length discriminates the variant
  (9 → RNC, 11 → cédula); mod-11 with frozen weights, DV `11−(Σ mod 11)`,
  raw `11 → 0`, raw `10 → invalid`.
- **Open item**: the modern **11-digit corporate RNC** (`…-00001`) shares its
  length with the cédula; its check-digit variant is **not** pinned by
  `docs/13` and is deferred to Fase 5b/5c pending accountant confirmation.
  Until then, 11-digit input is validated **only** under the cédula rule.

Format rules are domain-owned — never re-implemented in Zod or an adapter.
`esConsumidorFinal` rows are excluded from operator list/detail and protected
from update/deactivate; only internal provisioning reads them.

## Request flow

```
Zod transport (http/validation.ts)
  → getCurrentTenantContext(supabase)        # auth read, pre-transaction
  → withTenantTransaction(ctx)               # sets RLS GUCs, one tx
      → role gate (tieneRolPermitidoEnTx)    # CRUD Admin+Operador;
                                             # credit/tipo/deactivate Admin-only
      → use case                             # normalize, fiscal + credit rules,
                                             # tenant probes, optimistic lock
      → Prisma repository                    # tenant-scoped, P2002 → codes
      → audit row (same tx)                  # append-only, VARCHAR-safe payload
  → explicit DTO (money as fixed-point string)
```

The tenant context is resolved from the Supabase session BEFORE the wrapper (an
auth read, not tenant-DB access); every authorization check and Prisma call still
runs INSIDE the transaction. Server-side roles are authoritative — hiding UI
controls is never the security boundary.

## Error catalog (`domain/errors.ts`)

Eleven stable codes, each with a frozen Spanish `messageFor` (no ad-hoc strings
in adapters): `CLIENTE_IDENTIFICACION_DUPLICADA`, `IDENTIFICACION_FISCAL_INVALIDA`,
`CLIENTE_NO_ENCONTRADO`, `CLIENTE_YA_INACTIVO`, `CLIENTE_TIENE_VENTAS`,
`CONCURRENCIA_CONFLICTO`, `CREDITO_REQUIERE_FISCAL_IDENTIDAD`, `NO_AUTORIZADO`,
`SESION_INVALIDA`, `VALIDATION_ERROR`, `CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO`.

## Consumidor Final provisioning

Every empresa carries exactly one `esConsumidorFinal=true` row (NULL fiscal ID,
`MINORISTA`, credit off, limit `0.00`, term `30`) — the target of a B01/B02 sale
to an unidentified buyer.

- **Shape is single-sourced** in `domain/cliente.ts` (`CONSUMIDOR_FINAL`), so the
  seed and the reserved 5b seam can never drift.
- **Seed/backfill**: `pnpm seed:cliente` runs `tools/scripts/seed-consumidor-final.ts`
  (`seedConsumidorFinalParaEmpresa` / `seedConsumidorFinal`), idempotent and
  mirroring `seed-retencion-config.ts`. There is **no in-app empresa-provisioning
  service to hook** (empresa creation is operator/seed-driven), so — exactly like
  the retention seed — provisioning is this maintenance script plus the same
  seam the integration fixtures call.
- **Race safety**: `getOrCreateConsumidorFinalEnTx` (fetch → insert → catch
  `P2002` → refetch) is the **reserved Fase-5b seam**. It imports nothing from the
  `venta` module; 5a provisions only via the seed. The DB partial unique
  `cliente_consumidor_final_uk` (`UNIQUE(empresaId) WHERE esConsumidorFinal`) is
  the definitive backstop: concurrent callers leave exactly one row.

## Integration notes (`src/integration/cliente-tenant.integration.test.ts`)

Real DB (`sf-postgres:5433`, `systemfact_test`, RLS on). Run with
`pnpm test:integration`. Key guarantees:

- **Tenant PII isolation (R1)**: a foreign-empresa id returns the SAME
  `CLIENTE_NO_ENCONTRADO`/message as a never-existed id (no existence oracle).
- **Optimistic lock**: a stale `version` yields `CONCURRENCIA_CONFLICTO` and
  preserves the newer committed row.
- **Credit policy (R2/R5)**: an Operador credit-field edit is rejected by the
  real role table with zero writes; the credit⇒RNC cross-field rule fails without
  touching the row or emitting audit; an Admin credit edit audits only the changed
  fields.
- **Guarded deactivate (R6)**: a real `Venta` in `CONFIRMADA` state blocks with
  `CLIENTE_TIENE_VENTAS`; a `CANCELADA` sale does not.

### Audit payloads are VARCHAR(255)-safe

`MOVIMIENTO_AUDITORIA.valorAnterior` / `.valorNuevo` are `VarChar(255)`. The
module therefore audits **ids plus the changed scalar fields only** (never a
full-row JSON blob), so a single edit's before/after JSON always fits. Verified
in the integration suite (`length ≤ 255`).

### `schema.prisma` `@@unique` drift (documented, intentional)

`schema.prisma` declares a **full** `@@unique([empresaId, identificacionFiscal])`,
but the DATABASE enforces a **partial** unique
(`CLIENTE_empresaId_identificacionFiscal_key ... WHERE (activo = true)`) — created
by raw SQL in `20260901151853_partial_uk_sobre_activo`. Prisma's `@@unique` cannot
express a partial `WHERE` predicate, so the schema text and the DB differ by
necessity. Both were **frozen by the spec** (do not silently rewrite
`schema.prisma`, do not change the DB). Because Prisma does not enforce
`@@unique` client-side, the partial index is authoritative: deactivating a client
releases its fiscal ID for reuse (Directiva §12). Scenario **(f)** in the
integration suite is the executable proof of that effective behaviour and is the
resolution record for this drift.

