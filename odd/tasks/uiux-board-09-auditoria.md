# UI/UX board 09 — Auditoría (factura.penpot 09-Auditoria-Consulta), slice A

Branch `feature/uiux-board-09-auditoria` · target v0.44.0 · UI-only. Parent tracker: `odd/tasks/uiux-alignment.md`. Slices B (user/branch NAMES + selects, needs a read-contract change) and C (Anterior → Nuevo detail, needs an audit of what `valorAnterior`/`valorNuevo` writers store) are NOT part of this slice.

## Specs

- S1 Header: the title `Auditoría` is followed by a badge `Solo Administrador` (warn tokens: `bg-warn-bg text-warn`); the subtitle reads exactly `Consulta el registro de movimientos del sistema`.
- S2 Footer note under the table, exact text: `Registro de auditoría — Solo lectura · Inmutable (append-only)`.
- S3 Table columns, in wireframe order: `Fecha-Hora`, `Usuario`, `Acción`, `Entidad`, `Sucursal`, `Detalle`. The new `Entidad` column shows the entity (`fila.entidad`); `Detalle` keeps showing `#idEntidad` plus the reason (change `detalleFila` so `entidad` is no longer repeated there: `#idEntidad — motivo`, full text still in `title`). The `Usuario` column keeps `#usuarioId` and `Sucursal` keeps its current value (names are slice B). Every `<th>` gets `scope="col"`. The JSON payloads `valorAnterior`/`valorNuevo` are STILL never rendered or fetched for display (slice C).
- S4 Filters keep today's fields and behavior (Acción select, Usuario #, Sucursal #, Desde, Hasta, Texto libre, Aplicar, Limpiar). The Texto libre placeholder reads `Buscar en auditoría (texto libre)...`. Aplicar uses the primary button recipe (dark accent, `min-h-11`); Limpiar the outline recipe. No filter semantics, URL contract, pagination (25/page) or server action changes.
- S5 Tokens: every raw Tailwind palette class (`zinc-*`, `red-*`, `emerald-*`, `amber-*`, ...) and every `dark:` variant in `AuditFilters.tsx`, `AuditTable.tsx`, `format.ts` (`tonoAccion`) and `app/src/app/(app)/auditoria/page.tsx` maps to the F0 tokens of `design/factura/system.md` §2 (`text-ink`, `text-ink-muted`, `bg-surface`, `bg-surface-muted`, `border-line`, `bg-accent`/`text-accent-fg`, `bg-success-bg`/`text-success-fg`, `bg-danger/10`/`text-danger`, `bg-warn-bg`/`text-warn`, `text-link`); copy the recipes of boards 05-08. A source-level guard test (RAW_PALETTE + ARBITRARY_COLOR + `dark:`, pattern of `modules/tenant/ui/__tests__/administracion-board08.spec.tsx`) covers those four files.
- S6 Touch and a11y: every interactive element in the filters and the pagination links has `min-h-11`; visible labels are not overridden by a different `aria-label` (the accessible name equals or contains the visible label: fix `Desde` vs `Fecha desde` style mismatches, keeping tests meaningful); the access-denied alert keeps `role="alert"`.
- S7 Nav: the sidebar link `Auditoría` is shown ONLY to administrators (`esAdmin` is already a prop of `AuthShell`/`shell.tsx`; filter the static items, do not duplicate the list). The server-side gate of `/auditoria` is unchanged and stays the real security: a non-admin typing the URL still sees only the access message and no data. Other sidebar items are unchanged for every role.
- S8 No authorization, action, query, migration or backend change. No new dependency.
- S9 Tests: RTL for S1-S4, S6; guard test for S5; shell test for S7 (admin sees the link, non-admin does not, other items unchanged); update existing tests only where the new truth demands (labels/columns), never weakening assertions; a new Playwright spec `app/e2e/auditoria.spec.ts` (runs in CI only): admin sees the heading, the badge, the footer note and the six column headers and no mutation controls; the operador user (`E2E_OPERADOR_USER`, see `app/e2e/administracion.spec.ts` for how non-admins are used) does not see the nav link and sees the access message at `/auditoria`.
- S10 Version bump 0.44.0 (`app/package.json`, `.release-please-manifest.json`, `app/CHANGELOG.md`; bytes only, no BOM, keep each file's line endings; CHANGELOG has mixed endings: prepend bytes).

## Tasks

- T1 (S1-S9) implementation + tests, worker
- T2 (S10) parent: verify, bump, PR, CI, merge, deploy, smoke, tag+release

## Log

- L1: "Go" (start board 09, with check/recheck/evaluate/audit first).
- L2: BOARD REPORT 09 approved by the owner (ask_user_question, 2026-11-21): "A now, B (names/selects) next, C audited later (recommended)" and "Yes, admins only (recommended)" for the nav link.
- L3: Audit facts (explorer + parent recheck): role gate is server-side and correct (action + use case); `valorAnterior`/`valorNuevo` are `VarChar(255)` free text deliberately never shown (AC-3, `format.ts` comment); `Auditoría` is a static `NAV_ITEMS` entry (`shell.tsx:31`) with no role gating while `esAdmin` is available in the shell; no E2E exists for `/auditoria`; no `odd/tasks` file for board 09 existed.
