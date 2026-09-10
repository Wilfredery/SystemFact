# NCF Engine Specification

## Purpose

Owns the frozen DGII sequence rules over `NCF_SECUENCIA`: atomic single-NCF consumption with row lock, `B<tipo><%08d>` composition, 90% threshold warning, exhaustion/expiry blocking (SD calendar-day per D8), and `pnpm seed:ncf` provisioning (D5). Consumed by `confirmarVenta` and later nota/B11 flows. Row-lock atomicity lives here; type eligibility (B01/B02) lives in factura-emision.

## Requirements

### Requirement: Atomic single-NCF consumption (R-N1)

Consumption MUST lock the `NCF_SECUENCIA` row (`SELECT ... FOR UPDATE`) inside the caller's tenant transaction, filtered to `empresaId`+`tipoNcf`+`activa=true`. `secuenciaActual` is the **last used** value (D7). On consume: `next = secuenciaActual + 1`; the row MUST advance to `next` and return the composed NCF exactly once. No active matching row MUST hard-fail `NCF_SEC_INEXISTENTE` (config-style, no silent fallback). Concurrent consumes MUST serialize to distinct values; a retried/aborted transaction MUST NOT burn two numbers.

#### Scenario: Single consume advances counter

- GIVEN an active B02 range `inicio=500 fin=1000 secuenciaActual=521`
- WHEN consume runs once
- THEN NCF `B02000000522` is returned and `secuenciaActual` becomes 522
- TEST: integration (DB)

#### Scenario: Concurrent consume never duplicates

- GIVEN two parallel confirms for the same empresa+tipo
- WHEN both lock the sequence row
- THEN each receives a distinct sequential; the `@@unique([empresaId,tipoNcf])` is never violated
- TEST: integration (concurrency fixture, mirrors compra-concurrency)

#### Scenario: Missing sequence hard-fails

- GIVEN no active row for the requested tipo+empresa
- WHEN consume runs
- THEN `NCF_SEC_INEXISTENTE` returns with zero writes
- TEST: integration

### Requirement: Frozen NCF composition (R-N2)

The NCF string MUST be `B` + 2-digit `tipoNcf` + 8-digit zero-padded secuencial (`%08d`), exactly 11 characters, with **no embedded RNC** (B-series, verified vs DGII). Type prefix MUST match the requested `tipoNcf`.

#### Scenario: 11-char composition

- GIVEN B02 with secuencial 522
- WHEN the string is composed
- THEN the result is exactly `B02000000522` (11 chars, no RNC)
- TEST: unit (pure)

### Requirement: 90% threshold warning (R-N3)

After a successful consume the engine MUST compute `used = (secuenciaActual − rangoInicio + 1) / (rangoFin − rangoInicio + 1)`; when `used >= 0.90` and the range is not exhausted it MUST emit a non-blocking `NCF_UMBRAL_90` **warning** on the result. A warning MUST NOT fail the operation.

#### Scenario: Threshold warning at 90%

- GIVEN a range where the just-consumed value reaches 90% used
- WHEN consume returns
- THEN the NCF is assigned AND the payload carries `NCF_UMBRAL_90` (warning, not error)
- TEST: unit (pure calculation)

### Requirement: Exhaustion block (R-N4)

When `next > rangoFin` the consume MUST hard-fail `NCF_AGOTADA` and advance nothing. A value past `rangoFin` MUST be treated as exhausted (D7).

#### Scenario: Exhausted range blocks

- GIVEN `secuenciaActual = rangoFin`
- WHEN consume runs
- THEN `NCF_AGOTADA` returns and `secuenciaActual` is unchanged
- TEST: integration

### Requirement: Expiry block on SD calendar day (R-N5)

Expiry MUST compare `America/Santo_Domingo` calendar days via `date-fns-tz` (D8), NOT raw UTC instants: a range is expired when `todaySD > SDDate(vigenciaFin)`. Expired MUST hard-fail `NCF_VENCIDA`. The last valid calendar day MUST still consume normally.

#### Scenario: Boundary day still valid

- GIVEN `vigenciaFin` whose UTC instant is early morning but whose SD date equals today
- WHEN consume runs at end-of-day SD
- THEN the NCF is assigned (no `NCF_VENCIDA`)
- TEST: unit (injected clock / SD date compare)

#### Scenario: Day after expiry blocks

- GIVEN `todaySD` one day after `SDDate(vigenciaFin)`
- WHEN consume runs
- THEN `NCF_VENCIDA` returns with no advance
- TEST: integration

### Requirement: Range provisioning seed (R-N6)

`pnpm seed:ncf` MUST upsert DGII-authorized ranges per `empresaId`+`tipoNcf` (independent sequences, per AGENTS.md), setting `rangoInicio`/`rangoFin`/`vigenciaInicio`/`vigenciaFin`/`activa`. Admin CRUD is out of scope (D5). The seed is the only V1 provisioning path.

#### Scenario: Seed provisions B01 and B02

- GIVEN a fresh empresa
- WHEN `pnpm seed:ncf` runs
- THEN active B01 and B02 rows exist with independent ranges for that empresa
- TEST: integration
