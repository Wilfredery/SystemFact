/**
 * /productos E2E (odd/tasks/productos.md T2, S1-S4).
 *
 * The Administrador manages products from the new screen: creates one (code,
 * name, category, unit, Decimal price, ITBIS, description), checks it against
 * the DATABASE, edits its price (the optimistic lock version round-trips), and
 * deactivates it — asserting `activo=false` and that the row STILL EXISTS,
 * because a master entity is never deleted. Operador and Despachador are
 * view-only: no `+ Nuevo producto`, no `Acciones` column, no row actions; they
 * still read the list. Hiding is not security: the write actions re-check the
 * role on the server, covered by the unit and integration tests.
 *
 * No test here may skip: a missing env var FAILS the test (a skip in the local
 * lane reads as coverage it does not have; see assert-no-skips.mjs).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_DESPACHADOR_USER,
 * E2E_PASSWORD (shared by the three identities on the ephemeral local stack),
 * E2E_PRODUCT (default Arroz, for the view-only read) and
 * DIRECT_URL/DATABASE_URL (superuser read of the acting user's role and of the
 * created product, ASSERTIONS ONLY plus a soft cleanup).
 */

import { test, expect, type Page } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { openDb, rolesDelUsuario, usuarioPrecond } from "./utils/db";
import { requireEnv } from "./utils/env";
import { E2E_PRODUCT } from "./utils/venta-pos";

const pool = openDb();

test.afterAll(async () => {
  await pool.end();
});

const PRECIO_CREADO = "199.99";
const PRECIO_EDITADO = "249.50";

