/**
 * /auditoria E2E (odd/tasks/uiux-board-09-auditoria.md S9).
 *
 * READ-ONLY: this spec writes nothing. The Administrador sees the heading, the
 * `Solo Administrador` badge, the append-only footer note, the six column headers
 * and NO mutation control. The Operador (outside the Administrador role) does not
 * get the `Auditoría` nav link and, typing the URL, sees only the access message
 * (the server gate is the real security; hiding the link is only UX).
 *
 * No test here may skip: a missing env var FAILS the test (see utils/env.ts).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_PASSWORD.
 */

import { test, expect } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { requireEnv } from "./utils/env";

const COLUMNAS = ["Fecha-Hora", "Usuario", "Acción", "Entidad", "Sucursal", "Detalle"];

test.describe("/auditoria", () => {
  test("Administrador sees the header, badge, footer note and six columns, read-only", async ({
    page,
  }) => {
    await login(page, {
      user: requireEnv("E2E_USER"),
      password: requireEnv("E2E_PASSWORD"),
    });

    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", {
        name: "Auditoría",
      }),
    ).toBeVisible();

    await page.goto("/auditoria");
    await expect(page.getByRole("heading", { level: 1, name: /Auditoría/ })).toBeVisible();
    await expect(page.getByText("Solo Administrador", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Consulta el registro de movimientos del sistema", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Registro de auditoría — Solo lectura · Inmutable (append-only)", {
        exact: true,
      }),
    ).toBeVisible();

    // The login of this very test wrote at least one audit row, so the table exists.
    const cabeceras = page.getByRole("columnheader");
    await expect(cabeceras).toHaveCount(COLUMNAS.length);
    await expect(cabeceras).toHaveText(COLUMNAS);

    // Read-only: the only buttons on the page are the two filter controls.
    const principal = page.getByRole("main");
    await expect(principal.getByRole("button")).toHaveCount(2);
    await expect(principal.getByRole("button", { name: "Aplicar filtros" })).toBeVisible();
    await expect(principal.getByRole("button", { name: "Limpiar filtros" })).toBeVisible();
  });

  test("Operador has no nav link and gets the access message at /auditoria", async ({ page }) => {
    await login(page, {
      user: requireEnv("E2E_OPERADOR_USER"),
      password: requireEnv("E2E_PASSWORD"),
    });

    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", {
        name: "Auditoría",
      }),
    ).toHaveCount(0);

    await page.goto("/auditoria");
    // Scoped to <main>: Next.js adds its own route-announcer alert outside it.
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "Solo el administrador puede consultar el registro de auditoría.",
    );
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Filtros de auditoría" })).toHaveCount(0);
  });
});
