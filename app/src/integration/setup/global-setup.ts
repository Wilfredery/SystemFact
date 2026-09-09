/**
 * Jest globalSetup for the REAL-DB integration harness.
 *
 * Runs in the Jest root process BEFORE the test environment (and therefore
 * before any test file can import `src/lib/env.ts`, which validates the
 * environment at module-evaluation time). Loads `app/.env.integration` so the
 * code under test (`@/lib/prisma` → app role) points at `systemfact_test`.
 *
 * DB privileges granted once via docker exec psql (tables are owned by
 * `postgres`): GRANT USAGE ON SCHEMA public + GRANT SELECT, INSERT, UPDATE,
 * DELETE ON ALL TABLES IN SCHEMA public + GRANT USAGE, SELECT ON ALL SEQUENCES
 * IN SCHEMA public TO systemfact_app (run against systemfact_test).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dotenv = require("dotenv");

module.exports = function loadIntegrationEnv(): void {
  const result = dotenv.config({ path: path.join(__dirname, "..", "..", "..", ".env.integration") });
  if (result.error !== undefined) {
    throw new Error(
      `Failed to load app/.env.integration for the integration harness: ` +
        `${String(result.error)}. Copy .env.integration.example to .env.integration.`,
    );
  }
};