/** Opens /productos from the sidebar once signed in. */
async function irAProductos(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Productos", exact: true }).click();
  await page.waitForURL("**/productos", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Productos", exact: true })).toBeVisible();
}

async function buscar(page: Page, termino: string): Promise<void> {
  await page.getByLabel("Buscar producto").fill(termino);
}

function filaDelProducto(page: Page, codigo: string) {
  return page.locator('[data-testid^="producto-fila-"]').filter({ hasText: codigo }).first();
}

async function productoEnDb(empresaId: number, codigo: string) {
  const res = await pool.query(
    `select "activo", "precioVenta"::text as precio, "unidadMedida" as unidad
       from "PRODUCTO"
      where "empresaId" = $1 and "codigo" = $2`,
    [empresaId, codigo],
  );
  expect(res.rowCount, `PRODUCTO row for ${codigo}`).toBe(1);
  return res.rows[0] as { activo: boolean; precio: string; unidad: string };
}

// If the test dies before the deactivation, leave the created product inactive
// (soft state, never a delete) so the other specs' lists stay clean.
let creado: { empresaId: number; codigo: string } | null = null;

test.describe("/productos (productos T1/T2)", () => {
  test.afterEach(async () => {
    const pendiente = creado;
    creado = null;
    if (pendiente !== null) {
      await pool.query(
        `update "PRODUCTO" set "activo" = false where "empresaId" = $1 and "codigo" = $2`,
        [pendiente.empresaId, pendiente.codigo],
      );
    }
  });

  test("Administrador creates, edits and deactivates a product; the database reflects it", async ({ page }) => {
    const nombreUsuario = requireEnv("E2E_USER");
    const password = requireEnv("E2E_PASSWORD");

    expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([
      "Administrador",
    ]);
    const { empresaId } = await usuarioPrecond(pool, nombreUsuario);
    // A fresh code per run: the partial unique (empresaId, codigo) only covers
    // active rows, but the seed already owns other codes.
    const codigo = `E2E-P-${Date.now()}`;
    creado = { empresaId, codigo };

    await login(page, { user: nombreUsuario, password });
    await irAProductos(page);

    // --- Create ------------------------------------------------------------
    await page.getByRole("button", { name: "+ Nuevo producto" }).click();
    const crear = page.getByRole("dialog");
    await expect(crear.getByRole("heading", { name: "Nuevo producto" })).toBeVisible();
    await crear.getByLabel("Código *").fill(codigo);
    await crear.getByLabel("Nombre *").fill("Producto E2E productos");
    // The first real category of the tenant (option 0 is the placeholder).
    await crear.getByLabel("Categoría *").selectOption({ index: 1 });
    await crear.getByLabel("Unidad").fill("Libra");
    await crear.getByLabel("Precio de venta *").fill(PRECIO_CREADO);
    await crear.getByLabel("ITBIS *").selectOption({ label: "16%" });
    await crear.getByLabel("Descripción").fill("creado por e2e productos");
    await crear.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByRole("status")).toHaveText("Producto creado.");
    await buscar(page, codigo);
    await expect(filaDelProducto(page, codigo)).toBeVisible();
    const despuesCrear = await productoEnDb(empresaId, codigo);
    expect(despuesCrear.activo, "PRODUCTO.activo after create").toBe(true);
    expect(Number(despuesCrear.precio), "PRODUCTO.precioVenta after create").toBe(199.99);
    expect(despuesCrear.unidad, "PRODUCTO.unidadMedida after create").toBe("Libra");

    // --- Edit (the dialog prefill carries the row version) ------------------
    await page.getByRole("button", { name: `Editar ${codigo}` }).click();
    const editar = page.getByRole("dialog");
    await expect(editar.getByRole("heading", { name: "Editar producto" })).toBeVisible();
    await expect(editar.getByLabel("Código *")).toHaveValue(codigo);
    await expect(editar.getByLabel("Unidad")).toHaveValue("Libra");
    await expect(editar.getByLabel("Precio de venta *")).toHaveValue(PRECIO_CREADO);
    await editar.getByLabel("Precio de venta *").fill(PRECIO_EDITADO);
    await editar.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByRole("status")).toHaveText("Producto actualizado.");
    const despuesEditar = await productoEnDb(empresaId, codigo);
    expect(Number(despuesEditar.precio), "PRODUCTO.precioVenta after edit").toBe(249.5);

    // --- Deactivate: activo=false, the row is NEVER deleted -----------------
    await page.getByRole("button", { name: `Desactivar ${codigo}` }).click();
    const confirmar = page.getByRole("dialog");
    await expect(confirmar.getByRole("heading", { name: "Desactivar producto" })).toBeVisible();
    expect(await confirmar.textContent()).toContain(codigo);
    await confirmar.getByRole("button", { name: "Desactivar" }).click();

    await expect(page.getByRole("status")).toHaveText("Producto desactivado.");
    expect(await filaDelProducto(page, codigo).count(), "the inactive row leaves the active list").toBe(0);
    const despuesDesactivar = await productoEnDb(empresaId, codigo);
    expect(despuesDesactivar.activo, "PRODUCTO.activo after deactivate").toBe(false);
    expect(Number(despuesDesactivar.precio), "the price history is preserved").toBe(249.5);
    creado = null; // already inactive: no cleanup needed
  });

  for (const [rol, envUser] of [
    ["Operador", "E2E_OPERADOR_USER"],
    ["Despachador", "E2E_DESPACHADOR_USER"],
  ] as const) {
    test(`${rol} reads /productos with no manage controls`, async ({ page }) => {
      const nombreUsuario = requireEnv(envUser);
      const password = requireEnv("E2E_PASSWORD");

      expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([rol]);

      await login(page, { user: nombreUsuario, password });
      await irAProductos(page);

      // Read side works: search returns the seeded fixture.
      await buscar(page, E2E_PRODUCT);
      await expect(page.locator('[data-testid^="producto-fila-"]').first()).toBeVisible();

      // Manage side is absent markup, not a disabled control (S3).
      await expect(page.getByRole("button", { name: "+ Nuevo producto" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Acciones" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Editar / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Desactivar / })).toHaveCount(0);
    });
  }
});
