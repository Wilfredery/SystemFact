# Retencion Config Seeding Specification

## Purpose

Guarantees real production tenants can confirm and receive purchases by reprovisioning the mandatory retention config keys, which today exist only in integration fixtures.

## Requirements

### Requirement: Production seed for retention config keys

A documented, reproducible seed path MUST provision `RET_ISR_15`, `RET_ISR_2`, `RET_ITBIS_100`, and `RET_ITBIS_30` as active rows with validity windows in `ConfiguracionEmpresa` for production empresas, documented in the project SETUP guide. Rates MUST remain config-driven: the seed MUST NOT introduce hardcoded fallbacks in domain or application code, and MUST NOT change existing integration fixtures.

#### Scenario: Seeded tenant confirms

- GIVEN a fresh production tenant after the seed runs
- WHEN confirm computes applicable retentions
- THEN the config reads succeed and confirmation proceeds

#### Scenario: Seed re-run is idempotent

- GIVEN the seed already ran for an empresa
- WHEN the seed runs again
- THEN no duplicate or conflicting config rows are created (one active row per key)

### Requirement: Missing retention config blocks confirm and receipt

When a required applicable `RET_*` key is absent or outside its validity window, purchase confirmation MUST fail with the stable `CONFIG_RETENCION_FALTANTE`-style business error and zero state or inventory side effects, with no legal-default fallback; a tenant without the seed MUST therefore be unable to reach `RECIBIDA`.

#### Scenario: Unseeded tenant blocked

- GIVEN an empresa with no `RET_ITBIS_100` key and an informal supplier
- WHEN confirm or receipt is requested
- THEN the stable config error returns; state stays `BORRADOR` and receipt is unreachable
