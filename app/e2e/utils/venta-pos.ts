/**
 * Shared POS flow helpers (design D8, task 5.4).
 *
 * The env-reading constants and the draft→confirm drive live here so the
 * confirmed-sale harness exists ONCE; each spec keeps only its own assertions.
 * The demo CREDITO client name is a seed contract (`seed:bootstrap`).
 */

import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";

export const E2E_PRODUCT = process.env.E2E_PRODUCT ?? "Arroz";
export const E2E_USER = process.env.E2E_USER ?? "e2e";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";

/** The demo CREDITO client seeded by seed:bootstrap (name is a contract). */
export const CLIENTE_CREDITO_DEMO_NOMBRE = "Comercios Clara, SRL (demo)";

/** Search a product and add the first match to the cart. */
export async function buscarYAgregar(
  page: Page,
  producto: string,
): Promise<void> {
  await page.getByLabel("Search products").fill(producto);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Add" }).first().click();
}

/**
 * Save the current cart as a draft, confirm it, and read the emitted sale id
 * plus NCF from the success banner.
 */
export async function guardarYConfirmar(
  page: Page,
): Promise<{ ventaId: number; ncf: string }> {
  await page.getByRole("button", { name: "Save draft" }).click();

  const confirm = page.getByRole("button", { name: /Confirm draft \d+/ });
  await confirm.waitFor();
  await confirm.click();

  const poster = page.getByText(/Sale #\d+ confirmed/);
  await expect(poster).toContainText(/Sale #\d+ confirmed/);
  const text = (await poster.textContent())!;
  return {
    ventaId: Number(text.match(/#(\d+)/)![1]),
    ncf: text.match(/invoice (B\d+)/)![1],
  };
}

/**
 * The demo credit client's id for a tenant (0 when the seed row is absent, so
 * callers keep their explicit self-skip contract).
 */
export async function idClienteCreditoDemo(
  pool: Pool,
  empresaId: number,
): Promise<number> {
  const cliente = await pool.query(
    `select id from "CLIENTE"
      where "empresaId" = $1 and nombre = $2 and "tipoCliente" = 'CREDITO' and "creditoHabilitado" = true
       and activo = true
       limit 1`,
    [empresaId, CLIENTE_CREDITO_DEMO_NOMBRE],
  );
  return cliente.rows[0]?.id ?? 0;
}
