# Tasks: refactor-selective-backend-organization

## Review Workload Forecast

> **Status: historical forecast, superseded by actual delivery.** The 18-PR
> `feature-branch-chain` below never materialised past Slice 2. From Slice 3
> onward delivery is **one PR per module** carrying the `size:exception` label
> (maintainer-approved over-budget review), merged serially into `master`.
> See *Delivery Strategy Divergence* near the end of this file.

| Field | Value |
|-------|-------|
| Estimated changed lines | 6 + 304 + 444 + 476 + 418 + 514 + 534 + 692 + 602 + 672 = ~4662 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 10 slices: Slice 0 single PR, Slice 1 single PR, Slices 2-9 as 2-PR sub-chains |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

_Forecast as originally planned. The "PR" column shows the intended slot; the
actual PR that landed each unit is recorded in the phase heading and in
*Progress_.

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | ESLint tenant-wrapper hardening | PR 1 (Slice 0) | `pnpm exec tsc --noEmit` | N/A — config-only change | `git revert <slice-0-sha>` |
| 2 | inventario/http split (single PR) | PR 2 (Slice 1) | `pnpm exec jest src/modules/inventario/http/actions.test.ts` | `pnpm build` | `git revert <slice-1-sha>` |
| 3 | categoria/http sub-chain PR-A | PR 3A (Slice 2) | `pnpm exec jest src/modules/categoria/http/actions.test.ts` | `pnpm build` | `git revert <slice-2A-sha>` |
| 4 | categoria/http sub-chain PR-B | PR 3B (Slice 2) | `pnpm exec jest src/modules/categoria/http/actions.test.ts` | `pnpm build` | `git revert <slice-2B-sha>` |
| 5 | proveedor/http sub-chain PR-A | PR 4A (Slice 3) | `pnpm exec jest src/modules/proveedor/http/actions.test.ts` | `pnpm build` | `git revert <slice-3A-sha>` |
| 6 | proveedor/http sub-chain PR-B | PR 4B (Slice 3) | `pnpm exec jest src/modules/proveedor/http/actions.test.ts` | `pnpm build` | `git revert <slice-3B-sha>` |
| 7 | cobros/http sub-chain PR-A | PR 5A (Slice 4) | `pnpm exec jest src/modules/cobros/http/actions.test.ts` | `pnpm build` | `git revert <slice-4A-sha>` |
| 8 | cobros/http sub-chain PR-B | PR 5B (Slice 4) | `pnpm exec jest src/modules/cobros/http/actions.test.ts` | `pnpm build` | `git revert <slice-4B-sha>` |
| 9 | producto/http sub-chain PR-A | PR 6A (Slice 5) | `pnpm exec jest src/modules/producto/http/actions.test.ts` | `pnpm build` | `git revert <slice-5A-sha>` |
| 10 | producto/http sub-chain PR-B | PR 6B (Slice 5) | `pnpm exec jest src/modules/producto/http/actions.test.ts` | `pnpm build` | `git revert <slice-5B-sha>` |
| 11 | cliente/http sub-chain PR-A | PR 7A (Slice 6) | `pnpm exec jest src/modules/cliente/http/actions.test.ts` | `pnpm build` | `git revert <slice-6A-sha>` |
| 12 | cliente/http sub-chain PR-B | PR 7B (Slice 6) | `pnpm exec jest src/modules/cliente/http/actions.test.ts` | `pnpm build` | `git revert <slice-6B-sha>` |
| 13 | compra/http sub-chain PR-A | PR 8A (Slice 7) | `pnpm exec jest src/modules/compra/http/actions.test.ts` | `pnpm build` | `git revert <slice-7A-sha>` |
| 14 | compra/http sub-chain PR-B | PR 8B (Slice 7) | `pnpm exec jest src/modules/compra/http/actions.test.ts` | `pnpm build` | `git revert <slice-7B-sha>` |
| 15 | reportes/http sub-chain PR-A | PR 9A (Slice 8) | `pnpm exec jest src/modules/reportes/http/actions.test.ts` | `pnpm build` | `git revert <slice-8A-sha>` |
| 16 | reportes/http sub-chain PR-B | PR 9B (Slice 8) | `pnpm exec jest src/modules/reportes/http/actions.test.ts` | `pnpm build` | `git revert <slice-8B-sha>` |
| 17 | venta/http sub-chain PR-A | PR 10A (Slice 9) | `pnpm exec jest src/modules/venta/http/actions.test.ts` | `pnpm build` | `git revert <slice-9A-sha>` |
| 18 | venta/http sub-chain PR-B | PR 10B (Slice 9) | `pnpm exec jest src/modules/venta/http/actions.test.ts` | `pnpm build` | `git revert <slice-9B-sha>` |

