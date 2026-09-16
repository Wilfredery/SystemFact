# Proposal: fase-7a-auditoria — Audit consultation screen + partial write backfill

## Intent

Fase 7 ("Reportes y auditoría") names an Administrator audit-consultation capability that does not exist: `MovimientoAuditoria` is written but never read by any screen. Additionally, 2 of the 13 catalog events in already-built modules have no audit write (#3 cobros/reembolsos, #13 login/logout — `LOGIN`/`LOGOUT` enum values are unused). This change delivers the read screen and closes those two gaps.

## Scope

### In Scope
- New ADR-013 `auditoria` module (domain/application/infrastructure/http/ui) mirroring the proven `cobros` read pattern.
- Admin-only, paginated (25 default / max 100), filtered consultation screen at `/auditoria`. Filters combinable: acción (`AccionAuditoria`), usuario, sucursal, date range. Company-wide view (all tenant branches, matching the nullable-`sucursalId` RLS policy) with optional branch filter.
- Prisma index migration on `MOVIMIENTO_AUDITORIA` (e.g. `(empresaId, fechaHora)`, `(empresaId, accion)`, `(empresaId, usuarioId)`) to support the paged/filtered read.
- Backfill audit writes: #3 in `cobros` (`registrarCobro`/`registrarReembolso`, inside the same tx, no double-audit on idempotent replay), #13 in `auth` (login/logout, using existing unused enum values).
- One shared audit-write helper introduced and used ONLY by these new writes — no refactor of the ~8 existing fragmented write sites.

### Out of Scope
- Retention enforcement: policy documented here only (3 years, adjustable; mechanism postponed). **Architectural note:** any future purge is a DELETE on the audit table and directly conflicts with ADR-016 append-only ("never DELETE, not even by Admin"); an explicit carve-out ruling is required before purge code can exist. No purge job, no config key, no retention UI in this change.
- Events #10 (config-fiscal), #12 (roles/permisos) — no module writes them yet; deferred to their owning phases. #5 (cierre-caja) — `caja` module not built. Fiscal report access (LEER) events are not written by this change.
- B03 Nota de Débito audit (#2 partial) — deferred in V1 with the cobros ledger design.
- Big-bang refactor of the 8+ fragmented audit-write sites into one seam (explicit non-goal; follow-up risk noted below).
- Exporters (docs/16 §12: audit log never exported in V1).

## Capabilities

### New Capabilities
- `auditoria-consulta`: Admin-only, paginated, filtered, read-only consultation over `MovimientoAuditoria` (append-only, never deleted/edited; company-wide view with branch filter).

### Modified Capabilities
- `cobros`: adds audit-event requirement — every cobro and reembolso appends an audit row in the confirming transaction (idempotent replays must not double-audit).
- `auth`: adds audit-event requirement — successful login and logout append audit rows using `LOGIN`/`LOGOUT` enum values.

## Approach

Mirror `cobros`: `consultarAuditoria` (application) → `consultarAuditoriaEnTx` (infrastructure, only Prisma surface) → `consultarAuditoriaAction` (thin `"use server"`: Zod parse → `resolverCtx` → `withTenantTransaction` setting GUCs → `tieneRolPermitidoEnTx` admin role gate → delegate → typed result). `tenantWhere(tenantFilter(ctx))` for RLS-safe scoping; sort `fechaHora DESC, id DESC`. Backfill writes reuse the shared helper (`registrarEventoAuditoriaEnTx`) inside each confirm transaction. Single PR; branch `feature/fase-7a-auditoria`.

### PR slice forecast (budget context)
| Slice | ~Lines |
|---|---|
| Index migration + schema types | 50 |
| `auditoria` module (domain/infra/app/http) + tests | 320 |
| UI screen + filters + pagination | 280 |
| Shared helper + #3 cobros backfill + tests | 150 |
| #13 auth backfill + tests | 90 |
| **Total** | **~890** |

Exceeds the 400-line default and approaches the project-configured `review_budget_lines: 800`. Single-PR with `size:exception` was the previously maintainer-approved pattern for large SDD phases; recommending it again.

## Accepted defaults carried to spec (not open questions)
- Page default 25 / max 100; combinable filters; table loads paged-unfiltered-all-time on first visit.
- Sort `fechaHora DESC, id DESC`; totals shown per filter.
- Read restricted to Administrator role, server-side, via existing helper.

## Open points for spec phase (recommended defaults attached — no re-interview)
1. Whether the free-text filter searches structured fields only (`entidad`, `idEntidad`, `motivo`) — recommend yes; do not search JSON blobs.
2. Whether incidental `LEER`/producto read-audit rows are filterable noise — recommend exposed as an ordinary `accion` filter option, no special handling.

## Affected Areas

| Area | Impact |
|---|---|
| `app/src/modules/auditoria/**` | New module |
| `app/src/app/auditoria/page.tsx` | New route shell (Admin gate) |
| `app/src/app/prisma/schema.prisma` + migration | Indexes on `MOVIMIENTO_AUDITORIA` |
| `app/src/modules/cobros/**` | Audit rows on cobro/reembolso |
| `app/src/modules/auth/**` | Audit rows on login/logout |
| N/A | No existing audit-write site rewritten (non-goal) |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Cross-tenant leakage on the most sensitive read | Med | `withTenantTransaction` + `tenantWhere` + admin role gate + RLS `audit_select` (defense in depth); integration test asserting cross-tenant denial |
| Double-audit on idempotent refund replay | Med | Insert inside same tx; test audit count flat on replay (devolucion precedent) |
| Unindexed paged read degrades | Med | Index migration ships with the screen |
| Fragmented write sites drift further (missing future events) | Med | Documented; shared helper available for future modules (follow-up, own change) |

## Rollback Plan

Revert the single PR. Migration is additive (new indexes, new rows); downgrade migration drops indexes and no data is lost. No schema columns change.

## Dependencies

- Existing: `withTenantTransaction`, `tenantWhere`, `tieneRolPermitidoEnTx`, `ESLint server-action-must-wrap-tenant`, RLS policies already in place.
- Supabase session context for `LOGIN` events happens before `TenantCtx` exists — login audit write may need the standalone Supabase client path (design-phase concern).

## Success Criteria

- [ ] `/auditoria` reachable only by Admin; non-admin gets server-side denial.
- [ ] Paged (25/100) + combinable filters return correct results; tenant isolation proven by test.
- [ ] Catalog acceptance: #1✅ #2⚠️(B03 deferred) #3✅(this change) #4✅ #5❌(out) #6✅ #7✅ #8✅ #9✅ #10❌(out) #11✅ #12❌(out) #13✅(this change) → 8 of 13 met, 1 partial, 4 out-of-scope with documented owners.
- [ ] Append-only preserved: no UPDATE/DELETE path introduced; only `audit_select`/`audit_insert` used.
- [ ] No double-audit on idempotent replays (test asserted).
- [ ] Retention decision recorded (3 years, adjustable) + ADR-016 conflict noted.
