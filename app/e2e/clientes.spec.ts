/**
 * /clientes E2E (odd/tasks/clientes.md T2, S1-S5).
 *
 * The Administrador manages clients from the new screen: creates one (razón
 * social, RNC with the DGII check digit, phone, address, classification and the
 * credit fields), checks it against the DATABASE, edits its phone and credit
 * limit (the optimistic-lock version round-trips), and deactivates it —
 * asserting `activo=false` and that the row STILL EXISTS, because a master
 * entity is never deleted. Operador and Despachador are view-only AND credit is
 * admin-only even in view mode: no `+ Nuevo cliente`, no `Acciones` column, no
 * `Crédito`/`Límite`/`Plazo` columns. They still read the list. Hiding is not
 * security: the write actions re-check the role and the credit group on the
 * server, covered by the unit tests.
 *
 * No test here may skip: a missing env var FAILS the test (a skip in the local
 * lane reads as coverage it does not have; see assert-no-skips.mjs).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_DESPACHADOR_USER,
 * E2E_PASSWORD (shared by the three identities on the ephemeral local stack)
 * and DIRECT_URL/DATABASE_URL (superuser read of the acting user's role and of
 * the created client, ASSERTIONS ONLY plus a soft cleanup).
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

const TELEFONO_CREADO = "809-555-0001";
const TELEFONO_EDITADO = "809-555-0002";
const LIMITE_CREADO = "15000.00";
const LIMITE_EDITADO = "25000.50";

/**
 * Build a DGII-valid 9-digit RNC from an 8-digit prefix: the mod-11 weights
 * (7,9,8,6,5,4,3,2) are the frozen ones in `src/shared/domain/fiscal-id.ts`.
 * Generating one keeps each run unique without reusing a seeded fiscal id.
 */
function rncValido(semilla: number): string {
  const base = String(semilla % 100_000_000).padStart(8, "0");
  const pesos = [7, 9, 8, 6, 5, 4, 3, 2];
  const suma = base
    .split("")
    .reduce((total, digito, i) => total + Number(digito) * pesos[i], 0);
  const dv = 11 - (suma % 11);
  // 10 is an impossible check digit and 11 normalizes to 0.
  if (dv === 10) return rncValido(semilla + 1);
  return `${base}${dv === 11 ? 0 : dv}`;
}

