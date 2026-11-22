## [0.47.6](https://github.com/Wilfredery/SystemFact/compare/v0.47.5...v0.47.6) (2026-11-22)

### Fixed

* **factura impresa:** the printable invoice no longer formats or compares money through floating-point numbers. Amounts print through the shared money formatter and zero checks (discount, exempt subtotal, pending balance, line discount) use exact decimals. The printed document is unchanged for normal values. The invoice state is now typed from the schema (VIGENTE/CANCELADA/ANULADA), so a new state cannot silently print the "anulado" banner.

## [0.47.5](https://github.com/Wilfredery/SystemFact/compare/v0.47.4...v0.47.5) (2026-11-22)

### Fixed

* **selector de sucursal:** the branch dropdown showed the branch's database id (for example `4`) instead of its name; it now shows the name, with `(actual)` on the current branch, the same text as in the open list. The page title is now a real level-1 heading (the page had none). Found by the final production crawl of the screen audit; covered by two new unit tests.

## [0.47.4](https://github.com/Wilfredery/SystemFact/compare/v0.47.3...v0.47.4) (2026-11-22)

### Changed

* **design system (screen audit, T5):** the last screens on raw Tailwind colors move to the design-system tokens of the wireframe-aligned boards: the printable invoice screen, the return form and its button, the fiscal and operational report panels, the dialog backdrop and the page titles of Clientes, Productos and Proveedores. The unused `dark:` variants are gone. The invoice's print stylesheet keeps its own literal colors on purpose (paper output must not depend on a theme).
* **guard:** one app-wide test now scans every component and page under `app/src` and fails on any raw palette class, arbitrary color or `dark:` variant, so a new file is covered the moment it exists. It replaces the need to keep per-screen lists.

## [0.47.3](https://github.com/Wilfredery/SystemFact/compare/v0.47.2...v0.47.3) (2026-11-22)

### Changed

* **clientes, productos, proveedores (screen audit, T4):** the three master-data screens, their create/edit forms and their deactivate dialogs use the design-system tokens of the wireframe-aligned boards instead of raw Tailwind colors: primary buttons on the accent green, inputs and tables on `line`/`surface`, table headers on `surface-muted`, the Activo badge on the `success` pair, the Inactivo badge muted, error notices on `danger` and the success notice on `success`. The unused `dark:` variants are gone. One guard test covers all nine files. Layout and copy are unchanged.

## [0.47.2](https://github.com/Wilfredery/SystemFact/compare/v0.47.1...v0.47.2) (2026-11-22)

### Changed

* **dashboard (screen audit, T3):** the dashboard header, greeting, alerts and KPI tiles (also shown on `/reportes`) use the design-system tokens of the wireframe-aligned boards instead of raw Tailwind colors: logo tile on the accent green, text on `ink`/`ink-muted`, borders on `line`, the role notice on the `warn` pair and the error notice on `danger`. The unused `dark:` variants are gone (the design system is light-only). A source-level guard test keeps raw palette, arbitrary colors and `dark:` out of both files. Layout and copy are unchanged.

## [0.47.1](https://github.com/Wilfredery/SystemFact/compare/v0.47.0...v0.47.1) (2026-11-22)

### Fixed

* **compra:** a purchase (create and draft edit) now accepts at most 100 lines, the same bound as returns. The lines feed `id IN (...)` lookups and had no upper limit.
* **producto:** the category selector of the products screen is capped at 200 rows (the value the inventory category filter already uses). Audit of the other five `findMany` without a limit found them bounded by their input or a calculation input where a cap would silently corrupt the result (balances, mora, reversed-payment audit rows, role validation), so they stay as they are.

## [0.47.0](https://github.com/Wilfredery/SystemFact/compare/v0.46.1...v0.47.0) (2026-11-22)

### Added

* **boundaries (screen audit, PR-A):** branded Spanish pages on the design-system tokens for a page that does not exist (`not-found`, 44px targets, link home), for a failed screen (`error`, inside the app shell for the authenticated area, plus a `global-error` last resort; they show only an opaque reference code, never the error message) and for a screen that is loading (`loading`, announced as a busy status). The 404 renders per request, so Next can stamp the CSP nonce on its scripts: the default 404 logged two Content-Security-Policy script violations in the browser console.

### Changed

* **root:** `/` redirects to the login (an authenticated user is bounced to the dashboard by the proxy). The create-next-app starter page and its five starter `public/*.svg` files are gone; the security-headers e2e that used `/next.svg` as its static-asset probe now uses a dedicated `public/asset-probe.svg`.
* **venta:** the POS heading is now "Punto de venta" (was "Point of sale"); the e2e specs and the production smoke/demo lanes that wait for it follow.

### Fixed

* **caja:** the "Exportar PDF" link no longer triggers Next's viewport prefetch. That prefetch fired a `_rsc` request at the PDF route handler on every page view and it never completed, so the page never went network-idle on desktop.

## [0.46.1](https://github.com/Wilfredery/SystemFact/compare/v0.46.0...v0.46.1) (2026-11-22)

### Changed

* **e2e:** the local Playwright config no longer offers the opt-in Vercel protection-bypass header (`E2E_PROTECTION_BYPASS`). It contradicted the project rule of no protection-bypass option at all; no workflow or document used it. A guard test now pins that the config never offers one. Nothing the deployed app serves changed.

## [0.46.0](https://github.com/Wilfredery/SystemFact/compare/v0.45.0...v0.46.0) (2026-11-21)

### Added

* **auditoria (UI/UX board 09, slice C):** the audit table has an `Anterior → Nuevo` column. It shows values only for a hard, default-deny allowlist: Producto CREAR (code and ITBIS rate), Producto CANCELAR (Activo/Inactivo) and Producto LEER (result count); every other row shows a dash, because the other writers store personal data, amounts, NCFs, costs or free text.

### Security

