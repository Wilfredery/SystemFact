/**
 * Guarded Playwright fixtures of the production DEMO lane
 * (odd/tasks/prod-demo-lane.md S4).
 *
 * The built-in `page` fixture is OVERRIDDEN: a test can only obtain a page that
 * has already logged in with the demo identity AND passed the empresa guard, so
 * no spec can write before the guard ran (there is no unguarded page to use).
 *
 * The guard compares the empresa name the UI shows (the app-shell header, on
 * every `(app)` page) with `DEMO_EMPRESA_NAME`. A mismatch throws before the
 * first write; the config sets `maxFailures: 1`, so the whole run stops there.
 * The error never prints either name: a real company's name must not reach a
 * public Actions log.
 */

import { test as base, expect, type Page } from "@playwright/test";
import { login } from "../e2e/utils/login";
import {
  expectNoCspViolations,
  watchCspViolations,
  type CspViolation,
} from "../e2e-prod/csp-violations";
import { cabeceraPerteneceAEmpresa, leerEntornoDemo } from "./demo-env";

const violationsByPage = new WeakMap<Page, CspViolation[]>();

/** The live CSP violations collected on a guarded page since before its login. */
export function cspViolationsOf(page: Page): CspViolation[] {
  const violations = violationsByPage.get(page);
  if (violations === undefined) {
    throw new Error("cspViolationsOf: this page did not come from the guarded `page` fixture.");
  }
  return violations;
}

/** Fails when any CSP violation was reported on the page so far (directives and hosts only). */
export function expectNoCspOnPage(page: Page, where: string): void {
  expectNoCspViolations(cspViolationsOf(page), where);
}

/** Aborts before any write unless the UI shows the expected demo empresa. */
export async function assertDemoEmpresa(page: Page, empresaEsperada: string): Promise<void> {
  const header = page.getByTestId("app-shell-header");
  await expect(header, "the app-shell header must render after login").toBeVisible({
    timeout: 20_000,
  });
  const cabecera = await header.innerText();
  if (!cabeceraPerteneceAEmpresa(cabecera, empresaEsperada)) {
    throw new Error(
      "DEMO GUARD: the empresa shown in the UI is not the one named by DEMO_EMPRESA_NAME. " +
        "Aborting before any write; this lane may only write into the demo company.",
    );
  }
}

export const test = base.extend({
  page: async ({ page }, provide) => {
    const env = leerEntornoDemo(process.env);
    violationsByPage.set(page, await watchCspViolations(page));
    await login(page, { user: env.user, password: env.password });
    await assertDemoEmpresa(page, env.empresaName);
    await provide(page);
  },
});

export { expect };
