# Tasks: refactor-selective-backend-organization

## Review Workload Forecast

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

## Phase 5: proveedor/http Sub-Chain — PR A (Slice 3, Part 1)

_proveedor actions at 231 lines, ~476 diff estimate — +19% over 400 budget, requires 2-PR sub-chain._

- [ ] **5.1** Create `app/src/modules/proveedor/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Proveedor>`, `ProveedorDto`, `ROLES_GESTION_PROVEEDOR`.
- [ ] **5.2** Create `app/src/modules/proveedor/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearProveedorAction`, `actualizarProveedorAction`, `desactivarProveedorAction`).
- [ ] **5.3** Create `app/src/modules/proveedor/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [ ] **5.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build` — same pattern as Phase 3-4.

**Rollback boundary:** `git revert <slice-3A-sha>` — discards partial split.

## Phase 6: proveedor/http Sub-Chain — PR B (Slice 3, Part 2)

- [ ] **6.1** Create `app/src/modules/proveedor/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarProveedorAction`, `obtenerProveedorAction`).
- [ ] **6.2** Update `app/src/modules/proveedor/http/actions.ts` barrel: add lectura exports.
- [ ] **6.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/proveedor/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** `git revert <slice-3B-sha>` — restores original layout.

## Phase 7: cobros/http Sub-Chain — PR A (Slice 4, Part 1)

_cobros actions at 202 lines, ~418 diff estimate — +5% over 400 budget, requires 2-PR sub-chain._

- [ ] **7.1** Create `app/src/modules/cobros/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Pago>`, `PagoDto`, `ROLES_COBROS`, `ROLES_REEMBOLSO`.
- [ ] **7.2** Create `app/src/modules/cobros/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearCobroAction`, `actualizarCobroAction`, `desactivarCobroAction`).
- [ ] **7.3** Create `app/src/modules/cobros/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [ ] **7.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.

**Rollback boundary:** `git revert <slice-4A-sha>`.

## Phase 8: cobros/http Sub-Chain — PR B (Slice 4, Part 2)

- [ ] **8.1** Create `app/src/modules/cobros/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarCobroAction`, `obtenerCobroAction`).
- [ ] **8.2** Update `app/src/modules/cobros/http/actions.ts` barrel: add lectura exports.
- [ ] **8.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/cobros/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** `git revert <slice-4B-sha>`.

## Phase 9: producto/http Sub-Chain — PR A (Slice 5, Part 1)

_producto actions at 250 lines, ~514 diff estimate — +29% over 400 budget, requires 2-PR sub-chain._

- [ ] **9.1** Create `app/src/modules/producto/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Producto>`, `ProductoDto`.
- [ ] **9.2** Create `app/src/modules/producto/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions.
- [ ] **9.3** Create `app/src/modules/producto/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [ ] **9.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.

**Rollback boundary:** `git revert <slice-5A-sha>`.

## Phase 10: producto/http Sub-Chain — PR B (Slice 5, Part 2)

- [ ] **10.1** Create `app/src/modules/producto/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarProductoAction`, `obtenerProductoAction`).
- [ ] **10.2** Update `app/src/modules/producto/http/actions.ts` barrel: add lectura exports.
- [ ] **10.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/producto/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** `git revert <slice-5B-sha>`.

## Phase 11: cliente/http Sub-Chain — PR A (Slice 6, Part 1)

_cliente actions at 260 lines, ~534 diff estimate — +34% over 400 budget, requires 2-PR sub-chain. Contains the two-stage credit check in `actualizarClienteAction` which must survive as a unit inside a single action body (cliente/http/actions.ts:209-222)._

- [ ] **11.1** Create `app/src/modules/cliente/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Cliente>`, `ClienteDto`, `ROLES_GESTION_CLIENTES`, `ROLES_ADMIN_ONLY`. **Constraint**: `toDto(c: Cliente): ClienteDto` is synchronous (no `async`); `ROLES_GESTION_CLIENTES = ["Administrador", "Operador"]` and `ROLES_ADMIN_ONLY = ["Administrador"]` are constants. Do NOT force `async` — the design explicitly removes the directive from shared.ts to avoid this anti-pattern.
- [ ] **11.2** Create `app/src/modules/cliente/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearClienteAction`, `actualizarClienteAction`, `desactivarClienteAction`). **Critical**: The two-stage credit check (`llevaCamposDeCredito(...)` then second `tieneRolPermitidoEnTx` with `ROLES_ADMIN_ONLY`) at lines 209-222 must survive as a single contiguous body inside one action — may NOT be split across two modules.
- [ ] **11.3** Create `app/src/modules/cliente/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [ ] **11.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.

