# Exploration: ui-foundation (F0 — UI foundation)

Store: hybrid (Engram topic `sdd/ui-foundation/explore` + this file).
Read-only phase. No business code touched.

## Current frontend state (evidence)

- `app/package.json`: Next 16.3.3, React 19.2.8, `tailwindcss` v4 + `@tailwindcss/postcss` v4 only — **no tailwind.config.js** (v4 is CSS-first, config lives in `globals.css` `@theme`). No UI component library. No `lucide-react` / `class-variance-authority` yet (shadcn adds them).
- `app/src/app/globals.css`: minimal `@import "tailwindcss"` + `@theme inline` mapping only `background`/`foreground`. Body hardcodes **Arial** (violates ratified Source Sans Pro) and `:root` carries a **dark-mode media query** (`#0a0a0a` bg) with no ratified dark palette — must be removed; SystemFact is a light-only app.
- `app/src/app/layout.tsx`: loads **Geist** fonts (`--font-geist-sans`) = dead weight once Source Sans Pro becomes the sole font. No header/sidebar anywhere — root layout is bare (`min-h-full flex flex-col`).
- Route tree is flat (`app/venta`, `app/cobros`, `app/reportes`, `app/dashboard`, `app/auditoria`, `app/login`) — **no `(app)` route group, no shell layout**. Every module renders its own page without empresa/sucursal header.
- Login screen exists separately (`app/login/`); shell must NOT wrap it.

## Token divergences in venta/POS (diff-level)

- `PosScreen.tsx` and children style with raw Tailwind one-off colors/grays (e.g. `bg-slate-*`, spread hex utilities) instead of ratified palette (`#2b2b2b/#666/#f2f2f2/#e8e8e8/#e0e0e0`).
- Money shows as `RD$ {formatearMonto(valor)}` (Totales.tsx:17) — correct currency prefix, but formatting lives as an export of the cart model `carro.ts` (name collision hazard: it is NOT cart logic).
- `fecha.ts` pins `America/Santo_Domingo` via `Intl.DateTimeFormat` with `dateStyle:"medium"` → renders US medium style (`Oct 13, 2026`), **not the ratified dd/MM/yyyy**. Needs a shared day-format helper.
- No min-44px touch hitboxes / 8px target spacing conventions anywhere; buttons are ad-hoc heights.

## Helper relocation map (reuse, do not duplicate — already proving the need)

| Existing helper | Lives in | Used by | Duplicate hazard |
|---|---|---|---|
| `formatearMonto` (display, Intl grouping) | `venta/ui/carro.ts:180` | Totales, CartTable, DraftList (venta/ui) | `cobros/ui/format.ts` has near-twin `formatearMontoDO` |
| `formatearFechaSD` (medium date+time) | `venta/ui/fecha.ts` | POS screens | cobros/reportes each re-roll date rendering |
| `formatearMonto` (DGII fixed-width) | `reportes/domain/dgii/formato.ts` | 607/608 exports | **NOT a duplicate** — fiscal-width format, keeps its `domain/` home untouched |
| `format.ts` + `url.ts` | `reportes/ui` | reportes panels | absorb into shared where generic |

Destination: `app/src/shared/ui/format/money.ts` + `date.ts` (pure, presentation-only, unit-tested). `venta/ui` and `cobros/ui` re-export or import directly; DGII formatter stays in its fiscal domain.

## Seams decided for F0

1. **Design tokens** → `app/src/app/globals.css` `@theme` block (Tailwind 4 native, no config file). CSS variables only; keep `@theme inline` pattern for anything tiered. Semantic naming: `--color-ink-*` (text scale), `--color-surface-*` (bg), `--color-line-*` (borders), `--color-accent`, `--color-warn`, `--color-link`, `--color-danger`, `--color-success-bg`; `--spacing-*` quirks not needed (page pad 20px = `p-5`, gap 12 = `gap-3`, radius 8 = `rounded-lg` as token overrides). Font: `Source_Sans_3` via `next/font/google` in root layout (Google renamed "Source Sans Pro" → **Source Sans 3**; the original family slug is deprecated/unavailable — gotcha). Remove Geist + dark-mode block; drop the Arial fallback.
2. **AppShell** → `app/src/shared/ui/app-shell/` (server component: header with empresa + sucursal always visible; sidebar with the 8 modules; "Cambiar sucursal" branch-gated **server-side**, mirroring how `PosScreen` already receives `esAdmin`). Wiring via route group: move `venta|cobros|reportes|dashboard|auditoria` under `app/src/app/(app)/` with `(app)/layout.tsx` rendering the shell; `login/` stays outside.
3. **shadcn/ui on Tailwind v4**: supported by current shadcn CLI (`npx shadcn@latest init`) — generates CSS-variables theme compatible with v4 `@theme` and React 19 (no `forwardRef` issues). Requires path aliases in tsconfig (`@/* → ./src/*`) and `components.json`. Risk: init wants `tw-animate-css` dep + will rewrite globals.css primitive layer — do init BEFORE hand-authoring the Penpot `@theme` block, then merge tokens to avoid the CLI overwriting them.

## Phase boundaries (proposed)

- **F0.1 Tokens**: globals.css `@theme` (palette/type/radius), Source Sans 3 in root layout, delete Geist/dark-mode/Arial.
- **F0.2 shadcn base**: components.json + aliases + `tw-animate-css` + first primitives (Button, Input, Select, Badge, Dialog, Table) — small set only.
- **F0.3 Shared formatters**: `shared/ui/format/{money,date}` + move tests from `venta/ui/formatearMonto.test.ts`, update venta/cobros imports (mechanical, no behavior change).
- **F0.4 AppShell**: route group `(app)`, server shell, role-gated sucursal switch,sidebar nav for the 8 module names (routes may be stubs for unbuilt modules).
- **F0.5** (already planned in ratified memory `design/penpot-frontend-map`): Penpot boards for missing screens — runs after F0 as part of each feature phase.

## Risks / open questions

- **Tailwind v4 `@theme` syntax**: variables must be declared inside `@theme` (not `:root`) to emit utilities; the existing `@theme inline` indirection is only needed for dark-mode/etc — can be simplified away. Verify build after F0.1 (CI typecheck + `pnpm build`).
- **shadcn init on Next 16**: CLI assumes latest Next conventions; if it balks at 16.3.3, fall back to manual setup (components.json + copy primitive sources) — shadcn is copy-paste anyway.
- **BOM rule**: any write to versioned tooling files must avoid PowerShell BOM (AGENTS.md release convention).
- Open: does the sidebar highlight require pathname (client) — acceptable as tiny `"use client"` island, zero business logic.
- Open (owner decision pending): dark palette confirmed out of scope (light-only app).

## Owner addendum (2026-10-13, post-review)

1. **Dark mode IS in scope** (owner decision; supersedes 'light-only'): tokens are SEMANTIC (--color-surface, --color-text-primary, ...) with a light registry (Penpot palette as base) and a dark registry derived with WCAG AA contrast; class or prefers-color-scheme switch decided in specify/design.
2. **Date helper**: single shared formatter in src/shared/ui/format/ — DB stores UTC (already compliant), presentation layer renders America/Santo_Domingo dd/MM/yyyy; no manual hour arithmetic (AGENTS.md dates rule).
3. **Risk treatments ratified**: Source_Sans_3 via next/font; shadcn init BEFORE token authoring (or manual components.json fallback); tokens inside @theme only; UTF-8 no-BOM writes; relocate formatters to shared home and rewire both modules.
