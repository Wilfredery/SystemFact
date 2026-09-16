# Design: Phase 7A — Audit Consultation

## Technical Approach

Create an ADR-013 `auditoria` module for a read-only Administrator audit view and a small public write seam. The read path is `consultarAuditoria` → Prisma-only `consultarAuditoriaEnTx` → thin Server Action → `withTenantTransaction` and role gate. Cobros and auth inject the public audit port only for the two missing catalog events; existing fragmented writers remain unchanged.

## Architecture Decisions

| Decision | Choice | Alternatives / rationale |
|---|---|---|
| Module boundary | `domain/`, `application/`, `infrastructure/`, `http/`, `ui/`, plus `src/app/auditoria/page.tsx` | Keeps pure filter/pagination mapping separate from Prisma and React, mirroring `cobros` and ADR-013. |
| Company-wide admin read | Clear `app.current_sucursal_id` locally inside the transaction, query `empresaId` plus optional branch filter, then restore it in `finally` | `TenantCtx` is branch-shaped, but the existing RLS audit policy intentionally permits `sucursalId IS NULL` and all branches when the branch GUC is empty. The company GUC remains pinned. |
| Shared write seam | Export `AuditoriaWritePort` from `auditoria/application`; `infrastructure` supplies the PrismaTx adapter. Cobros/auth receive the port rather than importing private repositories | No project-wide refactor of eight existing writers; no module imports another module’s internals. |
| Login/logout context | Direct Prisma transaction after identity resolution: set login-flow plus `app.current_empresa_id`, insert with resolved `empresaId`, `sucursalId`, `usuarioId` (nullable branch for company events), then complete auth action | `withTenantTransaction` cannot run before `TenantCtx` exists. The auth result is the authoritative tenant anchor; failure propagates rather than silently losing security evidence. |

## Data Flow

```text
filters → Zod action → resolverCtx → withTenantTransaction/GUCs
        → Admin gate → consultarAuditoria → repository → rows + total
        → typed DTO → client filter/pagination table

COBRO/REEMBOLSO transaction ─→ Pago mutation ─→ audit port insert
LOGIN/LOGOUT ─→ auth identity ─→ standalone audit transaction ─→ session result
```

## File Changes

| File | Action | Description |
|---|---|---|
| `app/src/modules/auditoria/{domain,application,infrastructure,http,ui}/**` | Create | Pure filters/pagination, typed use case/errors, Prisma read/write adapters, action, filter form and table. |
| `app/src/app/auditoria/page.tsx` | Create | Server shell; redirects unauthenticated users and passes admin context to UI. |
| `app/prisma/schema.prisma` + migration | Modify/Create | Add audit read indexes. |
| `app/src/modules/cobros/**` | Modify | Inject audit port after the first committed COBRO/REEMBOLSO application only. |
| `app/src/modules/auth/**` | Modify | Write LOGIN/LOGOUT using the standalone path above. |

Indexes: `(empresaId, fechaHora, id)` supports the default newest-first page; `(empresaId, sucursalId, fechaHora, id)` supports branch/date filters; `(empresaId, accion, fechaHora, id)` and `(empresaId, usuarioId, fechaHora, id)` support the two selective equality filters. No JSON/blob or free-text index is added. Four targeted indexes cost insert/update index maintenance on an append-heavy table, but avoid an unbounded tenant scan for the required access patterns; no speculative `(entidad,idEntidad)` index ships in V1.

## Interfaces / Contracts

`AuditoriaFiltro`: `accion?`, `usuarioId?`, `sucursalId?`, `desde?`, `hasta?`, `texto?`, `page` (≥1), `pageSize` (25 default, max 100). `AuditoriaPagina` returns rows, `total`, `page`, `pageSize`, `totalPages`. Stable errors: `AUDITORIA_NO_AUTORIZADO` and `AUDITORIA_VALIDACION` (transport validation); Prisma errors never cross the action boundary.

The repository always pins `empresaId`, applies optional filters, orders `fechaHora DESC, id DESC`, and uses explicit selects. No update/delete API exists. The refund audit call occurs only after the idempotency pre-check has proved a new `Pago`; replay and unique-conflict paths write no audit row.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Filter normalization, page clamping, DTO mapping, error catalog | Jest, no database. |
| Integration | Pagination/filter combinations, tenant isolation, admin gate, branch/company scope, append-only; cobro/refund first-apply + replay no-dup; login/logout rows | Real Postgres 16 with RLS and `systemfact_app`. |
| UI | Filter submission, loading/error/table/page navigation, no mutation controls | Minimal React UI test; one Playwright smoke for `/auditoria` if credentials are available. |

Standard mode applies (`strict_tdd: false`).

## Threat Matrix

Routing changes are limited to a Next.js page/action; no shell, subprocess, executable classification, VCS, or PR automation boundary exists. Therefore every supplied row is `N/A`:

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No documentation execution. |
| Git repository selection | N/A | No Git command or repository selection. |
| Commit state | N/A | No commit automation. |
| Push state | N/A | No push automation. |
| PR commands | N/A | No PR command integration. |

## Migration / Rollout

Ship migration/indexes separately from application code, then module/read UI, then cobros and auth backfills. Each slice rolls back by reverting its code; the additive index migration can drop only its new indexes. Failed audit inserts roll back with the owning transaction. No data deletion or retention job is introduced.

Retention remains documented as **3 years, adjustable**, with enforcement postponed. Architectural note (ADR-016, verbatim): “El log de auditoría es **append-only e inmutable**: - Los movimientos de auditoría se insertan una sola vez y NUNCA se actualizan ni se eliminan, ni a nivel de aplicación ni a nivel de base de datos (sin UPDATE ni DELETE sobre el log). - La tabla es de solo inserción y la consulta del registro es SOLO LECTURA. - El acceso a la consulta del log es exclusivo del rol Administrador.” Any future purge is a DELETE and requires an explicit carve-out ruling before implementation.

## Non-Goals and Open Questions

No retention mechanism/UI, exporter, report/KPI, B03, caja/config/roles backfill, or refactor of existing audit writers. No blocking questions remain for this design; task planning must preserve the transaction, replay, RLS, and rollback boundaries above.
