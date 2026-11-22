/**
 * /dashboard E2E (odd/tasks/screen-audit-fixes.md T6, S8).
 *
 * READ-ONLY: this spec writes nothing. The Administrador sees the greeting, the four KPI tiles,
 * the top-products table header and the "Ir a Reportes" hub link (which really navigates). The
 * Operador (neither Administrador nor Cobrador) gets only the access message and no KPI tile: the
 * server gate is the real security, not the hidden tiles.
 *
 * No test here may skip: a missing env var FAILS the test (see utils/env.ts).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_PASSWORD.
 */

import { test, expect } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { requireEnv } from "./utils/env";

const TILES = ["Ventas del día", "Ventas del mes", "CxC — saldo pendiente", "Inventario valorizado"];

test.describe("/dashboard", () => {
  test("Administrador sees the greeting, the KPI tiles and the hub link to /reportes", async ({
    page,
  }) => {
    await login(page, {
      user: requireEnv("E2E_USER"),
      password: requireEnv("E2E_PASSWORD"),
    });
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { level: 1, name: /^Hola, / })).toBeVisible();
    const principal = page.getByRole("main");
    for (const titulo of TILES) {
      await expect(principal.getByText(titulo, { exact: true })).toBeVisible();
    }
    await expect(principal.getByText("Productos más vendidos (mes)", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();

    await page.getByRole("link", { name: /Ir a Reportes/ }).click();
    await page.waitForURL(/\/reportes/);
    await expect(page.getByRole("heading", { level: 1, name: "Reportes" })).toBeVisible();
  });

  test("Operador gets the access message and no KPI tile", async ({ page }) => {
    await login(page, {
      user: requireEnv("E2E_OPERADOR_USER"),
      password: requireEnv("E2E_PASSWORD"),
    });
    await page.goto("/dashboard");

    // Scoped to <main>: Next.js adds its own route-announcer alert outside it.
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "Su rol no incluye paneles de reporte.",
    );
    for (const titulo of TILES) {
      await expect(page.getByText(titulo, { exact: true })).toHaveCount(0);
    }
  });
});
