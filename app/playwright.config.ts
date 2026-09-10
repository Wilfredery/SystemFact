/**
 * Playwright E2E — SystemFact (fase-5c `pnpm e2e`).
 *
 * One smoke per phase, exercised against a REAL dev stack:
 *   - `webServer` boots `next dev` on :3000 (reused when already running);
 *   - auth is REMOTE Supabase (see SETUP-LOCAL.md): `E2E_USER`/`E2E_PASSWORD`
 *     must be a Supabase Auth user whose `nombreUsuario` row exists in the
 *     LOCAL dev database (`postgres` @ :5433), with a branch assigned;
 *   - the DB caveat: the local dev DB must be migrated AND seeded first
 *     (`pnpm seed:venta`, `pnpm seed:ncf`, `pnpm seed:cliente` — in that
 *     order), because the app runtime reads LOCAL Postgres while auth stays
 *     remote. Products/stock/branch data must exist for the E2E user.
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
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});