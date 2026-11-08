/**
 * /inventario consulta E2E (odd/tasks/inventario-consulta.md T4, S2/S4).
 *
 * Operador and Despachador are view-only and the Administrador manages (Step 1b),
 * but in this PR all three roles see the same read-only screen: list, KPIs,
 * search and status filter, and NO manage controls ("+ Ajustar", "Acciones").
 * One test per role, each signing in through the real login form with that
 * role's own identity (provisioned by .github/ci/provision-local-e2e.sh).
 *
 * Read-only by design: navigation and filters only, no writes.
 *
 * No test here may skip: a missing env var FAILS the test (a skip in the local
 * lane reads as coverage it does not have; see assert-no-skips.mjs).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_DESPACHADOR_USER,
 * E2E_PASSWORD (shared by the three identities on the ephemeral local stack),
 * E2E_PRODUCT (default Arroz) and DIRECT_URL/DATABASE_URL (superuser read of the
 * acting user's role, ASSERTIONS ONLY).
 */

import { test, expect, type Page } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { openDb } from "./utils/db";
import { E2E_PASSWORD, E2E_PRODUCT } from "./utils/venta-pos";

const pool = openDb();

test.afterAll(async () => {
  await pool.end();
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: provision the E2E stack with .github/ci/provision-local-e2e.sh and load its env file.`,
    );
  }
  return value;
}

async function rolDelUsuario(nombreUsuario: string): Promise<string[]> {
  const res = await pool.query(
    `select r.nombre as rol
       from "USUARIO" u
       join "USUARIO_ROL" ur on ur."usuarioId" = u.id
       join "ROL" r on r.id = ur."rolId"
      where u."nombreUsuario" = $1 and u.activo = true
      order by r.nombre`,
    [nombreUsuario],
  );
  return res.rows.map((row: { rol: string }) => row.rol);
}

const FILAS = '[data-testid^="inventario-fila-"]';

async function verInventario(page: Page, rol: string, envUser: string): Promise<void> {
  const nombreUsuario = requireEnv(envUser);
  requireEnv("E2E_PASSWORD");

  // The identity must really hold the role this test claims to cover.
  expect(await rolDelUsuario(nombreUsuario), `roles of ${nombreUsuario}`).toEqual([rol]);

  await login(page, { user: nombreUsuario, password: E2E_PASSWORD });
  await page.getByRole("link", { name: "Inventario", exact: true }).click();
  await page.waitForURL("**/inventario", { timeout: 20_000 });

  await expect(page.getByRole("heading", { name: "Inventario", exact: true })).toBeVisible();

  // The four KPI cards.
  for (const [testid, etiqueta] of [
    ["total", "Total productos"],
    ["bajo", "Bajo stock"],
    ["agotados", "Agotados"],
    ["valor", "Valor de inventario"],
  ] as const) {
    const tarjeta = page.getByTestId(`inventario-kpi-${testid}`);
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta).toContainText(etiqueta);
  }
  await expect(page.getByTestId("inventario-kpi-valor")).toContainText(/RD\$/);

  // The seeded fixture product is listed, with its status badge.
  const filaProducto = page.locator(FILAS).filter({ hasText: E2E_PRODUCT });
  await expect(filaProducto.first()).toBeVisible();
  await expect(filaProducto.first()).toContainText("Disponible");
  await expect(page.getByText(/^Página \d+ de \d+$/)).toBeVisible();

  // Search by name narrows the table to matching rows only.
  await page.getByLabel("Buscar producto").fill(E2E_PRODUCT);
  await expect(async () => {
    const filas = await page.locator(FILAS).allTextContents();
    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) expect(fila).toContain(E2E_PRODUCT);
  }).toPass({ timeout: 10_000 });

  // A nonsense search shows the empty state.
  await page.getByLabel("Buscar producto").fill("zz-sin-coincidencias-zz");
  await expect(page.getByText("No hay productos que coincidan con los filtros.")).toBeVisible();
  await expect(page.locator(FILAS)).toHaveCount(0);

  // Back to the product, then the status filter.
  await page.getByLabel("Buscar producto").fill(E2E_PRODUCT);
  await expect(filaProducto.first()).toBeVisible();

  const estado = page.getByLabel("Filtrar por estado");
  await estado.selectOption({ label: "Agotado" });
  await expect(page.locator(FILAS).filter({ hasText: E2E_PRODUCT })).toHaveCount(0);
  await expect(page.getByText("No hay productos que coincidan con los filtros.")).toBeVisible();

  await estado.selectOption({ label: "Disponible" });
  await expect(filaProducto.first()).toBeVisible();
  await expect(filaProducto.first()).toContainText("Disponible");

  // View-only: no manage controls in this PR, for any role.
  await expect(page.getByRole("button", { name: /Ajustar/ })).toHaveCount(0);
  await expect(page.getByText("+ Ajustar")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Acciones" })).toHaveCount(0);
}

test.describe("/inventario consulta (inventario-consulta T4)", () => {
  test("Administrador sees the inventory list, KPIs and filters, without adjust controls", async ({ page }) => {
    await verInventario(page, "Administrador", "E2E_USER");
  });

  test("Operador sees the inventory list, KPIs and filters, without adjust controls", async ({ page }) => {
    await verInventario(page, "Operador", "E2E_OPERADOR_USER");
  });

  test("Despachador sees the inventory list, KPIs and filters, without adjust controls", async ({ page }) => {
    await verInventario(page, "Despachador", "E2E_DESPACHADOR_USER");
  });
});
