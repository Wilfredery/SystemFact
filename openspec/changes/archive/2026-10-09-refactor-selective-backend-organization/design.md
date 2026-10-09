# Design: Selective backend-pure reorganization

Change: `refactor-selective-backend-organization`
Artifact store: `openspec` (primary) + `engram` mirror (attempted, see Delivery)
Status: design only. No production code is modified by this artifact.

---

## 1. Technical Approach

Extend the pattern already validated by PR #82 (`869166c`, released `v0.11.28`): **strangler
split of oversized backend-pure files plus a re-export barrel that keeps the public surface
byte-identical**.

Two facts from the repository drive the whole plan:

1. **A pure code move costs roughly twice the file size in diff lines.** Moving an `L`-line
   file produces ~`L` additions and ~`L` deletions. The 400-line review budget therefore
   caps any *single* file move at roughly a **195-line file**. This is arithmetic, not
   preference, and it dictates that nearly every candidate is a chained PR.
2. **The barrel trick only works where a barrel can exist.** `http/actions.ts` is imported
   through its own path by consumers, so it can be replaced by a re-export barrel and *no
   consumer changes*. A repository like `venta-repository.ts` is imported **by name** from
   15 files, so splitting it forces 15 import-site edits and cannot use a barrel.

Consequence: the `http/` layer and the `infrastructure/` layer need **different strategies**,
and only the `http/` strategy is validated. This change therefore delivers the `http/` layer
plus a security-regression fix; the repositories are sequenced as a follow-on change.

### Source root correction

The real source root is `app/src/`, not `src/`. The proposal's paths (`src/modules/*/http/actions.ts`)
are shorthand. All paths in this document are repo-relative and real.

---

## 2. Measured inventory

### 2.1 Measurement method (and a correction)

`Measure-Object -Line` **undercounts**, because it scores an empty string as zero lines and
blank lines are empty strings. It reported `auth/http/actions.login.ts` as 56 lines; git
reports 65. Every number below uses `[IO.File]::ReadAllLines(path).Count`.

The method was validated against git's own numbers for all seven files of the PR #82 pilot —
an exact 7/7 match:

| File | `ReadAllLines` | git numstat |
|---|---|---|
| `auth/http/actions.login.ts` | 65 | 65 |
| `auth/http/actions.logout.ts` | 14 | 14 |
| `auth/http/actions.ts` | 3 | 3 |
| `auth/http/actions.user.ts` | 12 | 12 |
| `devolucion/http/actions.devolver.ts` | 29 | 29 |
| `devolucion/http/actions.shared.ts` | 74 | 74 |
| `devolucion/http/actions.ts` | 2 | 1 |

(`devolucion/http/actions.ts` is 2 lines by `ReadAllLines` and 1 by git: the file ends with a
trailing newline that git does not count as a line. A one-line discrepancy on a barrel with no
code impact.)

### 2.2 Layer totals (all 179 non-test `.ts` files under the four backend-pure layers)

| Layer | Files | Lines |
|---|---|---|
| `application/` | 57 | 8436 |
| `infrastructure/` | 35 | 8280 |
| `domain/` | 59 | 7411 |
| `http/` | 28 | 3358 |

`http/` is the **smallest** layer by a wide margin — and it holds the lowest fan-in. That is
the empirical case for attacking it first.

### 2.3 The proposal's premise, checked against measurement

The proposal states the problem as "files with **1000+ lines**". Measured reality:

- **2** files ≥ 1000 lines
- **3** files in 700–999
- **4** files in 400–599
- **9** files ≥ 400 in total, out of 179 backend-pure files

Only `venta-repository.ts` (1097) and `inventario-repository.ts` (1031) meet the "1000+"
description. The design does not inflate the problem; the ordering below reflects the measured
distribution.

### 2.4 Ranked inventory — risk = fan-in (exact resolved importers) × criticality

