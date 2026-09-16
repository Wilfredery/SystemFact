# Exploration — fase-7a-auditoria (Audit log consultation)

Scope: the **auditoría** half of roadmap Fase 7 ("Reportes y auditoría"). The read-only
Administrator consultation screen over the append-only audit log, the retention policy, and
closing the gaps in the 13 audited-event catalog. The **Reportes** half belongs to
`fase-7b` and is out of scope here.

Sources of truth read: `docs/18-auditoriaFact.md` (canonical module spec), `docs/03-reglasNegocioFact.md` §13,
`docs/15-criterios_de_aceptacion.md` §8.11, `docs/16-flujos_ux.md` §12, `docs/17-plan_wireframes.md` §3/§4,
`docs/11-pendientes_y_decisiones_abiertas.md`, `docs/12-decisiones_de_arquitectura.md` ADR-016, `AGENTS.md`.
Code read: `app/prisma/schema.prisma` (`MovimientoAuditoria`, `AccionAuditoria`, `ConfiguracionEmpresa`),
RLS migration `20260902120000_enable_rls.sql`, audit write helpers across `src/modules/*`, the
read/query pattern `src/modules/cobros` + `tenant-where.ts` + `withTenantTransaction.ts`.

---

## Current State

**Audit entity exists and is well-shaped.** `MovimientoAuditoria` (table `MOVIMIENTO_AUDITORIA`)
has `empresaId` (required), `sucursalId` (nullable — null = company-wide action), `usuarioId`,
`fechaHora` (`timestamptz`, set in code, no DB default), `accion` (enum `AccionAuditoria`),
`entidad`/`idEntidad` (polymorphic string refs), `valorAnterior`/`valorNuevo` (nullable VarChar —
JSON blobs in practice), and `motivo`. Relations to `Empresa`/`Sucursal`/`Usuario` are all `onDelete: Restrict`.

**Append-only is enforced at the DB layer.** RLS (`enable_rls.sql`) creates only `audit_select`
(scoped by `empresaId` + nullable `sucursalId`) and `audit_insert` (by `empresaId`). There is **no
UPDATE/DELETE policy**, so writes are default-denied under `FORCE ROW LEVEL SECURITY`
(`force_rls.sql`) for the non-owner `systemfact_app` role. This already satisfies ADR-016 / §13 at
the database. The Prisma model comment documents the same intent.

**The write path is FRAGMENTED — there is no single audit seam.** Each module owns its own helper or
inlines the insert: `registrarAuditClienteEnTx`, `registrarAuditCategoriaEnTx`,
`registrarAuditProveedorEnTx`, `registrarAuditFacturaEnTx` + `registrarAuditVentaEnTx` (venta),
`registrarAuditNotaCreditoEnTx` (devolucion), `registrarAuditCompraEnTx` (compra), plus inline
`tx.movimientoAuditoria.create(...)` in producto (4 call sites) and inventario (3 call sites).
No shared library, so an event is audited only if a developer remembered to add it per-module.

**`AccionAuditoria` enum:** `CREAR, ACTUALIZAR, CANCELAR, ANULAR, PAGAR, AJUSTAR, LOGIN, LOGOUT, LEER`.
`LEER` was added by a later migration (`20260905000000_add_leer_accion_auditoria`) and producto already
emits a `LEER` read-audit row. `LOGIN`/`LOGOUT` exist but **nothing writes them today** (the auth module
has no audit call).

**No `auditoria` module exists yet.** The directory tree under `src/modules/` is:
`auth, categoria, cliente, cobros, compra, devolucion, inventario, ncf, producto, proveedor, tenant, venta`.
`docs/08-arquitecturaFact.md` places the entity in `src/modules/auditoria` — that module must be created.
There is also no `caja` module and no dedicated `configuracion` module.

**Read/query pattern to mirror is proven and mature.** `src/modules/cobros` is the template:
`consultarSaldoCxc` (application, orchestration) → `consultarSaldoCxcEnTx` (infrastructure, the only
Prisma/raw-SQL surface) → `consultarSaldoCxcAction` (thin `"use server"` adapter: Zod parse →
`resolverCtx` from Supabase session → `withTenantTransaction` → `tieneRolPermitidoEnTx(...)` role gate
→ delegate → typed result). `tenantWhere(tenantFilter(ctx))` translates the tenant filter to a Prisma
`where`; `ctx.esAdmin` is carried in `TenantCtx` and pushed to the `app.current_es_admin` GUC.
A paged-read precedent exists (`listar-paginado.integration.test.ts`). **Caveat:** `consultarSaldoCxc`
is NOT paginated (returns all VIGENTE rows) — the audit screen must add pagination (25/page, max 100),
which the saldo pattern does not demonstrate.

