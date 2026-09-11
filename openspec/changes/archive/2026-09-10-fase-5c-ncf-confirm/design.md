# Design: fase-5c-ncf-confirm

## Technical Approach

Choose exploration Option 1: reusable `app/src/modules/ncf/{domain,application,infrastructure}`; `venta` orchestrates one `withTenantTransaction`. Existing ERD tables/enums are reused: zero migrations.

## Architecture Decisions

| Choice | Rejected | Why |
|---|---|---|
| NCF domain owns composition, eligibility result types, SD expiry and threshold math; application exposes the consume port; infrastructure owns Prisma locking and seed. | NCF inside `venta/infrastructure`. | Future B04/B11 consumers reuse one rule implementation. |
| Lock `NCF_SECUENCIA` with `SELECT ... FOR UPDATE`, not `EMPRESA`. | Company-row lock. | Serializes only the requested `empresaId+tipoNcf` sequence. |
| Every post-consume rejection throws. | Return-after-consume. | The transaction must roll back counter, state, invoice, stock and audit. |

## Data Flow

`Action → withTenantTransaction → confirmarVenta → NCF + FACTURA + registrarSalidasVenta → commit`

`cancelarVenta → guarded flips + registrarReposicionCancelacion → commit`

`consumirNcfEnTx(tx, ctx, tipo, opts)` returns `{ncf, tipo, secuencial, warning?}`. It locks active `empresaId/tipoNcf`, treats `secuenciaActual` as last used, advances `next`, and composes exactly `B<tipo><next as %08d>`. Missing, `next > rangoFin`, and expired ranges throw `NCF_SEC_INEXISTENTE`, `NCF_AGOTADA`, and `NCF_VENCIDA`; expiry compares SD calendar dates with `date-fns-tz`, not UTC instants. Used ≥90% returns out-of-band `NCF_UMBRAL_90` without failing. Retried `CONFIRMADA` sales return before consuming; aborted transactions burn nothing.

## File Changes

| Path | Action |
|---|---|
| `app/src/modules/ncf/` | Create pure rules, consume port, locked repository, seed. |
| `app/src/modules/venta/domain/{venta,errors}.ts` | Add confirm/cancel transitions; 19-code catalog and two warning statuses. |
| `app/src/modules/venta/application/{confirmar-venta,venta-service}.ts` | Add confirm and confirmed-cancel orchestration. |
| `app/src/modules/venta/infrastructure/venta-repository.ts` | Add guards, persisted-line read, FACTURA and FAC allocator. |
| `app/src/modules/inventario/{application,infrastructure}` | Add exit/reposition batches. |
| `app/src/modules/venta/http/actions.ts`, `ui/{PosScreen,DraftList}.tsx` | Add thin actions, single-shot controls, error/warning display. |
| `app/tools/scripts/seed-ncf.ts`, `package.json`, venta-config reader/seed | Add seed and DESC_MAX deterministic ordering/overlap assertion. |

## Interfaces / Contracts

`confirmarVenta(tx,ctx,{id})` runs: read + branch guard → pure `transicionarConfirmar` → re-read persisted lines/rates and hard stock preview (early) → NCF consume → guarded `UPDATE ... WHERE estado='BORRADOR'` plus affected-row check → `FACTURA(VIGENTE)` → throwing `registrarSalidasVenta` → warnings. It gates `facturaAutomatica` before NCF (`FACTURA_AUTOMATICA_FALTA`). FACTURA totals are recomputed from persisted lines with Decimal(12,2)/(12,3), including 16% as gravado; `total = subtotal - descuento + itbis`; FAC is atomic `FAC-%06d` allocation. The allocator locks `EMPRESA`, temporarily clears sucursal GUC for company-wide MAX, and restores it in `finally` before the branch-scoped FACTURA write.

B01 is selected only when the client has a valid 9-digit RNC from `fiscal-id.ts` and `!esConsumidorFinal`; otherwise B02 (degenerate data fails closed). `registrarSalidasVenta(tx,ctx,{ventaId,lineas})` deduplicates IDs, locks ascending product IDs, verifies ownership, locks/upserts branch inventory, throws `STOCK_INSUFICIENTE_BLOQUEO`, then writes one `SALIDA_VENTA` movement per line with `ventaId` and before/after quantities. Reposition mirrors the locks with positive delta, non-empty reason and `REPOSICION_CANCELACION`; neither changes `costoPromedio`.

Cancellation guards `CONFIRMADA→CANCELADA`, annuls linked `VIGENTE→ANULADA`, audits both, restores stock, and never rewinds NCF (608 semantics); repeated cancellation returns the guarded stable error. The 5 new error codes are `NCF_AGOTADA`, `NCF_VENCIDA`, `NCF_SEC_INEXISTENTE`, `FACTURA_AUTOMATICA_FALTA`, `STOCK_INSUFICIENTE_BLOQUEO`; `STOCK_INSUFICIENTE` and `NCF_UMBRAL_90` remain warnings. Update R-V13 length assertion to 19.

## HTTP, UI and Seed

Confirm/cancel Server Actions validate, authorize, and call the use cases inside `withTenantTransaction`; UI disables on first click, lets the server revalidate, surfaces the five errors, and shows the 90% banner in the POS status/warning area. `pnpm seed:ncf` upserts `{empresaId,tipoNcf,rangoInicio,rangoFin,vigenciaInicio,vigenciaFin,activa}` per empresa/type, with independent B01/B02 ranges, existing compound-upsert idempotency, and fail-fast overlap checks. _Deviation (reconciled at apply, PR-4): phase-1 drafts printed a 9-digit dev range (100000000–100000999) that spelled the NCF 12 characters long, but the canonical composition is `B<tipo 2d><%08d>` = 11 characters (R-N2, `consumir-ncf`). The landing seed uses ranges consistent with that composition: dev/local B01 `00000001–00000100` and B02 `00000101–00000200` per empresa (disjoint, DGII-plausible ≤ 99_999_999, `secuenciaActual = rangoInicio - 1`); production ranges load through the same seam._

## Testing Strategy

Unit: composition, eligibility, transitions, SD expiry, 90%, exhaustive state mapping. Integration: row-lock concurrency, absent/exhausted/expired ranges, post-consume rollback, FAC concurrency, tenant/branch isolation, shortage rollback, cancellation/608, DESC_MAX ordering and seed overlap. Playwright only: seeded draft → confirm → invoice/NCF visible and DB assertion; no broader E2E.

## Threat Matrix

The seed is a shell entry point, but there is no VCS/PR automation or repository/process selector: documentation-like paths, Git selection, commit state, push state and PR commands are all `N/A` for those reasons. RED coverage is seed argv/exit behavior plus idempotency.

## PR Slicing

Four chained PRs: (1) NCF engine/tests ~420 lines, runtime; (2) confirm/FACTURA/catalog ~620, runtime; (3) exits/reposition/cancel ~520, runtime; (4) UI/seed/smoke/DESC_MAX ~760, runtime. Forecast includes lockfile lines and applies the 5b +15% UI carry: ~2,320 review lines total. Tasks preserve applicable RED cases unchanged.

## Migration / Rollout

No migration. Seed ranges before confirm E2E; consumed NCFs remain consumed on cancellation or code rollback.

## Open Questions

None blocking. Corporate 11-digit RNC remains deferred; B01 is local-validation-only in V1.