**Rollback boundary:** `git revert <slice-6A-sha>` — preserves the two-stage credit check integrity.

## Phase 12: cliente/http Sub-Chain — PR B (Slice 6, Part 2)

- [ ] **12.1** Create `app/src/modules/cliente/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarClienteAction`, `obtenerClienteAction`).
- [ ] **12.2** Update `app/src/modules/cliente/http/actions.ts` barrel: add lectura exports. Final form matches the design barrel pattern.
- [ ] **12.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/cliente/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** `git revert <slice-6B-sha>`.

## Phase 13: compra/http Sub-Chain — PR A (Slice 7, Part 1)

_compra actions at 339 lines, ~692 diff estimate — +73% over 400 budget, requires 2-PR sub-chain. Highest blast radius: 17 application importers, purchase/NCF path. Fan-in 17 makes this the most-coupled http/ module._

- [ ] **13.1** Create `app/src/modules/compra/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Compra>`, `CompraDto`, `ROLES_COMPRA`. `ROLES_COMPRA = ["Administrador"]` (Administrador-only).
- [ ] **13.2** Create `app/src/modules/compra/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearCompraAction`, `actualizarCompraAction`, `desactivarCompraAction`). Note: compra has no two-stage credit check; simpler authorization gate.
- [ ] **13.3** Create `app/src/modules/compra/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [ ] **13.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.

**Rollback boundary:** `git revert <slice-7A-sha>`.

## Phase 14: compra/http Sub-Chain — PR B (Slice 7, Part 2)

- [ ] **14.1** Create `app/src/modules/compra/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarCompraAction`, `obtenerCompraAction`).
- [ ] **14.2** Update `app/src/modules/compra/http/actions.ts` barrel: add lectura exports.
- [ ] **14.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/compra/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** `git revert <slice-7B-sha>`.

## Phase 15: reportes/http Sub-Chain — PR A (Slice 8, Part 1)

_reportes actions at 294 lines, ~602 diff estimate — +51% over 400 budget, requires 2-PR sub-chain. Medium-high risk: fan-in 11, UI-wired (yes), no test coverage per design risk table._

- [ ] **15.1** Create `app/src/modules/reportes/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Reporte>`, `ReporteDto`.
- [ ] **15.2** Create `app/src/modules/reportes/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions.
- [ ] **15.3** Create `app/src/modules/reportes/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [ ] **15.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.

**Rollback boundary:** `git revert <slice-8A-sha>`.

## Phase 16: reportes/http Sub-Chain — PR B (Slice 8, Part 2)

- [ ] **16.1** Create `app/src/modules/reportes/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarReporteAction`, `obtenerReporteAction`).
- [ ] **16.2** Update `app/src/modules/reportes/http/actions.ts` barrel: add lectura exports.
- [ ] **16.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/reportes/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** `git revert <slice-8B-sha>`.

## Phase 17: venta/http Sub-Chain — PR A (Slice 9, Part 1)

_venta actions at 329 lines, ~672 diff estimate — +68% over 400 budget, requires 2-PR sub-chain. High fan-in: 5 UI-importing modules, VC path._

- [ ] **17.1** Create `app/src/modules/venta/http/shared.ts` with pure helpers. No `"use server"` directive. Exports: `ok`, `error`, `ActionResult<Venta>`, `VentaDto`.
- [ ] **17.2** Create `app/src/modules/venta/http/actions.escritura.ts` with `"use server"` directive. Move verbatim: write actions (`crearVentaAction`, `actualizarVentaAction`, `desactivarVentaAction`).
- [ ] **17.3** Create `app/src/modules/venta/http/actions.ts` barrel with ONLY escritura exports + ActionResult type.
- [ ] **17.4** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.

**Rollback boundary:** `git revert <slice-9A-sha>`.

## Phase 18: venta/http Sub-Chain — PR B (Slice 9, Part 2)

- [ ] **18.1** Create `app/src/modules/venta/http/actions.lectura.ts` with `"use server"` directive. Move verbatim: read actions (`listarVentaAction`, `obtenerVentaAction`).
- [ ] **18.2** Update `app/src/modules/venta/http/actions.ts` barrel: add lectura exports.
- [ ] **18.3** Verify: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm exec jest src/modules/venta/http/actions.test.ts`, `pnpm build`, `pnpm lint:commits`.

