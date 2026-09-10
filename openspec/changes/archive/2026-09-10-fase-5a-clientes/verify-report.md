```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:da20525e560a53785000c132e2ddd3b666669fde62678790339f14b1bf35339e
verdict: pass
blockers: 0
critical_findings: 0
requirements: 16/16
scenarios: 23/23
test_command: pnpm test
test_exit_code: 0
test_output_hash: sha256:c522c556823cb2ad1d4c338878a6af11c2c11d46371e79543826e21aa75fb836
build_command: npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: fase-5a-clientes
**Branch**: `feat/fase-5a-clientes` (delta `d53edc4..700cbee`)
**Mode**: Standard (config `strict_tdd: false`)
**Persistence**: hybrid (openspec + engram)

### Authoritative counts (native spec headings)

Recounted directly from the two delta specs instead of the proposal-phase prose:

| Spec file | `### Requirement:` | `#### Scenario:` |
|---|---|---|
| `specs/cliente/spec.md` | 12 | 15 |
| `specs/client-validators/spec.md` | 4 | 8 |
| **Total** | **16** | **23** |

The design/prose "13 requirements / 20 scenarios" figure was stale (the
cross-field credit⇒RNC rule and related scenarios were added after the initial
proposal count). Corrected in the doc-remediation commit `700cbee`.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 17 |
| Tasks complete | 17 (re-checked every `[x]` against source + runtime evidence) |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Type-check (`npx tsc --noEmit`)**: ✅ Passed — 0 diagnostics, exit 0, empty output.
**Lint (`pnpm lint` / eslint)**: ✅ Passed — exit 0, no findings (includes the project-local `systemfact/server-action-must-wrap-tenant` rule over `actions.ts`).

**Unit tests (`pnpm test`)**: ✅ 460 passed / 0 failed / 0 skipped (50 suites), exit 0.
**Integration tests (`pnpm test:integration`)**: ✅ 55 passed / 0 failed (15 suites), exit 0 — run against the live `sf-postgres:5433` (`systemfact_test`, RLS on), which was up and reachable.

**Coverage**: threshold not enforced by config; coverage priority (fiscal domain / critical integration) is satisfied by the pure-domain unit suites + the mandatory tenant integration suite.

### Spec Compliance Matrix