> Units 5–10 were **not** delivered as sub-chains. Each of proveedor, cobros
> and producto landed as a single PR (#87, #88, #89 respectively), because the
> maintainer chose 1 PR per module + `size:exception` over splitting.
> Units 11–18 are restructured accordingly as single-PR phases (Phases 11–14).

## Phase 1: ESLint Tenant-Wrapper Hardening (Slice 0)

_Prerequisite — must pass before any http/ slice PR is merged. Restores defense-in-depth security control._

- [x] **1.1** Widen ESLint filename glob in `app/eslint.config.mjs:14` from `["src/**/actions.ts", "src/**/actions.tsx"]` to `["src/**/actions.ts", "src/**/actions.tsx", "src/**/actions.*.ts", "src/**/actions.*.tsx"]`
- [x] **1.2** Widen regex in `app/tools/eslint-plugin-systemfact/rules/server-action-must-wrap-tenant.ts:149` from `/[\\/]actions\.tsx?$/` to `/[\\/]actions(\.[\w-]+)?\.tsx?$/`
- [x] **1.3** Verify: `npx eslint --print-config src/modules/devolucion/http/actions.ts` preserves rule; `npx eslint --print-config src/modules/devolucion/http/actions.shared.ts` now includes rule (was absent)

**Verification gates for this phase:**
- `pnpm exec tsc --noEmit` — must pass (type-only change)
- `pnpm lint` — must pass with 0 new errors (full-repo check confirmed: 0 new errors, only the throwaway probe error)
- `pnpm build` — must pass (Turbopack production build)
- `pnpm lint:commits` — Conventional Commits gate

## Phase 2: inventario/http Split — Single PR (Slice 1)

_Inventario actions at 145 lines, ~304 diff estimate — under 400 budget, single PR acceptable._

Per-slice shape target for `inventario/`:
```
app/src/modules/inventario/http/
  actions.ts                       6 lines   barrel, NO "use server"
  shared.ts                       ~60 lines  pure helpers, NO "use server"
  actions.escritura.ts           ~80 lines  "use server"  crear, actualizar, desactivar
  actions.lectura.ts              ~65 lines  "use server"  listar, obtener
  actions.test.ts                unchanged    imports "./actions" — must not be edited
```

- [x] **2.1** Create `app/src/modules/inventario/http/shared.ts` with pure helpers (DTO types, `ok`, `error`, `toDto`, role constants). No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Cliente>`, `ClienteDto`, `ROLES_GESTION_INVENTARIO`.
- [x] **2.2** Create `app/src/modules/inventario/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: `crearInventarioAction`, `actualizarInventarioAction`, `desactivarInventarioAction`. Each body preserves its own imports of `createClient`, `getCurrentTenantContext`, `withTenantTransaction`, `tieneRolPermitidoEnTx`, zod schema, error codes. No body edits, no reordering.
- [x] **2.3** Create `app/src/modules/inventario/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: `listarInventarioAction`, `obtenerInventarioAction`. Each body preserves its own imports and authorization flow.
- [x] **2.4** Create/overwrite `app/src/modules/inventario/http/actions.ts` barrel: `export { crearInventarioAction, actualizarInventarioAction, desactivarInventarioAction } from "./actions.escritura"; export { listarInventarioAction, obtenerInventarioAction } from "./actions.lectura"; export type { ActionResult } from "./shared";`
- [x] **2.5** Verify: `pnpm exec tsc --noEmit` — type-check passes with barrel re-exports
- [x] **2.6** Verify: `pnpm lint` — passes systemaction-must-wrap-tenant rule on all new `"use server"` files
- [x] **2.7** Verify: `pnpm test` — module's `actions.test.ts` passes through barrel (imports `./actions`, unchanged)
- [x] **2.8** Verify: `pnpm exec jest src/modules/inventario/http/actions.test.ts` — fast per-slice signal green
- [x] **2.9** Verify: `pnpm build` — full production build passes (Turbopack `"use server"` constraint)
- [x] **2.10** Verify: `pnpm lint:commits` — Conventional Commits gate

**Rollback boundary for this phase:** `git revert <slice-1-sha>` — restores `inventario/http/actions.ts` barrel-only layout; all other new files discarded; consumer imports unchanged since barrel preserves public surface.

## Phase 3: categoria/http Sub-Chain — PR A (Slice 2, Part 1)

_categoria actions at 215 lines, ~444 diff estimate — +11% over 400 budget, requires 2-PR sub-chain._

Per-slice shape target for `categoria/`:
```
app/src/modules/categoria/http/
  actions.ts                       6 lines   barrel, NO "use server"
  shared.ts                       ~60 lines  pure helpers, NO "use server"
  actions.escritura.ts           ~110 lines  "use server"  crear, actualizar, desactivar
  actions.lectura.ts              ~105 lines  "use server"  listar, obtener
  actions.test.ts                unchanged
```

- [x] **3.1** Create `app/src/modules/categoria/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Categoria>`, `CategoriaDto`, `ROLES_GESTION_CATEGORIA`.
- [x] **3.2** Create `app/src/modules/categoria/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearCategoriaAction`, `actualizarCategoriaAction`, `desactivarCategoriaAction`).
- [x] **3.3** Create `app/src/modules/categoria/http/actions.ts` barrel with ONLY escritura exports + ActionResult type: `export { crearCategoriaAction, actualizarCategoriaAction, desactivarCategoriaAction } from "./actions.escritura"; export type { ActionResult } from "./shared";`
- [x] **3.4** Verify: `pnpm exec tsc --noEmit` — type-check passes with partial barrel
- [x] **3.5** Verify: `pnpm lint` — rule passes on new `"use server"` files; no coverage on `actions.lectura.ts` yet (will be added in PR-B)
- [x] **3.6** Verify: `pnpm build` — Turbopack build passes for escritura module only

**Rollback boundary for PR-A:** `git revert <slice-2A-sha>` — discards `actions.escritura.ts`, `shared.ts`, and partial `actions.ts`; original `actions.ts` restored; `actions.lectura.ts` not yet created.

## Phase 4: categoria/http Sub-Chain — PR B (Slice 2, Part 2)

_Continues from PR-A. Completes the split and verifies the full barrel._

- [x] **4.1** Create `app/src/modules/categoria/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarCategoriaAction`, `obtenerCategoriaAction`).
- [x] **4.2** Update `app/src/modules/categoria/http/actions.ts` barrel: add lectura exports. Final form: `export { crearCategoriaAction, actualizarCategoriaAction, desactivarCategoriaAction } from "./actions.escritura"; export { listarCategoriaAction, obtenerCategoriaAction } from "./actions.lectura"; export type { ActionResult } from "./shared";`
- [x] **4.3** Verify: `pnpm exec tsc --noEmit` — all barrel re-exports resolve types correctly
- [x] **4.4** Verify: `pnpm lint` — systemaction-must-wrap-tenant rule covers all `"use server"` files (widened glob from Slice 0)
- [x] **4.5** Verify: `pnpm test` — module's `actions.test.ts` passes through updated barrel (imports `./actions`, unchanged source)
- [x] **4.6** Verify: `pnpm exec jest src/modules/categoria/http/actions.test.ts` — fast per-slice signal green
- [x] **4.7** Verify: `pnpm build` — full production build passes
- [x] **4.8** Verify: `pnpm lint:commits` — Conventional Commits gate

**Rollback boundary for PR-B:** `git revert <slice-2B-sha>` — restores categoria to original `actions.ts` layout; all new files (`shared.ts`, `actions.escritura.ts`, `actions.lectura.ts`) discarded; barrel reverts to single-file state.

## Phase 5: proveedor/http — PR A (Slice 3, Part 1)

_proveedor actions at 231 lines, ~476 diff estimate — +19% over 400 budget._

> **Delivered as a SINGLE PR, not a sub-chain: PR #87 → `40155a4`, version 0.11.30.**
> Both halves below landed together with the `size:exception` label.

- [x] **5.1** Create `app/src/modules/proveedor/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Proveedor>`, `ProveedorDto`, `ROLES_GESTION_PROVEEDOR`.
- [x] **5.2** Create `app/src/modules/proveedor/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearProveedorAction`, `actualizarProveedorAction`, `desactivarProveedorAction`).
- [x] **5.3** Create `app/src/modules/proveedor/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [x] **5.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build` — same pattern as Phase 3-4.

**Rollback boundary:** `git revert 40155a4` — discards the whole proveedor split in one revert.

## Phase 6: proveedor/http — PR B (Slice 3, Part 2)

- [x] **6.1** Create `app/src/modules/proveedor/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarProveedorAction`, `obtenerProveedorAction`).
- [x] **6.2** Update `app/src/modules/proveedor/http/actions.ts` barrel: add lectura exports.
- [x] **6.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/proveedor/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** folded into PR #87 (single revert boundary above).

## Phase 7: cobros/http — PR A (Slice 4, Part 1)

_cobros actions at 202 lines, ~418 diff estimate — +5% over 400 budget._

> **Delivered as a SINGLE PR, not a sub-chain: PR #88 → `6fbe9d3`, version 0.11.31.**
> Both halves below landed together with the `size:exception` label. A version
> bump conflict against 0.11.30 was resolved during merge (both CHANGELOG
> entries kept, `0.11.31` wins in `package.json` + manifest).

- [x] **7.1** Create `app/src/modules/cobros/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Pago>`, `PagoDto`, `ROLES_COBROS`, `ROLES_REEMBOLSO`.
- [x] **7.2** Create `app/src/modules/cobros/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearCobroAction`, `actualizarCobroAction`, `desactivarCobroAction`).
- [x] **7.3** Create `app/src/modules/cobros/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [x] **7.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.

**Rollback boundary:** `git revert 6fbe9d3` — discards the whole cobros split in one revert.

## Phase 8: cobros/http — PR B (Slice 4, Part 2)

- [x] **8.1** Create `app/src/modules/cobros/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarCobroAction`, `obtenerCobroAction`).
- [x] **8.2** Update `app/src/modules/cobros/http/actions.ts` barrel: add lectura exports.
- [x] **8.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/cobros/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** folded into PR #88 (single revert boundary above).

