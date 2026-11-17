# Factura print — printable fiscal-invoice view (browser-print first)

Owner request (2026-11-17): confirm whether the app generates the electronic bill after a sale
(YES: VIGENTE FACTURA with consumed NCF on confirm) and print it (gap: no print view for the
fiscal invoice). Owner decision: "go ahead wit the brwoser-print-first plan, remember, always
check, recheck, evaluate and do an audit before to work as professional, practical, safe and
security way". Audit done BEFORE this doc: code context (explorer, path:line evidence),
wireframe `Factura.penpot` (extracted to temp dir: NO invoice-print board exists — 02-Venta-Contado
is the POS screen), DGII rules (web research), print-pattern constraints.

## Specs

- **S1 (owner, verbatim)** — "can u pls confirm and check if after a customer buy a product we
  already have a ft that generate a electronic voice/bill and print the voice/bill". The gap is
  the print view for the persisted VIGENTE FACTURA; generation is NOT touched (no new NCF logic).
- **S2 (owner, verbatim)** — "go ahead wit the brwoser-print-first plan". Browser `window.print()`
  with real `@media print` / `@page` CSS; no server-side PDF in this slice (Caja pdfkit is a
  separate precedent, later option). No real-paper verification needed (owner: "Dont worry about
  print it on real paper").
- **S3 (DGII, Decreto 254-06 Art. 7/11 + NG 06-2018)** — the printed NCF invoice MUST show:
  voucher denomination per type (B01 "Factura de Crédito Fiscal" / B02 "Factura de Consumo"),
  the NCF clearly visible, the NCF expiry date (`NCF_SECUENCIA.vigenciaFin`, from data — never
  hardcoded), emisor name/RNC/address (tenant data), client name + RNC for B01 (required) and
  optional for B02, per-line description/quantity/price/subtotal, subtotal, ITBIS desglosado per
  rate (from the frozen line rates; pure aggregation), descuento (ADR-018, before ITBIS), total,
  and forma de pago (Contado/Crédito + derived balance from the cobros canonical query, ADR-017).
- **S4 (fiscal semantics, binding)** — the print view is a REPRESENTATION of the persisted
  record: reprinting NEVER mints a new NCF or document; CANCELADA renders a "no fiscal effect"
  banner; ANULADA renders a prominent reported-in-608 banner; the view is read-only and role-gated
  server-side.
- **S5 (engineering rules)** — new read action in the venta module: zod → `ROLES_VENTA`
  (Administrador, Operador) → `withTenantTransaction`; Decimal crossing as strings; no `any`;
  no inline scripts (CSP nonce-only — React onClick is fine); inline `<style>` allowed
  (style-src 'unsafe-inline', owner decision S2). Cross-module read (cobros balance) goes through
  the canonical query, never a materialized value.
- **S6 (visual self-check)** — the print output is verified with Playwright print-media emulation
  + screenshots (read back as images) and a PDF (`page.pdf()`), attached to the PR; the local E2E
  stack is re-provisioned first (its passwords were reset by a worker on 2026-11-16).

## Tasks

| ID | S# | Route | Work |
|----|----|-------|------|
| T1 | S3,S5 | worker/inline | `consultarFacturaParaImpresionAction` + `FacturaParaImpresionVista` DTO + pure per-rate ITBIS aggregation + tests (RED first) |
| T2 | S2,S3,S4 | inline | route `/venta/factura/[facturaId]` (server shell) + client island + print CSS + nav/shell print-hiding + tests |
| T3 | S6 | inline | Playwright print-emulation screenshots + PDF self-review; local E2E spec wired into the authenticated lane |
| T4 | S1-S6 | inline | version bump (MINOR, feat), docs, JD review, PR |

Evidence: explorer audit (task mwl4odzg-a-7vj6) — ReciboReprintScreen pattern (route shell +
client island + window.print, NO print CSS exists anywhere yet), venta-repository seams
(`leerFacturaDeVentaEnTx`, `VentaDetalle` without NCF fields), `ROLES_VENTA` in venta
`http/shared.ts`, CSP enforced nonce-only with style-src 'unsafe-inline'.

## Log (Judgment Day)

- Round 1 (2026-11-17), target origin/master..HEAD (4 commits), blind judges A+B: BOTH confirmed a
  CRITICAL — FacturaPrintScreen.tsx + its RTL suite were staged but never committed (an aborted
  `git add` chain left them out; the branch did not build). A alone flagged the banner OUTSIDE the
  print-isolated article (a printed CANCELADA/ANULADA copy would omit its banner) — treated as
  confirmed-severe. Owner approved the full fix round: both CRITICALs + dark-mode print legibility
  (B's WARNING: dark-OS prints near-illegible) + a REAL empresa-B cross-tenant integration test +
  truthful wording + SD-timezone expiry + strict digit id.
- Round 2 (2026-11-17), fix delta bc1608c, both judges: NO fix-caused defects; the round-1 fixes
  hold. Residual both-flagged: the footer's dark:text-zinc-400 still printed faint. Final fix
  (round 2 allowed): blanket descendant print reset with the banner red restored after it, plus
  RTL containment + transport-rejection guards. Final scoped re-judgment (both judges): CLEAN.
  **JUDGMENT: APPROVED ✅ (terminal, round 2).** 11/11 island tests, 3/3 integration, full local
  lane 32 passed / 0 failed, tsc 0, eslint clean.
- Recorded as later work (single-judge/recorded, not fixed): forma de pago derives from the
  canonical saldo only (the contado/crédito condition is not persisted — a B04 credit note of the
  pre-ITBIS subtotal against a fully-cobrado invoice leaves a NEGATIVE canonical saldo, seen live
  at -150.00; belongs to the devolucion domain, NOT this slice); canonical saldo loads all
  VIGENTE invoices then filters in JS; sucursalId not pinned in the factura read (RLS tier-2
  covers it); the range-miss expiry fallback is unreachable while @@unique(empresaId,tipoNcf)
  holds; the screen-money display uses Number() (display-only); a POS shortcut link to the print
  view is future work.

## Log

- L1 (2026-11-17): owner request quoted in S1; audit commissioned and delivered (this header).
  DGII research: e-CF (Ley 32-23) is the future; this slice prints the classic NCF format (254-06).
- L2 (2026-11-17): owner chose browser-print-first and delegated the visual-iteration loop to the
  agent (Playwright print emulation + screenshots), quoting S2.
- L3 (2026-11-17): T1-T3 shipped on `feature/factura-print`. T1: pure `desglosarItbisPorTasa`
  (4 unit tests, RED first) + `consultarFacturaParaImpresion` composing `leerFacturaParaImpresionEnTx`
  (invoice + frozen lines + emisor/receptor + NCF expiry resolved from the SEQUENCE RANGE
  containing the NCF — numeric part after the 2-digit type code) + ADR-017 balance from the cobros
  canonical query (3 integration tests, real DB/RLS; caught two real behaviors: rates are stored as
  percentages ("18.00"), and a contado B02 sale has its COBRO applied at confirm → saldo 0).
  T2: `FacturaPrintScreen` island + route `/venta/factura/[facturaId]` + `@media print`/`@page`
  isolation (first print CSS in the app) + 10 RTL tests; new error code `FACTURA_NO_ENCONTRADA`
  (census 27→28). T3: Playwright print-emulation screenshots + PDF reviewed visually (fixed the
  2-digit year and "18.00%"→"18%"), new `e2e/factura-print.spec.ts` (2 tests: DGII document on a
  real invoice + reprint-mints-nothing, typed error on a foreign id), session-smoke walker gained
  the `/venta/factura/[facturaId]` sentinel entry. FULL local lane: **32 passed / 0 failed**, incl.
  the CSP walker. tsc 0, eslint clean.
- L5 (2026-11-17): CI caught a real gap the local lane missed: the CSP authenticated walker had no seeded id for [facturaId] (my T3 entry added the route to the e2e-prod walker but the LOCAL csp-authenticated.spec.ts map did not know the segment). Fixed: the walker resolves facturaId from the seeded tenant (max VIGENTE invoice id) — verified locally (csp walker + print spec 3/3).
- L4 (2026-11-17): the local stack was re-provisioned cleanly (schema drop + provision with
  explicit throwaway passwords, recorded in this file only as the procedure; the stack env file is
  gitignored and its values were never read).

- L6 (2026-11-17): the 0.37.0 deploy arc caught a demo-lane red: the prod-demo CSP walker (UI-derived ids only) had no id for [facturaId]. Fixed properly by shipping the deferred POS link: listarVentas rows now carry facturaId and CONFIRMADA rows render a "Ver factura" link to /venta/factura/{id} (also closes the changelog promise); the demo walker reads the id the way it always does — from the estado de cuenta UI (run.facturaId) — and the local csp walker resolves it from the seeded tenant. Bump 0.37.1 (fix → PATCH).
- L7 (2026-11-17): LIVE FINDING recorded during the visual check: a B04 credit note of the pre-ITBIS subtotal (150) against a fully-cobrado invoice (177) leaves a NEGATIVE canonical saldo (-150) — the print view shows it honestly; the amount belongs to the devolucion domain (later work, owner decision).
