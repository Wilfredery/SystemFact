/**
 * /inventario/ajuste E2E (odd/tasks/inventario-ajuste.md T3, S2-S6).
 *
 * The Administrador adjusts stock from the consulta page (`+ Ajustar`): a live
 * preview line, the "Stock insuficiente" guard, an Entrada 5 that is checked
 * against the DATABASE (INVENTARIO and the AJUSTE movement), then a Salida 5
 * that restores the stock so the other specs that sell this product are not
 * disturbed. Operador and Despachador get no `+ Ajustar` link and, on the
 * direct URL, the access alert and never the form (hiding is not security:
 * the action re-checks the role, covered by the integration tests).
 *
 * No test here may skip: a missing env var FAILS the test (a skip in the local
 * lane reads as coverage it does not have; see assert-no-skips.mjs).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_DESPACHADOR_USER,
 * E2E_PASSWORD (shared by the three identities on the ephemeral local stack),
 * E2E_PRODUCT (default Arroz) and DIRECT_URL/DATABASE_URL (superuser read of the
 * acting user's role and of the stock, ASSERTIONS ONLY).
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

const MENSAJE_SIN_PERMISO = "No tiene permisos para ajustar inventario.";

type Opcion = { codigo: string; stock: number };

/** Opens /inventario from the sidebar once signed in. */
async function irAInventario(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Inventario", exact: true }).click();
  await page.waitForURL("**/inventario", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Inventario", exact: true })).toBeVisible();
}

/** From /inventario: `+ Ajustar`, search the fixture product and pick it. */
async function elegirProducto(page: Page): Promise<Opcion> {
  await page.getByRole("link", { name: "+ Ajustar", exact: true }).click();
  await page.waitForURL("**/inventario/ajuste", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Ajuste de Inventario" })).toBeVisible();

  await page.getByPlaceholder("Seleccionar producto...").fill(E2E_PRODUCT);
  const opcion = page
    .getByRole("list", { name: "Productos encontrados" })
    .getByRole("button")
    .filter({ hasText: E2E_PRODUCT })
    .first();
  await expect(opcion).toBeVisible();

  const [etiqueta, stockTexto] = await opcion.locator("span").allTextContents();
  const codigo = etiqueta.split(" — ")[0].trim();
  const stock = Number(stockTexto.replace("Stock:", "").trim());
  expect(Number.isFinite(stock), `stock read from "${stockTexto}"`).toBe(true);

  await opcion.click();
  return { codigo, stock };
}

async function stockEnDb(sucursalId: number, empresaId: number, codigo: string) {
  const res = await pool.query(
    `select i.id as "inventarioId", i.cantidad::text as cantidad
       from "INVENTARIO" i
       join "PRODUCTO" p on p.id = i."productoId"
      where i."sucursalId" = $1 and p."empresaId" = $2 and p.codigo = $3`,
    [sucursalId, empresaId, codigo],
  );
  expect(res.rowCount, `INVENTARIO row for ${codigo} in sucursal ${sucursalId}`).toBe(1);
  const fila = res.rows[0] as { inventarioId: number; cantidad: string };
  return { inventarioId: fila.inventarioId, cantidad: Number(fila.cantidad) };
}

async function ultimoMovimientoId(inventarioId: number): Promise<number> {
  const res = await pool.query(
    `select coalesce(max(id), 0) as id from "MOVIMIENTO_INVENTARIO" where "inventarioId" = $1`,
    [inventarioId],
  );
  return Number(res.rows[0].id);
}

async function movimientosNuevos(inventarioId: number, despuesDeId: number) {
  const res = await pool.query(
    `select "tipoMovimiento"::text as tipo, motivo, "usuarioId",
            "cantidadMovida"::text as movida,
            "cantidadAnterior"::text as anterior, "cantidadNueva"::text as nueva
       from "MOVIMIENTO_INVENTARIO"
      where "inventarioId" = $1 and id > $2
      order by id`,
    [inventarioId, despuesDeId],
  );
  return res.rows as {
    tipo: string;
    motivo: string;
    usuarioId: number;
    movida: string;
    anterior: string;
    nueva: string;
  }[];
}

async function confirmarAjuste(
  page: Page,
  datos: { tipo: "Entrada" | "Salida"; motivo: string; cantidad: number; observaciones: string },
): Promise<void> {
  const tipo = page.getByRole("button", { name: datos.tipo, exact: true });
  await tipo.click();
  await expect(tipo).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Motivo *").selectOption({ label: datos.motivo });
  await page.getByLabel("Nueva cantidad *").fill(String(datos.cantidad));
  await page.getByLabel("Observaciones").fill(datos.observaciones);
  const confirmar = page.getByRole("button", { name: "Confirmar Ajuste" });
  await expect(confirmar).toBeEnabled();
  await confirmar.click();
  await page.waitForURL("**/inventario", { timeout: 20_000 });
}

/**
 * After the redirect the consulta must show the new stock (wireframe: "Confirmar
 * Ajuste -> Consulta (stock actualizado)"): search the product and read its
 * Existencia cell (5th column: Código, Nombre, Categoría, Und., Existencia).
 */
async function esperarExistenciaEnConsulta(page: Page, codigo: string, esperada: number): Promise<void> {
  await page.getByLabel("Buscar producto").fill(codigo);
  const fila = page.locator('[data-testid^="inventario-fila-"]').filter({ hasText: codigo }).first();
  await expect(fila.locator("td").nth(4), `Existencia of ${codigo} on /inventario`).toHaveText(String(esperada));
}

// If the test dies between the Entrada and the Salida, put the stock back so the
// specs that sell this product keep their expectations. Direct SQL is acceptable
// here only because this is test cleanup on the ephemeral local stack.
let restaurarStock: (() => Promise<void>) | null = null;

test.describe("/inventario/ajuste (inventario-ajuste T3)", () => {
  test.afterEach(async () => {
    const restaurar = restaurarStock;
    restaurarStock = null;
    if (restaurar !== null) await restaurar();
  });

  test("Administrador adjusts stock (Entrada 5, then Salida 5) and the database reflects it", async ({ page }) => {
    const nombreUsuario = requireEnv("E2E_USER");
    const password = requireEnv("E2E_PASSWORD");

    expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([
      "Administrador",
    ]);
    const { usuarioId, empresaId, sucursalId } = await usuarioPrecond(pool, nombreUsuario);

    await login(page, { user: nombreUsuario, password });
    await irAInventario(page);

    // --- Entrada 5 -------------------------------------------------------
    const { codigo, stock: x } = await elegirProducto(page);
    const antes = await stockEnDb(sucursalId, empresaId, codigo);
    expect(antes.cantidad, "stock shown in the option equals INVENTARIO").toBe(x);
    const movimientoBase = await ultimoMovimientoId(antes.inventarioId);
    restaurarStock = async () => {
      await pool.query(`update "INVENTARIO" set cantidad = $2 where id = $1 and cantidad <> $2`, [
        antes.inventarioId,
        x,
      ]);
    };

    // A Salida above the stock is refused in the form: message and disabled button.
    await page.getByRole("button", { name: "Salida", exact: true }).click();
    await page.getByLabel("Motivo *").selectOption({ label: "Merma" });
    await page.getByLabel("Nueva cantidad *").fill(String(x + 1));
    await expect(page.getByText("Stock insuficiente")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirmar Ajuste" })).toBeDisabled();

    // Entrada 5: the live line says what the stock will become (S2).
    await page.getByRole("button", { name: "Entrada", exact: true }).click();
    await page.getByLabel("Nueva cantidad *").fill("5");
    await expect(page.getByText(`Existencia actual ${x} → quedará ${x + 5}`)).toBeVisible();
    await expect(page.getByText("Stock insuficiente")).toHaveCount(0);

    await confirmarAjuste(page, {
      tipo: "Entrada",
      motivo: "Conteo físico",
      cantidad: 5,
      observaciones: "e2e ajuste",
    });

    await esperarExistenciaEnConsulta(page, codigo, x + 5);
    const despuesEntrada = await stockEnDb(sucursalId, empresaId, codigo);
    expect(despuesEntrada.cantidad, "INVENTARIO after Entrada 5").toBe(x + 5);
    const movimientosEntrada = await movimientosNuevos(antes.inventarioId, movimientoBase);
    expect(movimientosEntrada).toHaveLength(1);
    expect(movimientosEntrada[0]).toMatchObject({
      tipo: "AJUSTE",
      motivo: "Conteo físico: e2e ajuste",
      usuarioId,
    });
    expect(Number(movimientosEntrada[0].movida)).toBe(5);
    expect(Number(movimientosEntrada[0].anterior)).toBe(x);
    expect(Number(movimientosEntrada[0].nueva)).toBe(x + 5);

    // --- Salida 5: restore the stock the other specs sell from ------------
    const segunda = await elegirProducto(page);
    expect(segunda.codigo).toBe(codigo);
    expect(segunda.stock, "the list now shows the adjusted stock").toBe(x + 5);
    await page.getByRole("button", { name: "Salida", exact: true }).click();
    await page.getByLabel("Nueva cantidad *").fill("5");
    await expect(page.getByText(`Existencia actual ${x + 5} → quedará ${x}`)).toBeVisible();

    await confirmarAjuste(page, {
      tipo: "Salida",
      motivo: "Corrección de error",
      cantidad: 5,
      observaciones: "e2e ajuste restore",
    });

    await esperarExistenciaEnConsulta(page, codigo, x);
    const despuesSalida = await stockEnDb(sucursalId, empresaId, codigo);
    expect(despuesSalida.cantidad, "INVENTARIO restored after Salida 5").toBe(x);
    const movimientosTotales = await movimientosNuevos(antes.inventarioId, movimientoBase);
    expect(movimientosTotales).toHaveLength(2);
    expect(movimientosTotales[1]).toMatchObject({
      tipo: "AJUSTE",
      motivo: "Corrección de error: e2e ajuste restore",
      usuarioId,
    });
    expect(Number(movimientosTotales[1].movida)).toBe(-5);
    expect(Number(movimientosTotales[1].anterior)).toBe(x + 5);
    expect(Number(movimientosTotales[1].nueva)).toBe(x);
  });

  for (const [rol, envUser] of [
    ["Operador", "E2E_OPERADOR_USER"],
    ["Despachador", "E2E_DESPACHADOR_USER"],
  ] as const) {
    test(`${rol} gets no + Ajustar link and an access message on /inventario/ajuste`, async ({ page }) => {
      const nombreUsuario = requireEnv(envUser);
      const password = requireEnv("E2E_PASSWORD");

      expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([rol]);

      await login(page, { user: nombreUsuario, password });
      await irAInventario(page);
      await expect(page.getByText("+ Ajustar")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Ajustar/ })).toHaveCount(0);

      await page.goto("/inventario/ajuste");
      await expect(page.getByRole("alert").filter({ hasText: MENSAJE_SIN_PERMISO })).toBeVisible();
      await expect(page.getByRole("link", { name: "Volver a Inventario" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Confirmar Ajuste" })).toHaveCount(0);
      await expect(page.getByPlaceholder("Seleccionar producto...")).toHaveCount(0);
    });
  }
});
