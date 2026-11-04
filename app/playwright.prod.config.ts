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
 * `PROD_USER` / `PROD_PASSWORD` (an Operador for the logged-in half).
 * There is no protection-bypass option on purpose — see the note further down.
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
    // NO VERCEL PROTECTION BYPASS. This lane probes the PUBLIC alias as an
    // anonymous visitor, which is the only thing that proves a visitor can use
    // production. A bypass header would answer 200 even if the alias were
    // misconfigured behind SSO, so the capability is deliberately absent rather
    // than configurable: an opt-in flag is still a knob that can be flipped, and
    // the trigger would sit in a weaker-protected place than the secret it gates
    // (review R1-workflow-env-conflation). If a protected deployment URL ever
    // needs probing, add that deliberately, with its own check and its own
    // reason — never as a flag on this one.
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // NOTE: no `webServer` here — this config must NEVER boot a local server.
});
