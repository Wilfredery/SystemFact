# Delta for Cliente

## Purpose

F2 read-only additive touch to the `cliente` capability: the `listarClientesAction` response DTO is extended with the client's credit profile fields (`creditoHabilitado`, `limiteCredito`, `plazoCreditoDias`) so the POS `ClienteSelector` can render credit context per venta R-V19 (of this change, `specs/venta/spec.md`). Owner-ratified proposal decision #4. This is a LECTURA-only extension: no customer mutation capability, no email/credential exposure, no change to any existing requirement text.

## ADDED Requirements

### Requirement: Listing DTO exposes credit profile (R-V27)

The `listarClientesAction` response DTO for each client row MUST additionally expose:

- `creditoHabilitado` (boolean) — whether the client is credit-enabled.
- `limiteCredito` (Decimal-string money, strict Prisma `Decimal(12,2)` serialization) — MUST NOT serialize as float or number.
- `plazoCreditoDias` (number) — credit term in days.

The extension MUST remain strictly read-only and additive: it MUST add no create/update/deactivate capability, MUST NOT alter the existing projection, pagination (25 default / 100 cap), search, ordering, filter, or audit semantics of the listing, and MUST NOT introduce any email or authentication-related field in the response (ADR-014 holds — email is never exposed for clients). Every read MUST flow through the existing tenant-scoped action path, filtered by the acting context's `empresaId` (the existing tenant isolation R1 of the main cliente spec stays untouched). Visibility/administration semantics follow the existing action authorization rules unchanged (default-deny, electronically-scoped; no new permission gate is added for this read).

The consumer of this extension is the venta change's R-V19 (`ClienteSelector` credit-profile display) — see `openspec/changes/f2-venta-pos/specs/venta/spec.md`.

(Traceability: proposal decision #4, owner-ratified; explore Area 3; slice B.)

#### Scenario: DTO serializes the credit profile

- GIVEN a client holds `creditoHabilitado=true`, `limiteCredito` Decimal(12,2) 20000.00, `plazoCreditoDias` 15
- WHEN `listarClientesAction` maps the row
- THEN the response carries `creditoHabilitado` `true`, `limiteCredito` the Decimal-string `"20000.00"` (not a float), and `plazoCreditoDias` `15`
- TEST: unit (mock DTO contract)

#### Scenario: DTO stays tenant-scoped and exposure-free

- GIVEN two empresas, each with its own clients (same names possible)
- WHEN `listarClientesAction` runs under one empresa's acting context
- THEN the response contains only that empresa's clients, and NO row exposes email or any authentication-related field (ADR-014 holds)
- TEST: integration (RLS tenant isolation)

#### Scenario: No mutation capability added by the extension

- GIVEN the extended DTO fields render to the caller
- WHEN an HTTP response is inspected against the action surface
- THEN only lectura semantics exist (no new write, deactivate, or credit-edit endpoint appears; the main spec "Paginated searchable listing" and "Admin-only audited credit edits (R2, R5)" remain unchanged)
- TEST: unit (mock DTO contract)