**Frontend pattern is minimal.** Each screen is a thin server shell at `src/app/<module>/page.tsx`
(resolves `TenantCtx`, redirects to `/login` when absent, passes `esAdmin` down) with interactive
`ui/` under the module (server components by default, `"use client"` only for interactivity). No
`/auditoria` route or audit UI exists. No global role-gated nav/sidebar component was found; routes are
reached directly.

**Retention is configured nowhere.** `ConfiguracionEmpresa` is a generic key/value table with
`{empresaId, clave, valor, vigenciaInicio, vigenciaFin, activa, version}` (keys: `TASA_ITBIS`,
`RET_ISR_*`, `RET_ITBIS_*`, `DESC_MAX`, `PLAZO_DEVOLUCION`, `PLAZO_CREDITO`). There is **no retention
key** for audit and **no purge/archive job** (no `pg_cron`, no scheduled migration). Docs confirm
"3 years, adjustable" as a DECIDED business value but never specify a mechanism.

---

## Event catalog coverage (the scope driver)

The 13 audited events (`docs/03` §13 = `docs/18` §6). Verified against actual write call sites:

| # | Audited event | Writing module | Audit write today? |
|---|---------------|----------------|--------------------|
| 1 | Creation / cancellation / annulment of invoices | venta | ✅ `registrarAuditVentaEnTx` + `registrarAuditFacturaEnTx` (CREAR/ACTUALIZAR/CANCELAR + Factura ANULAR) |
| 2 | Issue of Credit Notes (B04) and Debit Notes (B03) | devolucion | ⚠️ PARTIAL — B04 via `registrarAuditNotaCreditoEnTx`; **B03 (Nota de Débito) deferred in V1** |
| 3 | Collections and payments (cobros/pagos) | cobros | ❌ **MISSING** — `registrarCobro`/`registrarReembolso` write no audit row |
| 4 | Purchases | compra | ✅ `registrarAuditCompraEnTx` |
| 5 | Cash register closes (cierres de caja) | (caja) | ❌ **MODULE NOT BUILT** — no `caja` module, nothing to audit |
| 6 | Price change | producto | ✅ `ACTUALIZAR` (`precioVenta`) |
| 7 | Cost change | producto / inventario | ✅ producto `ACTUALIZAR`; avg-cost on purchase receipt |
| 8 | Inventory adjustments | inventario | ✅ `AJUSTAR` (`valorAnterior`→`valorNuevo`) |
| 9 | Credit-limit change | cliente | ✅ `registrarAuditClienteEnTx` (credit fields ride the Admin-only path) |
| 10 | Fiscal-configuration changes | (config) | ❌ **NO WRITE** — no `configuracion` module; `ConfiguracionEmpresa` mutations are not audited |
| 11 | Logical deactivation of a product | producto | ✅ `CANCELAR` (`activo` true→false) |
| 12 | Role and permission changes | (roles/user admin) | ❌ **NO WRITE** — no role-change audit helper |
| 13 | Login and logout | auth | ❌ **MISSING** — `LOGIN`/`LOGOUT` enum values exist but nothing emits them |

Confirmed gaps: **#3, #5, #10, #12, #13** have no audit write; **#2** is partial (B03 deferred).
#5 and #10 are in modules that do not exist yet (likely delivered by other phases); #3, #13 are in
already-built modules and #12 depends on whether a role/permission admin surface exists at all.

---

## Affected Areas

- `app/prisma/schema.prisma` — `MovimientoAuditoria` has **no `@@index`**; a filtered + paginated
  query will scan. Expect a migration adding indexes (e.g. `(empresaId, sucursalId, fechaHora)`,
  `(empresaId, accion)`, `(empresaId, usuarioId)`, `(entidad, idEntidad)`). Possibly a retention
  config key or a new table — see open questions.
- `app/src/modules/auditoria/` — **new module** (`domain/` pure filter+row types;
  `infrastructure/` the only Prisma read; `application/` `consultarAuditoria` use case;
  `http/` thin actions; `ui/` the screen). Follows ADR-013 layout like `cobros`.
