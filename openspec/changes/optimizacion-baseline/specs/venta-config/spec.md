# Delta for venta-config

## ADDED Requirements

### Requirement: Single canonical active-window reader (R-C4)

The ConfiguracionEmpresa active-window predicate used by R-C1 (company + key + validity window covering the evaluated date in `America/Santo_Domingo`) MUST have exactly ONE canonical reader implementation, exposed as a shared read-only seam (R-QC-08 of `backend-code-quality`). `leerConfigVentaEnTx` MUST consume that seam; no module MAY keep a re-encoded copy of the predicate. The venta-config read behavior MUST be unchanged: same required-key discipline, same hard-fail `DESC_MAX_FALTANTE` semantics, same expired-window-as-missing treatment, same SD-date evaluation.

#### Scenario: One implementation serves the DESC_MAX read

- GIVEN the canonical reader seam exists
- WHEN `leerConfigVentaEnTx` evaluates a `DESC_MAX` row's validity window
- THEN it uses the single shared predicate and no venta-local re-encoding remains (grep: one implementation)

#### Scenario: Read behavior unchanged

- GIVEN the seam replaces the previously inlined predicate
- WHEN every DESC_MAX scenario of R-C1 and R-C3 is re-run
- THEN the outcomes are identical (missing-key failure, expired-window failure, valid-window success)
- TEST: integration (existing suites pass unchanged)
