# Screen audit fixes (post board realignment, 2026-11-22)

Owner-approved fix list from the full-site audit (prod crawl as DEMO-admin + code audit).
Rule for every task: CHECK, RECHECK, EVALUATE and AUDIT BEFORE implementing; then
branch -> commit -> push -> PR -> CI green -> merge -> deploy (owner pre-approved) -> prod smoke
(+ demo lane only if sales/payments/returns/login changed) -> tag + release.
Resume: `mem_search` topic `odd/screen-audit-fixes/tasks`, then this file; reconcile before the next task.

## Specs

- S1 (root): "The starter page is the login one." `/` must land on the login (anonymous) and, once
  authenticated, end on the dashboard through the existing proxy bounce. No create-next-app template.
- S2 (boundaries): "We need it those pages". Branded `not-found`, `error`, `global-error` and `loading`
  pages in Spanish on the design-system tokens, no raw palette; the 404 must stop logging CSP script
  violations in the browser console.
- S3 (caja): "Fix it." `/caja` "Exportar PDF" must not be prefetched (the `_rsc` request to
  `/api/caja/cierre-pdf` hangs after every page view).
- S4 (non-goal): "this project doesnt will be able in mobile screen". PC keyboard + touchscreen
  (tablet / touch PC) only. NO mobile-width fixes (the 390px overflows on /auditoria and /inventario
  are NOT to be fixed). Keep touch targets at 44px.
- S5 (copy): "Put it in spanish". The `/venta` heading "Point of sale" becomes Spanish ("Punto de venta").
- S6 (colors): "Fix and follow the color from wireframe we used." Replace raw Tailwind palette with the
  F0 design-system tokens (same mapping the aligned boards use) on: dashboard, Clientes, Productos,
  Proveedores, invoice print, devolucion ReturnForm/DevolverButton, reportes fiscal/operacional panels,
  and add the missing source-level no-raw-palette guard tests (also inventario).
- S7 (queries): "Check, recheck, evaluate, do an audit and follow as professional, practical, safe and
  security." Audit the six findMany without `take` (inventario-repository:344, producto-repository:247,
  compra-repository:240, pago-repository:202, saldo-cxc.repository:769, usuario-gestion-repository:114);
  bound each one that can grow with the data, tenant filter intact, explicit select, no behavior change.
- S8 (tests): "follow with the test". Add E2E specs for /dashboard, /reportes and the cobros
  sub-screens (recibo, estado-cuenta, factura); remove the stray `console.log` in
  `app/src/lib/security/csp-report.ts:211` (or justify it).

## Tasks