* **auditoria:** the raw `valorAnterior`/`valorNuevo` columns no longer leave the repository. Before this release they were sent to the browser in every audit row (hidden by the UI but readable in the response by an administrator); now the row carries only the allowlisted, server-built display text, and a malformed or unexpected payload yields no text at all.

## [0.45.0](https://github.com/Wilfredery/SystemFact/compare/v0.44.0...v0.45.0) (2026-11-21)

### Added

* **auditoria (UI/UX board 09, slice B):** the audit table shows the user's login name (with the company-code prefix, full name on hover) and the branch name instead of numeric ids, and the Usuario and Sucursal filters are now selects ("Todos" / "Todas" first) fed by the company's users (capped at 500, active first) and branches. Inactive users and branches stay selectable and are labelled, because old audit rows reference them. The names come from the same page query inside the existing company-wide read window, behind the same admin gate; only login name, full name and active flag leave the server. The old → new values stay hidden (separate decision).

## [0.44.0](https://github.com/Wilfredery/SystemFact/compare/v0.43.1...v0.44.0) (2026-11-21)

### Added

* **auditoria (UI/UX board 09, slice A):** the audit screen aligns to the factura.penpot wireframe 09 — a `Solo Administrador` badge, the wireframe subtitle, the footer note "Registro de auditoría — Solo lectura · Inmutable (append-only)", the six columns in wireframe order with the new `Entidad` column (`scope="col"` headers), the whole screen on the F0 design-system tokens pinned by a no-raw-palette guard, 44px touch targets and accessible names equal to the visible labels. The `Auditoría` sidebar link is now shown to administrators only; the server-side gate of `/auditoria` is unchanged and stays the real security. Not in this slice (separate decisions): user and branch names with selects, and the old → new values, which stay hidden.

## [0.43.1](https://github.com/Wilfredery/SystemFact/compare/v0.43.0...v0.43.1) (2026-11-21)

### Changed

* **login (UI/UX board 01):** the card follows the wireframe copy ("Inicia sesión para continuar.", button "Iniciar sesión") and shows the `CÓDIGO-usuario` format hint under the username field. The inert "Recuperar contraseña" control (a focusable fake link; self-service reset cannot exist because the sign-in email is not a real mailbox, ADR-014) is replaced by plain text pointing to the administrator. The username field disables phone auto-capitalisation, autocorrect and spell-check, and the error alert is linked to both fields (`aria-invalid`, `aria-describedby`). No auth logic, error message or format check changed, so login stays a non-enumeration surface. The shared E2E login helper follows the new button name.

## [0.43.0](https://github.com/Wilfredery/SystemFact/compare/v0.42.2...v0.43.0) (2026-11-21)

### Added

* **multi-company (company code):** every company now has a mandatory, immutable `EMPRESA.codigo` (3-6 characters `A-Z0-9`, unique, never reused) and every username is `<CODIGO>-<usuario>` (for example `DEMO-admin`), both enforced in the database by triggers (`empresa_codigo_immutable`, `usuario_nombre_prefijo_guard`) and validated in the app. Login stays lenient and canonicalises what is typed (`demo-Admin` -> `DEMO-admin`) without adding any new error, so it is not an enumeration oracle. New operator script `provision-empresa.ts` creates a company (code, first branch, roles, settings, its OWN NCF ranges, first administrator) in one transaction, dry-run by default. Seeds, CI fixtures and docs follow the new rule. Decision record: `odd/tasks/multi-company-codigo.md` (ADR-021).

### Changed

* The production test users are renamed with the `DEMO-` prefix at rollout, together with their Supabase Auth emails and the `PROD_USER`/`DEMO_USER` secrets.

## [0.42.2](https://github.com/Wilfredery/SystemFact/compare/v0.42.1...v0.42.2) (2026-11-21)

### Fixed

* **security (tenant kill switch):** `Empresa.activa` was declared but never enforced. Login now refuses a user of an inactive company (new stable code `AUTH_EMPRESA_INACTIVA`, session signed out, not counted as a throttle attempt) and every per-request session resolves to no session for an inactive or unreadable company (fail closed). A new database trigger (`empresa_activa_guard`) makes `EMPRESA.activa` changeable only in bootstrap mode, closing the hole where any tenant session could flip its own company's flag through `empresa_modify`. Production has one company and it is active, so no tenant is affected. The migration is applied to production separately, on the owner's approval.

## [0.42.1](https://github.com/Wilfredery/SystemFact/compare/v0.42.0...v0.42.1) (2026-11-21)

### Fixed

* **administracion:** the tab bar follows the WAI-ARIA tabs pattern — roving tabindex, ArrowLeft/ArrowRight (wrap), Home and End move focus only, Enter/Space activate; and a link to `/administracion` without `tab` but with `busqueda`, `activo` or `page` opens the Usuarios tab again, so old bookmarks keep their filters.

## [0.42.0](https://github.com/Wilfredery/SystemFact/compare/v0.41.0...v0.42.0) (2026-11-21)

### Added

* **administracion (UI/UX board 08):** the Administración screen aligns to the factura.penpot wireframes 08a/08b/08c — five tabs in wireframe order (Empresas, Sucursales, Usuarios, Roles, Configuración) opening on Empresas; a read-only Empresas tab (company and all its branches with how many are active, no create/edit/delete: no company write use case exists and master entities are never deleted); a read-only Roles tab fed by the new server-gated `listarRolesAdministracionAction`; a "Buscar sucursal..." search on Sucursales; the Usuarios Roles column lists every role joined with " · "; tablist/tabpanel accessibility semantics; the whole admin scope retrofits to the F0 design-system tokens, pinned by a source-level no-raw-palette guard. NCF sequences stay read-only and there is no global "Guardar cambios" (per-card edits keep their own confirm).

## [0.41.0](https://github.com/Wilfredery/SystemFact/compare/v0.40.0...v0.41.0) (2026-11-20)

### Added

