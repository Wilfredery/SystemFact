# Delta Spec — tokens (F0.1)

Design tokens + font foundation in `app/src/app/globals.css` and `app/src/app/layout.tsx`.
Binding scope: openspec/changes/ui-foundation/proposal.md §F0.1. Tailwind 4 is CSS-first: zero `tailwind.config.js`; all tokens live in a `@theme` block.

### Requirement: Semantic token registry (light)

The `app/src/app/globals.css` SHALL declare a Tailwind 4 `@theme` block defining semantic CSS variables: `--color-ink-*` (text scale anchored on `#2b2b2b`), `--color-surface-*` (background scale anchored on the ratified grays `#f2f2f2` / `#e8e8e8` / `#e0e0e0` plus white), `--color-line-*` (border scale), `--color-accent: #2e7d32`, `--color-warn` (`#856404` with `#fff3cd` as its background via `--color-warn-bg`), `--color-link: #0066cc`, `--color-danger: #8b0000`, and `--color-success-bg: #e8f5e9`. Because they are declared inside `@theme`, Tailwind 4 SHALL emit the corresponding utilities (`bg-accent`, `text-ink`, `border-line`, …) without any config file.

#### Scenario: Utilities are emitted from @theme

- **GIVEN** a component using a semantic class such as `bg-accent` or `text-ink`
- **WHEN** `pnpm build` runs against the rewritten `globals.css`
- **THEN** the build succeeds producing the utility CSS, and the value emitted for `bg-accent` resolves to `#2e7d32` in the light registry.

#### Scenario: Plain-text consumable (BOM-safe + config-free)

- **GIVEN** any process rewrites `globals.css` (or `tsconfig.json`, `components.json`, YAML) on this change
- **WHEN** the file bytes are inspected
- **THEN** the file starts with no UTF-8 BOM (`EF BB BF`) and the repo contains no `tailwind.config.js` (Tailwind 4 CSS-first tokens via `@theme` only).

### Requirement: Dark registry (WCAG AA) via class hook with prefers-color-scheme as default

The tokens system SHALL provide both light and dark registries. Dark values SHALL be authored inside `@theme` under a `.dark` class override (shadcn-compatible convention) and, in the absence of any manual toggle, SHALL default to the `prefers-color-scheme` media query — zero JavaScript, no manual toggle UI in F0. Dark pairings SHALL meet WCAG AA contrast (≥ 4.5:1 normal text) at least for the pairs: `ink` on `surface`, `accent`-on-`surface`, `warn` on `warn-bg`, `link` on `surface`, `danger` on `surface`.

#### Scenario: OS dark preference drives the default with no JavaScript

- **GIVEN** the browser OS is set to dark mode and no `.dark`/`.light` class is applied in markup
- **WHEN** the app renders
- **THEN** the dark registry values are active purely by the `prefers-color-scheme` media query, with no runtime script deciding the theme.

#### Scenario: Class-based override is hooked but unused in F0

- **GIVEN** the `:root`/`.dark` class selectors exist for every token (same names as `@theme`)
- **WHEN** no class is set on `<html>`
- **THEN** the media-query default wins; adding `.dark` on `<html>` switches every consumed token without re-architecting (future manual toggle path).

#### Scenario: Dark AA contrast

- **GIVEN** the dark registry values in `@theme` under `.dark`
- **WHEN** each required text/background pair is evaluated for WCAG contrast
- **THEN** every pair listed in the SHALL has ratio ≥ 4.5:1; any intentionally excepted pair is documented in a `globals.css` comment with its measured ratio.

### Requirement: No flash-of-wrong-theme

The F0 theme switch mechanism SHALL avoid any flash-of-wrong-theme by design: the default path is a pure CSS `prefers-color-scheme` media query (evaluated before first paint, no JS), and the `.dark` class hook is authored as a CSS selector — not hydrated state — so a future manual toggle can set the class server-side or pre-paint. F0 SHALL introduce no client-side theme-detection script.

#### Scenario: First paint matches OS preference

- **GIVEN** a fresh page load with OS in dark mode and cache disabled
- **WHEN** the first opaque paint occurs
- **THEN** dark tokens are already applied (no light flash, no post-hydration re-paint), because the decision was made by CSS media query before paint.

### Requirement: Source Sans 3 as sole font; removes Geist, Arial, stale dark block

`app/src/app/layout.tsx` SHALL load `Source_Sans_3` via `next/font/google` (weights 400 normal / 700 bold) and expose it as the only application font family (CSS variable consumed by `globals.css`). The layout SHALL import no Geist font; `globals.css` SHALL contain no `Arial` font-family declaration and SHALL remove the un-ratified legacy dark-mode `:root` media-query block.

#### Scenario: Font is loaded and applied

- **GIVEN** the rendered root layout markup
- **WHEN** the page loads
- **THEN** `Source_Sans_3` is self-hosted via next/font (no cross-origin fetch of the deprecated "Source Sans Pro"), applied to `body`, and no Geist font is loaded.

#### Scenario: Legacy styling dead weight is gone

- **GIVEN** the final `globals.css` and `layout.tsx` contents
- **WHEN** they are searched for `Geist`, `Arial`, and the old unratified dark `:root` media block
- **THEN** zero occurrences remain.

### Requirement: YAGNI guardrails for tokens

F0.1 SHALL NOT add: a manual theme toggle UI, extra color families beyond the ratified set, a third theme variant, `tailwind.config.js`, or arbitrary inline hex one-offs in the tokens layer.

#### Scenario: No scope creep in token files

- **GIVEN** the merged `globals.css`
- **WHEN** it is reviewed
- **THEN** it contains only the ratified semantic families (ink/surface/line/accent/warn/link/danger/success-bg), no toggle UI references, and no `tailwind.config` file exists in the app.