- [x] T1 S1,S2,S3,S5,S8(console.log) — PR-A: `/` redirect, not-found/error/global-error/loading, caja prefetch, Spanish heading, csp log. Route: inline. Commit: 576adf0 (v0.47.0, PR #275; deployed, smoke 10/0, demo 5/0, release v0.47.0)
- [x] T2 S7 — audit the six findMany, bound the growing ones with tests. Route: explorer audit + inline fix. Commit: PR-B v0.47.1 (see L4)
- [x] T3 S6 — dashboard + token mapping check + guard test. Route: inline. Commit: PR-C v0.47.2 (dashboard/page.tsx + reportes/ui/dashboard-kpis.tsx; mapping: zinc-900/50->ink, zinc-500/400->ink-muted, zinc-200/300/800->line, white/zinc-900->surface, indigo-600->accent+accent-fg, amber alert->warn-bg+warn, red alert->danger/10+danger, hover zinc-100->surface-muted, dark: removed)
- [x] T4 S6 — Clientes, Productos, Proveedores (screens, forms, confirm dialogs) + guards. Commit: PR-D v0.47.3 (9 files, one guard spec `shared/ui/__tests__/palette-maestros.spec.ts`; same mapping as T3 plus: emerald->success-bg/success-fg, bg-zinc-900+text-white (primary button)->accent+accent-fg, bg-zinc-50 thead->surface-muted, inactive badge->surface-muted+ink-muted, divide->line)
- [x] T5 S6 — FacturaPrintScreen, ReturnForm/DevolverButton, reportes fiscal/operacional panels + (found by the sweep) the 3 page titles and `components/ui/dialog.tsx`; guard is APP-WIDE (`shared/ui/__tests__/palette-global.spec.ts`), inventario needed no edits. Commit: PR-E v0.47.4
- [x] T6 S8 — E2E for dashboard and reportes (cobros sub-screens were ALREADY covered: `cobros.spec.ts` visits cxc-board, estado-cuenta and the receipt link, and `csp-authenticated.spec.ts` loads every `(app)` page; the audit overstated this gap). Commit: PR-F (e2e/dashboard.spec.ts, e2e/reportes.spec.ts; admin tests ran green against production, Operador tests are proven by CI)
- [x] T8 (added by the final crawl) branch picker `/selector-empresa-sucursal`: dropdown showed the branch id instead of the name; no h1. Commit: PR-G v0.47.5 (`Select items` prop + h1; 2 unit tests, RED first)
- [ ] T7 close — prod crawl re-run as DEMO-admin (script: %TEMP%/sf-admin-check/crawl-all.cjs, needs demo-admin.pw), update memory, report.

Each PR: version bump (app/package.json + .release-please-manifest.json + app/CHANGELOG.md, no BOM),
tag + GitHub release after deploy + smoke. Release-please PR from the bot: ignore/close.

## Log

- L1 (owner, 2026-11-22, verbatim): "1- This project doesnt work in a mobile, just PC-keyboard and Touchscreen(TABLET OR PC TOUCHSCREEN). And looks good to have one tbh. The starter page is the login one. 2- We need it those pages, thx for the suggestions. 3- Fix it. 4- As I told you this project doesnt will be able in mobile screen. 5- Put it in spanish, thx. 6- Fix and follow the color from wireframe we used. 7- Check, recheck, evaluate, do an audit and follow as professional, practical, safe and security. 8- follow with the test. Just in case create a .md or try to dont forget to complete these process... Cause we need to complete it, and just in case we dont finish today, u can still have the context what we are, what we've done and what we need to do, as u know. REMEMBER ALWAYS CHECK, RECHECK, EVALUATE AND DO AN AUDIT BEFORE TO IMPLEMENT, remember the push->PR->deploy and if everythings good tag+release, ok?"
- L2 (audit evidence, 2026-11-22): prod crawl as DEMO-admin: 12 sidebar routes load OK (h1, no console errors, no failed requests, no unlabeled inputs). Findings: no error/loading/not-found files exist; `/` still the starter template (`app/src/app/page.tsx`); `/caja` desktop never reaches networkidle because `<Link>` prefetch of `/api/caja/cierre-pdf` hangs; default 404 logs CSP script violations; `/venta` h1 "Point of sale"; raw palette in dashboard/clientes/productos/proveedores/factura print/devolucion/reportes panels (no guard); six findMany without take; no e2e for dashboard/reportes/cobros sub-routes. `/ventas` 404 was a wrong guess of the audit (real route `/venta`).
- L3 (decision, 2026-11-22): the `console.log` in `app/src/lib/security/csp-report.ts:211` is INTENTIONAL (one structured JSON line per CSP violation, read in the Vercel logs); kept, not removed. S8's first half is therefore closed by this note. Local build shows `/_not-found` is now dynamic (`ƒ`), which is what gives it a CSP nonce; the real proof is the authenticated prod crawl of an unknown URL after deploy (T1 is not done until that shows zero console CSP errors).
- L4 (T2 audit result, 2026-11-22): of the six `findMany` without `take`, only #2 (`producto-repository.ts` category selector) is unbounded by data: now `take: 200`. #1 (inventario ownership check), #3 (compra product lookup), #4 (reversed payments of one sale), #5 (saldo-cxc clients batch) and #6 (global role catalog) are bounded by their input or feed calculations where a cap would silently corrupt results; left unchanged on purpose. Recheck found the input side of #3 was open: purchase `lineas` had no `.max`; now `.max(100)` (same as devolucion). Venta/inventory have no line arrays in their schemas. Not verified: the non-compra id-list callers' own input caps beyond the zod arrays listed (`grep z.array(` shows only compra and devolucion).
- L5 (observations from the T3 prod screenshot, 2026-11-22, NOT fixed in T3): (a) the dashboard shows 'CxC — saldo pendiente -684.40' with 2 pending invoices: a negative receivable may be a legitimate credit-note surplus from the demo lane returns or a calculation bug; investigate in T7 before calling it fine. (b) the dashboard has its own 'SystemFact' header with 'Cerrar sesión' below the shell top bar; logout is only reachable from the dashboard: owner layout decision, ask.
- L6 (T5 scope note, 2026-11-22): the repo-wide sweep found 4 more files than the audit list (clientes/productos/proveedores `page.tsx` titles and `components/ui/dialog.tsx` scrim `bg-black/10` -> `bg-ink/10`); included in T5 under the same S6 intent. The invoice print stylesheet keeps literal hex on purpose (paper output). After T5 the app-wide guard passes with zero raw palette anywhere in `app/src`.
- L7 (follow-ups found by the commit review of T5 and the prod screenshots, NOT fixed, to raise with the owner in T7): (a) `FacturaPrintScreen.tsx` formats and compares money with `Number()` (`formatoMoney`, `Number(saldo.saldoPendiente) === 0`, `Number(data.subtotalExento)`), against AGENTS.md 'never number for money'; (b) `ReturnForm.tsx`: `obtenerVentaAction` without `.catch` (stuck on 'Loading...') and `devolverVentaAction` without `finally` (submit can stay locked); the same file still has English copy ('Loading sale lines…'); (c) dashboard 'CxC — saldo pendiente' shows -684.40 with 2 pending invoices; (d) dashboard keeps its own 'SystemFact' header with the only 'Cerrar sesión' under the shell top bar; (e) sidebar height follows the content, leaving white space on short pages.
- L8 (T7 final audit, 2026-11-22): final prod crawl as DEMO-admin, desktop only: 16 main routes clean (h1, no console/CSP errors, no failed requests, no unlabeled controls, `/caja` settles in ~2s, `/` ends on the dashboard, 404 is branded with no CSP violations); the crawl found T8. NEGATIVE CxC INVESTIGATED: not a calculation bug. Per-invoice saldo = total - collected - credit notes + debit notes (+ refunds) follows the canonical formula; the demo lane issues B04 credit notes (40.00) on invoices already paid in full (47.20) or partly paid (23.60), leaving per-invoice balances of -40.00 / -16.40 (a customer credit). The dashboard KPI 'CxC - saldo pendiente' SUMS those negatives with real receivables (net -684.40), so credits cancel receivables. DECISION FOR THE OWNER: keep the net, or clamp each invoice at 0 for the receivable KPI and show 'Saldos a favor' separately (recommended: separate, so a pending receivable is never negative). Not changed.