## Phase 9: producto/http — PR A (Slice 5, Part 1)

_producto actions at 250 lines, ~514 diff estimate — +29% over 400 budget._

> **Delivered as a SINGLE PR, not a sub-chain: PR #89 → `56bd574`, version 0.11.32.**
> Both halves below landed together with the `size:exception` label.

- [x] **9.1** Create `app/src/modules/producto/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Producto>`, role constants.
  _Correction recorded 2026-10-06:_ `ProductoDto` does not exist in this module — the original `actions.ts` never defined it, so there was nothing to move verbatim. `shared.ts` (22 lines) holds `ActionResult<T>`, `ROLES_GESTION_PRODUCTOS`, `ROLES_ADMIN_ONLY`, `ok` and `error`.
- [x] **9.2** Create `app/src/modules/producto/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearProductoAction`, `actualizarProductoAction`, `desactivarProductoAction`) — 179 lines.
- [x] **9.3** Create `app/src/modules/producto/http/actions.ts` barrel. Final form: `export { crearProductoAction, actualizarProductoAction, desactivarProductoAction } from "./actions.escritura"; export { listarProductosAction } from "./actions.lectura"; export type { ActionResult } from "./shared";` — 3 lines.
- [x] **9.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.

**Rollback boundary:** `git revert 56bd574` — discards the whole producto split in one revert.

