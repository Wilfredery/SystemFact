/**
 * /reportes E2E (odd/tasks/screen-audit-fixes.md T6, S8).
 *
 * READ-ONLY: this spec writes nothing and exports nothing. The Administrador sees the report tabs
 * (the catalogue incl. the DGII 606/607/608 and IT-1 families), the period selector, and switching
 * the tab moves the selection and the panel title. The Operador still sees the tab strip but the
 * server gate refuses the panel (permission message, no data).
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

  test("Operador is refused by the server gate: permission message and no report data", async ({
    page,
  }) => {
    await login(page, {
      user: requireEnv("E2E_OPERADOR_USER"),
      password: requireEnv("E2E_PASSWORD"),
    });
    await page.goto("/reportes");

    // The tab strip is a shell every user sees (selector-first); each PANEL is gated server-side.
    await expect(page.getByRole("tablist", { name: "Reportes disponibles" })).toBeVisible();
    // Scoped to <main>: Next.js adds its own route-announcer alert outside it.
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "No tiene permisos para consultar este reporte.",
    );
    for (const titulo of ["Ventas del día", "Ventas del mes", "CxC — saldo pendiente"]) {
      await expect(page.getByText(titulo, { exact: true })).toHaveCount(0);
    }
  });
});
