# Venta Config Specification

## Purpose

Empresa-level sale configuration for 5b: the `DESC_MAX` discount-cap parameter with a hard-fail in-transaction read and a reproducible production seed. Conventions mirror the shipped `retencion-config` read (`CONFIG_RETENCION_FALTANTE` style) and `retencion-config-seeding` precedents — hence a dedicated capability rather than folding into `venta`.

## Task Notes (non-runtime)

- **`TASA_ITBIS` empresa key stays unseeded and unread in 5b**: it is redundant with per-product rates (frozen on each line); a consumer must exist before seeding it (strict YAGNI).
- Seed script naming follows repo convention (`seed:retencion` → `seed-retencion-config.ts`): the new script is `pnpm seed:venta` → `tools/scripts/seed-venta-config.ts`.

## Requirements

### Requirement: Hard-fail config read of DESC_MAX (R-C1)

`leerConfigVentaEnTx` MUST read the active `DESC_MAX` row from `ConfiguracionEmpresa` scoped to `empresaId`, with a validity window covering the draft date evaluated in `America/Santo_Domingo` (retention-key parity). The read is required whenever any positive discount is present (required-keys parity: a zero-discount draft MUST NOT need the key). A missing or expired key MUST fail the enclosing save with stable `DESC_MAX_FALTANTE` and zero writes; a legal-default fallback MUST NOT exist in domain/application code and the cap MUST NOT be hardcoded.

#### Scenario: Missing key blocks discounted draft only

- GIVEN an empresa with no active `DESC_MAX` row
- WHEN a draft with a positive discount saves
- THEN `DESC_MAX_FALTANTE` returns and no row persists
- AND a zero-discount draft of the same empresa still saves without reading config

#### Scenario: Expired window treated as missing

- GIVEN a `DESC_MAX` row whose vigencia ended before the sale date (SD time)
- WHEN a discounted draft is validated
- THEN the same stable config error returns

### Requirement: Idempotent production seed for DESC_MAX (R-C2)

A documented, reproducible seed path `pnpm seed:venta` MUST provision exactly one active `DESC_MAX` row per empresa (business-confirmed default value 4.00, adjustable, with vigencia window), idempotent on re-run mirroring `seedRetencionConfigParaEmpresa`, documented in the project SETUP guide. The seed MUST NOT introduce hardcoded fallbacks in domain/application code and MUST NOT change existing integration fixtures.

#### Scenario: Seed re-run is idempotent

- GIVEN the seed already ran for an empresa
- WHEN it runs again
- THEN exactly one active `DESC_MAX` row exists (no duplicates or conflicts)

#### Scenario: Seeded tenant discounts successfully

- GIVEN a fresh production tenant after the seed
- WHEN an admin saves a draft with a 4% discount
- THEN the config read succeeds and the draft persists

### Requirement: Cap enforcement consumes the config value (R-C3)

The `DESC_MAX` value read per R-C1 MUST be the single source for venta discount-cap validation (venta spec R-V8); changing the configured value MUST change accepted discounts without a code deploy.

#### Scenario: Adjusted cap takes effect

- GIVEN an admin updates `DESC_MAX` to 10.00 with a valid window
- WHEN a 10% header discount saves
- THEN validation passes, while 10.01% fails `DESCUENTO_EXCEDE_MAXIMO`
