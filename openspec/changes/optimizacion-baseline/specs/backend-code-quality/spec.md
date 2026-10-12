# Delta for backend-code-quality

## ADDED Requirements

### Requirement: Shared pagination contract (R-QC-07)

A single pure pagination contract in `shared/domain/pagination.ts` MUST be the only pagination helper consumed by the modules served by this change (cobros board, auditoria, reportes financieros/operacionales/rentabilidad). It MUST be pure TypeScript (no imports of Next.js, React, Prisma, or Supabase), MUST normalize page size to the default of 25 with a hard clamp at 100, MUST compute page/offset (or keyset parameters) in one place, and MUST produce typed pagination metadata. The duplicated helpers it replaces — `auditoria/domain/auditoria.ts`, `reportes/domain/reporte-filtro.ts`, the `pagina<T>` helpers in `financiero.ts`/`operacional.ts`, and `cobros/ui/board.ts` `paginar<T>` — MUST be absorbed into it with zero behavior change; after the change the count of duplicated pagination helpers for this scope MUST be 0.

#### Scenario: Single pure helper consumed

- GIVEN the shared contract exists
- WHEN any served module paginates a list
- THEN it imports `shared/domain/pagination.ts` and no module-local pagination helper remains for this scope
- TEST: integration + grep (duplicated helpers = 0)

#### Scenario: Clamp normalization is uniform

- GIVEN pageSize requests of 0, 25, and 250
- WHEN the contract normalizes them
- THEN 0 yields the default 25, 25 stays 25, and 250 clamps to 100 identically in every consuming module
- TEST: unit

### Requirement: Shared ConfiguracionEmpresa active-window reader seam (R-QC-08)

The ConfiguracionEmpresa active-window predicate (company + parameter key + validity window evaluated against a cutoff date resolved in `America/Santo_Domingo`) MUST have exactly ONE canonical reader implementation, exposed as a shared read-only seam. The modules that today re-encode that predicate (including `venta-config` and the 4 modules flagged by the audit) MUST consume the seam instead of duplicating the logic; behavior MUST be unchanged (same key, same window evaluation, same SD-date resolution). The predicate MUST NOT be re-encoded per module after the change.

#### Scenario: One canonical predicate implementation

- GIVEN the shared reader seam exists
- WHEN every module that evaluates the config active-window predicate runs
- THEN each consumes the single seam and no module keeps a re-encoded copy (grep: one implementation)

#### Scenario: No duplicated re-encoding across modules

- GIVEN a new module needs the active-window predicate
- WHEN its read path is reviewed
- THEN importing the shared seam is the only sanctioned way to evaluate the predicate
- TEST: code review + grep
