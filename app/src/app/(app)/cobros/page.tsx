/**
 * `/cobros` — the "Cobros" menu entry (plan de pantallas, hallazgo F1).
 *
 * The menu pointed here but only `/cobros/cxc-board`, `/cobros/estado-cuenta/...` and
 * `/cobros/recibo/...` existed, so the link ended in a 404. The wireframe's `03-Cobros`
 * page is the receivables list, which is the CxC board, so this route serves that same
 * screen. It is a real page and NOT a redirect on purpose: the menu keeps `/cobros`
 * highlighted for every `/cobros/*` page, and `e2e/csp-authenticated.spec.ts` requires each
 * page to render at its own URL.
 */

export { default } from "./cxc-board/page";