| Requirement | Scenario | Covering test(s) | Result |
|-------------|----------|------------------|--------|
| CV-R1 Pinned mod-11 weights | Valid RNC accepted (`131045677`) | `fiscal-id.test.ts > accepts the valid spec RNC 131045677` | ✅ COMPLIANT |
| CV-R1 | Invalid RNC digit rejected (`131045671`) | `fiscal-id.test.ts > rejects 131045671` | ✅ COMPLIANT |
| CV-R1 | Valid cédula accepted (`00123456795`) | `fiscal-id.test.ts > accepts the valid spec cédula 00123456795` | ✅ COMPLIANT |
| CV-R1 | Invalid cédula digit rejected | `fiscal-id.test.ts > rejects 00123456791` | ✅ COMPLIANT |
| CV-R2 Normalization & length | Separators stripped (`131-04567-7`) | `fiscal-id.test.ts > strips separators and dispatches by length` | ✅ COMPLIANT |
| CV-R2 | Bad length rejected (8/10/12) | `fiscal-id.test.ts > rejects bad lengths (8,10,12)` + per-variant pre-checksum tests | ✅ COMPLIANT |
| CV-R3 Open item (11-digit corp RNC) | Open-item disclosure | `fiscal-id.test.ts > rejects an 11-digit corporate-branch value that is not a valid cédula` + pinned JSDoc header + README contract | ✅ COMPLIANT |
| CV-R4 Pure and reusable | Cross-module reuse | `cliente/domain/cliente.test.ts > normalizeIdentificacionFiscal — shared validator reuse` (import path exercised); module has zero Prisma/Next/React/Supabase imports (tsc/lint/static) | ✅ COMPLIANT |
| C-R3 Create w/ credit defaults | Create without credit fields | `crear-cliente.test.ts > CLI-CREATE-A` (v1 active) + `CLI-CREATE-B` (0.00/30) + `cliente-tenant.integration.test.ts (b)` seed row limit/plazo | ✅ COMPLIANT |
| C-R3 | Duplicate fiscal ID in tenant | `crear-cliente.test.ts > CLI-DUP` + repository `CLT-DUP-A/CLT-DUP-C` | ✅ COMPLIANT |
| C Validate fiscal ID (create/update) | Check digit fails | `crear-cliente.test.ts > CLIENTE-R-FISCAL` + `actualizar-cliente.test.ts > CLIENTE-FISCAL` + domain throw test | ✅ COMPLIANT |
| C cross-field credit⇒RNC (R5) | Credit enabled without fiscal ID | `cliente.test.ts > validarReglasCredito` (3 variants) + `crear-cliente`/`actualizar-cliente` R5 tests + `integration (d)` zero-write | ✅ COMPLIANT |
| C Optimistic-lock update | Stale version | `actualizar-cliente.test.ts > CLI-EDIT-B` + repository `CLT-OPT-A` + `integration (c)` | ✅ COMPLIANT |
| C Admin-only audited credit (R2/R5) | Operador attempts credit edit | `integration (d)` real-role-table reject + `actions.test.ts > credit-field edit by a non-admin → NO_AUTORIZADO` | ✅ COMPLIANT |
| C | Admin edits credit | `integration (d)` Admin credit edit + `actions.test.ts > admin → delegates` + `actualizar-cliente.test.ts > CLI-EDIT-A` | ✅ COMPLIANT |
| C Paginated searchable listing | Bounds and status filter | repository `CLT-LIST-A` (active-only, CF-excluded, deterministic) + `listar-clientes.test.ts > CLIENTE-R4` + `integration (b)` CF hidden | ✅ COMPLIANT |
| C Guarded soft deactivation (R6) | Block live sales reference | `desactivar-cliente.test.ts > CLIENTE-R6` + repository `CLT-GUARD-A` (real `Venta` probe) + `integration (e)` CONFIRMADA blocks / CANCELADA frees | ✅ COMPLIANT |
| C | Deactivation frees the code | `integration (f)` reuse after deactivate (partial UK authoritative) | ✅ COMPLIANT |
| C CF seed on provisioning | Seed re-run | `integration (b)` idempotent seed across re-runs + per-empresa | ✅ COMPLIANT |
| C Race-safe CF get-or-create (R2) | Concurrent get-or-create | `integration (b)` concurrent `Promise.all` ⇒ 1 row + `consumidor-final.test.ts > race refetch` | ✅ COMPLIANT |
| C Tenant isolation of PII (R1) | Foreign-row probe | `integration (a)` foreign id == unknown id (same code+message) + `obtener-cliente.test.ts > CLIENTE-R1-ISO` | ✅ COMPLIANT |
| C Transactional audit | Rollback leaves no audit | `integration (g)` no client row + no audit after mid-tx throw | ✅ COMPLIANT |
| C No auth linkage | Create touches no auth surface | structural: module imports no auth-provisioning API (grep: `auth.admin`/`createUser`/synthetic-email = 0 hits); `integration (g)` + `crear-cliente` prove only CLIENTE+auditoria are written | ✅ COMPLIANT |

**Compliance summary**: 23/23 scenarios compliant (all have a passing covering test executed at runtime in this run).

### Correctness (Static Evidence) — spot checks

