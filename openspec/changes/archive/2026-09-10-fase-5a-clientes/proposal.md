# Proposal: fase-5a-clientes (Client CRUD Module)

## Intent

Deliver the `cliente` module: full CRUD for clients (PII) with tenant-isolated storage, fiscal-ID (RNC/cédula) validation via a new mod-11 validator, credit-field storage, and per-empresa Consumidor Final provisioning. Today `CLIENTE` exists only as a Prisma model — no application layer. This unblocks venta (5b/5c) and CxC (Fase 6).

## Resolved Decisions (user-confirmed)

- **D1 Consumidor Final**: seed at empresa provisioning + defensive race-safe `obtener-o-crear-consumidor-final` in the sale/use-case path; DB partial UK per-empresa is the backstop.
- **D2 Credit edits** (`creditoHabilitado`, `limiteCredito`, `plazoCreditoDias`, `tipoCliente`): Admin-only, audited in-transaction.
- **D3 NOT NULL defaults**: use-case defaults (`limiteCredito 0.00`, `plazoCreditoDias 30`) **AND** DDL defaults in their **own migration commit** (migrations always separate, reviewable).
- **Correction of phase map**: `CLIENTE` is a standalone table, no FK `Usuario` — ADR-014 does NOT apply; no Supabase Auth for clients. Corr. also: delivery is **2 chained PRs** (phase-map single-PR estimate was wrong; ~1,000–1,300 lines vs 800 budget).
- **Corporate RNC (11-digit DV variant)**: open item confirmed with accountant at 5b/5c; validator accepts 9-digit RNC + 11-digit cédula with pinned weights; corporate 11-digit is flagged for later pinning.

## Scope

### In Scope
- `src/modules/cliente/` four layers, proven proveedor-parity patterns: entity+errors (domain), 4 CRUD use cases + `obtener-o-crear-consumidor-final` (application), tenant-scoped repository with P2002/optimistic-lock/audit-in-tx (infrastructure), zod validations + thin `actions.ts` (http).
- `domain/fiscal-id.ts` shared mod-11 validator: `validarRnc` (9-digit, weights `[7,9,8,6,5,4,3,2]` per docs/13) + `validarCedula` (11-digit, weights `[1,2,4,8,5,10,9,7,3,6]`); separator-strip + length discrimination.
- `seedConsumidorFinalParaEmpresa(db, empresaId)` mirroring `seedRetencionConfigParaEmpresa` + idempotent backfill script `app/tools/scripts/` and hook in the empresa provisioning/seed path.
- Credit fields persisted; **storage only** (no Fase 6 CxC blocking/alerts; no venta wiring).
- Deactivation guard `tieneVentasNoCanceladas` (forward integrity).
- Migration commit: `ALTER TABLE CLIENTE ... SET DEFAULT 0/30` in its own commit.
- `src/integration/cliente-tenant.integration.test.ts` (mandatory).

### Out of Scope
- No Supabase Auth / login for clients; `identificacionFiscal` is fiscal-only, never a credential.
- No CxC blocking/alerts (Fase 6), no venta creation wiring (5b), B01/B02 billing rules (5b).
- No centralization of `tieneRolPermitidoEnTx` (deferred YAGNI; becomes 4th copy).

## Capabilities

### New Capabilities
- `cliente`: client CRUD requirements — create/update/list/deactivate, credit-fields policy, Consumidor Final provisioning, RLS/audit invariants.
- `client-validators`: mod-11 RNC/cédula validation requirements (shared fiscal-id contract for compra/venta reuse).

### Modified Capabilities
- None.

## Approach

Faithful proveedor-port (Approach 1 of exploration). **Port**: repository patterns, error catalog, audit-in-tx, HTTP adapter conventions, ESLint tenant rule compliance. **Skip**: `contacto`/`tipoProveedor`/`tipoPersona`/purchase-guard. **Add**: `direccion`, `tipoCliente`, `esConsumidorFinal`, credit fields, ventas guard, mod-11 validator, CF get-or-create.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/src/modules/cliente/**` | New | Full module (~12 files + tests) |
| `app/src/modules/tenant/**` | Read-only reuse | No change |
| `app/prisma/migrations/` | New (OSW commit) | DDL defaults 0/30 |
| `app/tools/scripts/` + seed hook | New | CF seed, idempotent |
| `app/src/integration/` | New | Tenant-isolation + race test |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| PII cross-tenant leak | Med | RLS `cliente_isolation` + `empresaId` filters + ESLint rule + mandatory integration test |
| CF seed race (concurrent sale) | Low | Race-safe get-or-create (fetch→insert→`P2002`→refetch); partial UK backstop; concurrency test |
| NOT NULL default regression | Low | D3: use-case defaults + DDL migration (own commit) + creation-path tests |

## Review Workload Forecast

2 chained PRs, stacked to `main` (confirmed): **PR-5a.1** domain + validators + repository + unit tests; **PR-5a.2** use cases + http + integration + seed/migration. Each within review budget.

## Rollback Plan

Revert per PR. The migration commit is its own self-contained unit — drop/revert defaults independently of code. CF seed script is idempotent and additive; no destructive DDL.

## Dependencies

- Proveedor module patterns (existing); `docs/13` §39-40 weights; tenant seed convention (`seed-retencion-config.ts`).

## Success Criteria

- [ ] All 4 CRUD use cases + get-or-create pass domain/unit tests (no DB in domain tests)
- [ ] `cliente-tenant.integration.test.ts`: zero cross-tenant leaks + CF race under concurrency
- [ ] CF row exists for every empresa (seed) and get-or-create is idempotent
- [ ] Credit edits Admin-only + audited in-transaction
- [ ] Migration in own commit; both approved PRs merged green to `main`
