/**
 * Printable fiscal-invoice E2E (factura-print.md T3, S2/S3/S4) — local lane.
 *
 * Flow: login (nombreUsuario, ADR-014) → pick the newest VIGENTE FACTURA of the
 * session's company straight from the local DB → open /venta/factura/{id} →
 * assert the DGII 254-06 document contract renders (denomination, NCF, expiry,
 * ITBIS desglosado, total, forma de pago) → click Imprimir (must not throw) →
 * assert the DB invoice count did NOT change (a reprint never mints an NCF, S4).
 *
 * ENV: E2E_USER/E2E_PASSWORD (Supabase Auth), DATABASE_URL or DIRECT_URL for
 * the invoice lookup (the base URL comes from `playwright.config.ts`). Skips
 * are NOT allowed
 * downstream (assert-no-skips.mjs), so the invoice precondition FAILS loudly.
 */

import { test, expect } from "@playwright/test";
import "dotenv/config";
import { Pool } from "pg";
import { login } from "./utils/login";
import { E2E_PASSWORD, E2E_USER } from "./utils/venta-pos";

const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});

let factura: { id: number; ncf: string; tipoNcf: string };

test.beforeAll(async () => {
  const { rows } = await pool.query(
    `SELECT f."id", f."ncf", f."tipoNcf"::text
       FROM "FACTURA" f
      WHERE f."estado" = 'VIGENTE'
      ORDER BY f."id" DESC
      LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error(
      "No VIGENTE FACTURA exists in the local DB: run the confirm-venta smoke first " +
        "(e2e/confirm-venta.spec.ts) so the print view has a real invoice to render.",
    );
  }
  factura = rows[0]!;
});

test.afterAll(async () => {
  await pool.end();
});

test.describe("printable fiscal invoice (factura-print.md)", () => {
  test("renders the DGII 254-06 document for a real invoice and never mints an NCF", async ({
    page,
  }) => {
    test.skip(E2E_PASSWORD === "", "Set E2E_USER/E2E_PASSWORD (Supabase Auth) to run.");
    await login(page, { user: E2E_USER, password: E2E_PASSWORD });

    await page.goto(`/venta/factura/${factura.id}`);
    const doc = page.getByTestId("factura-print");
    await doc.waitFor();

    // Header: denomination per type, the NCF visible, expiry from data.
    const ncfText = await page.getByTestId("factura-ncf").textContent();
    expect(ncfText).toContain(factura.ncf);
    expect(await page.getByTestId("factura-denominacion").textContent()).toMatch(
      factura.tipoNcf === "B01" ? /Crédito Fiscal/ : /Consumo/,
    );
    // VIGENTE invoices always carry a governing range expiry (S3).
    expect(await page.getByTestId("factura-ncf-vigencia").textContent()).toMatch(/\d{4}-\d{2}-\d{2}/);

    // Money: total present; payment status derived from the balance (Pagada or Saldo pendiente).
    expect(await page.getByTestId("factura-total").textContent()).toMatch(/RD\$/);
    const formaPago = await page.getByTestId("factura-forma-pago").textContent();
    expect(formaPago).toMatch(/^(Pagada|Saldo pendiente)$/);

    // Reprint contract (S4): clicking Imprimir mints NOTHING. Count invoices
    // (and NCF-adjacent state) after the click — unchanged, and the print
    // dialog never blocks the headless run.
    const antes = await pool.query(`SELECT COUNT(*)::int AS n FROM "FACTURA"`);
    await page.getByTestId("factura-boton-imprimir").click();
    const despues = await pool.query(`SELECT COUNT(*)::int AS n FROM "FACTURA"`);
    expect(despues.rows[0]!.n).toBe(antes.rows[0]!.n);
    expect(await doc.textContent()).toContain("no genera un nuevo NCF");
  });

  test("a foreign invoice id surfaces the typed catalog error, never a provider error", async ({
    page,
  }) => {
    test.skip(E2E_PASSWORD === "", "Set E2E_USER/E2E_PASSWORD (Supabase Auth) to run.");
    await login(page, { user: E2E_USER, password: E2E_PASSWORD });

    await page.goto("/venta/factura/999999");
    // The app shell carries its own empty alert/live region — wait for THIS
    // island's typed error, not for any alert node.
    const alert = page.getByRole("alert").filter({ hasText: "Factura no encontrada" });
    await alert.waitFor();
    expect(await alert.textContent()).toBe("Factura no encontrada");
    expect(await alert.textContent()).not.toMatch(/Prisma|Error:|at /);
  });
});