- `app/src/app/auditoria/page.tsx` — **new** server shell resolving `TenantCtx` and gating to Admin.
- `app/src/modules/cobros/**` — gap #3: collections/refunds should append an audit row (if this change owns backfill).
- `app/src/modules/auth/**` (`auth-service.ts`, `http/actions.ts`) — gap #13: login/logout should append audit rows (if in scope).
- Missing-event backfill for #10/#12 — depends on modules that may not exist; likely deferred to their owning phases.
- Retention: a purge/archive mechanism + the append-only tension (see Risks / Open questions).
- ESLint `systemfact/server-action-must-wrap-tenant` (in `app/eslint.config.mjs`) applies to `src/**/actions.ts(x)` — the audit query action must use `withTenantTransaction` like every other.

---

## Approaches

### A. Screen-only; backfill missing writes in each module's own phase
Build the read model + UI only. Audit-write gaps (#3, #13) are added opportunistically when those
modules next change; #5/#10/#12 arrive with their owning modules.
- Pros: smallest, reviewable slice; stays strictly inside the "consulta" scope; no coupling to unbuilt modules.
- Cons: the catalog stays knowingly incomplete after this phase; acceptance of "13 events audited" cannot be fully asserted yet.
- Effort: Low (for this change) — defers real work.

### B. Screen + backfill writes for events in EXISTING modules (#3 cobros, #13 login/logout)
Also add audit-write to already-built modules whose events are missing, and (optionally) extract a
shared audit-write helper to stop the drift.
- Pros: materially closes the catalog; makes the screen demonstrate real coverage; a single helper
  reduces future missed events.
- Cons: larger diff; touches cobros + auth transactional paths (idempotency/rollback must be preserved —
  a refund idempotency replay must NOT double-audit, matching the existing devolucion no-extra-audit test);
  shared-helper refactor risks scope creep.
- Effort: Medium.

### C. Screen + full backfill + shared seam + retention job
B plus a real retention mechanism (scheduled purge/archive with a configurable window) and a project-wide
audit-write library adopted by all modules.
- Pros: fully satisfies the catalog + retention end-to-end.
- Cons: purging conflicts with "append-only, never DELETE" (ADR-016) — needs an explicit architectural
  carve-out; retention job (pg_cron/external scheduler) is infra beyond a Next.js screen; highest risk and size.
- Effort: High.

---

## Recommendation

**Approach B, scoped to the read model + the in-module backfills that are safe (#3, #13), with a
shared audit-write helper as a SEPARATE follow-up decision.** This change's core deliverable is the
Administrator-only, filtered, paginated, read-only consultation (which nothing provides today and is
the named half of Fase 7). Backfilling cobros and login/logout is low-coupling because those modules
exist and the events are explicitly in the catalog. Defer #5/#10/#12 to their owning modules (they
literally have no code path to audit yet). Treat retention as its own decision (below) rather than
shipping an ambiguous purge in the same PR as a read screen. Keep a possible shared audit-write seam as
a distinct refactor so it can be reviewed on its own merits.

Note: the recommendation is an engineering suggestion; the product decisions are listed as open
questions — the orchestrator should get user sign-off before `sdd-propose`.

---

## Open product decisions (for the orchestrator — do NOT assume)

1. **Does `fase-7a` own backfilling missing audit writes** (#3 cobros, #13 login/logout), or is it
   strictly the consultation screen (Approach A)? This changes the PR size and the acceptance story
   for "13 events audited."
2. **Retention mechanism & semantics.** "3 years, adjustable" has no implementation. Is it: (a) a
   scheduled purge/archive deleting rows older than N, (b) table/partition archival, or (c) a
   documented-only policy with no enforcement in V1? **This directly conflicts with ADR-016
   append-only "never DELETE, not even by Admin."** A business/architecture ruling is required on how
   (and by whom) expired rows are removed without breaking immutability/evidentiary value.
3. **Where "adjustable" is configured** — a new `ConfiguracionEmpresa` key (e.g. `RETENCION_AUDITORIA_ANIOS`),
   a new config column/table, an env var, or an admin UI field? Is an edit UI in scope or only a
   default? (No config-fiscal admin module exists to host it.)
4. **Default filter values** on the screen (default date range — e.g. last 30 days vs all-time; whether
   the table loads unfiltered or requires a filter first).
5. **Filter set & combination semantics** confirmation: date range, user, action type (`AccionAuditoria`),
   branch, free-text search (`entidad`/`idEntidad`/`motivo`?). Does "free text" search the JSON
   `valorAnterior`/`valorNuevo` blobs, or only structured fields? (`docs/03` §13 note: filter "includes
   entity/action in the search.")
6. **Pagination** — default 25 / max 100 per AGENTS.md; page-number vs cursor. Confirm totals display.
7. **Sorting** default (recommend `fechaHora DESC, id DESC` to mirror `consultarSaldoCxc`).
8. **Branch scope for the Admin** — company-wide view (all branches, matching the nullable-`sucursalId`
   RLS policy) with an optional branch filter, vs. per-branch default. `docs/18` says "branch filtered
   within the companies/branches the Admin may consult" — need the exact multi-company/multi-branch
   selection rule for an Admin.
9. **Exporters:** RESOLVED by docs — **NO export in V1**. `docs/16` §12: the audit log is NEVER included
   in exports in V1; on-screen consultation only. (Listed so the proposal states it explicitly.)
10. **Retention UI scope** — is any admin surface to view/change the retention window part of this
    change, or purely an operational/config concern? (Ties to #3.)
11. **`LEER` (read) actions** — producto emits a `LEER` audit row; is read-audit an intended catalog
    member or incidental noise the screen should be able to filter? Not in the 13-event list.
12. **Nota de Débito B03 (#2)** — confirm it is out of scope here because it is deferred in V1, so the
    screen simply has no such rows yet.

## Ambiguity in the audit-event catalog

- The catalog counts 13 items, but two of them (#5 cierres de caja, #10 configuración fiscal) reference
  modules that are not built, and #2's B03 half is deferred — so the "fully audited" claim cannot be
  satisfied by this phase alone regardless of the approach chosen.
- "Cambio de costo" (#7) overlaps with the inventory avg-cost update on purchase receipt (compra) — it is
  unclear whether the audit row is expected at the producto record level, the inventario movement level,
  or both (compra currently emits 2 audit rows on confirm per `compra-confirm.integration.test.ts`).
- The 13 events are described by business outcome, but the enum is by `AccionAuditoria` verb + free-text
  `entidad`; there is no enforced mapping between a "catalog event" and `(entidad, accion)` values, so
  "which events are covered" is a judgment call per call site, not a machine-checkable fact.

---

## Risks

- **Append-only vs retention (ADR-016 conflict).** Purging for retention literally means DELETE on the
  audit table, which the model comment, RLS (no delete policy), and ADR-016 forbid. Reconciling this is
  the highest architectural risk and must be decided before any purge code is written.
- **Cross-tenant leakage.** The audit screen is the most sensitive read in the system (it shows what
  *everyone* did). The query MUST pin `empresaId` and respect the branch GUC like every other tenant
  surface; a missing filter is a critical bug per AGENTS.md.
- **No index on `MOVIMIENTO_AUDITORIA`.** A filter+ORDER+LIMIT over a growing append-only log without
  indexes will degrade and may full-scan; ship the index migration with the screen.
- **Double-audit on retry/idempotent paths.** If backfilling #3 (refunds carry a client idempotency key)
  or confirm flows, an audit insert must sit inside the same transaction and must not fire on an
  idempotent replay (the devolucion cumulative/idempotency tests assert audit count stays flat on
  replay — replicate that discipline).
- **Scope creep via a shared helper.** Refactoring 8+ write sites into one seam is attractive but is a
  separate, riskier change; mixing it with the read screen can blow the 400-line review budget.

---

## Readiness for Proposal

**Yes — ready for `sdd-propose`, conditional on the orchestrator resolving the scope split (Q1) and the
retention-vs-append-only ruling (Q2/Q3).** The consultation screen itself has no blockers: the entity,
RLS, read/query pattern, pagination pattern, and role-gate helper all exist to mirror. Recommend the
proposal commit to **Approach B scoped narrowly**: create the `auditoria` read module + Admin-only
paged/filtered screen + the supporting index migration; treat retention as a documented decision
(enforcement deferred pending Q2) and treat the shared-write-seam refactor and #5/#10/#12 backfills as
explicitly out of scope. Cobros (#3) and login/logout (#13) backfills should be included only if the
user wants the catalog visibly fuller after this phase; otherwise Approach A keeps the PR small.
