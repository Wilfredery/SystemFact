/**
 * /reportes E2E (odd/tasks/screen-audit-fixes.md T6, S8).
 *
 * READ-ONLY: this spec writes nothing and exports nothing. The Administrador sees the report tabs
 * (the catalogue incl. the DGII 606/607/608 and IT-1 families), the period selector, and switching
 * the tab moves the selection and the panel title. The Operador is refused at the server.
 *
 * No test here may skip: a missing env var FAILS the test (see utils/env.ts).
 *
 * ENV: E2E_USER (Administrador), E2E_PASSWORD.
 */

import { test, expect } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { requireEnv } from "./utils/env";

const REPORTES_FISCALES = ["Resumen ITBIS", "IT-1 (casillas)", "DGII 606 (compras)", "DGII 607 (ventas)", "DGII 608 (anulados)"];

test.describe("/reportes", () => {
  test("Administrador sees the report tabs and switching a tab moves the selection", async ({
    page,
  }) => {
    await login(page, {
      user: requireEnv("E2E_USER"),
      password: requireEnv("E2E_PASSWORD"),
    });
    await page.goto("/reportes");

    await expect(page.getByRole("heading", { level: 1, name: "Reportes" })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Reportes disponibles" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("tab")).not.toHaveCount(0);
    for (const nombre of ["Panel de control", "Ventas por período", ...REPORTES_FISCALES]) {
      await expect(tabs.getByRole("tab", { name: nombre })).toBeVisible();
    }
    await expect(page.getByLabel("Período")).toBeVisible();

    await expect(tabs.getByRole("tab", { name: "Panel de control" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await tabs.getByRole("tab", { name: "Ventas por período" }).click();
    await expect(tabs.getByRole("tab", { name: "Ventas por período" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(tabs.getByRole("tab", { name: "Panel de control" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  test("Operador is refused at /reportes: no report tabs", async ({ page }) => {
    await login(page, {
      user: requireEnv("E2E_OPERADOR_USER"),
      password: requireEnv("E2E_PASSWORD"),
    });
    await page.goto("/reportes");

    await expect(page.getByRole("tablist", { name: "Reportes disponibles" })).toHaveCount(0);
    await expect(page.locator("main").getByRole("alert")).toBeVisible();
  });
});
