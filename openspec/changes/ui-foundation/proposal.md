# Proposal: ui-foundation (F0 — UI foundation)

Store: hybrid (Engram topic `sdd/ui-foundation/proposal` + this file).
SDD phase: propose. Owner-ratified decisions from explore.md addendum (2026-10-13) are binding.

## Why

The frontend has no shared presentation foundation. Evidence from exploration:

- `globals.css` hardcodes Arial, carries a dark-mode media query with no ratified palette, and maps only `background`/`foreground` — no semantic tokens.
- Root layout loads Geist fonts (dead weight — the sole ratified font is Source Sans, renamed **Source Sans 3** on Google Fonts).
- Route tree is flat: no `(app)` route group, no header/sidebar shell; login and app pages sit side by side with no structural separation.
- venta/POS screens style with raw slate/gray one-offs instead of the ratified Penpot palette; money/date formatting is duplicated across `venta/ui/carro.ts`, `cobros/ui/format.ts`, and ad-hoc re-rolls in cobros/reportes.
- No touch-first conventions (44px hitboxes, 8px spacing) encoded anywhere.
- Penpot map (`design/penpot-frontend-map`) fixed the palette (#2b2b2b text, #2e7d32 accent, grays #f2f2f2/#e8e8e8/#e0e0e0), Source Sans Pro, shadcn/ui over Tailwind 4, and the F0→F9 phase ladder — F0 is its foundation.

Every subsequent phase (F1–F9) builds on these tokens, primitives, formatters, and the shell. Building them now prevents each feature phase from re-rolling its own divergent styling.

## What Changes

F0 = presentation infrastructure only. Four coordinated sub-slices, one PR (owner ratified single PR; estimated ~300–450 changed lines total):

### F0.1 — Design tokens + font
- Semantic Tailwind 4 CSS-first tokens in `app/src/app/globals.css` `@theme`: `--color-ink-*` (text), `--color-surface-*` (bg), `--color-line-*` (borders), `--color-accent` (#2e7d32), `--color-warn` (#856404 / bg #fff3cd), `--color-link` (#0066cc), `--color-danger` (#8b0000), `--color-success-bg` (#e8f5e9).
- **Light AND dark registries** (owner decision supersedes "light-only"): light = Penpot palette as base; dark = derived set tuned to WCAG AA contrast. Dark values are semantic-variable re-authoring inside `@theme`, validated for contrast — not an inversion.
- Switch mechanism: **`prefers-color-scheme` media query as default + a `.dark` class override hook** (shadcn-compatible convention). Justification: (a) zero JavaScript, follows OS out of the box — correct for a POS used on varied devices; (b) the class hook leaves the door open for a manual toggle in the user profile later without re-architecting tokens; (c) shadcn/dark: variant expects the class convention, so the hybrid satisfies both.
- Font: `Source_Sans_3` via `next/font/google` in root layout (weights 400 normal / 700 bold). Remove Geist imports, Arial fallback, and the old unratified dark-mode `:root` block.

### F0.2 — shadcn/ui base primitives
- `npx shadcn@latest init` **BEFORE** hand-authoring tokens (CLI rewrites globals.css primitive layer; running it first avoids token loss). Requires `@/* → ./src/*` tsconfig alias + `components.json`. Fallback if the CLI balks on Next 16.3.3: manual `components.json` + copy primitive sources (shadcn is copy-paste by design).
- Adopt exactly eight primitives the next phases need: **button, input, label, card, table, dialog, badge, select**. No more (YAGNI).
- Accept CLI deps: `tw-animate-css`, `class-variance-authority`, `lucide-react`.
- Encode touch-first as tokens/docs: min hitbox 44px (48px for high-frequency targets such as POS cart actions), 8px minimum spacing between touch targets. Applied via primitive sizing tokens (e.g. button heights), not ad-hoc classes.

### F0.3 — Shared formatters
- New `app/src/shared/ui/format/money.ts` (`formatearMonto` — RD$ display format, Intl grouping) and `date.ts` (`formatearFechaSD` — America/Santo_Domingo, dd/MM/yyyy, computed from UTC-stored timestamps via `date-fns-tz`; NO manual hour arithmetic per AGENTS.md).
- Rewire consumers: `venta/ui/carro.ts` re-exports removed — venta/ui imports from shared; `cobros/ui/format.ts` near-twin `formatearMontoDO` deleted and replaced; reportes generic `format.ts` usage absorbed where it duplicates the shared home.
- Move existing unit tests (`venta/ui/formatearMonto.test.ts` → `shared/ui/format/`). Mechanical behavior-preserving change.
- NOT moved: `reportes/domain/dgii/formato.ts` `formatearMonto` (DGII fixed-width fiscal export format) — different semantic, stays in its domain.

### F0.4 — App Shell + route group
- `app/src/shared/ui/app-shell/` server component: permanent header showing empresa + sucursal always visible; sidebar with the 8 modules (Venta, Cobros, Inventario, Compras, Caja, Reportes, Administración, Auditoría).
- "Cambiar sucursal" rendered server-side **only for Administrador role** — reuse existing server authorization (mirrors how `PosScreen` already receives `esAdmin`); do NOT invent new auth.
- Wiring: move `venta|cobros|reportes|dashboard|auditoria` under `app/src/app/(app)/` with `(app)/layout.tsx` rendering the shell. `login/` stays outside the group.
- Sidebar entries for Inventario/Compras/Caja point to future routes that do not exist yet — that is fine and expected; entries render as placeholders (non-functional or clearly disabled), no fake pages are created.
- Sidebar active-state highlight: one tiny `"use client"` island for the nav item, zero business logic.

**Cross-cutting (no code, documented):** UI hierarchy N1 (total venta, deuda pendiente, estado factura) recorded as usage guidance for all later phases, not as configuration.

## Impact

Files affected (est.):
- `app/src/app/globals.css` — rewritten: shadcn primitive layer + semantic `@theme` tokens, light+dark registries.
- `app/src/app/layout.tsx` — Source_Sans_3, remove Geist.
- `app/tsconfig.json`, `app/components.json` — path aliases, shadcn config.
- `app/package.json` — CLI-added deps.
- NEW `app/src/shared/ui/format/{money,date}.ts` + tests.
- NEW `app/src/shared/ui/app-shell/` (server shell + nav island).
- `app/src/ui/` files using moved formatters: venta/ui (carro.ts, Totales.tsx, CartTable, DraftList), cobros/ui (format.ts), reportes/ui.
- Route moves: `app/src/app/venta|cobros|reportes|dashboard|auditoria` → `(app)/…` (no page-code changes, only relocation).
- POS screens (`PosScreen.tsx` + children): token re-decoration only where trivially mechanical in this PR; full palette conversion of every screen is NOT F0 scope.

No changes to: any module `domain/`, `application/`, `infrastructure/`; no Server Actions; no schema/migrations.

## Risks

1. **shadcn CLI on Next 16.3.3** — CLI assumes latest Next conventions; may fail or rewrite unexpectedly. Treatment: run init first (before token authoring) and commit its globals.css changes as a step; manual components.json fallback is cheap (copy-paste philosophy).
2. **Dark derivation quality** — derived dark palette may miss AA contrast on some pairings (warn/success backgrounds especially). Treatment: validate pairs; document any intentional exceptions in tokens comments; CI typecheck + build only — full visual pass belongs to later feature phases using the tokens.
3. **Rewire regressions in venta/cobros** — formatters move touches POS rendering paths. Treatment: tests move with the formatters; mechanical import rewrites; verify Totales/Cobros panels render identical output before/after (snapshot or manual check against known values).

## Out of scope (explicit)

- No redesign of any existing screen (palette normalization beyond mechanical formatter re-wiring is deferred to each feature phase).
- No Server Actions, mutations, auth changes, or new authorization logic.
- No routes/pages for Inventario/Compras/Caja (no fake stubs).
- No Penpot boards for missing screens (F0.5, per feature phases).
- No manual dark-mode toggle UI (only the preference default + class hook).
- No `reportes/domain/dgii/formato.ts` relocation.
- No tailwind.config.js (Tailwind 4 is CSS-first; `@theme` only).

## Delivery Forecast

Single PR, ~300–450 changed lines inclusive of tests. Sequenced F0.1 → F0.2 → F0.3 → F0.4 so each sub-slice lands on green CI (typecheck, lint, unit tests, build). Phase F0 done = every later phase inherits one token system, eight primitives, two formatters, and the shell.