## Phase 10: producto/http — PR B (Slice 5, Part 2)

- [x] **10.1** Create `app/src/modules/producto/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions — 76 lines.
  _Correction recorded 2026-10-06:_ the plan named `listarProductoAction` and `obtenerProductoAction`; neither exists. The module has exactly **four** actions, and the read side is only `listarProductosAction` (plural). There is no `obtenerProductoAction`.
- [x] **10.2** Update `app/src/modules/producto/http/actions.ts` barrel: add lectura exports.
- [x] **10.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/producto/http/actions.test.ts` (20/20), `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** folded into PR #89 (single revert boundary above).

---

## Phase 11: cliente/http Split — Single PR (Slice 6)

_cliente actions at 260 lines, ~534 diff estimate — +34% over the 400 budget → **one PR with `size:exception`**._

Deliberately single-phase: the 2-PR sub-chain planned as Phases 11+12 is superseded by the maintainer's 1-PR-per-module decision.

> **Delivered as a SINGLE PR: PR #91 → `dc8ce71`, version 0.11.33, merged 2026-10-06T21:16:39Z**
> with labels `type:refactor` + `size:exception` (GitHub API, verified 2026-10-09).
> Checkboxes reconciled against `master` @ `3d68ed0` during archive (2026-10-09).

- [x] **11.1** Create `app/src/modules/cliente/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Cliente>`, `ClienteDto`, `ROLES_GESTION_CLIENTES`, `ROLES_ADMIN_ONLY`. **Constraint**: `toDto(c: Cliente): ClienteDto` is synchronous (no `async`); `ROLES_GESTION_CLIENTES = ["Administrador", "Operador"]` and `ROLES_ADMIN_ONLY = ["Administrador"]` are constants. Do NOT force `async` — the design explicitly removes the directive from `shared.ts` to avoid this anti-pattern. _Archive reconciliation 2026-10-09: shipped as specified — `shared.ts` 59 lines, `toDto` synchronous (line 44), both role constants present with exact values._
- [x] **11.2** Create `app/src/modules/cliente/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearClienteAction`, `actualizarClienteAction`, `desactivarClienteAction`). **Critical**: the two-stage credit check (`llevaCamposDeCredito(...)` then a second `tieneRolPermitidoEnTx` with `ROLES_ADMIN_ONLY`) must survive as a single contiguous body inside one action — it may NOT be split across two modules. _Archive reconciliation 2026-10-09: three write actions present; two-stage credit check verified contiguous in `actions.escritura.ts` (`llevaCamposDeCredito` gate at line 95 → `ROLES_ADMIN_ONLY`)._
- [x] **11.3** Create `app/src/modules/cliente/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarClienteAction`, `obtenerClienteAction`). _Correction recorded 2026-10-09: the actual read action is `listarClientesAction` (plural), not `listarClienteAction`; plus `obtenerClienteAction`. Both present in `actions.lectura.ts` (86 lines)._
- [x] **11.4** Create `app/src/modules/cliente/http/actions.ts` barrel: re-export escritura + lectura actions and `export type { ActionResult } from "./shared";`. Pure re-export file — no `"use server"`, no executable code. _Verified: barrel is 3 lines, re-exports only._
- [x] **11.5** Verify: `pnpm exec tsc --noEmit` — exit 0. _Re-run on `master` @ `3d68ed0`, 2026-10-09: exit 0._
- [x] **11.6** Verify: `pnpm lint` — 0 errors; baseline is 16 pre-existing warnings (`auth`, `devolucion` only), no regression. _Re-run 2026-10-09: exit 0 — 0 errors, 16 warnings (auth/devolucion baseline unchanged)._
- [x] **11.7** Verify: `pnpm exec jest src/modules/cliente/http/actions.test.ts` — all tests green through the unchanged barrel. _Re-run 2026-10-09: PASS (4 suites / 46 tests across cliente+compra+venta modules, exit 0)._
- [x] **11.8** Verify: `pnpm build` — production build passes. _Evidence: required `CI gate` (strict) was green on PR #91 before merge; build not re-run locally at archive._
- [x] **11.9** Confirm `app/src/modules/cliente/http/actions.test.ts` and any sibling `validations.ts` are byte-identical to `master` (`git diff` shows no change). _Verified: `git diff dc8ce71^ 3d68ed0 -- app/src/modules/cliente/http/` touches only the 4 split files; `actions.test.ts` and `validation.ts` (actual name, singular) absent from the diff — byte-identical._
- [x] **11.10** Confirm no UTF-8 BOM in the four split files (first bytes must not be `EF BB BF`). _Verified 2026-10-09: all four files no-BOM._
- [x] **11.11** Bump version PATCH in `app/package.json` + `.release-please-manifest.json` + `app/CHANGELOG.md` (entry references the PR number), commit as `chore(release): bump <version>`. _Landed: squash `dc8ce71` carries `chore(release): bump version to 0.11.33`; CHANGELOG 0.11.33 references #91._
- [x] **11.12** PR with labels `type:refactor` + `size:exception`; merge with **Squash and merge** only. _Merged: PR #91 closed with `merged_at` 2026-10-06T21:16:39Z; labels verified via GitHub API._

**Rollback boundary:** `git revert dc8ce71` — one revert restores the whole cliente module.

## Phase 12: compra/http Split — Single PR (Slice 7)

_compra actions at 339 lines, ~692 diff estimate — +73% over the 400 budget → **one PR with `size:exception`**._

_Highest blast radius in the change: 17 application importers, purchase/NCF path. Fan-in 17 makes this the most-coupled `http/` module. Do it after Phases 11 has shipped and is proven green._

> **Delivered as a SINGLE PR: PR #92 → `3a51969`, version 0.11.34, merged 2026-10-06T21:35:55Z**
> with labels `type:refactor` + `size:exception` (GitHub API, verified 2026-10-09).

- [x] **12.1** Create `app/src/modules/compra/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Compra>`, `CompraDto`, `ROLES_COMPRA`. `ROLES_COMPRA = ["Administrador"]` (Administrador-only). _Correction recorded 2026-10-09: actual `shared.ts` (25 lines) exports `ok`, `error`, `ActionResult<T>` (error codes typed as `CompraErrorCode` imported from `../domain/errors`), `ROLES_ADMIN_ONLY = ["Administrador"]` (the plan's `ROLES_COMPRA` under its real name, same Administrador-only semantics), and `resolverCtx`. No `CompraDto` — none existed in the original file, so there was nothing to move verbatim._
- [x] **12.2** Create `app/src/modules/compra/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearCompraAction`, `actualizarCompraAction`, `desactivarCompraAction`). Note: compra has no two-stage credit check; simpler authorization gate. _Correction recorded 2026-10-09: escritura holds **five** write actions — `crearCompraAction`, `actualizarCompraAction`, `confirmarCompraAction`, `cancelarCompraAction`, `recibirCompraAction`. There is no `desactivarCompraAction` in this module (the plan named it in error)._
- [x] **12.3** Create `app/src/modules/compra/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarCompraAction`, `obtenerCompraAction`). _Correction recorded 2026-10-09: the actual read action is `listarComprasAction` (plural), plus `obtenerCompraAction`. Both present (155 lines)._
- [x] **12.4** Create `app/src/modules/compra/http/actions.ts` barrel: re-export escritura + lectura actions and `export type { ActionResult } from "./shared";`. _Verified: barrel is 3 lines, re-exports only._
- [x] **12.5** Verify: `pnpm exec tsc --noEmit` — exit 0. _Re-run on `master` @ `3d68ed0`, 2026-10-09: exit 0._
- [x] **12.6** Verify: `pnpm lint` — 0 errors, no regression on the 16-warning baseline. _Re-run 2026-10-09: exit 0 — 0 errors, 16 warnings._
- [x] **12.7** Verify: `pnpm exec jest src/modules/compra/http/actions.test.ts`. _Re-run 2026-10-09: PASS (actions.test.ts + validations.test.ts both green)._
- [x] **12.8** Verify: `pnpm build`. _Evidence: required `CI gate` (strict) was green on PR #92 before merge; build not re-run locally at archive._
- [x] **12.9** Confirm `actions.test.ts` and sibling files are byte-identical to `master`. _Verified: `git diff 3a51969^ 3d68ed0 -- app/src/modules/compra/http/` touches only the 4 split files; `actions.test.ts`, `validations.ts` and `validations.test.ts` absent from the diff._
- [x] **12.10** Confirm no UTF-8 BOM in the split files. _Verified 2026-10-09: all four files no-BOM._
- [x] **12.11** Check the blast radius: confirm every importer resolves through the barrel (no import path changed). _Verified 2026-10-09: `git grep` for `actions.lectura`/`actions.escritura` returns hits only inside each module's own `http/` dir (the barrels); zero references from application/, UI or any other layer._
- [x] **12.12** Bump version PATCH + CHANGELOG entry referencing the PR number. _Landed: squash `3a51969` carries `chore(release): bump version to 0.11.34`; CHANGELOG 0.11.34 references #92._
- [x] **12.13** PR with labels `type:refactor` + `size:exception`; merge with **Squash and merge** only. _Merged: PR #92 closed with `merged_at` 2026-10-06T21:35:55Z; labels verified via GitHub API._

**Rollback boundary:** `git revert 3a51969` — one revert restores the whole compra module.

## Phase 13: reportes/http Split — Single PR (Slice 8)

_reportes actions at 294 lines, ~602 diff estimate — +51% over the 400 budget → **one PR with `size:exception`**._

_Medium-high risk: fan-in 11, UI-wired, **no test coverage** per the design risk table. Verification leans harder on `tsc`, `lint` and `build` because there is no test suite to catch a broken export._

> **Delivered as a SINGLE PR: PR #93 → `ea63d75`, version 0.11.35, merged 2026-10-06T22:12:44Z**
> with labels `type:refactor` + `size:exception` (GitHub API, verified 2026-10-09).
> Module shipped **read-only**: `shared.ts` + `actions.lectura.ts` + barrel — no `actions.escritura.ts`.

- [x] **13.1** Create `app/src/modules/reportes/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Reporte>`, `ReporteDto`. _Correction recorded 2026-10-09: actual `shared.ts` (29 lines) exports `ActionResult<T>` and `ReportesAccionesErrorCode` (moved from the original file) plus `ok`/`error`; no `ReporteDto` existed in the original, so there was nothing to move verbatim._
- [x] **13.2** Create `app/src/modules/reportes/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions. _Correction recorded 2026-10-09: **N/A — reportes has no write actions** (read-only module; all 11 actions are `consultar*` queries). No `actions.escritura.ts` exists; the read-only shape shipped instead._
- [x] **13.3** Create `app/src/modules/reportes/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions. _Verified: `actions.lectura.ts` (267 lines) holds all 11 `consultar*Action` functions._
- [x] **13.4** Create `app/src/modules/reportes/http/actions.ts` barrel: re-export both sides plus `export type { ActionResult } from "./shared";`. _Verified: barrel is 2 lines — re-exports the 11 lectura actions + `ActionResult` and `ReportesAccionesErrorCode` types._
- [x] **13.5** Verify: `pnpm exec tsc --noEmit` — exit 0. **This is the primary safety net here** (no tests). _Re-run on `master` @ `3d68ed0`, 2026-10-09: exit 0._
- [x] **13.6** Verify: `pnpm lint` — 0 errors, no regression. _Re-run 2026-10-09: exit 0 — 0 errors, 16 warnings._
- [x] **13.7** Verify: `pnpm build` — production build passes (catches broken `"use server"` surface). _Evidence: required `CI gate` (strict) was green on PR #93 before merge; build not re-run locally at archive._
- [x] **13.8** Explicitly enumerate every export before/after and diff the two lists — none lost, none invented. Record the lists in the PR description. _Verified 2026-10-09 from git: pre-split `actions.ts` exported 2 types (`ReportesAccionesErrorCode`, `ActionResult`) + 11 `consultar*` actions; the post-split barrel re-exports exactly the same 2 types + same 11 actions — none lost, none invented._
- [x] **13.9** Confirm sibling files are byte-identical to `master`; no BOM. _Verified: `git diff ea63d75^ 3d68ed0 -- app/src/modules/reportes/http/` touches only 3 files (barrel rewrite + 2 new); `validations.ts` absent from the diff. `shared.ts`/`actions.lectura.ts`/`actions.ts` no-BOM._
- [x] **13.10** Bump version PATCH + CHANGELOG entry referencing the PR number. _Landed: squash `ea63d75` carries `chore(release): bump version to 0.11.35`; CHANGELOG 0.11.35 references #93._
- [x] **13.11** PR with labels `type:refactor` + `size:exception`; merge with **Squash and merge** only. _Merged: PR #93 closed with `merged_at` 2026-10-06T22:12:44Z; labels verified via GitHub API._

**Rollback boundary:** `git revert ea63d75` — one revert restores the whole reportes module.

## Phase 14: venta/http Split — Single PR (Slice 9)

_venta actions at 329 lines, ~672 diff estimate — +68% over the 400 budget → **one PR with `size:exception`**._

_High fan-in: 5 UI-importing modules, VC path. Final slice of the change._

> **Delivered as a SINGLE PR: PR #94 → `3d68ed0`, version 0.11.36, merged 2026-10-06T22:29:56Z**
> with labels `type:refactor` + `size:exception` (GitHub API, verified 2026-10-09).
> Final module of the change; `master` HEAD at archive time.

- [x] **14.1** Create `app/src/modules/venta/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Venta>`, `VentaDto`. _Correction recorded 2026-10-09: actual `shared.ts` (41 lines) exports `ROLES_VENTA = ["Administrador", "Operador"]`, `VentaAccionesErrorCode`, `ActionResult<T>`, `ok`, **`fail`** (the plan said `error`; venta's failure helper is named `fail`) and `resolverCtx`. No `VentaDto` existed in the original file, so there was nothing to move verbatim._
- [x] **14.2** Create `app/src/modules/venta/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearVentaAction`, `actualizarVentaAction`, `desactivarVentaAction`). _Correction recorded 2026-10-09: escritura holds `crearVentaAction`, `actualizarVentaAction`, `cancelarVentaAction`, `confirmarVentaAction` — there is no `desactivarVentaAction` (the plan named it in error; venta cancels/confirmss, it does not deactivate)._
- [x] **14.3** Create `app/src/modules/venta/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarVentaAction`, `obtenerVentaAction`). _Correction recorded 2026-10-09: the actual read action is `listarVentasAction` (plural), plus `obtenerVentaAction`. Both present (159 lines)._
- [x] **14.4** Create `app/src/modules/venta/http/actions.ts` barrel: re-export both sides plus `export type { ActionResult } from "./shared";`. _Verified: barrel is 3 lines, re-exports only._
- [x] **14.5** Verify: `pnpm exec tsc --noEmit` — exit 0. _Re-run on `master` @ `3d68ed0`, 2026-10-09: exit 0._
- [x] **14.6** Verify: `pnpm lint` — 0 errors, no regression. _Re-run 2026-10-09: exit 0 — 0 errors, 16 warnings._
- [x] **14.7** Verify: `pnpm exec jest src/modules/venta/http/actions.test.ts`. _Correction recorded 2026-10-09: **no `actions.test.ts` exists for venta** (the plan assumed one). The module's unchanged `validations.test.ts` passes: re-run 2026-10-09 PASS._
- [x] **14.8** Verify: `pnpm build`. _Evidence: required `CI gate` (strict) was green on PR #94 before merge; build not re-run locally at archive._
- [x] **14.9** Confirm sibling files byte-identical to `master`; no BOM. _Verified: `git diff 3d68ed0^ 3d68ed0 -- app/src/modules/venta/http/` touches only the 4 split files; `validations.ts` and `validations.test.ts` absent from the diff. All four split files no-BOM._
- [x] **14.10** Confirm the 5 UI-importing modules still resolve every import through the barrel. _Verified 2026-10-09: `git grep` for `actions.lectura`/`actions.escritura` returns hits only inside each module's own `http/` dir; zero references from any UI or application file — all consumers resolve through the `actions.ts` barrel._
- [x] **14.11** Bump version PATCH + CHANGELOG entry referencing the PR number. _Landed: squash `3d68ed0` carries `chore(release): bump version to 0.11.36`; CHANGELOG 0.11.36 references #94._
- [x] **14.12** PR with labels `type:refactor` + `size:exception`; merge with **Squash and merge** only. _Merged: PR #94 closed with `merged_at` 2026-10-06T22:29:56Z; labels verified via GitHub API._

**Rollback boundary:** `git revert 3d68ed0` — one revert restores the whole venta module.

---

## Implementation Order

Slices are ordered by the design's rollout specification:
1. **Slice 0 first and alone** — ESLint security-control restoration. Must be green before any http/ slice widens the surface it governs. (done)
2. **Slice 1 (inventario) single PR** — under 400 budget, simplest case, establishes the per-slice shape pattern. (done)
3. **Slices 2–9 in order of increasing fan-in and estimated diff size.** The design specified each over-budget module be split into PR-A (shared.ts + escritura) then PR-B (lectura + barrel) on a feature-branch chain.

**Why this order:** The design explicitly states "Rollout order is Slice 0 first and alone — it is a security-control restoration and must be green before any further split widens the surface it governs." Slice 1 is next as the only single-PR slice (under 400 budget), which validates the per-slice shape without the complexity of sub-chains. Slices 2–9 follow in design order, so each child PR's diff contains only its own module's changes and remains independently revertible.

> **Correction 2026-10-09 (git evidence): no module ever merged as a 2-PR
> sub-chain.** Categoria's escritura *and* lectura halves both live in commit
> `3c7c63f`, squashed into PR #84 `bbeef04` together with the eslint fix and
> the inventario split — the planned sub-chain for Slice 2 never landed as
> separate PRs. The *order* is still honoured; only the 2-PR-per-module split
> never materialised. The fan-in rationale for the ordering stands:
> `cliente` → `compra` → `reportes` → `venta`, ending with the most-coupled
> modules.

## Delivery Strategy Divergence

The 18-PR `feature-branch-chain` described in the original forecast never
materialised. Actual delivery:

| Slice | Module | Delivery | PR | Merge SHA | Version |
|-------|--------|----------|----|-----------|---------|
| 0 | ESLint tenant-wrapper hardening | single PR | #84 | `bbeef04` | 0.11.29 |
| 1 | inventario | single PR (rides Slice 0 squash) | #84 | `bbeef04` (content commit `3c7c63f`) | 0.11.29 |
| 2 | categoria | Phases 3–4 collapsed into one commit | #84 | `bbeef04` (content commit `3c7c63f`) | 0.11.29 |
| 3 | proveedor | **single PR** + `size:exception` | **#87** | `40155a4` | 0.11.30 |
| 4 | cobros | **single PR** + `size:exception` | **#88** | `6fbe9d3` | 0.11.31 |
| 5 | producto | **single PR** + `size:exception` | **#89** | `56bd574` | 0.11.32 |
| 6 | cliente | **single PR** + `size:exception` | **#91** | `dc8ce71` | 0.11.33 |
| 7 | compra | **single PR** + `size:exception` | **#92** | `3a51969` | 0.11.34 |
| 8 | reportes | **single PR** + `size:exception` (read-only) | **#93** | `ea63d75` | 0.11.35 |
| 9 | venta | **single PR** + `size:exception` (final module) | **#94** | `3d68ed0` | 0.11.36 |

> Backfilled 2026-10-09 from git history during archive. **Slices 1–2:** both
> landed inside PR #84's squash commit `bbeef04` — their content is commit
> `3c7c63f` ("split inventario and categoria … (slices 1, 2a)"), which contains
> inventario's four split files **and** categoria's escritura *and* lectura
> halves together, i.e. the planned categoria 2-PR sub-chain never merged as
> separate PRs. **Slices 6–9:** SHAs are the squash commits on `master`
> (verified present on GitHub `master`, which matches local byte-for-byte).
> The CHANGELOG links PR-*head* SHAs (e.g. `06b1862` for #91, `c20ac0b` for
> #94) which are pre-squash commits and intentionally differ from the table.

Working rules adopted from Slice 3 onward:

- **1 PR per module**, never a sub-chain. Branch `refactor/<module>-http-split`
  cut from `origin/master`, one split commit + one `chore(release)` bump commit.
- Labels on every PR: `type:refactor` + **`size:exception`** (maintainer-approved
  over-budget review; the 400-line policy is unchanged, the exception is per-PR).
- **Squash and merge only.** Merge title carries the conventional commit subject.
- Branch protection requires `CI gate` **strict** + `enforce_admins`; the
  requirement for an approving review was **removed 2026-10-06** at the
  maintainer's request, so the acting agent may merge its own PR.
- After each merge: cut the annotated tag `v<version>` on the squash commit
  (`release v<version>`) and publish the GitHub Release with an **ASCII-only**
  body (no accented characters — avoids mojibake in the release feed).

## Progress

**Slices 0–5 (Phases 1–10) complete and merged** (mid-change snapshot verified 2026-10-06, `master` @ `56bd574`, version `0.11.32`):

- Slice 0 (Phase 1) — ESLint `server-action-must-wrap-tenant` widened to `actions.*.ts` + test early-return. PR #84 → `bbeef04`.
- Slice 1 (Phase 2) — `inventario/http` split into `shared.ts` + `actions.lectura.ts` + `actions.escritura.ts` + barrel. _Backfill 2026-10-09: landed inside PR #84 → `bbeef04` (content commit `3c7c63f`), version 0.11.29._
- Slice 2 (Phases 3–4) — `categoria/http` split into the same shape. _Correction 2026-10-09: git shows both halves in the single commit `3c7c63f` inside PR #84 — the planned 2-PR sub-chain never merged as separate PRs._
- Slice 3 (Phases 5–6) — `proveedor/http` split, **single PR #87 → `40155a4`**, version 0.11.30.
- Slice 4 (Phases 7–8) — `cobros/http` split, **single PR #88 → `6fbe9d3`**, version 0.11.31.
- Slice 5 (Phases 9–10) — `producto/http` split, **single PR #89 → `56bd574`**, version 0.11.32.

Verification evidence for Phases 1–4 (run locally on `master` @ `d1dafbd`):

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm lint` | 0 errors, 16 pre-existing warnings (`auth`, `devolucion` only) |
| `pnpm test` | 119 suites / 1162 tests passed |
| `pnpm build` | exit 0 |
| Action inventory diff | inventario 2 → 2, categoria 4 → 4 — **none lost, none invented** |

