/**
 * Fase-5c E2E smoke (task 4.6): the confirm happy path through the REAL stack.
 *
 * Flow: login (remote Supabase) → POS → search → add to cart → save draft →
 * confirm → assert CONFIRMADA + NCF on the screen → assert the full observable
 * chain in the LOCAL dev DB (VENTA flip, VIGENTE FACTURA with the shown NCF,
 * NCF_SECUENCIA advanced, one SALIDA_VENTA movement).
 *
 * PREREQUISITES (documented in SETUP-LOCAL.md — the "seed+DB caveat"):
 *   1. Local Postgres up (`docker compose up -d`) and `prisma migrate deploy`.
 *   2. Seeded dev data, in order: `pnpm seed:venta`, `pnpm seed:ncf`,
 *      `pnpm seed:cliente`. `E2E_USER`'s empresa must own B01/B02 ranges and
 *      `facturaAutomatica=true`; the appointed branch must stock `E2E_PRODUCT`.
 *   3. Supabase Auth user matching `E2E_USER`'s `nombreUsuario` (email is never
 *      a credential, ADR-014). Set `E2E_USER` / `E2E_PASSWORD`.
 *   4. Browsers: `npx playwright install chromium`.
 *
 * ENV: E2E_BASE_URL (default http://localhost:3000), E2E_USER (default "e2e"),
 * E2E_PASSWORD, E2E_PRODUCT (default "Arroz").
 */

import { test, expect } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { openDb, usuarioPrecond, type UsuarioPrecond } from "./utils/db";
import {
  CLIENTE_CREDITO_DEMO_NOMBRE,
  E2E_PASSWORD,
  E2E_PRODUCT,
  E2E_USER,
  buscarYAgregar,
  guardarYConfirmar,
  idClienteCreditoDemo,
} from "./utils/venta-pos";

// Superuser read for ASSERTIONS ONLY (RLS would tenant-filter the probe).
const pool = openDb();

let precond: UsuarioPrecond;
/** Demo CREDITO client id; 0 when the seed row is absent (test self-skips). */
let clienteIdCredito = 0;

async function checkPreconditions(): Promise<void> {
  precond = await usuarioPrecond(pool, E2E_USER);

  // The confirm emission gate: the empresa must auto-invoice (R-F1). The
  // flag lives on EMPRESA (`facturaAutomatica`); CONFIGURACION_EMPRESA is the
  // key/value params table (DESC_MAX, ITBIS validity…), not a boolean row.
  const cfg = await pool.query(
    `select "facturaAutomatica" from "EMPRESA" where id = $1`,
    [precond.empresaId],
  );
  if (cfg.rowCount === 0 || !cfg.rows[0].facturaAutomatica) {
    throw new Error(`Empresa ${precond.empresaId} has facturaAutomatica=false (R-F1 blocks confirm).`);
  }

  // B01/B02 ranges must exist for the user's empresa (seed:ncf).
  const ncf = await pool.query(
    `select "tipoNcf", "rangoInicio", "rangoFin", "secuenciaActual", activa
       from "NCF_SECUENCIA" where "empresaId" = $1 order by "tipoNcf"`,
    [precond.empresaId],
  );
  const tipos = ncf.rows.map((r) => r.tipoNcf);
  if (!tipos.includes("B01") || !tipos.includes("B02")) {
    throw new Error(`Empresa ${precond.empresaId} lacks B01/B02 NCF ranges — run pnpm seed:ncf.`);
  }

  // The E2E must sell a real stocked product at the user's branch.
  const prod = await pool.query(
    `select p.id, p.nombre, p."tasaItbis", i.cantidad
       from "PRODUCTO" p
       left join "INVENTARIO" i on i."productoId" = p.id and i."sucursalId" = $2
      where p.nombre = $1 and p.activo = true`,
    [E2E_PRODUCT, precond.sucursalId],
  );
  if (prod.rowCount === 0) {
    throw new Error(`E2E_PRODUCT "${E2E_PRODUCT}" not found/active — seed products with stock at sucursal ${precond.sucursalId}.`);
  }
  if (Number(prod.rows[0].cantidad) < 1) {
    throw new Error(`"${E2E_PRODUCT}" has no stock at sucursal ${precond.sucursalId} (cantidad=${prod.rows[0].cantidad}).`);
  }

  // Optional for the credit case: absence self-skips that test (task 5.13).
  clienteIdCredito = await idClienteCreditoDemo(pool, precond.empresaId);
}

