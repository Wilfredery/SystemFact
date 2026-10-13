# Delta Spec — ui-primitives (F0.2)

shadcn/ui base primitives over Tailwind 4, token-aware, touch-first. Binding scope: proposal §F0.2.

### Requirement: Exactly eight primitives via shadcn

The project SHALL adopt the shadcn CLI (`npx shadcn@latest init`, with `@/* → ./src/*` tsconfig alias + `app/components.json`) before hand-authoring tokens, and SHALL add exactly eight primitives: **button, input, label, card, table, dialog, badge, select** — no more. Accepted CLI dependencies: `tw-animate-css`, `class-variance-authority`, `lucide-react`. If the CLI fails on Next 16.3.3, the fallback SHALL be a manual `components.json` plus copy-paste of the primitive sources (shadcn is copy-paste by design), leaving the same eight in the same paths (`app/src/components/ui/`).

#### Scenario: Primitive inventory is exactly eight

- **GIVEN** `app/src/components/ui/` after this change
- **WHEN** its files are listed
- **THEN** they correspond to exactly button, input, label, card, table, dialog, badge, select — no additional primitives (no toast, no accordion, no popover, …).

#### Scenario: CLI-first order preserved

- **GIVEN** the change history/commit sequence
- **WHEN** the shadcn init commit and the token authoring commit are compared
- **THEN** init comes first, so its `globals.css` rewrite never clobbers the authored `@theme` tokens; the token layer is appended/merged in a later commit.

### Requirement: Touch-first sizing encoded in the primitives

Touch-first conventions SHALL be encoded as primitive sizing (tokens/CVA variants), not ad-hoc utility stacking in screens: every interactive primitive SHALL guarantee a minimum touch hitbox of **44px**; high-frequency targets (e.g. POS cart actions) SHALL have a **48px** variant; adjacent interactive primitives SHALL support a minimum **8px** spacing rhythm (8px spacing token/default gap). Primitives default to these sizes so screen code inherits them with zero extra classes.

#### Scenario: Button sizes meet the hitbox floor

- **GIVEN** the `Button` CVA size variants
- **WHEN** each variant's height is measured
- **THEN** the default variant is ≥ 44px and the high-frequency variant is exactly 48px (sm/compact variants, if any, are reserved for icon-only dense desktop lists and still ≥ 44px touch envelope).

#### Scenario: Spacing rhythm is tokenized

- **GIVEN** the primitives and their composed screens
- **WHEN** interactive controls are stacked
- **THEN** vertical gaps default to a multiple of the 8px spacing token (e.g. `gap-2` = 8px), and no primitive style requires sub-8px spacing between touch targets.

### Requirement: Token-aware, light/dark-ready primitives

Every primitive SHALL style exclusively through the semantic tokens from F0.1 (`ink/surface/line/accent/...`) so they are automatically light/dark aware; primitives SHALL NOT hardcode raw slate/gray hex or Tailwind one-off grays. Dialog overlay, focus rings, and badge/on-color pairings inherit the dark registry without primitive-level changes.

#### Scenario: No raw grays in primitives

- **GIVEN** any `app/src/components/ui/*.tsx` source
- **WHEN** it is searched for raw gray/slate classes (`slate-*`, `gray-*`, hex literals like `#64748b`)
- **THEN** zero occurrences remain — all colors route through semantic token classes.

#### Scenario: Dark mode needs no primitive edits

- **GIVEN** the app rendered with OS dark preference
- **WHEN** each of the eight primitives renders
- **THEN** its colors derive from the `.dark`/media-query registry with no per-primitive dark-only overrides (the AA contrast carried by the tokens covers them).

### Requirement: YAGNI / out-of-scope for primitives

F0.2 SHALL NOT introduce: additional primitives beyond the eight, a component library beyond shadcn's copy-paste model, storybook/docs sites, animation libraries beyond `tw-animate-css`, or per-screen restyling (existing POS screens keep their current look; token conversion of every screen is NOT F0 scope).

#### Scenario: No extra surface area

- **GIVEN** the diff of this sub-slice
- **WHEN** it is reviewed
- **THEN** it contains no primitive outside the eight, no Screen/storybook infrastructure, and no redesign of existing venta/POS screens beyond mechanically swapping in primitive usage where trivially mechanical.
