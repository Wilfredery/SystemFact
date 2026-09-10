# Client Validators Specification

## Purpose

Shared, pure, dependency-free fiscal-ID validation (`validarRnc`, `validarCedula`)
usable by the `cliente` module and later reused by compra/venta. Algorithms are
pinned to `docs/13-glosarioFact.md` §39–40 (DGII mod-11). No DB, no framework
imports; domain tests run without a database.

## Requirements

### Requirement: Pinned mod-11 weights

The validators MUST implement modulo-11 check digits with the frozen weights:
RNC `[7,9,8,6,5,4,3,2]` over the first 8 digits; cédula `[1,2,4,8,5,10,9,7,3,6]`
over the leading 10 digits. DV = 11 − (Σ mod 11); a result of 11 yields DV 0; a
result of 10 is invalid (docs/13 §39 convention, mirrored for cédula). Weights
MUST NOT be configurable.

#### Scenario: Valid RNC accepted
- GIVEN the 9-digit input `131045677` (Σ = 114, 114 mod 11 = 4, DV = 7)
- WHEN `validarRnc` runs
- THEN the value passes

#### Scenario: Invalid RNC digit rejected
- GIVEN the 9-digit input `131045671` (check digit 1 ≠ computed 7)
- WHEN `validarRnc` runs
- THEN the value fails

#### Scenario: Valid cédula accepted
- GIVEN the 11-digit input `00123456795` (Σ = 237, 237 mod 11 = 6, DV = 5)
- WHEN `validarCedula` runs
- THEN the value passes

#### Scenario: Invalid cédula digit rejected
- GIVEN the 11-digit input `00123456791` (check digit 1 ≠ computed 5)
- WHEN `validarCedula` runs
- THEN the value fails

### Requirement: Normalization and length discrimination

Inputs MUST be normalized by stripping separators (`-`, spaces) before validation.
Only digits MAY remain; length MUST discriminate the variant: exactly 9 digits →
RNC rule; exactly 11 digits → cédula rule. Any other length or any non-digit
character MUST fail validation with a stable format error.

#### Scenario: Separators stripped
- GIVEN the input `131-04567-7`
- WHEN validation runs
- THEN it normalizes to `131045677` and passes

#### Scenario: Bad length rejected
- GIVEN the input has 8, 10, or 12 digits after normalization
- WHEN validation runs
- THEN it fails without attempting the checksum

### Requirement: Open item documented in contract (11-digit corporate RNC)

The validator's contract/documentation MUST state that the modern **11-digit
corporate RNC** (branch-suffix form, e.g. `…-00001`) shares its length with the
cédula and that its check-digit variant is **NOT pinned** by docs/13: handling is
deferred to Fase 5b/5c pending accountant confirmation. Until pinned, 11-digit
inputs are validated ONLY under the cédula rule.

#### Scenario: Open-item disclosure
- GIVEN a developer reads the validator's exported contract
- WHEN the 11-digit corporate form is considered
- THEN the deferral and its 5b/5c resolution path are explicitly documented

### Requirement: Pure and reusable

The validators MUST live in a shared domain location importable by other modules
without pulling Next.js/React/Prisma/Supabase dependencies, and MUST expose both
per-variant functions plus a combined `identificacionFiscal` entry point.

#### Scenario: Cross-module reuse
- GIVEN the future compra/venta modules
- WHEN they validate supplier or buyer fiscal IDs
- THEN they import the same validators with identical results