/** Opens /clientes from the sidebar once signed in. */
async function irAClientes(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Clientes", exact: true }).click();
  await page.waitForURL("**/clientes", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
}

async function buscar(page: Page, termino: string): Promise<void> {
  await page.getByLabel("Buscar cliente").fill(termino);
}

function filaDelCliente(page: Page, nombre: string) {
  return page.locator('[data-testid^="cliente-fila-"]').filter({ hasText: nombre }).first();
}

async function clienteEnDb(empresaId: number, identificacionFiscal: string) {
  const res = await pool.query(
    `select "activo", "nombre", "telefono" as telefono,
            "creditoHabilitado" as credito, "limiteCredito"::text as limite,
            "plazoCreditoDias" as plazo, "version"
       from "CLIENTE"
      where "empresaId" = $1 and "identificacionFiscal" = $2
      order by id desc`,
    [empresaId, identificacionFiscal],
  );
  expect(res.rowCount, `CLIENTE row for ${identificacionFiscal}`).toBe(1);
  return res.rows[0] as {
    activo: boolean;
    nombre: string;
    telefono: string;
    credito: boolean;
    limite: string;
    plazo: number;
    version: number;
  };
}

// If the test dies before the deactivation, leave the created client inactive
// (soft state, never a delete) so the other specs' lists stay clean.
let creado: { empresaId: number; identificacionFiscal: string } | null = null;

test.describe("/clientes (clientes T1/T2)", () => {
  test.afterEach(async () => {
    const pendiente = creado;
    creado = null;
    if (pendiente !== null) {
      await pool.query(
        `update "CLIENTE" set "activo" = false
          where "empresaId" = $1 and "identificacionFiscal" = $2`,
        [pendiente.empresaId, pendiente.identificacionFiscal],
      );
    }
  });

  test("Administrador creates, edits and deactivates a client; the database reflects it", async ({ page }) => {
    const nombreUsuario = requireEnv("E2E_USER");
    const password = requireEnv("E2E_PASSWORD");

    expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([
      "Administrador",
    ]);
    const { empresaId } = await usuarioPrecond(pool, nombreUsuario);
    const rnc = rncValido(Date.now());
    const nombre = `Cliente E2E ${Date.now()}`;
    creado = { empresaId, identificacionFiscal: rnc };

    await login(page, { user: nombreUsuario, password });
    await irAClientes(page);

    // --- Create ------------------------------------------------------------
    await page.getByRole("button", { name: "+ Nuevo cliente" }).click();
    const crear = page.getByRole("dialog");
    await expect(crear.getByRole("heading", { name: "Nuevo cliente" })).toBeVisible();
    await crear.getByLabel("Nombre o razón social *").fill(nombre);
    await crear.getByLabel("RNC / Cédula").fill(rnc);
    await crear.getByLabel("Teléfono *").fill(TELEFONO_CREADO);
    await crear.getByLabel("Dirección *").fill("Av. E2E 100");
    await crear.getByLabel("Tipo de cliente *").selectOption("MAYORISTA");
    await crear.getByLabel("Habilitar crédito").check();
    await crear.getByLabel("Límite de crédito").fill(LIMITE_CREADO);
    await crear.getByLabel("Plazo de crédito (días)").fill("15");
    await crear.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByRole("status")).toHaveText("Cliente creado.");
    await buscar(page, nombre);
    await expect(filaDelCliente(page, nombre)).toBeVisible();
    const despuesCrear = await clienteEnDb(empresaId, rnc);
    expect(despuesCrear.activo, "CLIENTE.activo after create").toBe(true);
    expect(despuesCrear.telefono, "CLIENTE.telefono after create").toBe(TELEFONO_CREADO);
    expect(despuesCrear.credito, "CLIENTE.creditoHabilitado after create").toBe(true);
    expect(despuesCrear.limite, "CLIENTE.limiteCredito after create").toBe(LIMITE_CREADO);
    expect(despuesCrear.plazo, "CLIENTE.plazoCreditoDias after create").toBe(15);
    expect(despuesCrear.version, "CLIENTE.version after create").toBe(1);

    // --- Edit (the dialog prefill carries the row version) ------------------
    await page.getByRole("button", { name: `Editar ${nombre}` }).click();
    const editar = page.getByRole("dialog");
    await expect(editar.getByRole("heading", { name: "Editar cliente" })).toBeVisible();
    await expect(editar.getByLabel("Nombre o razón social *")).toHaveValue(nombre);
    await expect(editar.getByLabel("RNC / Cédula")).toHaveValue(rnc);
    await expect(editar.getByLabel("Teléfono *")).toHaveValue(TELEFONO_CREADO);
    await expect(editar.getByLabel("Límite de crédito")).toHaveValue(LIMITE_CREADO);
    await editar.getByLabel("Teléfono *").fill(TELEFONO_EDITADO);
    await editar.getByLabel("Límite de crédito").fill(LIMITE_EDITADO);
    await editar.getByRole("button", { name: "Guardar" }).click();

    await expect(page.getByRole("status")).toHaveText("Cliente actualizado.");
    const despuesEditar = await clienteEnDb(empresaId, rnc);
    expect(despuesEditar.telefono, "CLIENTE.telefono after edit").toBe(TELEFONO_EDITADO);
    expect(despuesEditar.limite, "CLIENTE.limiteCredito after edit").toBe(LIMITE_EDITADO);
    expect(despuesEditar.version, "the optimistic lock bumped the version").toBe(2);

    // --- Deactivate: activo=false, the row is NEVER deleted -----------------
    await page.getByRole("button", { name: `Desactivar ${nombre}` }).click();
    const confirmar = page.getByRole("dialog");
    await expect(confirmar.getByRole("heading", { name: "Desactivar cliente" })).toBeVisible();
    expect(await confirmar.textContent()).toContain(nombre);
    await confirmar.getByRole("button", { name: "Desactivar" }).click();

    await expect(page.getByRole("status")).toHaveText("Cliente desactivado.");
    await expect(
      filaDelCliente(page, nombre),
      "the inactive row leaves the active list",
    ).toHaveCount(0);
    const despuesDesactivar = await clienteEnDb(empresaId, rnc);
    expect(despuesDesactivar.activo, "CLIENTE.activo after deactivate").toBe(false);
    expect(despuesDesactivar.limite, "the credit history is preserved").toBe(LIMITE_EDITADO);
    creado = null; // already inactive: no cleanup needed
  });

  for (const [rol, envUser] of [
    ["Operador", "E2E_OPERADOR_USER"],
    ["Despachador", "E2E_DESPACHADOR_USER"],
  ] as const) {
    test(`${rol} reads /clientes with no manage controls and no credit fields`, async ({ page }) => {
      const nombreUsuario = requireEnv(envUser);
      const password = requireEnv("E2E_PASSWORD");

      expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([rol]);

      await login(page, { user: nombreUsuario, password });
      await irAClientes(page);

      // Read side works: the list renders (rows, or the explicit empty state)
      // and no permission error is shown. The local seed only provisions the
      // Consumidor Final row, which operator lists exclude by design.
      await expect(page.getByLabel("Buscar cliente")).toBeVisible();
      await expect(
        page
          .locator('[data-testid^="cliente-fila-"]')
          .first()
          .or(page.getByText("No hay clientes que coincidan con los filtros.")),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);

      // Manage side is absent markup, not a disabled control (S3).
      await expect(page.getByRole("button", { name: "+ Nuevo cliente" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Acciones" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Editar / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Desactivar / })).toHaveCount(0);

      // Credit fields are admin-only even in view mode (S3).
      await expect(page.getByRole("columnheader", { name: "Crédito" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Límite" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Plazo" })).toHaveCount(0);
    });
  }
});