test.describe("confirm smoke (R-V15)", () => {
  test.beforeAll(async () => {
    await checkPreconditions();
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("draft → confirm → CONFIRMADA with NCF, plus the full DB observable chain", async ({ page }) => {
    test.skip(E2E_PASSWORD === "", "Set E2E_USER/E2E_PASSWORD (Supabase Auth) to run the smoke.");
    await login(page, { user: E2E_USER, password: E2E_PASSWORD });

    await page.goto("/venta");
    await page.getByRole("heading", { name: "Point of sale" }).waitFor();

    // Build a one-line cart and save the draft.
    await page.getByLabel("Search products").fill(E2E_PRODUCT);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("button", { name: "Add" }).first().click();
    await page.getByRole("button", { name: "Save draft" }).click();

    // The saved BORRADOR appears in "My drafts" with its confirm control.
    const confirm = page.getByRole("button", { name: /Confirm draft \d+/ });
    await confirm.waitFor();
    await confirm.click();

    // Success status carries the invoice NCF and the row flips CONFIRMADA.
    const status = page.getByRole("status");
    await expect(status).toContainText(/confirmed — invoice B\d+/);
    const saleNcf = (await status.textContent())!.match(/invoice (B\d+)/)![1];
    const ventaId = Number((await status.textContent())!.match(/#(\d+)/)![1]);

    const row = page.getByTestId(`venta-fila-${ventaId}`);
    await expect(row).toContainText("CONFIRMADA");
    await expect(row).toContainText(saleNcf);

    // Observable chain in the LOCAL dev DB (assertions only, superuser reads).
    const venta = await pool.query(
      `select estado from "VENTA" where id = $1 and "empresaId" = $2 and "sucursalId" = $3`,
      [ventaId, precond.empresaId, precond.sucursalId],
    );
    expect(venta.rows[0]?.estado).toBe("CONFIRMADA");

    const factura = await pool.query(
      `select id, ncf, estado, "tipoNcf", total from "FACTURA" where "ventaId" = $1`,
      [ventaId],
    );
    expect(factura.rowCount).toBe(1);
    expect(factura.rows[0].ncf).toBe(saleNcf);
    expect(factura.rows[0].estado).toBe("VIGENTE");

    // R-V26/D8 contado COBRO gap: a cash sale auto-settles, so exactly ONE
    // applied COBRO exists for the invoice and it covers the frozen total.
    const pagos = await pool.query(
      `select tipo, estado, monto from "PAGO"
        where "facturaId" = $1 and "empresaId" = $2`,
      [factura.rows[0].id, precond.empresaId],
    );
    expect(pagos.rowCount).toBe(1);
    expect(pagos.rows[0].tipo).toBe("COBRO");
    expect(pagos.rows[0].estado).toBe("APLICADO");
    expect(Number(pagos.rows[0].monto)).toBe(Number(factura.rows[0].total));

    // The consumed NCF advances the range's sequence exactly to its %08d tail.
    const sec = await pool.query(
      `select "secuenciaActual" from "NCF_SECUENCIA" where "empresaId" = $1 and "tipoNcf" = $2`,
      [precond.empresaId, factura.rows[0].tipoNcf],
    );
    expect(Number(sec.rows[0].secuenciaActual)).toBe(Number(saleNcf.slice(3)));

    // Exactly one SALIDA_VENTA movement for this sale (no N+1, no double-debit).
    const movs = await pool.query(
      `select "tipoMovimiento", "cantidadAnterior", "cantidadNueva" from "MOVIMIENTO_INVENTARIO" where "ventaId" = $1`,
      [ventaId],
    );
    expect(movs.rowCount).toBe(1);
    expect(movs.rows[0].tipoMovimiento).toBe("SALIDA_VENTA");
    expect(Number(movs.rows[0].cantidadNueva)).toBeLessThan(Number(movs.rows[0].cantidadAnterior));
  });

  /**
   * R-V26/D8 credit divergence: the SAME flow with a CREDITO client must NOT
   * auto-settle. No COBRO is created — the receivable stays collectable for
   * fase 6 (ADR-017: balances are derived, never materialized on confirm).
   */
  test("credit client → confirm → CONFIRMADA + VIGENTE invoice with ZERO COBRO rows", async ({ page }) => {
    test.skip(E2E_PASSWORD === "", "Set E2E_USER/E2E_PASSWORD (Supabase Auth) to run the smoke.");
    test.skip(
      clienteIdCredito === 0,
      `Demo CREDITO client "${CLIENTE_CREDITO_DEMO_NOMBRE}" not seeded for empresa ${precond.empresaId} — run pnpm seed:bootstrap.`,
    );
    await login(page, { user: E2E_USER, password: E2E_PASSWORD });

    await page.goto("/venta");
    await page.getByRole("heading", { name: "Point of sale" }).waitFor();
    await page.getByRole("combobox", { name: "Client selection" }).selectOption({
      label: CLIENTE_CREDITO_DEMO_NOMBRE,
    });
    await buscarYAgregar(page, E2E_PRODUCT);

    const { ventaId, ncf } = await guardarYConfirmar(page);
    // The banner carries the emitted NCF (same copy shape as the cash path).
    await expect(page.getByText(/Sale #\d+ confirmed — invoice B\d+/)).toBeVisible();
    await expect(page.getByTestId(`venta-fila-${ventaId}`)).toContainText(ncf);

    const venta = await pool.query(
      `select estado from "VENTA" where id = $1 and "empresaId" = $2 and "sucursalId" = $3`,
      [ventaId, precond.empresaId, precond.sucursalId],
    );
    expect(venta.rows[0]?.estado).toBe("CONFIRMADA");

    const factura = await pool.query(
      `select id, ncf, estado from "FACTURA" where "ventaId" = $1`,
      [ventaId],
    );
    expect(factura.rowCount).toBe(1);
    expect(factura.rows[0].ncf).toBe(ncf);
    expect(factura.rows[0].estado).toBe("VIGENTE");

    // Credit edge: nothing auto-collects. ZERO applied COBRO rows.
    const pagos = await pool.query(
      `select count(*)::int as n from "PAGO"
        where "facturaId" = $1 and "empresaId" = $2 and tipo = 'COBRO' and estado = 'APLICADO'`,
      [factura.rows[0].id, precond.empresaId],
    );
    expect(pagos.rows[0].n).toBe(0);
  });
});