Verification evidence for Slice 5 / producto (PR #89):

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm lint` | 0 errors, 16 pre-existing warnings (no regression) |
| `pnpm exec jest src/modules/producto/http/actions.test.ts` | 20/20 tests passed |
| `pnpm build` | compiled + 12/12 static pages |
| `gga` code review | PASSED |
| CI on PR #89 | `CI gate` success |
| CI on `master` post-merge | `CI gate` success |
| Split result | `shared.ts` 22 · `actions.lectura.ts` 76 · `actions.escritura.ts` 179 · `actions.ts` 3 — `validations.ts` and `actions.test.ts` byte-identical |

**Delivery strategy diverged from the plan above.** The intended 18-PR
`feature-branch-chain` never happened: Slices 0–2 landed inside PR #84's
squash, and Slices 3–9 each landed as a single PR with `size:exception`.
Treat the chain description as historical design intent, not as the
structure to resume.

**All 10 slices (0–9) are complete and merged into `master`**
(verified 2026-10-09, `master` @ `3d68ed0`, version `0.11.36`):

- Slice 6 (Phase 11) — `cliente/http` split, **single PR #91 → `dc8ce71`**, version 0.11.33.
- Slice 7 (Phase 12) — `compra/http` split, **single PR #92 → `3a51969`**, version 0.11.34.
- Slice 8 (Phase 13) — `reportes/http` split (read-only: shared + lectura + barrel, no escritura), **single PR #93 → `ea63d75`**, version 0.11.35.
- Slice 9 (Phase 14) — `venta/http` split, **single PR #94 → `3d68ed0`**, version 0.11.36 — final module.

Verification evidence for Phases 11–14 (re-run on `master` @ `3d68ed0`, 2026-10-09, during archive):

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm lint` | 0 errors, 16 pre-existing warnings (`auth`, `devolucion` — no regression) |
| `pnpm exec jest` (cliente/compra/venta module tests) | 4 suites / 46 tests passed, exit 0 |
| `git diff <split>^ 3d68ed0 -- <module>/http/` | each module: only its own split files changed; tests/validations byte-identical |
| BOM check (12 split files, 11 present + reportes escritura N/A) | none start with `EF BB BF` |
| Barrel isolation grep (`actions.lectura`/`actions.escritura`) | hits only inside each module's own `http/` dir — zero outside references |
| PRs #91–#94 (GitHub API) | closed with `merged_at` 2026-10-06; labels `type:refactor` + `size:exception`; squash commits on `master` match subjects |
| Production build | not re-run locally at archive; required `CI gate` (strict) was green on each merged PR |

## Next Step

**None — all phases complete; change archived 2026-10-09** to
`openspec/changes/archive/2026-10-09-refactor-selective-backend-organization/`
after delta-spec sync. Both open housekeeping items are resolved:

- *Review Workload Forecast* table left intact as historical forecast (status
  note at the top of this file governs).
- Slice-1 / slice-2 PR numbers backfilled in *Delivery Strategy Divergence*
  (both rode PR #84 / `bbeef04` / 0.11.29).

`master` is branch-protected: every PR needs the `CI gate` check green with
`strict: true`, plus `enforce_admins`. **The one-approving-review requirement
was removed on 2026-10-06** at the maintainer's request — an agent may merge
its own PR. Plan each slice as a branch + PR, never a direct push to `master`.