| Check | Status | Notes |
|------|--------|-------|
| No Supabase-auth code for clients (ADR-014 N/A) | ✅ | `createClient`/`getCurrentTenantContext` read the session for tenant ctx only; no auth-user/synthetic-email creation anywhere in the module or seed. |
| Credit edit Admin-only, server-side, zod NOT authoritative | ✅ | Zod bounds transport only (no role check); the action layers a second `tieneRolPermitidoEnTx([...,"Administrador"])` gate inside `withTenantTransaction`; proven by the real-role-table integration test. |
| CF rows excluded from list/detail, protected on update/deactivate | ✅ | `buildWhere` sets `esConsumidorFinal:false`; `obtenerCliente` returns `CLIENTE_NO_ENCONTRADO` for CF; update/deactivate return `CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO`. |
| Deactivation guard is a real `Venta` probe | ✅ | `tieneVentasNoCanceladas` counts `Venta.estado != CANCELADA` in-tenant; `Venta`/`EstadoVenta` exist in schema — not a stub. |
| Validator weights match docs/13 §39–40 | ✅ | Code uses `[7,9,8,6,5,4,3,2]` / `[1,2,4,8,5,10,9,7,3,6]`; DV `11−(Σ mod 11)`, `11→0`, `10→invalid`; verified against `docs/13-glosarioFact.md` lines 39–40. |
| Spec fixture `131045677` passes; `131045671` fails | ✅ | Executed green in `fiscal-id.test.ts`; Σ=114, mod 11=4, DV=7. |
| Migration only adds DDL defaults, own commit | ✅ | `20260909000000_cliente_credit_defaults` = `ALTER COLUMN ... SET DEFAULT 0.00/30` only; landed as its own commit `9368753 migrate(db):`. |
| `schema.prisma` `@@unique` drift documented, DB partial-UK authoritative | ✅ | `pg_indexes`: `CLIENTE_empresaId_identificacionFiscal_key ... WHERE (activo = true)` and `cliente_consumidor_final_uk ... WHERE esConsumidorFinal`; reuse-after-deactivate proven in `integration (f)`; drift record in README + test comment. |
| CF get-or-create seam exported, NO venta logic | ✅ | `getOrCreateConsumidorFinalEnTx` imports nothing from `venta`; documented reserved 5b seam. |
| Money never float end-to-end | ✅ | Write = `Decimal(12,2)` string, read = `decimal.js` Decimal, DTO = fixed-point string. |
| Audit payloads VARCHAR(255)-safe | ✅ | Ids + changed scalars only; `integration (d)` asserts `length ≤ 255`. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Validator in `shared/domain/fiscal-id.ts`, non-configurable weights | ✅ | Frozen constants; per-variant + combined exports. |
| Pure `validarReglasCredito`, called before probes/writes | ✅ | Domain rule; zero-write on failure across create + update. |
| 11-code error catalog + `messageFor` | ✅ | Matches design catalog exactly (incl. `CLIENTE_CONSUMIDOR_FINAL_PROTEGIDO`). |
| Real `Venta` deactivation probe (not `Factura`) | ✅ | Counts `estado != CANCELADA`. |
| CF seed + race-safe get-or-create; hide/protect CF | ✅ | Seed shape single-sourced from `CONSUMIDOR_FINAL`; partial-UK backstop. |
| One optimistic command, credit gated Admin-only in-tx | ✅ | Same `actualizarCliente` path; second role gate layered by the action. |
| Own migration commit; two stacked slices (PR-5a.1 → PR-5a.2) | ✅ | Commit history matches the slice plan (validator/domain → repo → use cases/http/seed/integration/docs). |

**Documented, faithful deviations (no spec violation):**
- "Size bounded to 100" is implemented as *reject above the cap* with `VALIDATION_ERROR`, matching the sibling proveedor/producto list convention (not a silent clamp). Consistent with the normative "cap at 100" and AGENTS.md "max 100".
- No in-app empresa-provisioning service exists to hook the CF seed (parity with `seedRetencionConfigParaEmpresa`); provisioning is the idempotent script + fixtures. Recorded in README/tasks 2.4.

### Issues Found

**CRITICAL**: None.

**WARNING**: None open. (Resolved during verification) The design/tasks prose cited "13 requirements / 20 scenarios" while the specs contain 16/23. Corrected in doc-only commit `700cbee`; envelope uses the authoritative native counts. Non-runtime, no behavioral impact.

**SUGGESTION**: The stale `13/20` total had propagated into prose only — future phase-map/proposal drafts should derive totals from a heading count, not a proposal-phase estimate, to avoid re-introducing the drift at archive time. Informational; does not block archival.

### Verdict

PASS — 16/16 requirements and 23/23 scenarios carry a passing runtime-covering test (unit 460, integration 55 green against live `sf-postgres:5433`), lint and tsc exit 0, all spot-checks and design-coherence points hold, and the only finding (stale prose count) is remediated in a doc-only commit. Archive-ready.
