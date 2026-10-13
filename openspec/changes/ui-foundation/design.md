# Design: ui-foundation (F0 — UI foundation)

SDD phase: design. Inputs: `proposal.md`, 4 delta specs (`tokens`, `ui-primitives`, `format`, `app-shell`),
Engram `sdd/ui-foundation/{explore,proposal}`, `design/penpot-frontend-map` (#1086), and code ground
truth (`app/src/app/globals.css`, `app/src/app/layout.tsx`, route tree, venta/cobros formatters + their
tests, `tenant-runtime.ts` / `TenantCtx`, `auth-identity.ts`, `app/package.json` + `tsconfig.json`).
Artifacts in English. All WCAG ratios below were computed with the WCAG 2.x relative-luminance formula.

---

## D1 — Token architecture (globals.css `@theme` + light/dark registries)

### Mechanism (Tailwind 4 CSS-first, zero JS)

```css
@import "tailwindcss";

/* Runtime semantic vars — LIGHT registry */
:root {
  --ink: #2b2b2b;
  --ink-muted: #666666;
  --surface: #ffffff;
  --surface-muted: #f2f2f2;
  --surface-raised: #e8e8e8;
  --line: #e0e0e0;
  --accent: #2e7d32;
  --accent-fg: #ffffff;
  --warn: #856404;
  --warn-bg: #fff3cd;
  --link: #0066cc;
  --danger: #8b0000;
  --success-bg: #e8f5e9;
}

/* Dark registry — authored ONCE, applied via two pure-CSS triggers.
   The media query is the F0 default (OS preference, first paint, no JS);
   the .dark class hook is FUTURE toggle plumbing, currently dormant. */
@media (prefers-color-scheme: dark) {
  :root { /* dark values (same 14 var names) */ }
}
.dark { /* dark values — MUST be authored after the media block (equal
           specificity :root vs .dark; later block wins deterministically) */ }

/* Tailwind 4 token mapping — `inline` so utilities emit var(--ink) references and
   runtime overrides in :root/.dark/media-query propagate. No tailwind.config.js. */
@theme inline {
  --color-ink: var(--ink);
  --color-ink-muted: var(--ink-muted);
  --color-surface: var(--surface);
  --color-surface-muted: var(--surface-muted);
  --color-surface-raised: var(--surface-raised);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-warn: var(--warn);
  --color-warn-bg: var(--warn-bg);
  --color-link: var(--link);
  --color-danger: var(--danger);
  --color-success-bg: var(--success-bg);
  --font-sans: var(--font-source-sans); /* next/font variable from layout.tsx */
}
body { background: var(--surface); color: var(--ink); font-family: var(--font-source-sans), sans-serif; }
```

- **Decision 1.1 — variable set (14).** `ink`, `ink-muted`, `surface`, `surface-muted`,
  `surface-raised`, `line`, `accent`, `accent-fg`, `warn`, `warn-bg`, `link`, `danger`,
  `success-bg` + `--font-sans`. Light values are exactly the Penpot ratified palette
  (#2b2b2b/#666 grays, #f2f2f2/#e8e8e8/#e0e0e0, #2e7d32 accent, #856404/#fff3cd, #0066cc,
  #8b0000, #e8f5e9). Tradeoff: `accent-fg` is an addition beyond the spec-shall list — it is
  required so text on `bg-accent` is readable in BOTH registries (see ratios below), stays
  inside the accent family, and replaces every `text-white`-on-green one-off.
- **Decision 1.2 — shadcn `:root`/`.dark` HSL vars are REPLACED, not reconciled.** shadcn
  init's template writes oklch/HSL `--background/--foreground/--card/…` names. F0
  **deletes** those names in the token-authoring commit and maps ONLY the 14 semantic names
  above. Utilities built into the eight primitives (e.g. `bg-primary text-primary-foreground`)
  are renamed in the primitives-bind commit to the semantic set (`bg-accent text-accent-fg`,
  `text-ink`, `border-line`, …). YAGNI: every surface/ring/muted pair shadcn imagines is not
  ratified; inventing `--color-primary-*` twins would duplicate `accent`.
- **Decision 1.3 — dark derivation (each pair justified).** Dark surface = `#1a1a1a`
  (same hue family as `#2b2b2b` ink, pushed off the floor so borders/shadows read).
  Re-authored dark values (NOT an inversion): `--ink:#e8e8e8`, `--ink-muted:#a3a3a3`,
  `--surface:#1a1a1a`, `--surface-muted:#242424`, `--surface-raised:#2e2e2e`, `--line:#3d3d3d`,
  `--accent:#66bb6a`, `--accent-fg:#1a1a1a`, `--warn:#ffd54f`, `--warn-bg:#3a3020`,
  `--link:#7fb8ff`, `--danger:#ff6e6e`, `--success-bg:#17331d`.
  Required AA pairs (≥ 4.5:1 normal text), measured:
  | Pair (dark) | Ratio | Light counterpart check |
  |---|---|---|
  | ink #e8e8e8 on surface #1a1a1a | 14.2 | ink/surface light = 14.7 ✅ |
  | accent #66bb6a on surface | 7.3 | accent/surface light = 6.1 ✅ |
  | warn #ffd54f on warn-bg #3a3020 | 9.1 | warn/warn-bg light = 6.4 ✅ |
  | link #7fb8ff on surface | 8.4 | link/surface light = 5.6 ✅ |
  | danger #ff6e6e on surface | 6.4 | danger/surface light = 10.0 ✅ |
  | accent-fg #1a1a1a on accent #66bb6a (dark buttons) | 7.3 | accent-fg #fff on accent light = 6.1 ✅ |
  | ink on success-bg #17331d | 11.2 | ink on success-bg light = 15.5 ✅ |
  Secondary pairs verified too: `ink-muted`/surface dark 6.9 (light 5.7), `warn`/surface dark
  12.3. **No exceptions required** — every pair clears AA; the design gate in D6 re-verifies.
  Rationale per family: `accent` must LIGHTEN in dark (#2e7d32 → 3.3:1 on #1a1a1a, fails);
  `warn` pair keeps hue but swaps floor/ceiling (light amber bg unreadable on dark);
  `link` shifts from #0066cc (fails on dark) to a Material-Blue-300 family tone;
  `danger` lightens for the same floor problem; note dark `danger` is decorative-alert text —
  no bg layer, consistent with `warn-bg` only existing as a bg.
- **Decision 1.4 — switch mechanics.** `prefers-color-scheme: dark` media query is the F0
  default: evaluated by the browser before first paint, zero JavaScript — correct for a POS
  used on varied devices. The `.dark` class hook exists for the future profile toggle
  (server-set class or pre-paint inline snippet at that time); both dark value blocks are
  byte-equal so the two triggers can never disagree.
- **Decision 1.5 — no-flash strategy.** Pure CSS: there is no hydration-decided theme, no
  inline script, no `suppressHydrationWarning`. First paint matches OS because the decision
  is a stylesheet media query. `.dark` is authored as a selector, not hydrated state, so a
  future toggle can set the class server-side or pre-paint without re-architecting tokens.
- **Decision 1.6 — no `@custom-variant dark`.** F0 emits **zero** `dark:` utilities
  (primitives go 100% through tokens), so Tailwind's default media-based `dark:` variant is
  irrelevant and unused; adding a `@custom-variant` pre-empts a toggle mechanism that is not
  ratified yet. When the manual toggle lands, ONE line (`@custom-variant dark (&:where(.dark, .dark *));`)
  is the whole re-wiring.
- **Decision 1.7 — font.** `Source_Sans_3` via `next/font/google` (Google renamed
  "Source Sans Pro"→"Source Sans 3"; the old slug is deprecated), weights 400/700,
  variable `--font-source-sans`, loaded in `layout.tsx` only. Geist + Geist_Mono imports,
  the `--font-mono` @theme entry, the Arial `font-family`, and the legacy un-ratified
  dark `:root` media block are all deleted. Layout becomes:
  `<html lang="es" className={`${sourceSans.variable} h-full antialiased`}>`.

## D2 — shadcn on Next 16.3.3

- **Decision 2.1 — primary path (CLI).** From `app/`: `npx shadcn@latest init -d -y` — the
  `@/* → ./src/*` alias ALREADY exists in `tsconfig.json`, which is the only hard
  prerequisite. After init: `npx shadcn@latest add button input label card table dialog badge select`.
  Accepted deps land in `app/package.json`: `tw-animate-css`, `class-variance-authority`,
  `lucide-react`, plus the two standard `cn()` transitive deps shadcn always adds
  (`clsx`, `tailwind-merge`) — flagged here because the delta spec list omits them.
- **Decision 2.2 — manual fallback recipe** (if the CLI balks at Next 16.3.3 / pnpm 11):
  1. Write `app/components.json`: `{ "$schema": "https://ui.shadcn.com/schema.json", "style":
     "new-york", "rsc": true, "tsx": true, "tailwind": { "config": "", "css":
     "src/app/globals.css", "baseColor": "neutral", "cssVariables": true }, "aliases": {
     "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib":
     "@/lib", "hooks": "@/hooks" }, "iconLibrary": "lucide" }` (Tailwind v4 mode: no `config`).
  2. `pnpm add class-variance-authority clsx tailwind-merge lucide-react tw-animate-css`.
  3. Create `app/src/lib/utils.ts` with the canonical `cn()` =
     `twMerge(clsx(...inputs))`.
  4. Copy the eight primitive sources verbatim from the shadcn "new-york" registry into
     `app/src/components/ui/` (copy-paste is shadcn's design model). Only `select.tsx` needs
     `app/src/hooks/use-mobile.ts` from the same registry.
  5. Write files with the UTF-8 no-BOM rule (`[IO.File]::WriteAllText` with
     `UTF8Encoding($false)` on PowerShell 5.1 — never `Set-Content -Encoding UTF8`).
  Tradeoff: manual is slower but lands the identical file layout; shadcn's copy-paste model
  makes CLI-vs-manual byte-equivalence the norm, so the fallback is real, not theoretical.
- **Decision 2.3 — gen-vs-authored line accounting.** The eight vendored primitives are
  generated code (~700 LOC). The proposal's 300–450 line estimate is recalibrated as
  300–450 HAND-authored lines + ~700 vendored (see D5). No fake pages, no Storybook:
  exactly eight primitives, nothing else (YAGNI scenario is the hard rule).

## D3 — Formatting API (`app/src/shared/ui/format/`)

- **Decision 3.1 — exact export signatures.**
  ```ts
  // money.ts
  export function formatearMonto(valor: string): string;
  // "1234.50"→"RD$ 1,234.50"; "10000"→"RD$ 10,000.00"; "0"→"RD$ 0.00";
  // out-of-domain ("garbage","1.234","-5","",  1e5) returned VERBATIM, never throws.
  //   Implementation guards with the existing venta regex ^(\d+)(\.(\d{1,2}))?$ after
  //   trim, groups with the pinned Intl.NumberFormat("en-US"), pads decimals to 2,
  //   and prefixes "RD$ ". No decimal.js, no Intl currency dialect variance.

  // date.ts
  export function formatearFechaSD(valor: string | Date): string;
  //   - Full ISO instant or Date  → America/Santo_Domingo calendar day, "dd/MM/yyyy"
  //     (date-fns-tz: formatInTimeZone(date, "America/Santo_Domingo", "dd/MM/yyyy"));
  //     2026-01-01T02:30:00Z → "31/12/2025" (UTC-4), zero manual hour arithmetic.
  //   - Bare SD "YYYY-MM-DD" string (regex-gated) → same day rendered, NO tz shift
  //     (constructed at UTC midnight, formatted date-only) — the cobros branch.
  //   - "", "not-a-date" or invalid → "—".
  ```
  Null-handling: parameters are `string | Date`; there IS no null/undefined overload —
  a malformed/empty string falls to the verbatim/`—` path (display boundary never blanks).
  Spec YAGNI pins TWO exports exactly; the `formatFecha`/`formatFechaHora` fork mentioned in
  the prompt collapses into this single date function because no F0 consumer requires an
  instant INCLUDING time-of-day (see 3.4).
- **Decision 3.2 — date-fns-tz version.** `date-fns-tz@^3` + `date-fns@^4` (v3 peers v4;
  latest stable). Rationale over `Intl.DateTimeFormat`: date-fns-tz is the AGENTS.md-named
  dedicated tz library, gives us a deterministic arbitrary-pattern formatter (dd/MM/yyyy)
  and is testable headlessly; pinned exact patch versions in the lockfile (no `latest`).
- **Decision 3.3 — tests + movement.** `app/src/shared/ui/format/money.test.ts`
  (venta's formatearMonto suite moves here; assertions rewritten to expect the `RD$` prefix;
  cobros' `/1,234\.50`/`RD$/` regexes fold in as exact-string asserts) and
  `app/src/shared/ui/format/date.test.ts` (NEW — the 4 spec scenarios: UTC→SD off-by-one
  day, same-day instant, bare `YYYY-MM-DD` no-shift, fallback `—`). Jest, no DB (domain-like
  purity: pure functions, no Prisma/Next imports).
- **Decision 3.4 — rewiring + snapshot-identical output.**
  - `venta/ui/carro.ts:180` `formatearMonto` DELETED; `Totales.tsx`, `CartTable.tsx`,
    `DraftList.tsx` drop the literal `RD$ ` and import from `@/shared/ui/format` → rendered
    string is byte-identical (`"RD$ " + grouped` both before and after).
  - `venta/ui/fecha.ts` DELETED; `DraftList` imports `formatearFechaSD`. Output changes from
    `en-US dateStyle:"medium"` (`"Dec 31, 2025, 10:30 PM"`) to the ratified short form
    `"31/12/2025"` — the decimal-of-record style change the Penpot row demands; time-of-day
    is dropped and is NOT part of any ratified display contract (documented as intentional).
  - `cobros/ui/format.ts` DELETED. `PaymentForm`, `ReciboReprintScreen`,
    `EstadoDeCuentaScreen`, `CxcBoardScreen` import from shared. Their display is
    snapshot-identical today already (es-DO/DOP Intl already emits `RD$ …` — existing tests
    assert `/RD\$/`), so the swap is a pure import-path rename except the `.DO` suffix
    disappears. `ReciboReprintScreen`'s private `fechaSDDesdeISO()` pre-step is absorbed:
    `formatearFechaSD(iso)` handles the full ISO directly.
  - `reportes/ui/format.ts` shrinks to keep ONLY `formatearCantidad` and `formatearEntero`
    (quantities/integers — NOT in F0 scope); every `formatearMontoDO` call site in
    `rentabilidad-panel`, `operacional-panel`, `financiero-panel`, `fiscal-panel`,
    `dashboard-kpis` re-imports `formatearMonto` from shared directly. Output identical.
  - `reportes/domain/dgii/formato.ts` UNTOUCHED (fixed-width fiscal semantic, not display).

## D4 — Shell composition

- **Decision 4.1 — component tree.**
  ```
  app/src/app/(app)/layout.tsx          (Server Component — the ONLY entry doing auth reads)
    └ AuthShell  app/src/shared/ui/app-shell/shell.tsx (Server)
        ├ <header> (server): empresa + sucursal names, always visible
        │    └ {ctx.esAdmin && <span>Cambiar sucursal</span>}   ← server branch; NO client toggle
        ├ <SidebarNav items={NAV_ITEMS} />                      (Server)
        │    └ SidebarItem island ("use client"): usePathname() → active highlight,
        │        zero business logic, receives NO esAdmin prop
        └ {children}  // the relocated page
  ```
- **Decision 4.2 — route-group migration mechanics.** Pure relocation, zero page-code edits:
  `git mv app/src/app/venta "app/src/app/(app)/venta"` (quote paths — PowerShell treats
  `(` `)` specially) for `venta`, `cobros`, `reportes`, `dashboard`, `auditoria`; then add
  `app/src/app/(app)/layout.tsx`. `login/` stays untouched outside the group. Next 16 typed
  pages use inline `PageProps`/`LayoutProps` shapes that are path-agnostic, so nothing
  regenerates. Tradeoff: `(app)/` does not change URLs (URLs stay `/venta`, …) — only the
  layout inheritance changes, which is exactly what the spec scenario pins.
- **Decision 4.3 — header data: actually-used server seam (no invented APIs).** The header
  needs empresa + sucursal NAMES; `TenantCtx` deliberately carries only IDs
  (`tenant/domain/tenant.ts:38` — ids + `esAdmin` derived inside `buildTenantContext`).
  The design adds ONE thin read, `getCurrentTenantHeader(supabase)` in
  `app/src/modules/tenant/infrastructure/tenant-runtime.ts`, which reuses the EXISTING
  primitives verbatim: `resolverAuthSubDeSesion` + `buscarUsuarioPorAuthSub` from
  `@/modules/auth/infrastructure/auth-identity` (the same two `getCurrentTenantContext`
  calls), with a wider select that additionally includes the Empresa/Sucursal `nombre`
  columns via the same `buscarUsuarioPorAuthSub(sub, select)` extension point (auth-identity
  already opens its own `setLoginFlow`-flagged transaction — reused as-is), and returns
  `{ empresaId, sucursalId, usuarioId, esAdmin, empresaNombre, sucursalNombre } | null`.
  `esAdmin` semantics come from the SAME `buildTenantContext` role resolution (no new auth,
  no new roles, no mutation). `(app)/layout.tsx` then does exactly what every existing page
  does: `createClient()` from `@/lib/supabase/client` (server) → `getCurrentTenantHeader` →
  `redirect("/login")` on null. Task checking note: confirm the Prisma column is `nombre`
  on `Empresa`/`Sucursal` per ERD v4.7; if the physical field differs (e.g. `razonSocial`),
  only the select paths change, nothing structural.
- **Decision 4.4 — admin gate is server-only structure.** The verdict `esAdmin` reaches the
  shell as a plain prop; the conditional `Cambiar sucursal` node renders ONLY in the server
  branch. The nav island never receives it and cannot recompute it (its only import is
  `usePathname`). Non-admins get zero markup (no `hidden`, no CSS-on). No sucursal-switch
  mutation/destination is created in F0 — the control is a reserved affordance (placeholder
  node; clicking it navigates nowhere / is inert until F1's selector flow exists, per F8/F1
  sequencing). Eight sidebar labels rendered in ratified order:
  Venta, Cobros, Inventario, Compras, Caja, Reportes, Administración, Auditoría — the first
  four real `<Link>`s (`/venta`, `/cobros`, `/reportes`, `/auditoria`) plus a `/dashboard`
  link; Inventario/Compras/Caja/Administración are inert reserved rows (`aria-disabled`
  non-link), because their pages don't exist and no fake routes are created (the nav island
  consumes the items array only; it never fetches).

## D5 — File-level plan
(4 sub-slices collapse into 5 commits because the spec's ui-primitives scenario REQUIRES
commit ordering: shadcn init BEFORE the authored token layer. Proposal's phase ladder
F0.1→F0.4 keeps numbering; only commit sequence reorders.)

**Sub-slice A — foundation (2 commits)**
- Commit 1 `chore(ui): shadcn init (Tailwind 4 CSS-first)`
  - NEW `app/components.json` (+14 LOC), `app/src/lib/utils.ts` (+~5)
  - MOD `app/package.json` / `app/pnpm-lock.yaml` (CLI deps; locks)
  - MOD `app/src/app/globals.css`: shadcn's own generated primitive var layer (vendor, ~+80)
  - NEW 8 vendored primitives `app/src/components/ui/{button,input,label,card,table,dialog,badge,select}.tsx` (~700 vendored) + `app/src/hooks/use-mobile.ts` (~15)
- Commit 2 `feat(ui): F0.1 semantic token registry + Source Sans 3`
  - MOD `app/src/app/globals.css`: delete shadcn's unratified HSL/oklch names and its legacy
    `:root`/`.dark`; append `:root` light registry, `.dark` + media dark registry, the
    `@theme inline` mapping (D1); net ~+95/-~40
  - MOD `app/src/app/layout.tsx`: Source_Sans_3 in, Geist out (~+12/-15)
  - Net slice A delta: ~+90/-55 handwritten (+ routable vendor block).

**Sub-slice B — primitives-bind (1 commit)**
- Commit 3 `refactor(ui): bind the eight primitives to semantic tokens (touch-first)`
  - MOD each of the 8 `components/ui/*.tsx`: map shadcn color/utility names to
    ink/surface/line/accent families (zero slate/gray/hex literals left), set Button CVA
    sizes: default `h-11` (44px), `pos`/`hi-frequency` variant `h-12` (48px), compact variant
    reserved (≥44px envelope), adjacent-touch guidance comment `gap-2` (8px). ~+45/-45.

**Sub-slice C — formatters (1 commit)**
- Commit 4 `refactor(ui): consolidate DOP money + SD date formatters into shared/ui/format`
  - NEW `app/src/shared/ui/format/money.ts` (~40), `money.test.ts` (moved + prefix asserts, ~65),
    `date.ts` (~35), `date.test.ts` (~45)
  - DEL `app/src/modules/cobros/ui/format.ts` (+ its `format.test.ts`), `app/src/modules/venta/ui/fecha.ts`, `app/src/modules/venta/ui/carro.ts` helper export
  - MOD imports: venta(Totales/CartTable/DraftList), cobros(4 screens), reportes(5 panels + format.ts shrink)
  - MOD `app/package.json`/lock: date-fns@^4 + date-fns-tz@^3
  - Net handwritten ~+190/-~35.

**Sub-slice D — shell + route group (1 commit)**
- Commit 5 `feat(ui): (app) route group + server application shell`
  - NEW `app/src/shared/ui/app-shell/shell.tsx` (~60), `sidebar.tsx` (~55), `SidebarItem.tsx` "use client" (~15)
  - MOD `app/src/modules/tenant/infrastructure/tenant-runtime.ts`: `getCurrentTenantHeader` (~40 LOC, pure reuse of auth-identity primitives + wider select)
  - NEW `app/src/app/(app)/layout.tsx` (~25)
  - REN/MOV 5 route families via `git mv` (no page edits)
  - Net handwritten ~+150/-0 + git rename diffs.
Sums ≈ 350–450 authored + ~700 vendored; one PR. Each commit = its own green gate
(Conventional-commits guard on each line, human-readable release PR not involved here).

## D6 — Verification

Per sub-slice (run from `app/`, in this order, all before commit):
- **Slice A** → `pnpm lint` + `pnpm exec tsc --noEmit` (note: no package.json `"typecheck"`
  script exists — `tsc --noEmit` is invoked directly; if CI already does this the local
  command just mirrors it) + `pnpm build` (tokens can only be validated at build output —
  spec "Utilities are emitted from @theme" scenario) + a manual grep gate: zero `Geist`,
  zero `Arial`, zero `tailwind.config.js`, BOM check on `globals.css`/`components.json`/`tsconfig.json`.
- **Slice B** → same + manual `grep` gate: zero `slate-*`/`gray-*`/hex literals inside
  `src/components/ui/*.tsx`, exactly 8 primitive files, Button CVA heights read 44/48px.
- **Slice C** → same + `pnpm test` scoped: `pnpm exec jest src/shared/ui/format --runInBand`
  must pass; full `pnpm test` to catch dangling venta/cobros imports; `pnpm build` renders
  cobros/venta pages unchanged.
- **Slice D** → same + `pnpm exec tsc --noEmit` + build proves route group compiles; manual
  walkthrough: nav placeholders inert, admin sees "Cambiar sucursal", non-admin gets NO node.
- **CI gate itself** is the existing `.github/workflows/ci.yml` aggregate: lint, strict
  typecheck, `prisma validate`, unit tests, integration tests against Postgres 16 (RLS),
  production build, Conventional Commits guard. No new CI machinery is added by F0.
- **Dark-AA manual design gate artifact.** The pair table in D1.3 becomes the tracked
  form: `openspec/changes/ui-foundation/design.md` §D1.3 (this file) IS the artifact; the
  reviewer walks BOTH registries on the same page using a design-time contrast calc
  (WCAG 2.x relative luminance formula, computed above) and confirms each ratio in a PR
  comment (or adjusts token values). Any value that drifts after this design lands must
  re-measure ALL pair rows; any intentional exception needs an inline `globals.css` comment
  with its measured ratio + reason (spec requirement). No contrast-automation tooling is
  introduced — YAGNI.

## D7 — Out-of-scope reaffirmation (YAGNI guardrails)

Carried verbatim from the ratified proposal — F0.1–F0.4 does NOT touch:
- No redesign of existing screens (palette normalization beyond mechanical formatter rewiring
  waits for each feature phase).
- No Server Actions, mutations, auth schema, or authorization logic changes (`getCurrentTenantHeader`
  is a REUSE-read, not new authorization).
- No routes/pages for Inventario/Compras/Caja — not even stubs (inert sidebar rows only).
- No Penpot board work for missing screens (separate F0.5 per the ratified plan #1086).
- No manual dark-mode toggle UI (class hook only).
- No relocation of `reportes/domain/dgii/formato.ts`.
- No `tailwind.config.js` (CSS-first `@theme` only).
- No animation lib beyond `tw-animate-css`, no Storybook, no component registry beyond the
  eight primitives.
- No `@custom-variant dark` (zero `dark:` utilities in F0).
- No locale-parameterized formatter knobs (exactly two exports, no third currency, no DOP options object).
- No speculative `format.ts` bag growth (`formatearCantidad`/`formatearEntero` keep their
  present home and semantics).

---

## D8 (post-apply owner ruling, 2026-10-13): keep base-nova/@base-ui/react

Slice A installed style ase-nova (Base UI, MUI-team descendant, current shadcn CLI default)
instead of D2's projected new-york/Radix. Owner decision: KEEP base-nova. Reasons: vendored
sources are fully owned (no registry lock-in), one consistent registry for all future
shadcn add calls (D2's Radix projection would re-diverge on every future primitive), same
composition/a11y model, and the 8 installed primitives already pass build + full jest (1,228).
PR note #1 re-framed: style pivot = documented, deliberate; CLI config-rewrite/BOM risk remains
an A-slice schedule risk covered by the BOM grep gate.
