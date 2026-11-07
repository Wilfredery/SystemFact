/**
 * Production smoke — the logged-in half (odd/tasks/prod-smoke.md S1/S2).
 *
 * HARD RULE — NO FISCAL WRITES. This spec only READS the hosted tenant: it
 * never confirms a sale, never consumes an NCF, never voids anything and never
 * POSTs a mutating action. The only writes are the implicit ones Supabase Auth
 * performs on login (a session + refresh token). The identity is a single-branch
 * Operador supplied via PROD_USER / PROD_PASSWORD.
 *
 * ROLE GATE — the dashboard read is deny-by-default for an Operador
 * (`tilesPermitidos()` in src/modules/reportes/domain/roles.ts returns an empty
 * list), so `consultarDashboardAction()` answers REPORTE_NO_AUTORIZADO and the
 * page renders a `role="alert"` paragraph ("Su rol no incluye paneles de
 * reporte.") with NO KPI tile. If an Operador ever sees KPI data, that is a
 * security regression and this smoke must fail.
 *
 * When PROD_USER or PROD_PASSWORD is missing the check FAILS (never skips): a
 * skipped production check is exactly the lie this whole lane exists to prevent.
 */

import { test, expect } from "@playwright/test";
import { login } from "../e2e/utils/login";
import { expectNoCspViolations, watchCspViolations } from "./csp-violations";

const MISSING_CREDENTIALS =
  "PROD_USER and PROD_PASSWORD are required for the production session smoke. " +
  "Without a real least-privilege identity this check cannot prove that auth and " +
  "the database work in production, so it FAILS instead of skipping.";

// The KPI tiles render as <section aria-label="..."> in
// src/modules/reportes/ui/dashboard-kpis.tsx. An Operador is deny-by-default,
// so NONE of these may render — if one does, the role gate regressed.
const KPI_TILES = [
  "Ventas del día",
  "Ventas del mes",
  "Cuentas por cobrar",
  "Inventario",
  "Productos más vendidos",
] as const;

function readCredentials(): { user: string; password: string } {
  const user = process.env.PROD_USER;
  const password = process.env.PROD_PASSWORD;
  if (!user || !password) {
    throw new Error(MISSING_CREDENTIALS);
  }
  return { user, password };
}

test.describe("production session smoke", () => {
  test.beforeAll(() => {
    // Throws (and therefore FAILS the tests, never skips) when the identity is
    // missing, before any browser work starts.
    readCredentials();
  });

  test("a single-branch Operador logs in through the real form and lands on the dashboard rendered as a denied report role", async ({
    page,
  }) => {
    // Watch from before the login page loads, so the whole login -> dashboard
    // journey is covered (S4/S5: zero CSP violations on login and dashboard).
    const violations = await watchCspViolations(page);

    await login(page, readCredentials());
    await expect(page).toHaveURL(/\/dashboard/);

    // The session header renders the acting identity: the greeting heading with
    // the user's name, then the empresa/sucursal line directly under it.
    await expect(
      page.getByRole("heading", { level: 1, name: /^Hola, .+/ }),
      "the dashboard must render the 'Hola, <nombre>' greeting with a real name",
    ).toBeVisible();
    await expect(
      page.locator("main h1 + p"),
      "the empresa/sucursal line under the greeting must be rendered",
    ).toBeVisible();
    await expect(page.locator("main h1 + p")).toContainText(/\S/);

    // Role gate: an Operador gets the access message, not KPI data. Scoped to
    // `main` on purpose: right after a client-side navigation Next.js injects
    // its route announcer (`<div role="alert" id="__next-route-announcer__">`,
    // which announces the greeting) into <body>, so an unscoped
    // `getByRole("alert")` resolves to two elements and dies on strict mode
    // before it asserts anything about the gate.
    const denial = page.locator("main").getByRole("alert");
    await expect(denial).toHaveCount(1);
    await expect(denial).toBeVisible();
    await expect(denial).toContainText("Su rol no incluye paneles de reporte.");

    // And explicitly: NO KPI tile may render for this role.
    for (const label of KPI_TILES) {
      await expect(
        page.locator(`section[aria-label="${label}"]`),
        `an Operador must not see the "${label}" KPI tile`,
      ).toHaveCount(0);
    }

    await page.waitForLoadState("networkidle");
    expectNoCspViolations(violations, "the login -> dashboard journey");
  });

  // docs/22 T6: @supabase/ssr and Next never set `Secure` on the sb-* auth
  // cookies, so production is PROVEN here, never assumed. HttpOnly is recorded
  // as deliberately false (see the comment in src/lib/supabase/client.ts).
  // Messages name cookies and flags only — NEVER values: this lane logs into
  // live production.
  test("the sb-* auth cookies carry Secure and SameSite=Lax and are deliberately not HttpOnly", async ({
    page,
  }) => {
    await login(page, readCredentials());
    await expect(page).toHaveURL(/\/dashboard/);

    const authCookies = (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("sb-"),
    );
    expect(
      authCookies.length,
      "login must leave at least one sb-* auth cookie",
    ).toBeGreaterThan(0);

    for (const cookie of authCookies) {
      expect(
        cookie.secure,
        `auth cookie ${cookie.name} must be Secure`,
      ).toBe(true);
      expect(
        cookie.sameSite,
        `auth cookie ${cookie.name} must be SameSite=Lax`,
      ).toBe("Lax");
      expect(
        cookie.httpOnly,
        `auth cookie ${cookie.name} is deliberately not HttpOnly`,
      ).toBe(false);
    }
  });
});