Fan-in is **not** a text grep. It is the number of files whose import specifier, resolved to an
absolute path with `..` normalization, equals the target file's path (extensionless). A naive
name grep reports ~148 "importers" for `actions.ts`, which is pure noise.

**Tier 1 — `infrastructure/` (oversized, highest fan-in, NOT barrel-able)**

| Rank | Path (repo-relative) | Lines | Fan-in | Repo test | Risk |
|---|---|---|---|---|---|
| 1 | `app/src/modules/compra/infrastructure/compra-repository.ts` | 726 | 17 | yes | **Critical** — 14 application importers, purchase/NCF path |
| 2 | `app/src/modules/cliente/infrastructure/cliente-repository.ts` | 411 | 16 | yes | High — customer master data |
| 3 | `app/src/modules/venta/infrastructure/venta-repository.ts` | 1097 | 15 | no | **Critical** — also exports `tieneRolPermitidoEnTx`, used cross-module by `devolucion` |
| 4 | `app/src/modules/categoria/infrastructure/categoria-repository.ts` | 277 | 15 | yes | High — 15 importers |
| 5 | `app/src/modules/proveedor/infrastructure/proveedor-repository.ts` | 324 | 11 | yes | High |
| 6 | `app/src/modules/producto/infrastructure/producto-repository.ts` | 465 | 10 | yes | High |
| 7 | `app/src/modules/inventario/infrastructure/inventario-repository.ts` | 1031 | 13 | no | **Critical** — inventory, avg-cost, stock |

**Tier 2 — `application/`**

| Rank | Path | Lines | Repo test | Risk |
|---|---|---|---|---|
| 8 | `app/src/modules/venta/application/venta-service.ts` | 536 | yes | High |
| 9 | `app/src/modules/devolucion/application/crear-devolucion.ts` | 407 | yes | High — returns/NCF |
| 10 | `app/src/modules/producto/application/actualizar-producto.ts` | 345 | yes | Medium |
| 11 | `app/src/modules/cliente/application/actualizar-cliente.ts` | 327 | yes | Medium — credit-field authorization |
| 12 | `app/src/modules/proveedor/application/actualizar-proveedor.ts` | 279 | yes | Medium |
| 13 | `app/src/modules/cobros/application/registrar-reembolso.ts` | 242 | no | Medium — refund allocation |

**Tier 3 — `domain/` (already decomposed; low priority)**

| Path | Lines | Fan-in | Risk |
|---|---|---|---|
| `app/src/modules/auditoria/domain/auditoria.ts` | 323 | 13 | Medium |
| `app/src/modules/reportes/domain/reporte-filtro.ts` | 302 | **25** | **High fan-in** — most-coupled file in the codebase |
| `app/src/modules/compra/domain/compra.ts` | 417 | 14 | High (fiscal) |
| `app/src/modules/venta/domain/calculators.ts` | 286 | 4 | Low |
| `app/src/modules/devolucion/domain/devolucion.ts` | 233 | 4 | Low |

**Tier 4 — `http/` (smallest layer, lowest fan-in, barrel-able, pilot-validated)**

| Path | Lines | Actions | Fan-in | UI wired | Test | Risk |
|---|---|---|---|---|---|---|
| `app/src/modules/inventario/http/actions.ts` | 145 | 2 | 1 | no | yes | **Lowest** |
| `app/src/modules/categoria/http/actions.ts` | 215 | 4 | 1 | no | yes | Low |
| `app/src/modules/proveedor/http/actions.ts` | 231 | 4 | 1 | no | yes | Low |
| `app/src/modules/cobros/http/actions.ts` | 202 | 4 | 5 | yes | **no** | Low-med |
| `app/src/modules/producto/http/actions.ts` | 250 | 4 | 5 | yes | yes | Low-med |
| `app/src/modules/cliente/http/actions.ts` | 260 | 5 | 5 | yes | yes | Low-med |
| `app/src/modules/reportes/http/actions.ts` | 294 | 11 | 2 | yes | **no** | Medium |
| `app/src/modules/compra/http/actions.ts` | 339 | 7 | 1 | no | yes | Medium |
| `app/src/modules/venta/http/actions.ts` | 329 | 6 | 5 | yes | **no** | Medium-high |

