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

- [ ] T1 S1,S2,S3,S5,S8(console.log) — PR-A: `/` redirect, not-found/error/global-error/loading, caja prefetch, Spanish heading, csp log. Route: inline. Commit: -
- [ ] T2 S7 — audit the six findMany, bound the growing ones with tests. Route: inline (verify if a tenant read changes). Commit: -
- [ ] T3 S6 — dashboard + token mapping check + guard test. Route: inline. Commit: -
- [ ] T4 S6 — Clientes, Productos, Proveedores (screens, forms, confirm dialogs) + guards. Commit: -
- [ ] T5 S6 — FacturaPrintScreen, ReturnForm/DevolverButton, reportes panels, inventario guard. Commit: -
- [ ] T6 S8 — E2E for dashboard, reportes, cobros sub-screens. Commit: -
- [ ] T7 close — prod crawl re-run as DEMO-admin (script: %TEMP%/sf-admin-check/crawl-all.cjs, needs demo-admin.pw), update memory, report.

Each PR: version bump (app/package.json + .release-please-manifest.json + app/CHANGELOG.md, no BOM),
tag + GitHub release after deploy + smoke. Release-please PR from the bot: ignore/close.

## Log

- L1 (owner, 2026-11-22, verbatim): "1- This project doesnt work in a mobile, just PC-keyboard and Touchscreen(TABLET OR PC TOUCHSCREEN). And looks good to have one tbh. The starter page is the login one. 2- We need it those pages, thx for the suggestions. 3- Fix it. 4- As I told you this project doesnt will be able in mobile screen. 5- Put it in spanish, thx. 6- Fix and follow the color from wireframe we used. 7- Check, recheck, evaluate, do an audit and follow as professional, practical, safe and security. 8- follow with the test. Just in case create a .md or try to dont forget to complete these process... Cause we need to complete it, and just in case we dont finish today, u can still have the context what we are, what we've done and what we need to do, as u know. REMEMBER ALWAYS CHECK, RECHECK, EVALUATE AND DO AN AUDIT BEFORE TO IMPLEMENT, remember the push->PR->deploy and if everythings good tag+release, ok?"
- L2 (audit evidence, 2026-11-22): prod crawl as DEMO-admin: 12 sidebar routes load OK (h1, no console errors, no failed requests, no unlabeled inputs). Findings: no error/loading/not-found files exist; `/` still the starter template (`app/src/app/page.tsx`); `/caja` desktop never reaches networkidle because `<Link>` prefetch of `/api/caja/cierre-pdf` hangs; default 404 logs CSP script violations; `/venta` h1 "Point of sale"; raw palette in dashboard/clientes/productos/proveedores/factura print/devolucion/reportes panels (no guard); six findMany without take; no e2e for dashboard/reportes/cobros sub-routes. `/ventas` 404 was a wrong guess of the audit (real route `/venta`).
- L3 (decision, 2026-11-22): the `console.log` in `app/src/lib/security/csp-report.ts:211` is INTENTIONAL (one structured JSON line per CSP violation, read in the Vercel logs); kept, not removed. S8's first half is therefore closed by this note. Local build shows `/_not-found` is now dynamic (`ƒ`), which is what gives it a CSP nonce; the real proof is the authenticated prod crawl of an unknown URL after deploy (T1 is not done until that shows zero console CSP errors).
