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
| `application/` | *(PR-5a.2)* | CRUD use cases + `getOrCreateConsumidorFinalEnTx`, all typed success/error. |
| `infrastructure/` | `cliente-repository.ts` | Tenant-filtered Prisma only: active-only + CF-excluded `buildWhere`, active-only duplicate probe (P2002 → `CLIENTE_IDENTIFICACION_DUPLICADA`), optimistic `updateMany` (`{updated:false}` → `CONCURRENCIA_CONFLICTO`), idempotent soft-deactivate, real `Venta` `tieneVentasNoCanceladas` guard, in-transaction audit. Money crosses as `Decimal(12,2)` strings / `decimal.js` `Decimal`, never a float. |
| `http/` | *(PR-5a.2)* | Zod transport shapes + thin Server Actions (tenant ctx → `withTenantTransaction` → role gate → use case → DTO). |

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
