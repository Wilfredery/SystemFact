# Delta for auditoria

## MODIFIED Requirements

### Requirement: Shared audit-write helper (AU-1)

A single helper `registrarEventoAuditoriaEnTx(tx, ctx, event)` MUST exist and MUST append exactly one `MovimientoAuditoria` row carrying `empresaId`, `usuarioId`, `fechaHora` (UTC `timestamptz`, set in code), `accion` (a valid `AccionAuditoria` enum value — never a free string), `entidad`, `idEntidad`, and optional `sucursalId`/`valorAnterior`/`valorNuevo`/`motivo`. It MUST run inside the caller's `withTenantTransaction` (never opening its own). It MUST be the ONLY audit-append writer in the codebase: every module that appends audit rows MUST call this canonical helper, and the duplicated per-module append implementations (12 call sites today) MUST converge on it with zero behavior change — each consolidated call site MUST produce rows byte-identical in fields and values (`accion`, `entidad`, `idEntidad`, `motivo`, `valorAnterior`/`valorNuevo`) to the rows the pre-consolidation site wrote. The consolidation MUST NOT introduce any UPDATE or DELETE path on audit rows.
(Previously: the helper existed but was used only by this capability's write points, with 12 duplicated per-module append call sites intentionally left untouched.)

#### Scenario: Helper appends one scoped row

- GIVEN an active tenant transaction for company E, user U
- WHEN the helper is called with an event
- THEN exactly one audit row persists with `empresaId=E`, `usuarioId=U`, and a UTC `fechaHora`
- TEST: integration

#### Scenario: Consolidated call site is behavior-identical

- GIVEN a module call site that previously built its own audit append
- WHEN the site is rewritten to call `registrarEventoAuditoriaEnTx`
- THEN the appended row's fields and values match exactly what the old site wrote and no UPDATE/DELETE path on audit rows is introduced
- TEST: integration

## ADDED Requirements

### Requirement: Module pagination helpers absorbed into the shared contract (AU-4)

The pagination helpers duplicated in module code — including `auditoria/domain/auditoria.ts` — MUST be absorbed into the single shared pagination contract owned by capability `backend-code-quality` (R-QC-07) with zero behavior change to the audit consultation list. No module SHOULD retain a private copy of the helper after absorption.

#### Scenario: Single shared pagination module serves the consulta list

- GIVEN the shared pagination contract exists
- WHEN the auditoria consultation list is served paginated
- THEN it consumes the shared contract and no auditoria-local pagination helper remains
- TEST: integration + grep (duplicated helper count = 0)
