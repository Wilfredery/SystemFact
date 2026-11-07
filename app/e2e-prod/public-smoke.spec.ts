/**
 * Production smoke — the anonymous half (odd/tasks/prod-smoke.md S1).
 *
 * These assertions need NO credentials and must ALWAYS run: they answer
 * "does the public surface of production answer correctly" using plain HTTP
 * (`request` from @playwright/test — no browser needed). They never write
 * anything.
 *
 * The baseline security headers are declared in `app/next.config.ts` and
 * asserted here BY NAME. A stale production build (older than v0.17.3) serves
 * only `Strict-Transport-Security`, so the header assertions are EXPECTED to
 * fail until production is redeployed — that failure is the finding, never a
 * reason to weaken an assertion.
 */

import { test, expect } from "@playwright/test";
import { expectNoCspViolations, watchCspViolations } from "./csp-violations";

const BASELINE_HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
] as const;

test.describe("production public smoke", () => {
  test("the root path redirects unauthenticated visitors to the login page", async ({
    request,
  }) => {
    const response = await request.get("/", { maxRedirects: 0 });

    expect(response.status(), "GET / should answer 307").toBe(307);
    expect(
      response.headers()["location"],
      "the root redirect should point at /login",
    ).toContain("/login");
  });

  test("the login page answers 200 and carries the five baseline security headers", async ({
    request,
  }) => {
    const response = await request.get("/login", { maxRedirects: 0 });

    expect(response.status(), "GET /login should answer 200").toBe(200);

    for (const name of BASELINE_HEADERS) {
      // Soft assertions so a stale build reports EVERY missing header by name
      // (not just the first that fails) — the test still FAILS as a whole.
      expect.soft(
        response.headers()[name],
        `the login page must carry the ${name} header`,
      ).toBeTruthy();
    }
  });

  // The CSP ships report-only, so a violation blocks nothing: only a real browser
  // can see one. Zero violations on /login is the S5 exit criterion.
  test("the login page loads in a browser without a single CSP violation", async ({
    page,
  }) => {
    const violations = await watchCspViolations(page);

    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    expectNoCspViolations(violations, "the login page");
  });

  test("an unauthenticated request to the dashboard redirects to the login page", async ({
    request,
  }) => {
    const response = await request.get("/dashboard", { maxRedirects: 0 });

    expect(response.status(), "GET /dashboard without a session should answer 307").toBe(
      307,
    );
    expect(
      response.headers()["location"],
      "the dashboard redirect should point at /login",
    ).toContain("/login");
  });
});
