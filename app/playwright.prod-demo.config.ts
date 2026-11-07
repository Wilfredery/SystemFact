/**
 * Playwright configuration for the production DEMO lane (`pnpm e2e:prod-demo`).
 *
 * UNLIKE `playwright.prod.config.ts` (the read-only smoke), this lane WRITES demo
 * data into the DEPLOYED application: cash and credit sales (B02/B01), a partial
 * cobro and a return (B04). It is a separate lane on purpose
 * (`odd/tasks/prod-demo-lane.md` S3): own config, own workflow
 * (`.github/workflows/prod-demo.yml`, `workflow_dispatch` only), own GitHub
 * environment (`prod-demo`) and own identity (an Operador bound to the demo
 * company). Do not merge it with the smoke.
 *
 * There is deliberately NO `webServer`: this lane probes the LIVE deployment
 * (`https://systemfact.vercel.app` by default, overridable via `DEMO_BASE_URL`)
 * and must never boot a local server. To prove the specs without production, point
 * `DEMO_BASE_URL` at a local `next start` over a local Supabase stack.
 *
 * Env vars: `DEMO_BASE_URL` (optional), `DEMO_USER` / `DEMO_PASSWORD` (the demo
 * Operador) and `DEMO_EMPRESA_NAME` (the empresa name the UI must show before any
 * write — the specs abort otherwise).
 */

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.DEMO_BASE_URL ?? "https://systemfact.vercel.app";

export default defineConfig({
  testDir: "./e2e-prod-demo",
  fullyParallel: false,
  // One worker and no retries: a retry of a write would consume a second invoice
  // number for the same story, so a failure must stay a single, readable failure.
  workers: 1,
  retries: 0,
  // The first failure stops the run. If the empresa guard fails, nothing after it
  // may write; if a sale fails, the next steps depend on it anyway.
  maxFailures: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    // TRACE, SCREENSHOT AND VIDEO ARE OFF ON PURPOSE — do not turn them on here.
    // This lane logs into the LIVE hosted project with a real credential. A
    // Playwright trace snapshots the DOM and the network, so the login form's
    // password value can end up inside it, and the workflow uploads the
    // artifacts on failure in a PUBLIC repository: that is a credential leak
    // dressed as a debugging aid. Debug locally with a throwaway identity
    // instead, never by attaching a trace of a production login.
    trace: "off",
    screenshot: "off",
    video: "off",
    // NO VERCEL PROTECTION BYPASS, same as the smoke: the lane must see what a
    // visitor sees (see `playwright.prod.config.ts` for the reasoning).
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // NOTE: no `webServer` here — this config must NEVER boot a local server.
});