**Honest caveat on the lowest-risk rows.** `categoria`, `proveedor`, `inventario` and `compra`
have fan-in 1 — their actions are consumed **only by their own co-located test**. Verified by
symbol-name grep: no `src/app`, no `ui/`, no other module references `crearCategoriaAction`,
`listarCategoriasAction`, `crearProveedorAction`, or `listarInventarioAction`. These are the
cheapest splits *and* the least valuable, because those actions are not wired to any UI yet.
The design exploits the low cost but does not pretend it delivers user-visible value.

---

## 3. Architecture Decisions

### Decision: Restore tenant-wrapper ESLint enforcement before any further split

**Choice**: Slice 0 widens **two** gates, then all later slices proceed.

**Alternatives considered**: (a) accept the loss of enforcement, since the pilot merged and CI
was green; (b) put the split files under an ESLint override block per module.

**Rationale — measured, not assumed.** The project-local rule
`systemfact/server-action-must-wrap-tenant` is gated **twice**, and PR #82 opened both gates
without ever closing them:

1. `app/eslint.config.mjs:14` scopes the rule to `files: ["src/**/actions.ts", "src/**/actions.tsx"]`
   — an exact filename match that does **not** match `actions.shared.ts`.
2. `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts:149` hardcodes
   `const isActionsFile = /[\\/]actions\.tsx?$/.test(filename); if (!isActionsFile) return {};`
   — an early return that no-ops the rule for any other filename.

Proof, executed in the repo and then reverted (`git status --porcelain` clean,
`eslint.config.mjs` SHA-256 `88D3DFBC7DA27ED1` restored):

```
$ npx eslint --print-config src/modules/devolucion/http/actions.ts        # barrel
    "systemfact/server-action-must-wrap-tenant": [                        # rule PRESENT
$ npx eslint --print-config src/modules/devolucion/http/actions.shared.ts  # split file
(no output — rule ABSENT)
```

Net effect today: every real action body in `auth` and `devolucion` is **unguarded**. The barrel
satisfies the rule trivially because it contains no database access. Defense-in-depth required
by `AGENTS.md` §Security is silently off for exactly the files the refactor touches.

Widening the ESLint glob alone is **not sufficient** — verified: with only the config glob
widened, a deliberately unwrapped action in `actions.probe.ts` still passed (exit 0). Both gates
must change:

- `app/eslint.config.mjs:14` → `["src/**/actions.ts", "src/**/actions.tsx", "src/**/actions.*.ts", "src/**/actions.*.tsx"]`
- `.../server-action-must-wrap-tenant.ts:149` → `/[\\/]actions(\.[\w-]+)?\.tsx?$/`

With both gates widened, the same probe **fails** as required:

```
error  Server Action "leerSinWrap" accesses prisma outside withTenantTransaction(ctx, async (tx) => {...})
exit=1
```

And the change is regression-clean, verified in-repo:

- full-repo `npx eslint`: **0 new errors** (the only error was the throwaway probe)
- the 5 pilot split files: **pass** under the widened rule
- `npx jest tools/eslint-plugin-systemfact`: **20/20 tests pass** with the widened regex