**Rollback boundary:** `git revert <slice-9B-sha>`.

---

## Implementation Order

Slices are ordered by the design's rollout specification:
1. **Slice 0 first and alone** — ESLint security-control restoration. Must be green before any http/ slice widens the surface it governs.
2. **Slice 1 (inventario) single PR** — under 400 budget, simplest case, establishes the per-slice shape pattern.
3. **Slices 2–9 as feature-branch sub-chains** — each over-budget module split into PR-A (shared.ts + escritura) then PR-B (lectura + barrel completion), in order of increasing fan-in and estimated diff size. The feature branch chain structure means: PR #1 (Slice 0) targets main, PR #2 (Slice 1) targets the feature branch, PR 3A (Slice 2-A) targets PR 2's branch, PR 3B targets 3A's branch, and so on through all 18 PRs.

**Why this order:** The design explicitly states "Rollout order is Slice 0 first and alone — it is a security-control restoration and must be green before any further split widens the surface it governs." Slice 1 is next as the only single-PR slice (under 400 budget), which validates the per-slice shape without the complexity of sub-chains. Slices 2–9 follow in design order, each as a 2-PR sub-chain on the same feature branch, so each child PR's diff contains only its own module's changes and remains independently revertible.

## Progress

**Slices 0, 1, 2a and 2b are complete and merged into `master`** (verified 2026-10-05):

- Slice 0 (Phase 1) — ESLint `server-action-must-wrap-tenant` widened to `actions.*.ts` + test early-return.
- Slice 1 (Phase 2) — `inventario/http` split into `shared.ts` + `actions.lectura.ts` + `actions.escritura.ts` + barrel.
- Slice 2 (Phases 3–4) — `categoria/http` split into the same shape.

Verification evidence for Phases 1–4 (run locally on `master` @ `d1dafbd`):

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm lint` | 0 errors, 16 pre-existing warnings (`auth`, `devolucion` only) |
| `pnpm test` | 119 suites / 1162 tests passed |
| `pnpm build` | exit 0 |
| Action inventory diff | inventario 2 → 2, categoria 4 → 4 — **none lost, none invented** |

**Delivery strategy diverged from the plan below.** The intended 18-PR `feature-branch-chain`
never happened: Slices 0–2 landed through ordinary PRs targeting `master` directly.
Treat the chain description in *Implementation Order* as historical design intent,
not as the structure to resume.

## Next Step

**Phase 5 — `proveedor/http` Sub-Chain, PR A (Slice 3, Part 1)**, then PR B (Phase 6).
Remaining scope: Phases 5–18 = 49 tasks across proveedor, cobros, producto, cliente,
compra, reportes and venta.

`master` is now branch-protected: every PR needs the `CI gate` check green and
**one approving review** — the acting agent cannot approve its own PR.
Plan each slice as a branch + PR, not a direct push.