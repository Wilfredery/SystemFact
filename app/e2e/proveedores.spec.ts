/**
 * /proveedores E2E (odd/tasks/proveedores.md T2, S1-S5).
 *
 * The Administrador manages suppliers from the new screen: creates one (razón
 * social, RNC, contacto, teléfono and both fiscal classifications), checks it
 * against the DATABASE, edits its contact phone (the optimistic-lock version
 * round-trips), and deactivates it — asserting `activo=false` and that the row
 * STILL EXISTS, because a master entity is never deleted. Operador and
 * Despachador are view-only: no `+ Nuevo proveedor`, no `Acciones` column, no row
 * buttons. They still read the list, because they receive purchases. Hiding is
 * not security: the write actions re-check the role group on the server,
 * covered by the unit tests.
 *
 * No test here may skip: a missing env var FAILS the test (a skip in the local
 * lane reads as coverage it does not have; see assert-no-skips.mjs).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_DESPACHADOR_USER,
 * E2E_PASSWORD (shared by the three identities on the ephemeral local stack)
 * and DIRECT_URL/DATABASE_URL (superuser read of the acting user's role and of
 * the created supplier, ASSERTIONS ONLY plus a soft cleanup).
 */

import { test, expect, type Page } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { openDb, rolesDelUsuario, usuarioPrecond } from "./utils/db";
import { requireEnv } from "./utils/env";

const pool = openDb();

test.afterAll(async () => {
  await pool.end();
});

const CONTACTO_CREADO = "María Gómez";
const CONTACTO_EDITADO = "María Gómez Peña";
const TELEFONO_CREADO = "809-555-0101";
const TELEFONO_EDITADO = "809-555-0102";

/**
 * The supplier RNC rule is the DOMAIN's: separators are stripped and what
 * remains must be 9–11 digits (no DGII check digit — that rule belongs to the
 * client). A timestamp gives a unique value per run without reusing seeded data.
 */
function rncProveedorUnico(): string {
  return String(Date.now()).slice(-9);
}

/** Opens /proveedores from the sidebar once signed in. */
async function irAProveedores(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Proveedores", exact: true }).click();
  await page.waitForURL("**/proveedores", { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "Proveedores", exact: true }),
  ).toBeVisible();
}

async function buscar(page: Page, termino: string): Promise<void> {
  await page.getByLabel("Buscar proveedor").fill(termino);
}

function filaDelProveedor(page: Page, nombre: string) {
  return page.locator('[data-testid^="proveedor-fila-"]').filter({ hasText: nombre }).first();
}

async function proveedorEnDb(empresaId: number, rnc: string) {
  const res = await pool.query(
    `select "activo", "nombre", "contacto", "telefono" as telefono,
            "tipoProveedor" as "tipoProveedor", "tipoPersona" as "tipoPersona",
            "version"
       from "PROVEEDOR"
      where "empresaId" = $1 and "rnc" = $2
      order by id desc`,
    [empresaId, rnc],
  );
  expect(res.rowCount, `PROVEEDOR row for ${rnc}`).toBe(1);
  return res.rows[0] as {
    activo: boolean;
    nombre: string;
    contacto: string;
    telefono: string;
    tipoProveedor: string;
    tipoPersona: string;
    version: number;
  };
}

// If the test dies before the deactivation, leave the created supplier inactive
// (soft state, never a delete) so the other specs' lists stay clean.
let creado: { empresaId: number; rnc: string } | null = null;