* **reportes (UI/UX board 07):** Rentabilidad por producto and Analítico comparativo align to the factura.penpot wireframes 07a/07b — the 07a table adopts the wireframe columns (Ventas and Costo in; Inversión/Capital as KPI tiles), with a TOTAL row sourced from the same page-independent summary as the CSV footer; the 07b comparativa renders per-period rows (actual/anterior) with Variación RD$/% columns; KPI tiles on both boards; the whole board scope retrofits to the F0 design-system tokens (31 raw-palette sites, source-level no-raw-palette guard).

### Fixed

* Rentabilidad Costo is the true COGS (Salida × costoPromedio — the term the margin subtracts), and the margen derives from the rounded costo so Ventas − Costo = Margen holds to the cent; the CSV export gains the Costo column for EXP-2 parity (JD dual review round 1, CRITICAL).
* Reportes route shell error/empty states and the report selector use semantic tokens; two integration dead bindings removed.
## [0.40.0](https://github.com/Wilfredery/SystemFact/compare/v0.39.0...v0.40.0) (2026-11-20)

### Added

* **caja (UI/UX board 06):** the Cierre diario de caja and Resumen del día screens align to the factura.penpot wireframes 06a/06b — the whole module retrofits to the F0 design-system tokens (23 raw-palette sites, source-level no-raw-palette guard), the negative Diferencia KPI renders with the danger token, the disabled Cerrar caja control adopts the shared disabled recipe, and the method table gains proper column semantics. Behavior decisions kept: the day is server-derived (America/Santo_Domingo, no date control) and Cerrar caja stays disabled — the close is a derived report, never stored.

### Fixed

* CajaScreen converted to a server component (zero interactivity): no client JS shipped for the view (AGENTS.md server-by-default, gga adjudication).
* Two integration-test dead bindings removed (lint hygiene).
## [0.39.0](https://github.com/Wilfredery/SystemFact/compare/v0.38.2...v0.39.0) (2026-11-20)

### Added

* **compra (UI/UX board 05):** the purchase screens align to the factura.penpot wireframes 05a/05b — a nota-fiscal banner whose NCF kind shares the Comprobante line source (B01 for MERCANCIA, B11 otherwise; retention law figures as owner-approved fixed copy), the shared F0 NumericKeypad on Cantidad and Costo unitario (first tap replaces the focused value, later taps append, keypad closes on non-keypad focus), and "Ver detalle" granted to every read role while write actions stay Administrador-gated.
* **compra + inventario (F0 retrofit, boards 04–05):** every raw Tailwind palette class in the compra UI (list, form, CxP panel, cancellation dialog, route shell) and the inventario screens maps to system.md tokens, guarded by a source-level no-raw-palette test.
* **inventario (UI/UX board 04):** consulta and ajuste aligned to wireframe 04 — row menu with ajustar-prefill and exact product history filter, frozen MOTIVOS_AJUSTE enum, NumericKeypad quantities, top-right +Ajustar CTA, Disponible copy, --success foreground token.

### Fixed

* compra draft-edit keypad no longer silently corrupts stored quantities/costs (first-tap-replace rule pinned by tests); two stale lint warnings removed.

## [0.38.1](https://github.com/Wilfredery/SystemFact/compare/v0.38.0...v0.38.1) (2026-11-19)

### Fixed

* **smoke/demo lanes:** the production smoke now covers the new `/cobros/factura/[facturaId]` route and matches the board-03 F0 markup; the demo POS helper follows the shipped post-confirm flow (S5 receipt navigation, collapsed draft list S6) and validates the NCF grammar on both surfaces. Test-only; no production code changed.

## [0.38.0](https://github.com/Wilfredery/SystemFact/compare/v0.37.3...v0.38.0) (2026-11-19)

### Added

