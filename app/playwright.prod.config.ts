/**
 * Playwright configuration for the PRODUCTION smoke (`pnpm e2e:prod`).
 *
 * This is a READ-ONLY check against the DEPLOYED application
 * (`https://systemfact.vercel.app` by default, overridable via
 * `PROD_BASE_URL`). The specs in `e2e-prod/` answer "does production work"
 * with a least-privilege identity and no fiscal writes (no sale confirmation,
 * no NCF consumption, no void — see `odd/tasks/prod-smoke.md`).
 *
 * There is deliberately NO `webServer`: the whole point of this lane is to
 * probe the LIVE deployment, so it must never boot a local server. This is the
 * key difference from `playwright.config.ts`, whose `webServer` boots a local
 * `next` (or ephemeral Supabase) stack for the mutating E2E suite.
 *
 * Env vars (optional): `PROD_BASE_URL` (default https://systemfact.vercel.app),
 * `E2E_PROTECTION_BYPASS` (Vercel Authentication bypass secret, same pattern as
 * `playwright.config.ts`), `PROD_USER` / `PROD_PASSWORD` (an Operador for the
 * logged-in half of the smoke).
 */

import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PROD_BASE_URL ?? "https://systemfact.vercel.app";

export default defineConfig({
  testDir: "./e2e-prod",
  fullyParallel: false,
  // One worker and no retries: a production smoke must be deterministic and
  // must not hammer the deployed app or race its own session.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    // TRACE AND SCREENSHOT ARE OFF ON PURPOSE — do not turn them on here.
    // This lane logs into the LIVE hosted project with a real credential. A
    // Playwright trace snapshots the DOM and the network, so the login form's
    // password value can end up inside it, and the workflow uploads the
    // artifacts on failure in a PUBLIC repository: that is a credential leak
    // dressed as a debugging aid. Debug locally with a throwaway identity
    // instead, never by attaching a trace of a production login.
    trace: "off",
    screenshot: "off",
    // Vercel Authentication (SSO) protects per-deployment URLs. Sending the
    // bypass header by DEFAULT would defeat the anonymous half of this smoke:
    // it would answer "200" even if the public alias were misconfigured to hide
    // behind SSO, which is exactly what a visitor would not see. So the header
    // is opt-in only, for the deliberate case of probing a protected deployment
    // URL, and the public alias is always tested as an anonymous visitor.
    ...(process.env.PROD_PROTECTION_BYPASS === "1" &&
    process.env.E2E_PROTECTION_BYPASS
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": process.env.E2E_PROTECTION_BYPASS,
          },
        }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // NOTE: no `webServer` here — this config must NEVER boot a local server.
});
