# Auditoria Specification

## Purpose

Write-side contract of the append-only audit log. Owns the shared audit-write helper introduced this phase and the catalog-event coverage it closes (#3 collections/refunds, #13 login/logout). Existing per-module write helpers are intentionally left untouched — big-bang refactor is a follow-up change, not part of this spec.

## Requirements

### Requirement: Shared audit-write helper (AU-1)

A single helper `registrarEventoAuditoriaEnTx(tx, ctx, event)` MUST exist and MUST append exactly one `MovimientoAuditoria` row carrying `empresaId`, `usuarioId`, `fechaHora` (UTC `timestamptz`, set in code), `accion` (a valid `AccionAuditoria` enum value — never a free string), `entidad`, `idEntidad`, and optional `sucursalId`/`valorAnterior`/`valorNuevo`/`motivo`. It MUST run inside the caller's `withTenantTransaction` (never opening its own) and MUST be used only by this change's new write points.

#### Scenario: Helper appends one scoped row

- GIVEN an active tenant transaction for company E, user U
- WHEN the helper is called with an event
- THEN exactly one audit row persists with `empresaId=E`, `usuarioId=U`, and a UTC `fechaHora`
- TEST: integration

### Requirement: Catalog events closed this phase (AU-2)

The 13-event catalog gaps that sit in already-built modules MUST now produce audit rows:

| Catalog event | Write point | `accion` |
|---|---|---|
| #3 Collections/payments | `registrarCobro` / `registrarReembolso` commit | `PAGAR` |
| #13 Login | successful `loginWithCredenciales` | `LOGIN` |
| #13 Logout | session sign-out | `LOGOUT` |

Events #5 (caja not built), #10 (config-fiscal), #12 (roles/permisos), #2-B03 (deferred in V1), fiscal-report `LEER` events, exporters and retention purge are OUT of scope and MUST NOT be added by this change.

#### Scenario: Money flows appear in the log

- GIVEN a committed collection and a committed refund
- WHEN each transaction completes
- THEN one `PAGAR` audit row per committed payment is consultable via `/auditoria`
- TEST: integration

#### Scenario: Session flows produce LOGIN/LOGOUT

- GIVEN a user logs in successfully and later logs out
- WHEN both flows complete
- THEN one `LOGIN` row and one `LOGOUT` row exist for that user, each with `sucursalId` null (company-wide action)
- TEST: integration

### Requirement: Audit insert is transactional with its effect (AU-3)

Every new audit row MUST be written inside the same transaction as the audited effect. A rolled-back or rejected operation MUST NOT leave an audit row. An idempotent replay of a guarded refund MUST NOT double-audit — the audit row count stays flat (devolucion replay discipline replicated).

#### Scenario: Rejected payment writes nothing

- GIVEN a collection that fails with `COBRO_EXCEDE_SALDO`
- WHEN the transaction aborts
- THEN no Pago row and no audit row persist
- TEST: integration

#### Scenario: Refund replay stays audit-flat

- GIVEN a refund (key K) already committed and audited once
- WHEN K is replayed
- THEN `PAGO_IDEMPOTENCIA_CONFLICTO` returns and the total audit rows are unchanged
- TEST: integration

## Architectural notes (non-normative)

- **Retention:** "3 years, adjustable" is a decided business value with NO enforcement in V1. Any purge is a DELETE on the audit table and conflicts with ADR-016 append-only; an explicit carve-out ruling is required before purge code may exist. No config key, job, or UI ships in this change.
- **LOGIN single-tenant nuance:** login happens before `TenantCtx` exists (the `app.is_login_flow` path); the audit write must use the user's own resolved `empresaId` without widening the login-flow policy exception beyond that single company. Mechanism is owned by design.md.
