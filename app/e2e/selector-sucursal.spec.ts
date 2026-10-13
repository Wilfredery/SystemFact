/**
 * auth-tenant-selector E2E (tasks 4.7) — the UI paths that need no DB seeding.
 *
 * Covers: SEL-SLOT-05-A (header trigger navigates), SEL-RENDER-02-A (empresa
 * static & unique), SEL-EMPTY/RENDER visual sanity on the live board, and the
 * SEL-NAV-06 idempotent path reachable from the seeded single-branch E2E admin
 * (re-confirming the current branch is a no-op success that lands on
 * /dashboard with the session kept — no re-login).
 *
 * The login/landing helper intentionally accepts BOTH landing routes (design
 * D2) so a multi-branch seeded admin does not break the suite; the DB-level
 * branching (SEL-ROUTE-01-A/B via despachador accounts, cross-branch switch)
 * is covered by the jest loader/use-case suites and the integration harness.
 */

import { expect, test, type Page } from "@playwright/test";

const E2E_USER = process.env.E2E_USER ?? "";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USER);
  await page.getByLabel("Contraseña").fill(process.env.E2E_PASSWORD ?? "");
  await page
    .getByRole("button", { name: "Ingresar" })
    .click();
  await page.waitForURL(/\/(dashboard|selector-empresa-sucursal)/, {
    timeout: 20_000,
  });
}

test.describe("selector-empresa-sucursal (auth-tenant-selector)", () => {
  test.skip(E2E_USER === "", "Set E2E_USER/E2E_PASSWORD to run the smoke.");

  test("SEL-SLOT-05-A: the header trigger navigates to the selector", async ({ page }) => {
    await login(page);

    const trigger = page.getByTestId("cambiar-sucursal");
    await expect(trigger).toBeVisible();
    await expect(trigger).not.toHaveAttribute("aria-disabled");
    await trigger.click();

    await page.waitForURL("**/selector-empresa-sucursal", { timeout: 20_000 });
  });

  test("SEL-RENDER-02-A: the empresa appears exactly once, as static content", async ({ page }) => {
    await login(page);
    await page.goto("/selector-empresa-sucursal");

    const heading = page.getByTestId("selector-empresa");
    await expect(heading).toHaveCount(1);
    // P6: the empresa name is never a selectable/interactive node.
    await expect(
      heading.getByRole("combobox").or(heading.getByRole("button")),
    ).toHaveCount(0);
    await expect(page.getByTestId("selector-branch-select")).toBeVisible();
  });

  test("SEL-NAV-06-B: re-confirming the current branch keeps the session and lands on /dashboard", async ({ page }) => {
    await login(page);
    await page.goto("/selector-empresa-sucursal");

    await expect(page.getByTestId("selector-branch-select")).toBeVisible();
    // The preselected value IS the current branch; confirming is the TEN-SWITCH-04-E
    // idempotent no-op — success, no side effect, navigation to the dashboard.
    await expect(page.getByTestId("selector-confirm")).toBeEnabled();
    await page.getByTestId("selector-confirm").click();

    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    // Session kept: the shell header is still alive (empresa + sucursal shown).
    await expect(page.getByTestId("app-shell-header")).toBeVisible();
  });
});
