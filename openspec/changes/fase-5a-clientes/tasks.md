# Tasks: fase-5a-clientes

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1100–1400 (PR-5a.1 ~550–700; PR-5a.2 ~550–700) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR-5a.1 (domain+validator+repo) → PR-5a.2 (use cases+http+seed+integration) |
| Delivery strategy | ask-on-risk (resolved: stacked-to-main, size:exception-acceptable) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Domain rules, shared fiscal validator, error catalog, tenant repo, unit tests, migration | PR-5a.1 | `pnpm -C app test src/modules/cliente src/shared/domain` | N/A — domain is pure, no DB | Revert PR + standalone migration commit; no feature code |
| 2 | CRUD use cases, http actions, CF seed, integration suites, docs | PR-5a.2 | `pnpm -C app test src/integration/cliente-tenant.integration.test.ts` | Real DB `sf-postgres:5433`, `crearEmpresa` fixtures, RLS on | Revert PR-5a.2; PR-5a.1 artifacts stay intact |

## Phase 1: PR-5a.1 — Domain, Validator, Repository (mergeable to main independently)

- [x] 1.1 Migration commit FIRST (own commit, no code): `app/prisma/migrations/YYYYMMDDHHMMSS_cliente_credit_defaults/migration.sql` — `ALTER TABLE "CLIENTE" ALTER COLUMN "limiteCredito" SET DEFAULT 0; ALTER COLUMN "plazoCreditoDias" SET DEFAULT 30;`
- [x] 1.2 RED: `app/src/shared/domain/fiscal-id.test.ts` — fixtures `131045677` valid, `131045671` rejected; cédula `00123456795` valid, `00123456791` rejected; separators stripped (`131-04567-7`→pass); lengths 8/10/12 rejected pre-checksum; weights `RNC [7,9,8,6,5,4,3,2]` / `cédula [1,2,4,8,5,10,9,7,3,6]`, DV=11−Σ mod11, 11→0, 10→invalid (client-validators R1/R2)
- [x] 1.3 GREEN: `app/src/shared/domain/fiscal-id.ts` — pure, dependency-free `validarRnc`, `validarCedula`, `validarIdentificacionFiscal`; JSDoc documents open item: 11-digit corporate RNC DV variant NOT pinned, deferred to 5b/5c accountant (client-validators R3/R4)
- [x] 1.4 RED: `app/src/modules/cliente/domain/cliente.test.ts` — `validarReglasCredito`: creditoHabilitado/limite>0/tipoCliente credit-bearing with NULL or invalid fiscal ID ⇒ `CREDITO_REQUIERE_FISCAL_IDENTIDAD` (cliente R5)
- [x] 1.5 GREEN: `app/src/modules/cliente/domain/cliente.ts` — entity types, normalization, credit defaults (limite 0.00, plazo 30), limits (limite ≥0, plazo >0), `validarReglasCredito`
- [x] 1.6 Create `app/src/modules/cliente/domain/errors.ts` — `ClienteErrorCode`: 11 codes per design (DUPLICADA, FISCAL_INVALIDA, NO_ENCONTRADO, YA_INACTIVO, TIENE_VENTAS, CONCURRENCIA_CONFLICTO, CREDITO_REQUIERE_FISCAL_IDENTIDAD, NO_AUTORIZADO, SESION_INVALIDA, VALIDATION_ERROR, CONSUMIDOR_FINAL_PROTEGIDO) + `messageFor`; unit test maps all codes
- [x] 1.7 RED→GREEN: `app/src/modules/cliente/infrastructure/cliente-repository.ts` — all ops filter `empresaId`; `updateMany({id, empresaId, version})`; P2002→DUPLICADA mapping; `tieneVentasNoCanceladas(empresaId, clienteId)` counting `Venta.estado != CANCELADA`; Decimal-as-string/`Prisma.Decimal`, never float
- [x] 1.8 Create `app/src/modules/cliente/README.md` stub: module responsibility map + validator reuse contract
- [x] 1.9 Commit sequence: (a) migration (own commit), (b) validator + domain + tests, (c) repository + README. PR-5a.1 green CI then merge to `main` — commits landed on `feat/fase-5a-clientes` (validator and domain split into separate bisectable units); CI/merge remains after verify

## Phase 2: PR-5a.2 — Use Cases, HTTP, Seed, Integration (base = post-PR-5a.1 main)

- [ ] 2.1 Application use cases in `app/src/modules/cliente/application/`: `crearCliente` (defaults+credit rule+duplicate probe; version 1 active), `actualizarCliente` (optimistic lock, credit rule), `obtenerCliente`, `listarClientes` (default 25 / cap 100, deterministic order, `incluirInactivos`, search by name+fiscal-ID digits, credit fields in projection), `desactivarCliente` (soft, idempotent YA_INACTIVO, ventas guard, releases fiscal ID), all typed success/error, typed-business-error pattern
- [ ] 2.2 `getOrCreateConsumidorFinalEnTx(db, tx, empresaId)`: fetch→insert→catch P2002→refetch; CF shape per design (nombre `Consumidor Final`, N/A contacto, fiscal NULL, MINORISTA, credit off, limit 0.00, plazo 30, active); NO venta logic — reserved seam for 5b only
- [ ] 2.3 HTTP: `app/src/modules/cliente/http/validation.ts` (zod transport shapes only — no fiscal format logic in zod) + `actions.ts` thin adapters: tenant ctx → `withTenantTransaction` → role gate (CRUD Admin+Operador; credit fields + deactivate Admin-only server-side) → use case → DTO; CRM-row protection: update/deactivate of `esConsumidorFinal` ⇒ CONSUMIDOR_FINAL_PROTEGIDO; audit CREAR/ACTUALIZAR/CANCELAR entity "Cliente" in-tx
- [ ] 2.4 Seed: `app/tools/scripts/seed-consumidor-final.ts` — `seedConsumidorFinalParaEmpresa` mirroring `seedRetencionConfigParaEmpresa`, idempotent per-empresa, direct-URL guard; `seed:cliente` npm script; hook CF seed into empresa provisioning path
- [ ] 2.5 RED: `app/src/integration/cliente-tenant.integration.test.ts` (real DB `sf-postgres:5433`, RLS on): (a) tenant PII isolation — foreign-row probe indistinguishable from unknown id (R1); (b) CF race/idempotency — 2 concurrent get-or-create ⇒ exactly one row; seed re-run no dup; (c) optimistic lock conflict preserves newer data; (d) credit Admin-only + credit⇒RNC zero-write failures + audit before/after; (e) guarded deactivate vs real `Venta` row (estado CONFIRMADA/CANCELADA matrix); (f) partial-UK reuse after deactivate; (g) rollback leaves no audit
- [ ] 2.6 GREEN: make all integration scenarios pass
- [ ] 2.7 Docs: expand `src/modules/cliente/README.md` (flow diagram, error catalog, CF provisioning), SETUP/`docs` notes on seed script + migration defaults
- [ ] 2.8 Final verification: full unit+integration suites green; PR-5a.2 merge to `main`; archive-ready against 13 requirements / 20 scenarios

## Traceability

- client-validators R1–R4 → 1.2–1.3; cliente R3/defaults → 1.1, 1.5; R5 credit rule → 1.4, 2.1; R2 CF → 2.2, 2.4, 2.5b; R1 PII → 1.7, 2.5a; audit → 1.7, 2.3, 2.5g; ventas guard → 1.7, 2.1, 2.5e; no-auth-linkage → 2.3 (no auth surface touched, asserted in docs)
