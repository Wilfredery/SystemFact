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

import { test, expect, type Page } from "@playwright/test";
import "dotenv/config";
import { Pool } from "pg";

const E2E_USER = process.env.E2E_USER ?? "e2e";
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";
const E2E_PRODUCT = process.env.E2E_PRODUCT ?? "Arroz";

// Superuser read for ASSERTIONS ONLY (RLS would tenant-filter the probe);
// falls back to the app URL when DIRECT_URL is absent. Queries never mutate.
const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});

type Precond = {
  usuarioId: number;
  empresaId: number;
  sucursalId: number;
};

let precond: Precond;

async function checkPreconditions(): Promise<void> {
  const user = await pool.query(
    `select u.id as "usuarioId", u."empresaId", u."sucursalId", r.nombre as rol
       from "USUARIO" u
       left join "USUARIO_ROL" ur on ur."usuarioId" = u.id
       left join "ROL" r on r.id = ur."rolId"
      where u."nombreUsuario" = $1 and u.activo = true`,
    [E2E_USER],
  );
  if (user.rowCount === 0) {
    throw new Error(
      `E2E_USER "${E2E_USER}" not found in the LOCAL dev DB (postgres @ :5433). ` +
        `Create the user row, then run pnpm seed:venta && pnpm seed:ncf && pnpm seed:cliente.`,
    );
  }
  const row = user.rows[0];
  if (row.rol !== "Administrador" && row.rol !== "Operador") {
    throw new Error(`E2E_USER "${E2E_USER}" has rol "${row.rol}"; the POS requires Administrador/Operador.`);
  }

  // The confirm emission gate: the empresa must auto-invoice (R-F1). The
  // flag lives on EMPRESA (`facturaAutomatica`); CONFIGURACION_EMPRESA is the
  // key/value params table (DESC_MAX, ITBIS validity…), not a boolean row.
  const cfg = await pool.query(
    `select "facturaAutomatica" from "EMPRESA" where id = $1`,
    [row.empresaId],
  );
  if (cfg.rowCount === 0 || !cfg.rows[0].facturaAutomatica) {
    throw new Error(`Empresa ${row.empresaId} has facturaAutomatica=false (R-F1 blocks confirm).`);
  }

  // B01/B02 ranges must exist for the user's empresa (seed:ncf).
  const ncf = await pool.query(
    `select "tipoNcf", "rangoInicio", "rangoFin", "secuenciaActual", activa
       from "NCF_SECUENCIA" where "empresaId" = $1 order by "tipoNcf"`,
    [row.empresaId],
  );
  const tipos = ncf.rows.map((r) => r.tipoNcf);
  if (!tipos.includes("B01") || !tipos.includes("B02")) {
    throw new Error(`Empresa ${row.empresaId} lacks B01/B02 NCF ranges — run pnpm seed:ncf.`);
  }

  // The E2E must sell a real stocked product at the user's branch.
  const prod = await pool.query(
    `select p.id, p.nombre, p."tasaItbis", i.cantidad
       from "PRODUCTO" p
       left join "INVENTARIO" i on i."productoId" = p.id and i."sucursalId" = $2
      where p.nombre = $1 and p.activo = true`,
    [E2E_PRODUCT, row.sucursalId],
  );
  if (prod.rowCount === 0) {
    throw new Error(`E2E_PRODUCT "${E2E_PRODUCT}" not found/active — seed products with stock at sucursal ${row.sucursalId}.`);
  }
  if (Number(prod.rows[0].cantidad) < 1) {
    throw new Error(`"${E2E_PRODUCT}" has no stock at sucursal ${row.sucursalId} (cantidad=${prod.rows[0].cantidad}).`);
  }

  precond = {
    usuarioId: row.usuarioId,
    empresaId: row.empresaId,
    sucursalId: row.sucursalId,
  };
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USER);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
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
    await login(page);

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
      `select ncf, estado, "tipoNcf" from "FACTURA" where "ventaId" = $1`,
      [ventaId],
    );
    expect(factura.rowCount).toBe(1);
    expect(factura.rows[0].ncf).toBe(saleNcf);
    expect(factura.rows[0].estado).toBe("VIGENTE");

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
});