* **venta (UI/UX board 02):** the POS aligns to the factura.penpot wireframe — Despachador granted POS access per the wireframe role map (ROLES_VENTA), quick-amounts row (exact/RD$100/200/500/1000/2000/5000) beside the on-screen numeric keypad, per-line ITBIS-rate chips, cash-only sales navigate to the generated receipt, drafts collapsed by default, server-side role matrix pinned by tests.
* **cobros (UI/UX board 03):** Cobrador joins the collections role matrix per the wireframe; board shows client names and days outstanding; KPI strip (total pendiente / facturas pendientes / en mora) computed from the canonical ADR-017 saldo; search plus "Próximas a vencer" panel; new per-invoice detail route with payment history; payment form gains a server-banded fecha del pago and optional referencia (new Pago.referencia column, migration 20261118120000); confirmation is an explicit F0 modal with the shared keypad; the whole module retrofits to F0 tokens.
* **inventario (UI/UX board 04):** consulta rows gain a manage-group ⋯ menu (Ajustar prefills the adjust form with the product's code; Historial opens the movement history filtered by EXACT product code, a new `productoCodigo` filter taking precedence over the free-text search); "Cantidad a ajustar" label with the shared NumericKeypad; the manual-adjustment reason becomes a frozen `MOTIVOS_AJUSTE` enum enforced at the zod transport and domain boundary before composition; the UI retrofits to F0 tokens/primitives with a new `--success-fg` WCAG-AA token.

### Fixed

* Judgment-Day dual review remediations across the three boards: cash sale no longer navigates away before the crédito verdict/NCF banner renders; hidden return button for roles the server rejects; payment modal can no longer be closed during an in-flight confirm (double-coBRO guard); fecha del pago horizon config read lazily; a per-row menu rendered only with the server-granted permission; keypad decimal edge states; stale docblock comments and idempotency notes corrected.

## [0.37.3](https://github.com/Wilfredery/SystemFact/compare/v0.37.2...v0.37.3) (2026-11-18)

### Fixed

* **cobros/devolucion:** security hardening from the scoped audit (owner-approved): the `DEVOLUCION:` idempotency-key namespace is reserved server-side — a manual refund claiming it (any casing) is rejected with the new stable code `PAGO_IDEMPOTENCIA_RESERVADA` before any lookup, so it can no longer pre-block a predictable future return; the devolución auto-refund now uses its own entry point that mints those keys. Branch-GUC restores moved to `finally` in the cobros receipt allocator, the idempotency lookup, and the compra correlativo. The return flow locks FACTURA before EMPRESA and inventory (global FACTURA→EMPRESA→INVENTARIO, same order as the cobro/refund paths), removing a cross-flow deadlock window, and fails closed if the invoice stops being VIGENTE under the lock. The audited role exception is documented: the automatic refund runs under the return's role gate and is capped at the ITBIS-inclusive value of the returned goods and the cash actually collected; free-form manual refunds stay Administrador-only.

## [0.37.2](https://github.com/Wilfredery/SystemFact/compare/v0.37.1...v0.37.2) (2026-11-18)

### Fixed

* **devolucion:** credit notes and cash refunds now net on the ITBIS-inclusive basis in every CxC balance (canonical ADR-017 aggregate, its coupling fragment, the row-locked payment-gate recompute, and the estado de facturas report grid). A fully returned CONTADO sale no longer computes a negative saldo — it nets to exactly 0.00, matching what DGII 607/IT-1 already report. The return flow also auto-registers the cash refund (`REEMBOLSO`) bounded by what the cliente actually paid, takes the EMPRESA row lock first (removing a deadlock cycle against a concurrent sale confirmation), and rolls back the whole return if the refund is rejected.

## [0.37.1](https://github.com/Wilfredery/SystemFact/compare/v0.37.0...v0.37.1) (2026-11-17)

### Fixed

* **venta:** CONFIRMADA rows in the POS "My drafts" list now carry a "Ver factura" link to the print view `/venta/factura/{facturaId}` (the list rows expose the linked invoice's id) — closing the discoverability gap the changelog previously documented as future work. **ci:** the production-demo CSP walker resolves the new `[facturaId]` dynamic segment from the estado de cuenta UI (its own UI-derived id discipline), which un-blocks the demo lane after the print view shipped.

## [0.37.0](https://github.com/Wilfredery/SystemFact/compare/v0.36.2...v0.37.0) (2026-11-17)

### Features

* **venta:** the fiscal invoice now prints. After confirming a sale, `/venta/factura/{facturaId}` (reachable for Administrador/Operador; a POS shortcut link is future work) renders the persisted VIGENTE invoice as a print-ready document following DGII 254-06/NG 06-2018: voucher denomination per type top-right, the NCF visible with its expiry date resolved from the sequence range that contains it (never hardcoded, never "today's" range), emisor identity (name/RNC/address/phone/sucursal), receptor identity (RNC for B01), the frozen sale lines, ITBIS desglosado per rate (pure aggregation of the frozen line rates — a later TASA_ITBIS edit can never rewrite a past invoice), descuento, total, and forma de pago derived from the ADR-017 canonical balance. The view is a representation of the persisted record: it mints no NCF and mutates nothing; CANCELADA/ANULADA invoices render prominent banners (sin efecto fiscal / reportado en el 608). First real print CSS in the app (`@media print` isolation so only the document prints, `@page` margins; scripts stay nonce-only under the enforced CSP). Visual output verified by print-media emulation screenshots + PDF (odd/tasks/factura-print.md L3); local lane 32 passed / 0 failed; server-side role gates on every path.

## [0.36.2](https://github.com/Wilfredery/SystemFact/compare/v0.36.1...v0.36.2) (2026-11-17)

### Fixed

* **security:** the CSP report endpoint now bounds log volume across requests, not just within one: a per-instance token budget (30 lines per rolling 60 s window) sits in front of the logger, so repeated small POSTs can no longer grow log volume without bound. Stated honestly in code: this is real protection per serverless instance and no global guarantee — the durable global cap belongs to a Vercel Firewall rate rule on this path, recommended in the tracker for the dashboard owner; dropped reports still answer 204, so the browser contract never changes. Also: the overclaiming comments ("a hostile POST cannot buy log lines") now say exactly what the code enforces, and the declared-`Content-Length` short-circuit branch (untested — a string-built Request carries no content-length) has dedicated tests both over and under the cap.
* **ci:** the version-bump guard now reads `git diff --name-only -z` and parses by NUL without trimming, so git C-quoted paths (quotes, backslashes, control chars) and real filenames with leading/trailing spaces are classified correctly instead of misread into false failures; the root-anchoring comment now states that a slash-less pattern is deliberately stricter than gitignore; and the exempt-list comment is now truthful after the AGENTS.md amendment adds `**/*.test.tsx`/`**/*.spec.tsx` (the rule exempts tests, not one extension — the project ships RTL `.test.tsx` suites).

## [0.36.1](https://github.com/Wilfredery/SystemFact/compare/v0.36.0...v0.36.1) (2026-11-17)

### Fixed

* **ci:** the version-bump guard now verifies that the version actually INCREASED (app/package.json strictly greater at HEAD than at the base, and .release-please-manifest.json agreeing), not merely that one of the three version files was touched — so a one-byte CHANGELOG edit no longer satisfies the guard, and an `app/package.json`-only change with runtime fields (dependencies, engines) and an unchanged version now fails instead of shipping untagged. The job also diffs the live `origin/<base_ref>` instead of the event-frozen PR base sha, matching the `commits` job, so a master that advances mid-PR can no longer make the guard name paths the PR never touched. All three defects were found and confirmed by the Judgment Day audit before the fix; 45 node:test cases cover the new rule.


## [0.36.0](https://github.com/Wilfredery/SystemFact/compare/v0.35.1...v0.36.0) (2026-11-16)

### Features

## [0.35.2](https://github.com/Wilfredery/SystemFact/compare/v0.35.1...v0.35.2) (2026-11-16)

### Changed

* **ci:** the release-bump rule from AGENTS.md (2026-11-04 amendment) is now enforced mechanically: a new `version-bump` job in the CI gate runs `app/tools/scripts/check-version-bump.mjs`, which fails the PR when any non-exempt path changed (app/src/**, app/prisma/**, next.config.ts, proxy.ts, runtime package.json fields, .github/workflows|actions/**) and none of app/package.json, .release-please-manifest.json or app/CHANGELOG.md did. Exempt paths (docs/**, odd/**, *.md, README*, LICENSE*, *.test.ts(x), *.spec.ts(x), app/tools/**) ride into the next changelog without paying a tag, exactly as the rule reads. The guard's glob and decision logic is covered by 42 node:test cases; this PR's own diff is non-exempt and carries its bump.
## [0.35.1](https://github.com/Wilfredery/SystemFact/compare/v0.35.0...v0.35.1) (2026-11-16)

### Changed

* **security:** the development-only dependency audit is now clean: zero known vulnerabilities across the whole project (production was already clean). Upgrades, quoted per the dependency rule: shadcn 4.21.4 -> 4.23.0 (upstream release notes: shadcn 4.22.0 moves the CLI to Zod 4 and 4.23.0 switches the MCP server to the TypeScript SDK v2, which clears the high-severity zod advisory GHSA-mrhx-c7xc-m3w5 from the dev tree), and two cross-major overrides to the now-patched versions glob 14.0.2 (GHSA-3g3m-2fjr-6pw4, AbortSignal cancellation bypass) and minimatch 11.0.1 (GHSA-3h5v-q93c-6h6q, globparts amplification). Nothing that runs in production changes: these are developer tools, so no deploy and no release artifacts beyond the version files. Verified with the full green suite including an eslint run (the minimatch chain) and a jest coverage run (the glob chain), plus integration tests and the production build.

## [0.35.0](https://github.com/Wilfredery/SystemFact/compare/v0.34.13...v0.35.0) (2026-11-16)

### Features

* **itbis:** the Configuración tab in Administración now has a card to edit the company's list of allowed ITBIS rates (TASA_ITBIS, today 18,16,0), Administrador only (odd/tasks/itbis-tasas-edit.md, first MINOR release under the confirmed versioning rule). The screen shows the current list and its validity window; you type the new comma-separated list and save. Saving closes the current validity window at the change moment and opens a new row from it, so history is preserved and no past document changes: the new list governs from the moment of the save onward. Saving the same list again is a no-op. The form validates the format (comma-separated values between 0 and 100, no duplicates, no empty items) before sending, and the server re-checks with the same rules; a simultaneous edit by another admin returns a clear conflict message instead of overwriting. Every change writes one audit entry. The card carries a caution: confirm the legality of any new rate with your accountant before saving it; the screen enforces the format, not the legality. A database migration now restricts writes on the configuration table to Administrador sessions at the database level as well (SELECT unchanged; rows are never deleted through the application); the migration must be applied before deploying this release.

## [0.34.13](https://github.com/Wilfredery/SystemFact/compare/v0.34.12...v0.34.13) (2026-11-16)

### Changed

* **itbis:** the old hardcoded list of ITBIS rates in the code (`0, 16, 18`) was deleted (odd/tasks/itbis-tasas-config.md, sub-slice 3g, end of the feature). Nothing a visitor or user sees changes: the allowed rates come from the company's database list (`TASA_ITBIS`, today `18,16,0`) since the previous slices, and sales, purchases and products already validate against it (returns keep validating the frozen line rate by shape only, by design). The only code-level remnant is the static fallback sentence in the product error catalog, kept byte-identical ("La tasa de ITBIS debe ser 0%, 16% o 18%") for the generic default copy. From now on, changing a company's allowed rate set is a reviewed database change, not a code change. Also added a test pinning that editing a purchase validates its lines against the purchase's own stored date.

## [0.34.12](https://github.com/Wilfredery/SystemFact/compare/v0.34.11...v0.34.12) (2026-11-16)

### Features

* **itbis:** a purchase now validates each line's ITBIS rate against the company's list of allowed rates stored in the database (`TASA_ITBIS`, today `18,16,0`) at the purchase date, instead of a fixed set in the code (`odd/tasks/itbis-tasas-config.md`, sub-slice 3e). The accepted rates do not change (the same three). A well-formed rate that is no longer in the list (a retired rate, for example 7) refuses the purchase at draft time with `LINEA_INVALIDA` — you must fix the product's rate before the purchase can be saved; an editing purchase is validated against its own stored date, so changing its date is not required to keep editing. If the `TASA_ITBIS` configuration is ever missing, the purchase create and edit fail with the stable error `TASA_ITBIS_CONFIG_FALTANTE` instead of using a silent default. The purchase form on screen now only checks that the typed values are well-formed; whether the product's rate is allowed is decided by the server at save. The purchase code no longer borrows the product module's rate constants (the two domains are independent). Covered by real-database tests (full confirmed purchase at 18/16/0; a retired rate refused and a missing configuration fail on the previous code).

## [0.34.11](https://github.com/Wilfredery/SystemFact/compare/v0.34.10...v0.34.11) (2026-11-16)

### Features

* **itbis:** a sale now validates each line's ITBIS rate against the company's list of allowed rates stored in the database (`TASA_ITBIS`, today `18,16,0`) at the sale date, instead of a fixed set in the code (`odd/tasks/itbis-tasas-config.md`, sub-slice 3d). The accepted rates do not change (the same three); a product whose stored rate is written with extra zeros (`18.00`) is now accepted because it matches the list numerically. A well-formed rate that is no longer in the list (a retired rate, for example 7) refuses the sale at draft/prepare time with `LINEA_INVALIDA` — per the owner's decision, you must fix the product's rate before the sale can be saved; confirmed sales are never affected. If the `TASA_ITBIS` configuration is ever missing, the sale save fails with the stable error `TASA_ITBIS_CONFIG_FALTANTE` instead of using a silent default. The cart on screen now only checks that the typed values are well-formed; whether the product's rate is allowed is decided by the server at save. Covered by real-database tests (full sale at 18/16/0 already covered; a retired rate refused and a missing configuration fail on the previous code).

## [0.34.10](https://github.com/Wilfredery/SystemFact/compare/v0.34.9...v0.34.10) (2026-11-16)

### Features

* **itbis:** the product screens no longer crash on a product whose stored ITBIS rate is not in the company's list of allowed rates (`odd/tasks/itbis-tasas-config.md`, sub-slice 3c). Before, the product list, detail and search threw an error for such a product; now it is shown normally, with its rate followed by a **(retirada)** marker in the table and as a selected **"N% (retirada)"** option in the edit form, so an old product never shows a blank or wrong rate. The rate options in the product form now come from the company's database list (`TASA_ITBIS`, today `18%`, `16%`, `0% (exento)` in that order, default 18%) instead of a fixed list in the code. Nothing changes for the rates in use today. If the `TASA_ITBIS` configuration is ever missing, the product list, detail and search (including the product pickers in sales and purchases) fail with the stable error `TASA_ITBIS_CONFIG_FALTANTE` instead of using a silent default. Covered by a real-database test that fails on the previous code with the original crash.

## [0.34.9](https://github.com/Wilfredery/SystemFact/compare/v0.34.8...v0.34.9) (2026-11-16)

### Features

* **itbis:** creating or editing a product now checks the ITBIS rate against the company's list of allowed rates stored in the database (`TASA_ITBIS`, today `18,16,0`) instead of a fixed set in the code (`odd/tasks/itbis-tasas-config.md`, sub-slice 3b). The accepted rates do not change (the same three). What changes: a rate written with extra zeros (`18.00`, `18.0`, `018`) was rejected before and is now accepted and stored in its normal form (`18`); a well-formed rate that is not allowed (for example 19) now returns the clear error `TASA_ITBIS_INVALIDA` ("La tasa de ITBIS debe ser 0%, 16% o 18%") instead of the generic validation error; a malformed rate (empty, text, negative) still returns the validation error. An old product whose rate is no longer in the list can still be edited as long as its rate is not changed. If the `TASA_ITBIS` configuration is ever missing, the product create and edit fail with the stable error `TASA_ITBIS_CONFIG_FALTANTE` instead of using a silent default. Covered by a real-database test that fails on the previous code.

## [0.34.8](https://github.com/Wilfredery/SystemFact/compare/v0.34.7...v0.34.8) (2026-11-16)

### Bug Fixes

* **devolucion:** a return now validates the ITBIS rate FROZEN on the original sale line by shape only, not against the company's current list of allowed rates (`odd/tasks/itbis-tasas-config.md`, sub-slice 3f). Nothing changes for the rates in use today (18, 16, 0); the fix makes sure that when a rate is retired from the list later, sales made at that rate can still be returned with their original rate. Malformed rates (empty, non-numeric, negative, above 100, more than 2 decimals) are still refused with `LINEA_INVALIDA`. Covered by a real-database test that fails on the previous validation.

## [0.34.7](https://github.com/Wilfredery/SystemFact/compare/v0.34.6...v0.34.7) (2026-11-16)

### Maintenance

* **itbis:** sub-slice 3a of making the app read the allowed ITBIS rates from the database (`odd/tasks/itbis-tasas-config.md`). Adds the pure parser of the `TASA_ITBIS` comma list (rejects empty, duplicate, non-decimal, more than 2 decimals and rates above 100), the rate labels, the sentence builder, the stable error `TASA_ITBIS_CONFIG_FALTANTE` ("Falta la configuración TASA_ITBIS requerida; no se puede validar la tasa de ITBIS") and the reader `leerTasasItbisEnTx`. **Nothing calls them yet**, so there is no visible change; the following sub-slices wire the product, sale, return and purchase paths one at a time. The integration fixtures now provision `TASA_ITBIS = 18,16,0` for both test companies.

## [0.34.6](https://github.com/Wilfredery/SystemFact/compare/v0.34.5...v0.34.6) (2026-11-15)

### Features

* **itbis:** slice 2 of moving the allowed ITBIS rate list to the database (`odd/tasks/itbis-tasas-config.md`). A data migration, `20261115140000_seed_tasa_itbis`, provisions the `TASA_ITBIS` key (`18,16,0`: exactly the rates allowed today) for every existing empresa in `CONFIGURACION_EMPRESA`, idempotent (`ON CONFLICT DO NOTHING`, never updates or demotes an existing row). `pnpm seed:venta` provisions the same key for new environments and `pnpm config:verify` now checks it. **Nothing reads the new row yet** (slice 3), so applying it changes no behavior. The migration must run as a role that bypasses row-level security (production `postgres` does); verify after applying that the `TASA_ITBIS` row count equals the empresa count.

## [0.34.5](https://github.com/Wilfredery/SystemFact/compare/v0.34.4...v0.34.5) (2026-11-15)

### Maintenance

* **itbis:** slice 1 of moving the allowed ITBIS rate list to the database (`odd/tasks/itbis-tasas-config.md`). The five hardcoded copies of the set `0 / 16 / 18` (product domain and zod validations, sale calculators, return calculators, product form options) now come from ONE shared pure constant, `app/src/shared/domain/tasas-itbis.ts`. **No behavior change:** same accepted rates, same error codes and message ("La tasa de ITBIS debe ser 0%, 16% o 18%"), same form options and order. Checked by a differential run of 20 input values through 5 validators on the old and the new code: byte-identical output. No migration, nothing stored differently. The next slices add the per-empresa `TASA_ITBIS` list in the database (owner applies that migration) and then make the application read it.

## [0.34.4](https://github.com/Wilfredery/SystemFact/compare/v0.34.3...v0.34.4) (2026-11-15)

### Maintenance

* **lint:** removes 15 unused imports (0 warnings left in `src`): `auth/http/actions.login.ts` (3), `devolucion/http/actions.devolver.ts` (5), `devolucion/http/actions.shared.ts` (6) and one unused type in `venta/ui/__tests__/carro.spec.ts`. They were leftovers of the actions split in #82 (logout and current-user live in `actions.logout.ts` / `actions.user.ts`; the return action still checks the role, runs in `withTenantTransaction` and calls `crearDevolucion`). No behavior change.

## [0.34.3](https://github.com/Wilfredery/SystemFact/compare/v0.34.2...v0.34.3) (2026-11-15)

### Maintenance

* **deps:** dev-scope security advisories **35 -> 4** with patch/minor-level overrides in `app/pnpm-workspace.yaml`, one selector per vulnerable major with an upper bound (brace-expansion 1/2/5, handlebars 4 [2 critical], undici 7, systeminformation 5, body-parser 2, hono 4, @hono/node-server 2, qs 6, js-yaml 4), each with its GHSA ids in a comment. None of these packages is in the production dependency graph (`pnpm ls --prod` empty, `pnpm audit --prod --audit-level high` clean before and after), so production code is unchanged. Four advisories stay on purpose, documented in the same file: zod 3.x (patched only in 4.x), deepmerge (no patched version), glob 10 and minimatch 9/10 (patched only in a new major of the consumer). Verified: tsc, eslint, jest 225 suites / 2423 tests and the production build all pass.

## [0.34.2](https://github.com/Wilfredery/SystemFact/compare/v0.34.1...v0.34.2) (2026-11-15)

### Maintenance

* **engines:** `engines.node` is now `>=24.0.0`, the version CI, Vercel and `@types/node` already use (Playwright 1.65 no longer tests Node 20). Anyone installing on Node 20 or 22 now gets the engines warning.
* **ui:** `formatearFechaHoraSD` moves from `auditoria/ui/format` to `shared/ui/format` (the Inventario movements screen was importing it from another module). Same output (`15/09/2026, 00:00:00`), now with two unit tests; no visible change.

## [0.34.1](https://github.com/Wilfredery/SystemFact/compare/v0.34.0...v0.34.1) (2026-11-15)

### Maintenance

* **ci:** Playwright **1.57.0 → 1.65.1** (exact pin, lockfile touches only `@playwright/test`, `playwright`, `playwright-core`; the optional `fsevents` is dropped upstream). Playwright supports Ubuntu 26.04 since 1.61.0 (release notes: "Playwright now supports Ubuntu 26.04"), so the three Playwright workflows (`ci.yml` e2e job, `prod-smoke.yml`, `prod-demo.yml`) go back from the `ubuntu-24.04` pin to `ubuntu-latest`. Upstream breaking changes between 1.57 and 1.65 reviewed against this suite: none applies (no page-object classes, `tsconfig` target ES2020, `test.skip(condition, reason)` unchanged, Node 24 in CI); 1.64 now forwards `screen` from `devices["Desktop Chrome"]`. Runtime code is unchanged. `pnpm audit --prod --audit-level high`: no known vulnerabilities.

## [0.34.0](https://github.com/Wilfredery/SystemFact/compare/v0.33.0...v0.34.0) (2026-11-15)

### Features

* **tenant:** the Administrador can **deactivate and reactivate branches** from the Sucursales tab of Administración (**Desactivar** / **Activar**, with an **Inactiva** badge). A branch cannot be deactivated while it has active users, stock above zero, draft sales or draft/pending purchases, or customers with an unpaid balance; the message lists every blocker with its count. The current branch and the last active branch cannot be deactivated. Deactivation is serialized with user moves and branch switches (row locks) and uses optimistic locking; every change writes one audit row. No migration.

### Bug Fixes

* **tenant:** activating a user whose branch is inactive is now refused (`TEN_USUARIO_SUCURSAL_INACTIVA`).

## [0.33.0](https://github.com/Wilfredery/SystemFact/compare/v0.32.0...v0.33.0) (2026-11-15)

### Features

* **tenant:** the Administrador can **create and edit branches** from the Sucursales tab of Administración: a **Nueva sucursal** button and an **Editar** action on each row, with one dialog for both (nombre, dirección, teléfono; each required, trimmed, up to 255 characters). The table now shows Nombre, Dirección, Teléfono and Estado. A new branch is active at once and appears in the branch switch and in the **Mover de sucursal** dialog; it needs no stock setup (stock rows are created on first movement).
* **Rules, enforced on the server:** only the Administrador can write branches (Operador and Despachador are refused at the action and by the database). A branch name is unique per company, ignoring case and surrounding spaces, **and inactive branches count too** (the message says so, since the admin only sees active ones); a concurrent double create of the same name returns the same clear error instead of a crash. Editing uses optimistic locking: if someone changed the branch meanwhile you get the usual conflict message, the list reloads and nothing is overwritten; sending the same values again is a no-op that writes nothing. Each create and each real edit appends one audit row.

### Database (migration — apply to production BEFORE deploying)

* `20261115120000_sucursal_writes_admin_only`: the single `FOR ALL` policy on `SUCURSAL` is replaced by a read policy identical to the old one plus admin-only insert/update policies, and a delete policy that only the seed/provisioning path can pass (branches are never deleted); it also adds the `version` column (default 1) and a unique index on the company and the trimmed, lower-cased name. Production was checked read-only: one company, one branch, no duplicate names. Additive and compatible with the previous release (it never writes branches). **Deploy order: apply the migration first, then the code**, because the new code reads the `version` column.

### Notes

* Still open: activating and deactivating branches. When that lands, the user move must also lock the destination branch row (review advisory) so a concurrent deactivation cannot leave a user on an inactive branch.

### Tests

* **unit:** the pure branch rules (trimming, case-insensitive name, no-op detection, rename to the same name with different case), the use cases and actions, and 32 UI tests (buttons only for who can manage, validation, create/edit calls, errors, conflict reload, no retry, new branch in the move dialog). **integration (real Postgres, `systemfact_app`):** Operador refused for insert/update/delete, Administrador insert/update, cross-company refused, bootstrap insert, reads unchanged, the unique index (exact, case and space variants, other company allowed), create/edit/stale/no-op/audit, a parallel double create (exactly one wins). **e2e:** the Administrador creates a branch through the UI, sees it with its address and phone, edits it, a case/space variant of the name is refused, and it appears in the move dialog; it cleans up and must not skip.

## [0.32.0](https://github.com/Wilfredery/SystemFact/compare/v0.31.1...v0.32.0) (2026-11-14)

### Features

* **tenant:** the Administrador can **move a user to another active branch** of the company: a new **Mover de sucursal** action in the Usuarios table of Administración, available on every row except your own (use the branch selector to change yours). The dialog lists the company's active branches except the user's current one and asks for explicit confirmation; the new state is shown only after the server confirms. Rows of other branches keep their role and activate/deactivate buttons disabled, as before; only the move is enabled on them.
* **Safeguards, all enforced on the server inside one transaction:** a user cannot move themselves; a move that would leave the **source** branch without an active Administrador is refused (the count is of the source branch, not of the session branch); the destination must be an active branch of the same company; a stale screen (the user changed meanwhile) is refused with the usual conflict message and nothing changes; moving a user to the branch they already have is a no-op that writes nothing and no audit row. A successful move appends one audit row (who, the user, branch before and after) and takes effect on the moved user's next request.
* History stays where it was made: sales, invoices, payments, purchases and stock movements keep their own branch; only the user's branch changes.

### Notes

* **No migration and no RLS change.** The existing write policy already lets an Administrador update a user when the branch setting is blank; the move clears that setting only around the lock, the source-branch administrator count and the single version-checked update, restores it before writing the audit row, and never touches the company setting. The Operador and Despachador are refused at the action and, with the action bypassed, by the database.
* **Still open (need a SUCURSAL policy migration):** creating and renaming branches, and activating/deactivating them. When branch deactivation lands, the move must lock the destination branch row (review advisory) so a concurrent deactivation cannot leave a user on an inactive branch.

### Tests

* **unit:** the pure move decision (self, same branch, last Administrador of the source), the use case (order of checks, source re-read under the lock, restore of the branch setting), the action (gate, input), and the dialog, the new button on every row, the own-row title, the empty state and every error message. **integration (real Postgres, `systemfact_app`):** move across branches, other-empresa and inactive destinations refused, last Administrador of the source refused, self-move, stale version and replay, no-op without audit or version bump, exactly one audit row, the branch setting restored after both a successful and a refused move, the moved user's next context on the new branch, the database wall for an Operador, and two parallel moves of a branch's two administrators (at most one succeeds). **e2e:** the Administrador moves a fixture user to a second branch and sees it in the list; it must not skip.

## [0.31.1](https://github.com/Wilfredery/SystemFact/compare/v0.31.0...v0.31.1) (2026-11-14)

### Bug Fixes

* **inventario:** the movement history no longer sends the author's internal numeric user id to anyone. Since 0.31.0 every row carried it so the Administrador's name lookup could work, which meant an Operador or Despachador received that id for authors of another branch (same company, no name). The id is now dropped from every row inside the use case, for every role; what each role sees on screen is unchanged. This makes the 0.31.0 statement that other roles keep the dash with no privacy change exact.

### Tests

* **unit and integration (real Postgres):** no returned row has a `usuarioId` property, for an Administrador with a resolved name, for a name that stays unresolved, and for a non-admin.

## [0.31.0](https://github.com/Wilfredery/SystemFact/compare/v0.30.0...v0.31.0) (2026-11-14)

### Features

* **tenant:** the **Usuarios** tab of Administración now lists the users of **every branch of the company** for the Administrador (it used to list the session branch only). A user of another branch is shown but its **Cambiar roles** and **Activar/Desactivar** buttons are disabled with an explanation, because the write policies stay pinned to the session branch (a branch move or branch management is a separate step). Other roles keep the branch-only scope.
* **inventario:** the **Usuario** column of the movement history now shows the name of an author from another branch **for the Administrador** (one name-only lookup per page, inside the company-wide read widen). Operador and Despachador keep "—", exactly as before: no privacy change.

### Notes

* **No migration and no RLS change.** `usuario_select` already reads the whole company when the branch setting is blank; the existing `conSucursalAmpliadaEnTx` helper clears it for these two read-only calls only and restores it before the transaction continues, with the company setting never touched. This removes the "Known limitation" listed under 0.30.0.

### Tests

* **unit:** the use case widens only for an Administrador and takes its scope from the session, never from input; one name lookup per page, pinned to the company; the author fallback for every role; the disabled actions of another branch's row. **integration (real Postgres, `systemfact_app`):** an admin sees all branches of its company and never another company; a non-admin sees only its branch; a write right after the listing in the same transaction is still branch-pinned; the history author is resolved for an admin and stays null for a non-admin.

## [0.30.0](https://github.com/Wilfredery/SystemFact/compare/v0.29.0...v0.30.0) (2026-11-14)

### Features

* **inventario:** the **Historial de movimientos** (`/inventario/movimientos`), read-only, reached from a "Ver historial de movimientos" link on the stock list. Columns: Fecha (America/Santo_Domingo), Producto, Tipo, Cantidad movida, Cantidad anterior, Cantidad nueva, Usuario and Motivo. Filters: tipo de movimiento, producto (literal search over codigo/nombre) and a date range; 25 per page. **Administrador only** (`ROLES_GESTION_INVENTARIO`, deny-by-default; Operador and Despachador get the access message and no link), because the history shows who adjusted stock and why. **Session branch only**, filtered in the query itself on top of RLS. **Bounded by design:** the range is mandatory (default the last 30 days, maximum 90, typed errors `RANGO_FECHAS_INVALIDO` / `RANGO_FECHAS_EXCEDIDO`), one `findMany` plus one `count` with the same `where`, explicit select, ordered `fecha desc, id desc`. It never exposes the idempotency key or any cost. No migration, no RLS change, no write path, and no change to any writer of `MovimientoInventario`.

### Known limitation

* The **Usuario** column shows "—" when the author belongs to another branch: `USUARIO` is branch-scoped by RLS, so the name is not readable from this branch. Showing it needs the company-wide user listing (a separate RLS decision).

### Tests


[Showing lines 1-380 of 1262 (50.0KB limit). Use offset=381 to continue.]