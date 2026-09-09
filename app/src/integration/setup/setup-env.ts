/**
 * Per-suite integration setup (setupFilesAfterEnv).
 *
 * Truncates ALL public tables before each test so every test is
 * order-independent and starts from a known-empty `systemfact_test`.
 * The harness superuser client is closed in afterAll.
 */

import { truncateAll, closeHarnessDb } from "./fixtures";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeHarnessDb();
});