This is a ~6-line change that restores a security control the refactor removed. It is not a
behavior change to the product and is squarely inside spec Requirement 2 ("preserve
`withTenantTransaction` + server authorization").

### Decision: `http/` barrels keep the public surface; repositories do not get a barrel

**Choice**: Every `http/actions.ts` split ends in a re-export barrel with **no** `"use server"`
directive. Repository splits are deferred to a follow-on change that must solve import-site
rewrites without a barrel.

**Alternatives considered**: (a) barrel everything; (b) skip repositories permanently.

**Rationale**: `devolucion/ui/ReturnForm.tsx` (a `"use client"` component) imports
`devolverVentaAction` through `@/modules/devolucion/http/actions`. The barrel works because it
re-exports from a `"use server"` module. `venta-repository.ts` has **no** barrel option: 15
files import it by name (`import { tieneRolPermitidoEnTx } from ".../venta-repository"`), so a
split forces 15 import-site edits — a much larger and genuinely different refactor with no
pilot evidence behind it. Splitting it blindly would violate "no big bang".

### Decision: `shared.ts` without `"use server"`, not `actions.shared.ts` with it

**Choice**: Shared pure helpers (`ok`, `error`, DTO types, DTO mappers, role constants) go in a
plain module with **no** directive. Only real action modules carry `"use server"`.

**Alternatives considered**: replicate the pilot exactly — `actions.shared.ts` **with**
`"use server"` and every helper forced to `async`.

**Rationale**: This is the async gotcha, and the pilot's answer was to make the helpers
`async` (`devolucion/http/actions.shared.ts:59,63,70` — `ok`, `fail`, `resolverCtx` are all
`async`). That is correct for `resolverCtx` (it genuinely awaits), but wrong for a pure mapper:
`cliente/http/actions.ts:71` `toDto(c: Cliente): ClienteDto` is synchronous, and
`ROLES_GESTION_CLIENTES` (line 37) is a constant. Forcing them `async` would make
`toDto` return `Promise<ClienteDto>` and force `await` at every call site — a real behavior
change dressed as a refactor. Removing the directive avoids the constraint by construction
instead of paying for it.

`devolucion/http/actions.shared.ts` stays exactly as it is. This decision governs **new** files
only; the pilot is not redesigned.

### Decision: Order by measured fan-in, not by file size

**Choice**: Attack `http/` first, smallest fan-in first, and put `venta/http/actions.ts` last.

**Alternatives considered**: attack the 1097-line `venta-repository.ts` first, as the headline
win.

**Rationale**: `venta-repository.ts` is the most-coupling file in the sale path, has **no**
repository test, exports `tieneRolPermitidoEnTx` that `devolucion` depends on cross-module, and
cannot use a barrel. A 2236-line-diff change to it as the *first* move would be the opposite of
"1 low-risk candidate first". Its size makes it the worst possible opener regardless of its size.

### Decision: One module per chained PR; no PR bundles two modules

**Choice**: Each PR moves exactly one module's file.

**Rationale**: Bundling two ~215-line modules yields ~890 diff lines — double the budget — and
merges two independent rollback surfaces into one.

---

## 4. The `async` constraint — HARD RULE

> **Any value exported from a file carrying the `"use server"` directive MUST be an `async`
> function. A non-`async` export from a `"use server"` module is a build failure, not a warning.**

This is not theoretical. During PR #82 a production build failed for exactly this reason
(Next.js 16 / Turbopack rejects synchronous exports from a `"use server"` module).

Rules that follow:

1. `shared.ts` carries **no** directive, so its exports stay `async`-free and callers need no
   `await`. This is the default placement for `ok`, `error`, DTO types, DTO mappers, role
   constants, and `ActionResult<T>`.
2. If a genuinely async helper must be shared between two action modules (the
   `resolverCtx` case: `await createClient()` then `getCurrentTenantContext(supabase)`),
   either place it in `shared.ts` as a plain `async` function, or mirror the pilot in an
   `actions.shared.ts` that carries the directive **and** exports only `async` functions.
   Note `cliente`, `producto`, `proveedor`, `categoria` and `inventario` do **not** use a local
   `resolverCtx` at all — they inline `createClient()` + `getCurrentTenantContext()`
   (measured `resolverCtx` occurrences: 0 in those five, 8 in `compra`, 7 in `venta`,
   5 in `cobros`). So the constraint mostly disappears for the low-risk modules.
3. A **re-export barrel** must not carry `"use server"`. Both pilot barrels omit it
   (`auth/http/actions.ts`, `devolucion/http/actions.ts`), and this is load-bearing: the barrel
   must be importable by client components through a directive-bearing module.
4. `ActionResult<T>`, error-code unions, and DTO types are **types**, not runtime values. They
   are erased at compile time and are not subject to the constraint — but they still must be
   re-exported with `export type` / `export { type X }` so no runtime export is created.

**Verification for every slice: `pnpm build`.** `tsc --noEmit` cannot see this failure — only the
Turbopack production build can.

---

## 5. Preserved invariants (must hold verbatim in every slice)

These are copied, never rewritten. A slice that paraphrases them is out of contract.

**Tenant transaction.** Every action that touches the database resolves the context from the
Supabase session *first* (an auth read, not tenant-DB access), then performs **all**
authorization and **all** Prisma access inside:

```ts
const supabase = await createClient();
const ctx = await getCurrentTenantContext(supabase);
if (ctx === null) return error(SESION_INVALIDA, "Sesión no válida");

return withTenantTransaction(ctx, async (tx) => {
  const permitido = await tieneRolPermitidoEnTx(
    tx, ctx.usuarioId, ctx.empresaId, ROLES_GESTION_CLIENTES,
  );
  if (!permitido) return error(NO_AUTORIZADO, "No tiene permisos para …");

  const result = await useCase(tx, ctx, parsed.data);
  if (!result.ok) return error(result.code, result.message);
  return ok(toDto(result.data));
});
```

Order of operations — **unchanged**: `safeParse` → session context → `withTenantTransaction` →
role gate → use case → DTO mapping. The authorization gate runs **before** the use case and
**before** any write, so an unauthorized actor is refused before a receipt number or NCF is
allocated (the property documented at `cobros/http/actions.ts:130`).

**Authorization.** `tieneRolPermitidoEnTx(tx, ctx.usuarioId, ctx.empresaId, ROLES_*)` with the
module's existing role lists, moved byte-for-byte:

- `ROLES_GESTION_CLIENTES = ["Administrador", "Operador"]`, `ROLES_ADMIN_ONLY = ["Administrador"]`
  (`cliente/http/actions.ts:37,40`)
- `ROLES_COMPRA` is Administrador-only (`compra/http/actions.ts:39`)
- `ROLES_COBROS = ["Administrador", "Operador"]`, `ROLES_REEMBOLSO = ["Administrador"]`
  (`cobros/http/actions.ts:61,63`)

The two-stage credit check in `actualizarClienteAction` (`cliente/http/actions.ts:209-222`) —
`llevaCamposDeCredito(...)` then a second `tieneRolPermitidoEnTx` with `ROLES_ADMIN_ONLY` — must
survive as a unit inside a single action body. It may not be split across two modules.

**Errors.** Stable codes only, from the existing catalogs (`VALIDATION_ERROR`,
`SESION_INVALIDA`, `NO_AUTORIZADO`, `PAGO_NO_AUTORIZADO`, composed `*AccionesErrorCode` unions).
`result.message` is forwarded **verbatim** — the adapter never invents a duplicate message; the
domain/config catalog is the single source of truth.

**Money and DTOs.** `Decimal` never crosses the boundary; money serializes as a fixed-point
**string** (`limiteCredito: c.limiteCredito.toFixed(2)`).

---

## 6. Slice plan

Sizing formula, applied to every slice:

```
additions ≈ L + 9·K        (moved code + ~9 lines directive/import overhead per new file)
deletions ≈ L              (original emptied to a K-line barrel)
TOTAL     ≈ 2·L + 9·K
```

Budget: 400 changed lines. Preferred: ≤250 (proposal). Everything over 400 is flagged.

### Slices delivered by THIS change

| # | Slice | Target | L | Est. diff | Budget | Rollback |
|---|---|---|---|---|---|---|
| **0** | ESLint tenant-wrapper hardening | `eslint.config.mjs` + rule regex | — | **~6** | ✅ well under | revert 2 lines |
| **1** | `inventario/http/actions.ts` | 2 files + barrel | 145 | **~304** | ✅ under | `git revert` |
| **2** | `categoria/http/actions.ts` | 2 files + barrel | 215 | ~444 | ⚠️ **+11% over** | `git revert` |
| **3** | `proveedor/http/actions.ts` | 2 files + barrel | 231 | ~476 | ⚠️ **+19% over** | `git revert` |
| **4** | `cobros/http/actions.ts` | 2 files + barrel | 202 | ~418 | ⚠️ **+5% over** | `git revert` |
| **5** | `producto/http/actions.ts` | 2 files + barrel | 250 | ~514 | ⚠️ **+29% over** | `git revert` |
| **6** | `cliente/http/actions.ts` | 2 files + barrel | 260 | ~534 | ⚠️ **+34% over** | `git revert` |
| **7** | `compra/http/actions.ts` | 3 files + barrel | 339 | ~692 | ❌ **+73% over** | `git revert` |
| **8** | `reportes/http/actions.ts` | 3 files + barrel | 294 | ~602 | ❌ **+51% over** | `git revert` |
| **9** | `venta/http/actions.ts` | 3 files + barrel | 329 | ~672 | ❌ **+68% over** | `git revert` |

Slices 2–9 exceed 400 and must be delivered as **2-PR sub-chains** (see §6.1) or carry a
maintainer-approved `size:exception`. They are flagged here rather than planned silently.

### 6.1 Sub-chain shape for an over-budget slice

Split the module into two PRs, each independently reviewable and revertible:

- **PR-A** — extract `shared.ts` (DTO, role constants, `ok`/`error`, `ActionResult<T>`) and move
  the **write** actions (`crear`, `actualizar`, `desactivar`). Barrel re-exports only what exists.
- **PR-B** — move the **read** actions (`listar`, `obtener`, `consultar*`).

For `cliente` (534 est.) this yields ~270 and ~264 — both inside budget. Applied the same way,
`compra` (692) becomes ~350/~342, and `venta` (672) ~336/~336.

### 6.2 Slices deferred to the follow-on change

Ordered, with the same arithmetic. **None can use a barrel.**

| Order | Target | L | Fan-in | Est. diff | Sub-PRs |
|---|---|---|---|---|---|
| 1 | `producto/infrastructure/producto-repository.ts` | 465 | 10 | ~951 | 3 |
| 2 | `cliente/infrastructure/cliente-repository.ts` | 411 | 16 | ~843 | 3 |
| 3 | `auditoria/domain/auditoria.ts` | 323 | 13 | ~673 | 2 |
| 4 | `compra/infrastructure/compra-repository.ts` | 726 | 17 | ~1480 | 5 |
| 5 | `compra/domain/compra.ts` | 417 | 14 | ~869 | 3 |
| 6 | `venta/infrastructure/venta-repository.ts` | 1097 | 15 | ~2236 | 7 |
| 7 | `inventario/infrastructure/inventario-repository.ts` | 1031 | 13 | ~2104 | 6 |

Deferred because all seven (a) exceed budget by 1.7×–5.6× even after chaining, (b) require
import-site rewrites at 10–17 consumers instead of a barrel, (c) sit on fiscal, inventory, NCF
and credit-authorization paths, and (d) have no pilot evidence. `venta-repository.ts` and
`inventario-repository.ts` also **lack repository tests**, so the regression net is weaker than
in the `http/` tier. `reporte-filtro.ts` (fan-in **25**, the highest in the codebase) is
explicitly last of all.

---

## 7. Per-slice technical approach

Target shape, applied to each module (illustrated with `cliente`, since it has the richest
shape: a DTO, two role lists, and a two-stage authorization):

```
app/src/modules/cliente/http/
  actions.ts                       6 lines   barrel, NO "use server"
  shared.ts                       ~60 lines  pure helpers, NO "use server"
  actions.escritura.ts           ~120 lines  "use server"  crear, actualizar, desactivar
  actions.lectura.ts              ~75 lines  "use server"  obtener, listar
  actions.test.ts                unchanged    imports "./actions" — must not be edited
```

Barrel, exactly the pilot shape:

```ts
export { crearClienteAction, actualizarClienteAction, desactivarClienteAction } from "./actions.escritura";
export { obtenerClienteAction, listarClientesAction } from "./actions.lectura";
export type { ActionResult } from "./shared";
```

Symbol placement rules:

- `ActionResult<T>`, `*AccionesErrorCode`, `ClienteDto` → `shared.ts` (types)
- `ok`, `error`, `toDto` → `shared.ts` (sync, **no** directive)
- `ROLES_*` constants → `shared.ts`
- action functions → their `actions.<group>.ts` (the only `"use server"` modules)

Each action body moves **verbatim**, including its own imports of `createClient`,
`getCurrentTenantContext`, `withTenantTransaction`, `tieneRolPermitidoEnTx`, its zod schema and
its error codes. No body is edited, reordered, or "cleaned".

**The test file is never edited.** All six existing `actions.test.ts` import from `./actions`
(verified). If the barrel re-exports every public symbol, the suites pass untouched — which makes
them a genuine behavior-preservation proof and keeps the diff free of test churn.

---

## 8. Verification gates

Run from `app/`. All four are blocking; the build is not optional.

| # | Gate | Command | Catches |
|---|---|---|---|
| 1 | Types | `pnpm exec tsc --noEmit` | broken imports, type-only vs value re-export mistakes |
| 2 | Lint | `pnpm lint` | `systemfact/server-action-must-wrap-tenant` (post-Slice-0 it also covers split files), unused imports |
| 3 | Tests | `pnpm test` | the module's `actions.test.ts` through the barrel (unmodified) |
| 4 | Tests (targeted) | `pnpm exec jest src/modules/<m>/http/actions.test.ts` | fast per-slice signal |
| 5 | Build | `pnpm build` | **the `async`/"use server" Turbopack rejection, and client-component server-action resolution** |
| 6 | Commits | `pnpm lint:commits --from origin/master --to HEAD` | Conventional Commits gate |

Gate 5 is the one that cannot be skipped. It is the only gate that detects the async violation
and the only one that proves a `"use client"` consumer (e.g. `devolucion/ui/ReturnForm.tsx`)
still resolves a server action through a directive-less barrel.

Optional smoke for medium/high blast radius (proposal §How): `pnpm probe:tenant` and
`pnpm rls:verify` exercise the RLS/GUC path; run them for the `venta`/`compra`/`cobros` slices.

Baseline to compare against: 433 unit test files under `src/`, Next.js 16.3.3, React 19.2.8,
TypeScript 5, ESLint 9, Jest 29.

---

## 9. Risks and rollback

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Non-`async` export in a `"use server"` file | Medium | **Build failure** (hit in PR #82) | §4 rules; `pnpm build` is blocking |
| Barrel without `"use server"` breaks a client component's server-action import | Low | **Runtime** failure in UI | `pnpm build` + smoke the touched screen |
| Prisma access accidentally left outside the wrapper | Low | **Cross-tenant leak** (#1 risk) | Rule restored in Slice 0; `pnpm lint`; verbatim action bodies |
| Authorization gate reordered below the use case | Low | Unauthorized write / allocated receipt | Bodies copied verbatim; two-stage credit check kept whole |
| Two-stage credit check split across modules | Medium | Authorization regression | Slice-6 task constraint: keep it in one body |
| Losing ESLint coverage of split files | **Already occurred** | Security control silently off | Slice 0 (measured, proven above) |
| A `use case` or repository import accidentally crossing into `shared.ts` and being pulled client-side | Low | Bundle leak | `shared.ts` holds types + pure helpers only |
| Diff estimate off → PR exceeds 400 | Medium | Review-budget violation | Pre-merge `git diff --numstat origin/master...HEAD`; flag before opening |
| No test coverage for `cobros`, `reportes`, `venta` http | Medium | Weaker regression net | Manual smoke required for those three slices |

**Rollback**: every slice is a single conventional commit (`refactor(...)`) touching one module
plus its barrel. Rollback is `git revert <sha>` — no data migration, no schema change, no
feature flag, no state to unwind. Because the barrels preserve the public surface, reverting a
split restores the previous module layout with zero consumer edits. Slices are ordered so that a
revert at any point leaves a compiling, shipping tree.

---

## 10. Out of scope — explicitly unchanged

Confirmed **not** touched by any slice in this change:

- `src/app/**` — pages, layouts, route handlers. (`reportes`/`auditoria` actions are *read* by
  `src/app`; those imports stay byte-identical because the barrel preserves the surface.)
- `components/`, `features/`, any UI, `<module>/ui/**` — including `PosScreen.tsx` (329),
  `CxcBoardScreen.tsx` (304), `ReturnForm.tsx`, `AuditFilters.tsx`, `operacional-panel.tsx`
- shared UI hooks, utils, and types
- broad cross-cutting public barrels and re-export surfaces beyond the per-module
  `http/actions.ts` barrel
- `domain/` business logic, fiscal rules, ITBIS calculators, NCF sequences, retentions, invoice
  state transitions — **no logic edit anywhere**
- inventory, stock, average-cost semantics; RLS/GUC behavior in
  `tenant/infrastructure/withTenantTransaction.ts`
- the Prisma schema and migrations

Architectural rules that remain in force: Prisma access stays in `infrastructure/` and is never
called from `application/`, `http/`, or components; `domain/` stays pure (no Next.js, React,
Prisma, or Supabase imports). Strict YAGNI — no speculative seams, no "future extensibility"
parameters, no abstraction introduced for its own sake.

---

## 11. Threat Matrix

**N/A** — this change alters no routing, no shell commands, no subprocesses, no VCS/PR
automation, no executable-file classification, and no process integration. It only relocates
TypeScript module boundaries and widens an ESLint filename glob. No applicable rows, therefore no
RED tests are required by the matrix. The verification obligations that *do* apply come from §8,
not from the matrix.

---

## 12. Migration / Rollout

No migration required. No data migration, no schema change, no feature flag, no backfill, no
phased rollout. Each slice is an independent, revertible commit, merged with **Squash and
merge** per `AGENTS.md`, carrying its own version bump (`app/package.json` +
`.release-please-manifest.json` + `app/CHANGELOG.md`) written without a UTF-8 BOM
(`[IO.File]::WriteAllText` with `UTF8Encoding($false)`).

Chained slices use a **Feature Branch Chain**: PR #1 targets the feature/tracker branch, each
child targets its immediate predecessor, and each child is rebased until GitHub shows a diff
containing only its own module.

Rollout order is Slice 0 first and alone — it is a security-control restoration and must be green
before any further split widens the surface it governs.

---

## 13. Open Questions

- [ ] **Budget disposition for Slices 2–6** (444–534 est.): accept chained 2-PR sub-chains, or
      grant maintainer-approved `size:exception` for the four marginal ones (+5% to +34%)?
      This is a maintainer decision and it changes the slice count materially.
- [ ] **Scope boundary**: is the `http/` layer + Slice 0 the right boundary for *this* change,
      with repositories in a follow-on change? The alternative — one change covering all nine
      ≥400-line files — implies ~7,700 diff lines and ~30 chained PRs, which the 400-line budget
      makes a program rather than a change.
- [ ] Should `devolucion/http/actions.shared.ts` be migrated to the directive-less `shared.ts`
      shape for consistency (2 lines + helper de-asyncing), or left untouched as pilot residue?
      The design recommends leaving it untouched — YAGNI, and it is already correct and green.