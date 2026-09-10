# Exploration: fase-5a-clientes

**Date**: 2026-09-09
**Change**: fase-5a-clientes
**Branch**: `feat/fase-5a-clientes` (from master `d53edc4`)
**Store**: hybrid (OpenSpec file + Engram `sdd/fase-5a-clientes/explore`)
**Status**: exploration-complete
**Predecessor**: phase map `openspec/changes/fase-5-venta-exploracion/exploration.md` (engram #699)

## Current State

### 1. Which module holds clients? — `Cliente` is a standalone model; no module exists yet

- **No `cliente` module folder** (`app/src/modules/` = auth, categoria, compra, inventario, producto, proveedor, tenant). The only non-generated `Cliente` references are unrelated (`tenant-runtime.ts`, `tenant-where.ts` use "cliente" as HTTP-client vocabulary, not the model). `Cliente` appears in application logic **only via generated Prisma**.
- **`Cliente` is a first-class table (`CLIENTE`), NOT a subtable of `Usuario`.** There is **no `usuarioId`/FK** between `Cliente` and `Usuario` (`schema.prisma:299-328`). Clients are fiscal/commercial records; users are login identities. Two unrelated concepts.
- **ADR-014 (`nombreUsuario` access identifier) does NOT apply to `Cliente`.** ADR-014 governs `Usuario.nombreUsuario @unique` (`schema.prisma`, "login por código único (ADR-014)") and the Supabase synthetic-email scheme. A client record has **no login, no `nombreUsuario`, no synthetic email**. Confirmed by `Cliente` fields below. 5a must therefore **not** create Supabase Auth users for clients and must **not** treat `identificacionFiscal` as an access identifier — it is a fiscal identifier only.

`Cliente` model (`schema.prisma:299-328`) — ERD v4.7 frozen, DB-complete, no application layer:

| Field | Type | Notes for 5a |
|---|---|---|
| `id` | Int autoincrement | |
| `empresaId` | Int, FK→Empresa `Restrict` | tenant scope; every query filters here |
| `nombre` | VarChar(255) required | |
| `telefono` | VarChar(255) required | (note: proveedor has extra `contacto`; cliente does **not**) |
| `direccion` | VarChar(255) required | proveedor lacks this — a client-specific required field |
| `identificacionFiscal` | VarChar(255) **nullable** | RNC **or** cédula; NULL for Consumidor Final |
| `tipoCliente` | enum `TipoCliente` = MINORISTA/MAYORISTA/CREDITO | client-specific; no proveedor analogue |
| `esConsumidorFinal` | Boolean default false | reserved generic client, one per empresa |
| `creditoHabilitado` | Boolean default false | |
| `limiteCredito` | Decimal(12,2) **NOT NULL, no default** | ⚠ see §4 — schema gap |
| `plazoCreditoDias` | Int **NOT NULL, no default** | ⚠ see §4 — schema gap |
| `activo` | Boolean default true | soft-delete only (Directiva §12) |
| `version` | Int default 1 | optimistic locking (Directiva §10) |
| `createdAt`/`updatedAt` | timestamptz | |

Relations: `empresa`, `ventas[]`, `facturas[]`, `notasCredito[]`, `notasDebito[]`. Uniqueness: `@@unique([empresaId, identificacionFiscal])` + **DB-enforced partial UK** one-Consumidor-Final-per-empresa.

### 2. Proveedor parity — the exact template to mirror

The proveedor module (`app/src/modules/proveedor/`, ~1,096 source + ~1,149 test lines) is the direct structural template. Four layers, frozen classifications as `as const` maps, coded-error catalog, tenant-scoped repository, Admin+Operador for CRUD/list and Admin-only for deactivation, append-only audit in-transaction.

**Files 5a should replicate 1:1:**

```
cliente/
  domain/cliente.ts            ← entity + TIPO_CLIENTE const + normalizeNombre + (NEW) shared mod-11 validator
  domain/errors.ts             ← CLIENTE_* codes + messageFor + ClienteDomainError
  application/crear-cliente.ts (+ .test.ts)
  application/actualizar-cliente.ts (+ .test.ts)
  application/desactivar-cliente.ts (+ .test.ts)
  application/listar-clientes.ts (+ .test.ts)
  application/obtener-o-crear-consumidor-final.ts (+ .test.ts)   ← NEW, no proveedor analogue
  infrastructure/cliente-repository.ts (+ .test.ts)
  http/validations.ts          ← zod schemas
  http/actions.ts (+ .test.ts)  ← thin adapters, "use server"
```

**Repository patterns to copy verbatim (already proven):**
- `clienteSelect` `satisfies Prisma.ClienteSelect` + `toDomainCliente()` mapper (Prisma row never crosses HTTP).
- `buildWhere(ctx, query)` → `{ empresaId: ctx.empresaId }` + active-only default (`where.activo = true` unless `incluirInactivos`) + `buscar` OR (`nombre contains insensitive` + digits-only `identificacionFiscal contains`), mirroring `proveedor-repository.ts:62-85`.
- Duplicate-code probe over **active rows only** (`existeRncEnEmpresa` pattern), null-skipped; the partial unique is the real TOCTOU guard and `crearClienteEnTx` maps `P2002 → CLIENTE_IDENTIFICACION_DUPLICADA` (`proveedor-repository.ts:109-169`).
- Optimistic-lock `updateMany({ where: { id, empresaId, version }, data: { ...patch, version: version+1 } })` → `{ updated: false }` → `CONCURRENCIA_CONFLICTO` (`:183-205`).
- Idempotent soft-deactivate `updateMany({ where: { id, empresaId, activo: true }, data: { activo: false } })` → partial UK releases the code (`:213-223`).
- `tieneRolPermitidoEnTx` — the code comment (`:270-291`) notes this is already the **3rd copy** (categoria, producto, proveedor) and centralization was deferred as YAGNI; 5a will be the **4th copy**. Keep the deferral but note the growing seam.
- `registrarAuditClienteEnTx` writing `movimientoAuditoria` in-tx, reusing frozen `AccionAuditoria` (CREAR/ACTUALIZAR/CANCELAR), `entidad: "Cliente"` (no enum extension, no migration) (`:293-324`).

**HTTP action conventions to copy:**
- Session resolved via `getCurrentTenantContext(createClient())` **before** `withTenantTransaction` (the wrapper cannot be the literal first statement — Producto convention, `actions.ts:47-64`); zod parse → ctx null→`SESION_INVALIDA` → in-tx `tieneRolPermitidoEnTx` gate → delegate to use case → `{ ok, data|error }`.
- **Zod does NOT validate fiscal format** — normalization + 9–11/cédula rule are domain-owned, surfaced as a coded error (mirrors `validations.ts:9-11`).

**Proveedor-specific vs client-specific:**
- *Proveedor-only* (do not port): `contacto`, `tipoProveedor` (FORMAL/INFORMAL), `tipoPersona` (FISICA/JURIDICA) — those drive B11/ISR-15% supplier retention. The `tieneComprasNoCanceladas` deactivation guard is supplier-side.
- *Client-specific* (add): `direccion` (required), `tipoCliente` (MINORISTA/MAYORISTA/CREDITO), `esConsumidorFinal`, `creditoHabilitado`, `limiteCredito`, `plazoCreditoDias`; deactivation guard becomes **"tiene ventas no canceladas"** (non-CANCELADA `Venta` referencing the client) — the direct analogue of the purchase guard; will return 0 today (Fase 5b owns ventas) but is forward-looking integrity.

### 3. Consumidor Final provisioning

- **Schema models it as a reserved generic client row per empresa**, not a special code path: `esConsumidorFinal=true` with **NULL `identificacionFiscal`**, and a **DB-enforced partial unique index** guarantees one per empresa:
  `CREATE UNIQUE INDEX "cliente_consumidor_final_uk" ON "CLIENTE" ("empresaId") WHERE "esConsumidorFinal" = true;` (migration `20260901145709_cliente_consumidor_final_partial_uk`, commit `755a324`). Directiva §12 + erd-guia §62: exists per empresa, **never deleted**, only `activo=false`.
- **Fiscal basis (B02 vs B01).** `docs/03` §158-159: **B01 (crédito fiscal)** requires a *contribuyente with verified RNC + exact razón social + dirección fiscal*; **B02 (consumo)** is "la secuencia principal" for the majority of sales and needs **no client RNC**. So a Domingo retail sale with no identified buyer must bill **B02 against the empresa's Consumidor Final record**, while a sale to a registered taxpayer bills **B01 against a real RNC-bearing client**. Keeping B01's RNC-required rule intact is therefore achieved simply by: an anonymous/B02 sale always resolves to the Consumidor Final client, and that client is the *only* one allowed a NULL `identificacionFiscal`.
- **Friction-free pattern.** Provisioning must make the Consumidor Final *always present* so the sale path (5b/5c) just points at it. Two viable options are enumerated in §6 (Decision A). The partial UK means the "get-or-create" must be **race-safe**: attempt fetch by `(empresaId, esConsumidorFinal=true)`; on miss, insert under the empresa lock or `catch P2002 → re-fetch` (phase-map risk #10).

### 4. Credit fields — present, but `NOT NULL` with no default (migration gap to resolve)

- Columns **already exist** and are **Decimal(12,2)/Int** per ERD v4.7: `creditoHabilitado` (default false), `limiteCredito`, `plazoCreditoDias`.
- **Migration gap:** the applied init migration declares `"limiteCredito" DECIMAL(12,2) NOT NULL` and `"plazoCreditoDias" INTEGER NOT NULL` with **no DEFAULT**. This blocks clean creation of: (a) any MINORISTA/MAYORISTA client that never uses credit, and (b) the **Consumidor Final** (which has no credit meaning). Two resolutions (Decision B): add `DEFAULT 0` (limite) / `DEFAULT 30` (plazo) via a new migration, **or** have the use case always supply explicit defaults (RD$0 / 30 days) so no DDL is needed. Docs already fix the business defaults: `docs/11` §87 "Límite configurable por cliente (default RD$0); plazo por defecto 30 días (ajustable)".
- **Validation ranges** (5a owns storage only; enforcement of blocking is Fase 6): limit ≥ 0 (Decimal, never float — Directiva); plazo > 0 int days. `creditoHabilitado=true` (or `tipoCliente=CREDITO`) ⇒ `identificacionFiscal` **required** (`docs/11` §90, `docs/01` §139) and should additionally require a positive `limiteCredito` and `plazoCreditoDias`. This "credit ⇒ RNC mandatory" cross-field rule belongs in the **use case / domain**, not zod (parity with how RNC format is domain-owned).
- **Fase 6 consumption seam (store now, rule later).** 5a must **persist** the fields and expose them; it must **not** implement CxC blocking. `docs/11` §88-89 (alerts at 80–90%, block when overdue >30 days or over limit) and the ADR-017 canonical derived-balance query are Fase 6 (Cobros). 5a ships only the columns + edit/audit. Keep them readable via the listing projection so 5b/5c/6 consume without re-plumbing.

### 5. RNC / cédula validator — algorithms fully specified in docs, **no code exists yet**

- **No shared validator exists in code.** proveedor's `normalizeRnc` (`domain/proveedor.ts:65-74`) only strips separators and checks **9–11 digits** — it does **not** verify the DGII check digit. `grep` for mod-11/checksum across `app/src` (non-generated) returns nothing. So the mod-11 validator is **new 5a work**, and 5a is the natural place it first lands (phase-map calls it "shared validator — prove/compra parity").
- **Algorithms are pinned in `docs/13-glosarioFact.md` §39-40, decided internal in `docs/11` §298-326 / Directiva §67 (no public DGII tool available):**
  - **RNC DV**: módulo 11, weights `[7,9,8,6,5,4,3,2]` over the first 8 digits; `DV = 11 − (Σ mod 11)`; if result `=11 → DV 0`; if `=10 → invalid`.
  - **Cédula DV**: módulo 11, weights `[1,2,4,8,5,10,9,7,3,6]` over the leading digits; cédula is **11 digits** (`docs/01/02`).
- **Design guidance for 5a:** place `validarRnc(rnc)` and `validarCedula(cedula)` (both after separator-strip normalization) in a **shared, dependency-free domain util** (e.g. `cliente/domain/fiscal-id.ts`, exported for reuse by compra/venta). `identificacionFiscal` can be *either* RNC (company) or cédula (individual), so the validator must **discriminate by shape/length** (9-digit legacy RNC vs 11-digit cédula vs 11-digit corporate RNC-with-branch-suffix). ⚠ **Open nuance to confirm with the accountant**: the glosario RNC weights describe the classic **9-digit** RNC (e.g. `131-04567-1`); the modern **11-digit** corporate RNC (branch suffix `…-00001`) uses a variant of the same algorithm. Pin the exact 11-digit corporate handling in design before coding, or restrict 5a to the documented 9-digit-RNC + 11-digit-cédula forms and reject 11-digit corporate as out-of-rule (Decision C is a *technical clarification*, surfaced separately below — not a product decision).

## Affected Areas

- `app/src/modules/cliente/**` — new module (12 files: 6 use-case/source + repository + domain entity + errors + validations + actions + 6 test files). Parity target = proveedor module.
- `app/prisma/migrations/…` — **conditional**: one new migration ONLY if Decision B chooses DB defaults for `limiteCredito`/`plazoCreditoDias`. If the use case supplies defaults, **zero migration**.
- `app/src/integration/cliente-tenant.integration.test.ts` (new) — cross-empresa/sucursal isolation, mirroring `compra-tenant.integration.test.ts` and `tenant-isolation.integration.test.ts` (real DB harness, `withTenantTransaction`, assert foreign rows null / not leaked). Add a race-safe Consumidor-Final get-or-create test.
- `app/src/modules/tenant/**` — read-only reuse (`withTenantTransaction`, `getCurrentTenantContext`, `TenantCtx`, `PrismaTx`). No change.
- `app/prisma/schema.prisma` — **no change expected** (model already complete); if Decision B = migration, add `@default(0)`/`@default(30)` comments to match.
- Existing ESLint rule `systemfact/server-action-must-wrap-tenant` — **automatically applies** to `src/**/actions.ts`; `cliente/http/actions.ts` must satisfy it (already proven by proveedor).

## Approaches

### Approach 1 — Full proveedor-parity module + in-repo shared mod-11 validator (RECOMMENDED)
Mirror every proveedor layer, add the four client-specific fields, add a new `fiscal-id.ts` mod-11 validator (RNC + cédula), add the credit cross-field rule + the "one per empresa" get-or-create use case, add the `tieneVentasNoCanceladas` deactivation guard. No migration if use case supplies credit defaults.
- **Pros**: maximum reuse of proven patterns (reviewer familiarity); RLS/tenant/audit/optimistic-lock already solved; introduces the mod-11 validator at the natural first consumer; clean seam for 5b/5c/6.
- **Cons**: `tieneRolPermitidoEnTx` becomes a 4th copy (accepted deferral); the module is large — likely exceeds the 800-line review budget (see Risks).
- **Effort**: Medium

### Approach 2 — Parity module but extract shared primitives first (centralize `tieneRolPermitidoEnTx` + audit helper + fiscal-id into a common `shared/domain` lib before building cliente)
- **Pros**: removes the copy-paste seam at the source; a single audit/role helper for all CRUD modules.
- **Cons**: violates the project's own deferred-YAGNI decision (the code comment explicitly defers centralization); enlarges 5a scope and forces a refactor touching categoria/producto/proveedor tests; couples 5a delivery to unrelated churn.
- **Effort**: High

**Recommendation: Approach 1.** 5a stays a faithful proveedor clone plus the two genuinely-new primitives (mod-11 validator, Consumidor-Final get-or-create). Keep the helper duplication (4th copy) — it is the established, tested convention and centralizing is explicitly deferred.

## Risks

- **Sizing / review-budget (correct the phase map).** Proveedor is ~1,096 source + ~1,149 test lines. Clientes adds a shared mod-11 validator (+ tests), the get-or-create use case (+ test), the credit cross-field rule, and the fiscal-ID discriminator — realistically **~1,000–1,300 authored source lines**, above the project `review_budget_lines: 800`. The phase-map "~700–900, single PR" is optimistic. Recommend the orchestrator plan **2 chained PRs**: (1) domain + fiscal-id validator + repository + unit tests; (2) use cases + actions + integration tests. Delivery strategy is `ask-on-risk`, so surface this before tasks/apply.
- **PII cross-tenant leak (Critical/security).** Client data is high-surface PII. Mitigations already present: RLS `cliente_isolation` policy (`USING`/`WITH CHECK` on `app.current_empresa_id`) + every repository method filters `empresaId` + the ESLint tenant-action rule + a dedicated `cliente-tenant.integration.test.ts`. Must not ship without the integration isolation test.
- **Credit-column `NOT NULL` no default (Correctness/delivery).** If neither Decision B default nor use-case supply is applied, *every* create (including Consumidor Final and MINORISTA) fails at the DB. Resolve before coding (Decision B).
- **11-digit corporate RNC ambiguity (Fiscal/technical).** Glosario pins the 9-digit RNC weights; the 11-digit corporate variant differs. Implementing the wrong variant mis-classifies valid taxpayers (or accepts invalid RNCs on B01). Confirm the exact rule before coding the validator; scope 5a to what is documented otherwise.
- **Consumidor-Final race (Low).** Partial UK makes double-seed impossible at DB level, but a naive create-without-catch would surface `P2002` to the sale path. Use the empresa-lock or catch-unique-retry get-or-create; test it under concurrency.
- **Deactivation guard returns trivially today.** `tieneVentasNoCanceladas` will be 0 until 5b exists; still implement it (forward integrity), but do not over-test against non-existent venta fixtures.
- **RNC/cédula uniqueness semantics.** `@@unique([empresaId, identificacionFiscal])` is a *complete* (not partial-over-activo) unique per the schema comment; but the partial-UK-on-activo migration `20260901151853` was applied to the 4 code entities incl. `Cliente.identificacionFiscal` (docs/21 H1, resolved = option A "liberar"). Confirm the effective constraint is the partial one so deactivating frees the code (Directiva §12) — verify against `pg_indexes` during 5a setup.

## Two Product Decisions for the user (5a decision ledger)

### Decision A — How is the per-empresa Consumidor Final provisioned?
The DB guarantees "one per empresa" (partial UK), so both are safe; the difference is *when* the row appears and *who* can touch it.
- **A1. Lazy upsert on first anonymous sale** — the row is auto-created the first time a B02/anonymous sale needs it, inside that sale's transaction, race-safe (P2002 → re-fetch). Empresa admin never sees it in normal client CRUD (filter `esConsumidorFinal=true` out of listings). *Pros*: zero setup friction, self-healing per tenant. *Cons*: created implicitly (less visible); seeding/backfill of existing empresas is implicit.
- **A2. Seed at empresa creation + hidden from CRUD** — a `Cliente(esConsumidorFinal=true)` row is inserted when the Empresa is provisioned (Fase tenant/empresa flow), and the client module only *reads* it (never lets operators edit its name/limit). *Pros*: always present, explicit, single owner; sale path just looks it up. *Cons*: touches the empresa-creation flow (small out-of-module change); needs a backfill migration for the current demo/test empresas.
- **Recommendation: A2 (seed on empresa creation) as the primary, with a defensive lazy get-or-create fallback in the shared use case.** This keeps the sale path friction-free (row already exists) and auditable (explicit provisioning), while the get-or-create covers any pre-seed tenant. **Needs user confirmation** because it slightly widens scope into the empresa-creation flow.

### Decision B — Who may edit credit fields (`limiteCredito`, `plazoCreditoDias`, `creditoHabilitado`, `tipoCliente`) and how are they audited?
Editing `limiteCredito` is an **explicitly audited event** (docs/03 §13, docs/16 §422, docs/18 §73). The open questions are (i) edit policy and (ii) the NOT NULL default resolution.
- **B-edit-1. Admin-only edits, always audited with before/after + motivo** (stricter; credit is a financial risk decision). CRUD of name/contact stays Admin+Operador; only the credit block is Admin-gated. *Mirrors how proveedor reserves deactivation for Admin.*
- **B-edit-2. Admin+Operador may edit credit, audited** (parity with other CRUD; Operador already does product price/cost edits which are audited).
- **Recommendation: B-edit-1** (credit terms = financial, reserve for Administrador, audit old/new). **Needs user confirmation.**
- **B-schema (technical, bundled with the decision): resolve `limiteCredito`/`plazoCreditoDias` NOT NULL/no-default.** Recommended: **use-case supplies defaults (RD$0 / 30 days) → NO migration**, keeping 5a DB-clean and honoring Directiva "parameters from DB, never hardcoded" by *not* inventing extra business constants (0/30 are the documented defaults, applied at creation, editable later). Alternative if the user prefers DB-level safety: add a small migration `ALTER TABLE CLIENTE ALTER COLUMN "limiteCredito" SET DEFAULT 0; ALTER COLUMN "plazoCreditoDias" SET DEFAULT 30;`. This is a sub-choice under Decision B; flag the tradeoff (defaults in DDL vs in code).

## Ready for Proposal

**Yes — with the two product decisions surfaced to the user before specs.** 5a is DB-complete and the proveedor parity target is fully mapped, so the proposal can proceed immediately once the user answers:
- **Decision A** (Consumidor Final: seeded-on-empresa-creation + defensive get-or-create [recommended] vs pure lazy upsert).
- **Decision B** (credit-field edit policy: Admin-only audited [recommended] vs Admin+Operador; and NOT NULL default handling: use-case defaults [recommended, no migration] vs a defaults-in-DDL migration).

The implementing agent must **not** guess the **11-digit corporate RNC** verification rule (technical clarification with the accountant) — pin it in design. The orchestrator should also correct the sizing expectation: plan for **2 chained PRs** given the projected >800-line authored footprint under the `ask-on-risk` delivery strategy.
