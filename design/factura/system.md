# SystemFact Design System — factura.penpot ↔ code reconciliation

One-time setup deliverable of the UI/UX alignment protocol (owner standing order,
2026-11-18). Wireframe sources: `design/factura/sources/` (19 boards + 20
Etiqueta-Acción cards, PNG 2x + SVG). Code side: Next.js 16 App Router, Tailwind
CSS 4 CSS-first, `app/src`.

## 1. Source of truth and direction

- The Penpot wireframes (`factura.penpot`, boards 02–09) are the source of truth
  for **layout, interaction style (touch-first) and roles per screen**.
- `app/src/app/globals.css` is the source of truth for **color tokens**: its own
  header states the palette carries the "Penpot ratified values" (F0 board,
  design D1.3), so tokens reconcile 1:1 — no translation needed.
- Where the two disagree on a screen, it is recorded as drift in that board's
  report (`[wireframe]` / `[code-fix]` / `[beyond-wireframe]`), never fixed
  silently.

## 2. Token registry (verified verbatim in `app/src/app/globals.css:17–67`)

| Token | Light | Dark | Tailwind utility |
|---|---|---|---|
| `--ink` | #2b2b2b | #e8e8e8 | `text-ink` |
| `--ink-muted` | #666666 | #a3a3a3 | `text-ink-muted` |
| `--surface` | #ffffff | #1a1a1a | `bg-surface` |
| `--surface-muted` | #f2f2f2 | #242424 | `bg-surface-muted` |
| `--surface-raised` | #e8e8e8 | #2e2e2e | `bg-surface-raised` |
| `--line` | #e0e0e0 | #3d3d3d | `border-line` |
| `--accent` | #2e7d32 | #66bb6a | `bg-accent` |
| `--accent-fg` | #ffffff | #1a1a1a | `text-accent-fg` |
| `--warn` | #856404 | #ffd54f | `text-warn` |
| `--warn-bg` | #fff3cd | #3a3020 | `bg-warn-bg` |
| `--link` | #0066cc | #7fb8ff | `text-link` |
| `--danger` | #8b0000 | #ff6e6e | `text-danger` / `bg-danger` |
| `--success-bg` | #e8f5e9 | #17331d | `bg-success-bg` |

- Dark mode: `prefers-color-scheme: dark` default + dormant `.dark` class hook
  (byte-identical values; no toggle exists).
- No custom radius/spacing/z-index tokens: Tailwind built-ins (`rounded-xl`,
  `gap-2` on an 8px rhythm, `z-50` for overlays).

## 3. Typography and touch (touch-first, per wireframe)

- Single family **Source Sans 3** (400/500/700), `next/font/google`
  (`app/src/app/layout.tsx:5–8`), mapped via `--font-sans`.
- Scale: `text-xs` badges/table headers · `text-sm` body/buttons/inputs ·
  `text-base` card & dialog titles. No heading tokens.
- Touch targets: min 44px (`h-11`) everywhere interactive; POS bumps to 48px
  (`size="pos"` → `h-12`, `button.tsx` / `numeric-keypad.tsx`).
- Interaction style: no keyboard assumptions in venta UI (zero keydown
  handlers); money entry via on-screen NumericKeypad (13-key, grid-cols-3).
  **Open drift to bring to owner**: wireframe "Monto recibido" is a plain input
  vs code's keypad — pending owner decision with recommendation.

## 4. Primitive layer (all board-agnostic, `app/src/components/ui/`)

`button` (primary/outline/ghost/destructive/secondary/link + pos) · `input` ·
`label` · `card` · `table` · `dialog` (z-50) · `badge` (4 variants) ·
`select` (@base-ui/react) · `numeric-keypad` (POS).

Built on `@base-ui/react` + `class-variance-authority`. Binding specs:
`openspec/changes/ui-foundation/specs/ui-primitives/spec.md`; F0 design
`openspec/changes/ui-foundation/design.md` (D1–D7); POS design
`openspec/changes/f2-venta-pos/design.md`.

## 5. Known gaps (feed the board reports)

1. **No toast/notification primitive** — wireframes show inline confirmations;
   boards needing transient feedback must either add a primitive or use inline
   status (decide per board report).
2. **No distinct success foreground** — only `--success-bg`; status text pairs
   (`bg-success-bg` + dark green text) are hardcoded per screen today.
3. **No `--mora` semantic** — cobros "En Mora" badge should map to
   `--danger`/`--warn` family, not `bg-red-100`.
4. **≈10 pre-F0 screens bypass tokens** (cobros, inventario, cliente, producto,
   proveedor, compra, reportes, tenant, auditoria, devolucion, caja): raw
   Tailwind palette (`zinc-*`, `emerald-*`, `amber-*`, `red-*`) + per-component
   `dark:` overrides, e.g. `modules/inventario/ui/InventarioScreen.tsx:41–43`,
   `modules/cobros/ui/CxcBoardScreen.tsx:238–240`,
   `modules/cliente/ui/ClientesScreen.tsx:46,237`. Retrofitting them to the
   token layer is a `[code-fix]` decision to surface in each board report —
   never done silently.

## 6. Protocol (recap, owner-ratified)

Per board: audit wireframe + map current screen code (file:line facts) →
BOARD REPORT (matches / drifts / proposals, tagged) → **owner approves item by
item** → implement → test (RED→GREEN where applicable) → JD dual review → next
board. Boards grouped by number. Pilot: **02-Venta-Contado**.