test.describe("/proveedores (proveedores T1/T2)", () => {
  test.afterEach(async () => {
    const pendiente = creado;
    creado = null;
    if (pendiente !== null) {
      await pool.query(
        `update "PROVEEDOR" set "activo" = false
          where "empresaId" = $1 and "rnc" = $2`,
        [pendiente.empresaId, pendiente.rnc],
      );
    }
  });

  test("Administrador creates, edits and deactivates a supplier; the database reflects it", async ({ page }) => {
    const nombreUsuario = requireEnv("E2E_USER");
    const password = requireEnv("E2E_PASSWORD");

    expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([
      "Administrador",
    ]);
    const { empresaId } = await usuarioPrecond(pool, nombreUsuario);
    const rnc = rncProveedorUnico();
    const nombre = `Distribuidora E2E ${Date.now()}`;
    creado = { empresaId, rnc };

    await login(page, { user: nombreUsuario, password });
    await irAProveedores(page);

    // --- Create ------------------------------------------------------------
    await page.getByRole("button", { name: "+ Nuevo proveedor" }).click();
    const crear = page.getByRole("dialog");
    await expect(crear.getByRole("heading", { name: "Nuevo proveedor" })).toBeVisible();
    await crear.getByLabel("Nombre o razón social *").fill(nombre);
    await crear.getByLabel("RNC").fill(rnc);
    await crear.getByLabel("Contacto *").fill(CONTACTO_CREADO);
    await crear.getByLabel("Teléfono *").fill(TELEFONO_CREADO);
    await crear.getByLabel("Tipo de proveedor *").selectOption("FORMAL");
    await crear.getByLabel("Tipo de persona *").selectOption("JURIDICA");
    await crear.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByRole("status")).toHaveText("Proveedor creado.");
    await buscar(page, nombre);
    await expect(filaDelProveedor(page, nombre)).toBeVisible();
    const despuesCrear = await proveedorEnDb(empresaId, rnc);
    expect(despuesCrear.activo, "PROVEEDOR.activo after create").toBe(true);
    expect(despuesCrear.nombre, "PROVEEDOR.nombre after create").toBe(nombre);
    expect(despuesCrear.contacto, "PROVEEDOR.contacto after create").toBe(CONTACTO_CREADO);
    expect(despuesCrear.telefono, "PROVEEDOR.telefono after create").toBe(TELEFONO_CREADO);
    expect(despuesCrear.tipoProveedor, "PROVEEDOR.tipoProveedor after create").toBe("FORMAL");
    expect(despuesCrear.tipoPersona, "PROVEEDOR.tipoPersona after create").toBe("JURIDICA");
    expect(despuesCrear.version, "PROVEEDOR.version after create").toBe(1);

    // --- Edit (the dialog prefill carries the row version) ------------------
    await page.getByRole("button", { name: `Editar ${nombre}` }).click();
    const editar = page.getByRole("dialog");
    await expect(editar.getByRole("heading", { name: "Editar proveedor" })).toBeVisible();
    await expect(editar.getByLabel("Nombre o razón social *")).toHaveValue(nombre);
    await expect(editar.getByLabel("RNC")).toHaveValue(rnc);
    await expect(editar.getByLabel("Contacto *")).toHaveValue(CONTACTO_CREADO);
    await expect(editar.getByLabel("Teléfono *")).toHaveValue(TELEFONO_CREADO);
    await editar.getByLabel("Contacto *").fill(CONTACTO_EDITADO);
    await editar.getByLabel("Teléfono *").fill(TELEFONO_EDITADO);
    await editar.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByRole("status")).toHaveText("Proveedor actualizado.");
    const despuesEditar = await proveedorEnDb(empresaId, rnc);
    expect(despuesEditar.contacto, "PROVEEDOR.contacto after edit").toBe(CONTACTO_EDITADO);
    expect(despuesEditar.telefono, "PROVEEDOR.telefono after edit").toBe(TELEFONO_EDITADO);
    expect(despuesEditar.version, "the optimistic lock bumped the version").toBe(2);

    // --- Deactivate: activo=false, the row is NEVER deleted -----------------
    await page.getByRole("button", { name: `Desactivar ${nombre}` }).click();
    const confirmar = page.getByRole("dialog");
    await expect(
      confirmar.getByRole("heading", { name: "Desactivar proveedor" }),
    ).toBeVisible();
    expect(await confirmar.textContent()).toContain(nombre);
    await confirmar.getByRole("button", { name: "Desactivar" }).click();

    await expect(page.getByRole("status")).toHaveText("Proveedor desactivado.");
    await expect(
      filaDelProveedor(page, nombre),
      "the inactive row leaves the active list",
    ).toHaveCount(0);
    const despuesDesactivar = await proveedorEnDb(empresaId, rnc);
    expect(despuesDesactivar.activo, "PROVEEDOR.activo after deactivate").toBe(false);
    expect(despuesDesactivar.contacto, "the supplier history is preserved").toBe(CONTACTO_EDITADO);
    creado = null; // already inactive: no cleanup needed
  });

  for (const [rol, envUser] of [
    ["Operador", "E2E_OPERADOR_USER"],
    ["Despachador", "E2E_DESPACHADOR_USER"],
  ] as const) {
    test(`${rol} reads /proveedores with no manage controls`, async ({ page }) => {
      const nombreUsuario = requireEnv(envUser);
      const password = requireEnv("E2E_PASSWORD");

      expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([rol]);

      await login(page, { user: nombreUsuario, password });
      await irAProveedores(page);

      // Read side works: the list renders (rows, or the explicit empty state)
      // and no permission error is shown.
      await expect(page.getByLabel("Buscar proveedor")).toBeVisible();
      await expect(
        page
          .locator('[data-testid^="proveedor-fila-"]')
          .first()
          .or(page.getByText("No hay proveedores que coincidan con los filtros.")),
      ).toBeVisible();
      // The screen's OWN alert (inside `main`), never any alert on the page:
      // Next.js App Router appends a route announcer to `document.body`
      // (`<next-route-announcer>` with `role="alert"`, open shadow root) that
      // Playwright's role query pierces, so an unscoped `getByRole("alert")`
      // reports 1 on every route and can never be 0. Same rule as the Clientes
      // screen and the CxC board.
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

      // Manage side is absent markup, not a disabled control (S3).
      await expect(page.getByRole("button", { name: "+ Nuevo proveedor" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Acciones" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Editar / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Desactivar / })).toHaveCount(0);
    });
  }
});
