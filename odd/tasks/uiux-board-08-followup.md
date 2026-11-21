# UI/UX board 08 follow-up — tab keyboard + legacy links

Branch `feature/uiux-board-08-followup` · target v0.42.1 · UI-only. Parent: `odd/tasks/uiux-board-08-admin.md` (deferred items).

## Specs

- S1 Tab keyboard navigation (WAI-ARIA tabs, MANUAL activation because a tab switch is a server navigation): the tablist uses roving tabindex (selected tab `tabIndex=0`, others `-1`); ArrowRight/ArrowLeft move focus to the next/previous tab with wrap-around, Home/End move focus to the first/last tab; Enter/Space (native button click) activates. Arrow keys NEVER navigate by themselves. Touch behavior is unchanged (click still switches, `min-h-11` kept).
- S2 Legacy links: a request to `/administracion` WITHOUT a `tab` param but WITH any of `busqueda`, `activo` or `page` opens the Usuarios tab (those params only ever belonged to Usuarios), keeping its filters. No `tab` and none of those params still opens Empresas (S1 of board 08). An unknown `tab` value still falls back to Empresas. The decision lives in one pure helper in `administracion-tabs.ts`.
- S3 No authorization change, no new action, no backend change.
- S4 Version bump 0.42.1 (`app/package.json`, `.release-please-manifest.json`, `app/CHANGELOG.md`, UTF-8 no BOM, preserve each file's line endings: CHANGELOG has mixed endings, prepend bytes only).

## Tasks

- T1 (S1,S2,S3) helper + page + screen keyboard + tests
- T2 (S4) bump, PR, CI, merge, deploy, smoke, tag+release (owner-approved)

## Log

- L1: "Before to continue, "Left for your decision", we need to take care of it, dont u think?Thats going to fix and correct and have a better experience, right? What do u recommend me for that?"
- L2: "Hold on, do a check, recheck, audit and evaluation pls just to make sure and process with recommendations, pls"
- L3: Audit result: arrow keys and legacy-link fallback are low-risk UI work (this PR). Empresas search box skipped (one company per tenant: a search over one row is clutter). Company Eliminar/Desactivar not built (never-delete rule; would lock out the only company). Company Editar and "+ Nueva empresa" wait for owner/ADR. `Empresa.activa` is NOT enforced at runtime (audit: login, per-request ctx, RLS all ignore it): separate security PR.
