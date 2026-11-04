/**
 * Playwright E2E — SystemFact (fase-5c `pnpm e2e`).
 *
 * One smoke per phase, exercised against a REAL dev stack:
 *   - `webServer` boots `next dev` on :3000 (reused when already running);
 *   - auth is a real Supabase Auth server: REMOTE on a developer machine (see
 *     SETUP-LOCAL.md), LOCAL and ephemeral in CI (`supabase start`); either
 *     way `E2E_USER`/`E2E_PASSWORD` must be a Supabase Auth user whose
 *     `nombreUsuario` row exists in the database the app reads, with a branch
 *     assigned;
 *   - the DB caveat: the database must be migrated AND seeded first
 *     (`pnpm seed:venta`, `pnpm seed:ncf`, `pnpm seed:cliente` — in that
 *     order). Products/stock/branch data must exist for the E2E user.
 *
 * Env vars (optional): `E2E_BASE_URL` (default http://localhost:3000),
 * `E2E_USER`/`E2E_PASSWORD` (defaults `e2e`/`e2e-password`, see spec).
 */

import { defineConfig, devices } from "@playwright/test";

const port = 3000;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // E2E mutates the shared dev DB (confirms consume NCF sequences); it MUST
  // run serially so one parse of the seeded ranges is never double-consumed.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Vercel Authentication (SSO) blocks headless browsers on the protected
    // deployment; an automation-bypass secret is accepted via this header.
    ...(process.env.E2E_PROTECTION_BYPASS
      ? { extraHTTPHeaders: { "x-vercel-protection-bypass": process.env.E2E_PROTECTION_BYPASS } }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // CI tests the app AS IT SHIPS, not through a dev server. Two flake classes
    // came from the dev path and both disappear in a compiled build:
    //   1. Turbopack's next/font machinery failed to resolve this app's Google
    //      font on a cold dev start in the runner (`NextFontGoogleFontFileReplacer
    //      ... resolve_internal failed` → webServer timeout) while the SAME font
    //      compiled fine in `next build` during the same run;
    //   2. the first spec to hit a route paid that route's compile cost inside
    //      its own per-test timeout (32.7s against the 30000ms default).
    // A required gate must not go red for a bundler it is not testing. Local runs
    // keep `pnpm dev` (fast iteration) and still honour an already-running server.
    command: process.env.CI ? "pnpm build && pnpm start" : "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // CI compiles the production bundle before the server answers; that is the
    // whole point of this command, so the window is wide. Local `pnpm dev`
    // answers in seconds and is unaffected by a generous deadline.
    timeout: 300_000,
  },
});