# Delta for ncf-engine

## MODIFIED Requirements

### Requirement: Range provisioning seed (R-N6)

`pnpm seed:ncf` MUST upsert DGII-authorized ranges per `empresaId`+`tipoNcf` (independent sequences, per AGENTS.md), setting `rangoInicio`/`rangoFin`/`vigenciaInicio`/`vigenciaFin`/`activa`. Admin CRUD is out of scope (D5). The seed is the only V1 provisioning path. The seed MUST provision B01, B02, AND B04 ranges — B04 is required for the return lifecycle (Fase 5d).

#### Scenario: Seed provisions B01 and B02

- GIVEN a fresh empresa
- WHEN `pnpm seed:ncf` runs
- THEN active B01 and B02 rows exist with independent ranges for that empresa
- TEST: integration

#### Scenario: Seed provisions B04 range

- GIVEN a fresh empresa
- WHEN `pnpm seed:ncf` runs
- THEN an active B04 row exists with an independent range for that empresa
- TEST: integration

#### Scenario: B04 range active before return E2E

- GIVEN `pnpm seed:ncf` has run for a fresh empresa
- WHEN a return attempt consumes B04
- THEN the B04 sequence row exists, is active, and the consume succeeds
- TEST: integration
