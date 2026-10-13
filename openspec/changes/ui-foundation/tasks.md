# Tasks: ui-foundation (F0 — UI foundation)

SDD phase: tasks. Binding inputs: `design.md` (D1–D7), 4 delta specs (`tokens`, `ui-primitives`, `format`, `app-shell`), Engram `sdd/ui-foundation/{design,spec,proposal}` (project: systemfact).

Delivery strategy: **single-pr** (owner-ratified). Design D5 fixes the commit sequence: shadcn init BEFORE the authored token layer (spec `ui-primitives` "CLI-first order preserved" scenario). Every commit is its own green gate (lint + `tsc --noEmit` + scoped tests + `pnpm build`, run from `app/`). No `"typecheck"` script exists — `pnpm exec tsc --noEmit` is invoked directly.

Global rules for every task:
- Windows PowerShell 5.1: never `Set-Content -Encoding UTF8` on machine-consumed files (`package.json`, `components.json`, `globals.css`, `tsconfig.json`, YAML). Write with `[IO.File]::WriteAllText(..., UTF8Encoding($false))` and verify `bytes[0] -ne 0xEF` (AGENTS.md BOM rule; root cause of the PR #59 CI break).
- Quoted paths for `git mv` when parentheses are involved.
- Zero `any`, strict TS; Conventional Commits only; no AI attribution.
- YAGNI guardrails D7 apply verbatim: no tailwind.config.js, no extra primitives, no toggle UI, no fake routes, no locale knobs, `reportes/domain/dgii/formato.ts` untouched.

Legend: txn = `app/` workspace.

---

## Slice A — Commit 1: shadcn init chore

**Commit title**: `chore(ui): shadcn init (Tailwind 4 CSS-first)`

- [ ] 1.1 From `app/`: run `npx shadcn@latest init -d -y`. Prerequisite already satisfied: `@/* → ./src/*` alias exists in `app/tsconfig.json`. If the CLI balks at Next 16.3.3 / pnpm 11, execute the manual fallback recipe from D2.2 instead (do not debug the CLI — timebox and switch):
  - [ ] 1.1a Write `app/components.json` verbatim per D2.2 (style `new-york`, Tailwind v4 mode with `"config": ""`, `css: "src/app/globals.css"`, no-BOM write).
  - [ ] 1.1b `pnpm add tw-animate-css class-variance-authority lucide-react clsx tailwind-merge` in `app/package.json` (D2.1 flags `clsx` + `tailwind-merge` as always-required `cn()` transitive deps omitted from the spec list — they MUST land in this commit).
  - [ ] 1.1c Create `app/src/lib/utils.ts` with canonical `cn()` = `twMerge(clsx(...inputs))`.
- [ ] 1.2 `npx shadcn@latest add button input label card table dialog badge select` → vendored to `app/src/components/ui/{button,input,label,card,table,dialog,badge,select}.tsx` + `app/src/hooks/use-mobile.ts` (select dependency). Remove anything `add` drops beyond those files; inventory MUST be exactly eight primitives (spec `ui-primitives` "Primitive inventory is exactly eight").
- [ ] 1.3 Accept shadcn's generated primitive var layer in `app/src/app/globals.css` (vendor, ~+80 lines — HSL/oklch `--background/--foreground/...` names). Do NOT edit or hand-merge in this commit; the token commit replaces them (D1.2).

## Verification (Slice A)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm build
# BOM gate: no EF BB BF on globals.css / components.json / tsconfig.json / package.json
# Grep gates: zero "tailwind.config.js" anywhere; exactly 8 files in src/components/ui/
```

**Rollback boundary**: revert the commit; `pnpm-lock.yaml` and `package.json` revert with it. No authored tokens exist yet, so nothing downstream depends on this slice. `positives.json`-style cleanup: delete `app/components.json` + `src/lib/utils.ts` on revert (they arrive with init).

---

## Slice B — Commit 2: tokens + font

**Commit title**: `feat(ui): F0.1 semantic token registry + Source Sans 3`

- [ ] 2.1 `app/src/app/globals.css`: DELETE shadcn's unratified HSL/oklch `:root`/`.dark` var names (`--background`, `--foreground`, `--card`, `--primary`, …) — replaced, not reconciled (D1.2). Also delete the pre-existing legacy un-ratified dark `:root` media block and any `Arial` font-family declaration (spec `tokens` "Legacy styling dead weight is gone").
- [ ] 2.2 `app/src/app/globals.css`: append the 14-var light registry in `:root` with the exact Penpot values (D1.3: `--ink:#2b2b2b`, `--ink-muted:#666666`, `--surface:#ffffff`, `--surface-muted:#f2f2f2`, `--surface-raised:#e8e8e8`, `--line:#e0e0e0`, `--accent:#2e7d32`, `--accent-fg:#ffffff`, `--warn:#856404`, `--warn-bg:#fff3cd`, `--link:#0066cc`, `--danger:#8b0000`, `--success-bg:#e8f5e9`).
- [ ] 2.3 `app/src/app/globals.css`: author the DARK block ONCE, applied via two pure-CSS triggers, byte-equal values: `@media (prefers-color-scheme: dark) { :root { … } }` (F0 default, zero JS) AND `.dark { … }` AFTER the media block (later block wins at equal specificity). Values per D1.3 (`--ink:#e8e8e8`, `--accent:#66bb6a`, `--accent-fg:#1a1a1a`, `--warn:#ffd54f`, `--warn-bg:#3a3020`, `--link:#7fb8ff`, `--danger:#ff6e6e`, `--success-bg:#17331d`, surface family `#1a1a1a/#242424/#2e2e2e/#3d3d3d`, `--ink-muted:#a3a3a3`).
- [ ] 2.4 `app/src/app/globals.css`: add `@theme inline` mapping the 13 color vars to semantic utilities (`--color-ink: var(--ink)` … `--color-success-bg: var(--success-bg)`) plus `--font-sans: var(--font-source-sans)`. NO `@custom-variant dark` (D1.6; zero `dark:` utilities in F0). NO `tailwind.config.js`.
- [ ] 2.5 `app/src/app/layout.tsx`: swap to `Source_Sans_3` from `next/font/google` (weights 400/700, `variable: "--font-source-sans"`); delete Geist + Geist_Mono imports and the `--font-mono` @theme entry. Root html becomes `<html lang="es" className={`${sourceSans.variable} h-full antialiased`}>` (D1.7).

## Verification (Slice B)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm build   # spec scenario "Utilities are emitted from @theme": bg-accent resolves #2e7d32 in light; no tailwind.config.js
# Grep gates: zero "Geist", zero "Arial", zero "tailwind.config.js" in app/
# BOM gate on globals.css (rule verified after every rewrite)
# Token YAGNI: only ratified families present; no toggle UI refs
```

**Rollback boundary**: this commit is self-contained — reverting returns globals.css/layout.tsx to the Slice A vendored state. Primitives (Slice C) and formatters reference tokens only AFTER this lands; safe revert point.

---

## Slice C — Commit 3: primitive bind

**Commit title**: `refactor(ui): bind the eight primitives to semantic tokens (touch-first)`

- [ ] 3.1 For each of `app/src/components/ui/{button,input,label,card,table,dialog,badge,select}.tsx`: rename shadcn color/utility names (`bg-primary`, `text-primary-foreground`, `border-input`, `text-muted-foreground`, `bg-secondary`, `ring-ring`, …) to the semantic set: `bg-accent text-accent-fg`, `text-ink`, `text-ink-muted`, `border-line`, `bg-surface*`, `ring-link`. After editing: ZERO `slate-*`/`gray-*`/hex literals in any of the 8 files (spec "No raw grays in primitives").
- [ ] 3.2 `app/src/components/ui/button.tsx`: set Button CVA sizes — default `h-11` (44px hitbox floor), `pos`/high-frequency variant `h-12` (48px), a compact variant reserved (icon-only dense desktop lists) still ≥ 44px envelope (spec "Button sizes meet the hitbox floor").
- [ ] 3.3 Touch spacing: primitives/adjacent-interactive default vertical gap at the 8px token (`gap-2`) — no sub-8px requirement between touch targets; encoded as primitive sizing, not screen-level class stacking (spec "Spacing rhythm is tokenized").
- [ ] 3.4 No per-primitive `dark:` overrides — dark is handled entirely by the token registries (spec "Dark mode needs no primitive edits").

## Verification (Slice C)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm build
# Grep gates: 0 occurrences of slate-/gray-/hex literals in src/components/ui/*.tsx
# Inventory gate: exactly 8 primitive files
# CVA gate: Button heights read h-11 (default) / h-12 (high-frequency) / ≥44px compact
```

**Rollback boundary**: revert restores vendored class names; no consumers exist yet (screens are NOT rewired in F0), so revert is behavior-neutral.

---

## Slice D — Commit 4: formatter consolidation

**Commit title**: `refactor(ui): consolidate DOP money + SD date formatters into shared/ui/format`

- [ ] 4.1 `app/src/package.json` deps: add `date-fns@^4` + `date-fns-tz@^3` (pinned exact patch via lockfile, D3.2).
- [ ] 4.2 NEW `app/src/shared/ui/format/money.ts`: export `formatearMonto(valor: string): string` — trim-gte then venta regex `^(\d+)(\.(\d{1,2}))?$`, pinned `Intl.NumberFormat("en-US")` grouping, pad decimals to 2, prefix `RD$ `; out-of-domain (`"garbage"`, `"1.234"`, `"-5"`, `""`) returned VERBATIM, never throws (D3.1). No decimal.js, no knobs.
- [ ] 4.3 NEW `app/src/shared/ui/format/date.ts`: export `formatearFechaSD(valor: string | Date): string` — full ISO/Date → `formatInTimeZone(date, "America/Santo_Domingo", "dd/MM/yyyy")` (date-fns-tz, zero manual hour math); bare `YYYY-MM-DD` (regex-gated) → same day, NO tz shift; `""`/invalid → `"—"` (D3.1).
- [ ] 4.4 NEW `app/src/shared/ui/format/money.test.ts` — venta's `formatearMonto` suite moves here, asserts rewritten to expect the `RD$` prefix; cobros `/1,234\.50/`+`/RD\$/` regex assertions fold in as exact-string asserts. NEW `date.test.ts` — the 4 spec scenarios (UTC→SD off-by-one `2026-01-01T02:30:00Z→31/12/2025`, same-day instant, bare `2026-01-31→31/01/2026` no-shift, `—` fallback).
- [ ] 4.5 DELETE `app/src/modules/cobros/ui/format.ts` + `app/src/modules/cobros/ui/format.test.ts`; DELETE `app/src/modules/venta/ui/fecha.ts`; DELETE the `formatearMonto` export from `app/src/modules/venta/ui/carro.ts`.
- [ ] 4.6 Rewire imports: `venta/ui/Totales.tsx`, `CartTable.tsx`, `DraftList.tsx` (drop the literal `RD$ ` prefix — output stays byte-identical; DraftList drops the `en-US medium` style in favor of `dd/MM/yyyy` — the intentional contract change per D3.4); cobros `PaymentForm.tsx`, `ReciboReprintScreen.tsx` (absorb its private `fechaSDDesdeISO()`), `EstadoDeCuentaScreen.tsx`, `CxcBoardScreen.tsx`; reportes panels (`rentabilidad-panel`, `operacional-panel`, `financiero-panel`, `fiscal-panel`, `dashboard-kpis`) re-import `formatearMonto` from shared.
- [ ] 4.7 `app/src/modules/reportes/ui/format.ts`: shrink to keep ONLY `formatearCantidad` + `formatearEntero` (quantities/integers out of F0 scope). `app/src/modules/reportes/domain/dgii/formato.ts` UNTOUCHED (fiscal fixed-width semantic, D7).

## Verification (Slice D)

```
cd app
pnpm exec jest src/shared/ui/format --runInBand   # new contract passes
pnpm test                                          # no dangling venta/cobros imports anywhere
pnpm lint
pnpm exec tsc --noEmit
pnpm build   # cobros/venta pages compile; display surfaces unchanged except ratified dd/MM/yyyy in DraftList
# Grep gates: zero occurrences of formatearMonto in src/modules/venta|cobros/ui; dgii/formato.ts diff empty
```

**Rollback boundary**: revert swaps import paths back; tests restored in their original suites. No money/state semantics touched (pure display). Safe revert even after Slice E lands planned after it — Slice E does not depend on formatter internals.

---

## Slice E — Commit 5: app shell + (app) route group

**Commit title**: `feat(ui): (app) route group + server application shell`

- [ ] 5.1 `git mv` the 5 route families, paths QUOTED (PowerShell treats `(` `)` specially): `src/app/venta|cobros|reportes|dashboard|auditoria` → `src/app/(app)/<same>` (D4.2). Zero page-code edits; Next 16 typed `PageProps`/`LayoutProps` are path-agnostic so nothing regenerates. `login/` stays OUTSIDE the group.
- [ ] 5.2 NEW `app/src/app/(app)/layout.tsx` (~25 LOC, Server Component): `createClient()` from `@/lib/supabase/client` (server) → `getCurrentTenantHeader` → `redirect("/login")` on null → render `AuthShell` with `{children}`.
- [ ] 5.3 `app/src/modules/tenant/infrastructure/tenant-runtime.ts`: add `getCurrentTenantHeader(supabase)` (~40 LOC) reusing EXISTING primitives verbatim — `resolverAuthSubDeSesion` + `buscarUsuarioPorAuthSub` from `@/modules/auth/infrastructure/auth-identity` — with a wider select that pulls Empresa/Sucursal `nombre` (verify the physical column is `nombre` per ERD v4.7; if it differs, e.g. `razonSocial`, adjust only the select paths). Returns `{ empresaId, sucursalId, usuarioId, esAdmin, empresaNombre, sucursalNombre } | null`. NO new auth APIs, NO new roles, NO mutation (D4.3).
- [ ] 5.4 NEW `app/src/shared/ui/app-shell/shell.tsx` (~60 LOC, Server): `<header>` always shows empresa + sucursal names (DOM-invariant, not scroll/viewport/role-toggled); server branch `{ctx.esAdmin && <span>Cambiar sucursal</span>}` — inert affordance placeholder, non-admins get ZERO markup (no hidden/CSS) (D4.4).
- [ ] 5.5 NEW `app/src/shared/ui/app-shell/sidebar.tsx` (~55 LOC, Server) + `BrowseItem.tsx`-style island `app/src/shared/ui/app-shell/SidebarItem.tsx` ("use client", ~15 LOC): `usePathname()` → active highlight ONLY; imports nothing beyond `usePathname`; receives NO `esAdmin` prop (D4.4 / spec "Role verdict lives server-side only").
- [ ] 5.6 Sidebar items array with exactly the 8 ratified labels in order: **Venta, Cobros, Inventario, Compras, Caja, Reportes, Administración, Auditoría** (spec "Module labels are exactly the ratified eight"). Links: Venta `/venta`, Cobros `/cobros`, Reportes `/reportes`, Auditoría `/auditoria`, plus Dashboard `/dashboard`; Inventario/Compras/Caja/Administración are inert reserved rows (`aria-disabled` non-link `<span>`) — NO fake routes/pages created (spec "No fake routes were created").
- [ ] 5.7 No collapsible persistence, breadcrumbs, notifications, user-profile UI; only the sanctioned nav island (theme hook placeholder optional seam) may be `"use client"`.

## Verification (Slice E)

```
cd app
pnpm lint
pnpm exec tsc --noEmit
pnpm build   # route group compiles; URLs remain /venta, /cobros, ...
pnpm exec jest --runInBand 2>$null   # workspace tests green (rename must not break imports)
# Manual walkthrough (server-rendered):
#  - /venta HTML contains shell header (empresa + sucursal) + sidebar with exactly 8 labels
#  - /login HTML has NO shell chrome
#  - credentials admin: "Cambiar sucursal" present in HTML; non-admin credential: NONE node in HTML
#  - Inventario/Compras/Caja/Administración rows inert (aria-disabled, no href)
# `git status` shows pure RENAMES for the 5 families (no rename/edit mixing)
```

**Rollback boundary**: largest slice, still isolated — `git revert` undoes layout/shell/`getCurrentTenantHeader` and moves routes back via reverse git-mv. No Server Actions/mutations/authorization logic exist to unwind (D7).

---

## Review Workload Forecast

Estimated changed lines (design D5 calibration, D2.3 gen-vs-authored accounting):

| Slice | Hand-authored | Vendored/generated | Notes |
|---|---|---|---|
| A (init chore) | ~+25 | ~+80 (css var layer) + ~700 (8 primitives) + ~15 (use-mobile) | CLI-run + lockfile churn; review is audit-not-line-by-line |
| B (tokens+font) | ~+90 / −55 | — | 14-var registries ×2 triggers |
| C (primitive bind) | ~+45 / −45 | — (edits vendored files) | class renames + CVA heights |
| D (formatters) | ~+190 / −35 | — | 2 formatters + 2 test suites + ~12 rewired imports |
| E (shell+routegroup) | ~+150 | — | + git rename diffs (semantically zero page LOC) |
| **Total** | **~350–450 authored (+ ~700 vendored)** | | |

- `Chained PRs recommended: No` — single-pr is owner-ratified for this cycle; the commits are sequenced and individually gated inside the one PR.
- `400-line budget risk: High` — the ~700 vendored shadcn primitive lines alone push the PR past the ≤400-line guideline even though the authored surface (~350–450) fits it. The vendored code is registry-verbatim (shadcn copy-paste model), so per-line review is not meaningful for it.
- `Decision needed before apply: Yes` — the owner MUST accept pre-apply (or at PR time) the repo `size:exception` note route per the chained-pr/size policy (design cites the vendored-lines overrun; recommend the standard exception note: "PR exceeds 400 lines due to ~700 vendored shadcn registry lines; authored delta ~350–450, review focus on B/C/D/E only, vendored slice A reviewed by inventory + 8-file grep gate"). Alternative rejected by default: splitting commit 1 into a vendored-PR would end single-pr without review benefit.
