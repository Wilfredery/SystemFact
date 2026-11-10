/**
 * /administracion E2E (odd/tasks/administracion.md T3, S8).
 *
 * The screen is a READ-ONLY directory (S1): three tabs — Usuarios, Sucursales,
 * Configuración — and no create/edit/assign control for anybody, not even the
 * Administrador. The Administrador reads all three tabs; Operador and
 * Despachador are outside `ROLES_VER_ADMINISTRACION` (S3), so they get the
 * access message and NO data (deny by default). Hiding is not security: every
 * read action re-checks the role group on the server, covered by the unit tests.
 *
 * S5 (RLS): the Usuarios tab shows the session branch's users, because the
 * existing `usuario_select` policy scopes the query — a company-wide listing is
 * DEFERRED. The CI fixture (.github/ci/e2e-fixture.sql) seeds exactly one branch
 * and the three identities in it, so the assertion is "the rendered rows are
 * exactly the branch's users the database reports", never a hardcoded list.
 *
 * No test here may skip: a missing env var FAILS the test (a skip in the local
 * lane reads as coverage it does not have; see assert-no-skips.mjs).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_DESPACHADOR_USER,
 * E2E_PASSWORD (shared by the three identities on the ephemeral local stack)
 * and DIRECT_URL/DATABASE_URL (superuser read, ASSERTIONS ONLY).
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

const FILAS_USUARIO = '[data-testid^="usuario-fila-"]';
const FILAS_SUCURSAL = '[data-testid^="sucursal-fila-"]';
const MENSAJE_SIN_PERMISO = "No tiene permisos para ver la Administración.";

/** Opens /administracion through the sidebar link (S7: nav entry enabled). */
async function irAAdministracion(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  await page.waitForURL("**/administracion**", { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "Administración", exact: true }),
  ).toBeVisible();
}

/**
 * The users the session branch owns (S5 scope: the RLS policy filters by the
 * branch GUC, so this is what the screen is allowed to show). `activo` is NOT
 * filtered: the list's default estado filter is "Todos".
 */
async function usuariosDeLaSucursal(
  empresaId: number,
  sucursalId: number,
): Promise<{ id: number; nombreUsuario: string }[]> {
  const res = await pool.query(
    `select id, "nombreUsuario" as "nombreUsuario"
       from "USUARIO"
      where "empresaId" = $1 and "sucursalId" = $2
      order by id`,
    [empresaId, sucursalId],
  );
  return res.rows as { id: number; nombreUsuario: string }[];
}

/** No tab, no rows and no columns: the denial happens on the server. */
async function expectSinDatos(page: Page): Promise<void> {
  await expect(page.locator("main").getByRole("alert")).toHaveText(MENSAJE_SIN_PERMISO);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator(FILAS_USUARIO)).toHaveCount(0);
  await expect(page.locator("main").getByRole("table")).toHaveCount(0);
}

/** Read-only first (S1): nobody gets a create/edit/assign affordance. */
async function expectSinControlesDeEscritura(page: Page): Promise<void> {
  await expect(page.getByRole("columnheader", { name: "Acciones" })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /^(Nuevo|Nueva|Crear|Editar|Eliminar|Desactivar|Activar|Asignar)/,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^(Nuevo|Nueva|Crear|Editar) / })).toHaveCount(0);
}

test.describe("/administracion (administracion T3)", () => {
  test("Administrador reads the three tabs: usuarios, sucursales and configuración", async ({
    page,
  }) => {
    const nombreUsuario = requireEnv("E2E_USER");
    const password = requireEnv("E2E_PASSWORD");

    expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([
      "Administrador",
    ]);
    const { empresaId, sucursalId } = await usuarioPrecond(pool, nombreUsuario);
    const esperados = await usuariosDeLaSucursal(empresaId, sucursalId);
    expect(esperados.length, "the fixture seeds its identities in one branch").toBeGreaterThan(0);

    await login(page, { user: nombreUsuario, password });
    await irAAdministracion(page);

    // --- Usuarios (S2a) ---------------------------------------------------
    const tabs = page.getByRole("tablist", { name: "Secciones de Administración" });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole("tab")).toHaveText([
      "Usuarios",
      "Sucursales",
      "Configuración",
    ]);
    await expect(page.getByRole("tab", { name: "Usuarios" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const filas = page.locator(FILAS_USUARIO);
    await expect(filas).toHaveCount(esperados.length);
    // Every rendered row is one of the branch's users, and none is missing:
    // that set equality IS the S5 branch scope (the RLS policy decides it).
    const visibles = await filas.evaluateAll((rows) =>
      rows.map((row) => Number(row.getAttribute("data-testid")?.replace("usuario-fila-", ""))),
    );
    expect(visibles.sort((a, b) => a - b)).toEqual(esperados.map((u) => u.id));
    for (const usuario of esperados) {
      await expect(page.getByTestId(`usuario-fila-${usuario.id}`)).toContainText(
        usuario.nombreUsuario,
      );
    }

    // The wireframe columns, and no Acciones column (read-only, S2a).
    for (const columna of ["Usuario", "Nombre", "Rol", "Empresa/Sucursal", "Estado"]) {
      await expect(page.getByRole("columnheader", { name: columna, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId(`usuario-fila-${esperados[0].id}`)).toContainText(
      /Activo|Inactivo/,
    );
    await expect(page.getByLabel("Buscar usuario")).toBeVisible();
    await expect(page.getByLabel("Filtrar por estado")).toBeVisible();
    await expect(page.getByText(/^Página \d+ de \d+$/)).toBeVisible();
    // The screen's OWN alert (inside `main`), never any alert on the page:
    // Next.js App Router appends a route announcer with `role="alert"`.
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

    // --- Sucursales (S2b) -------------------------------------------------
    await page.getByRole("tab", { name: "Sucursales" }).click();
    await expect(page).toHaveURL(/tab=sucursales/);
    await expect(page.getByRole("tab", { name: "Sucursales" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("columnheader", { name: "Sucursal", exact: true })).toBeVisible();
    await expect(page.locator(FILAS_SUCURSAL).first()).toBeVisible();
    await expect(page.locator(FILAS_SUCURSAL).first()).toContainText("Activa");

    // --- Configuración (S2c) ---------------------------------------------
    await page.getByRole("tab", { name: "Configuración" }).click();
    await expect(page).toHaveURL(/tab=configuracion/);
    await expect(page.getByRole("tab", { name: "Configuración" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const seccion of ["Retenciones", "ITBIS", "Secuencias NCF"]) {
      await expect(page.getByRole("heading", { name: seccion, exact: true })).toBeVisible();
    }
    // Retentions are tenant configuration: the seeded stack may have the rates
    // ("no configurada" is the documented readable state, never a fabricated 0%).
    await expect(
      page
        .getByTestId("retencion-isr15")
        .or(page.getByText("Retenciones no configuradas para esta empresa.")),
    ).toBeVisible();
    // `pnpm seed:ncf` provisions B01/B02/B04 for the empresa (independent ranges).
    for (const tipo of ["B01", "B02"]) {
      await expect(page.getByTestId(`ncf-fila-${tipo}`)).toBeVisible();
    }
    await expect(page.getByTestId("ncf-fila-B01")).toContainText("%");
    await expect(page.getByRole("columnheader", { name: "% usado" })).toBeVisible();

    // Read-only for the Administrador too (S1).
    await expectSinControlesDeEscritura(page);
  });

  for (const [rol, envUser] of [
    ["Operador", "E2E_OPERADOR_USER"],
    ["Despachador", "E2E_DESPACHADOR_USER"],
  ] as const) {
    test(`${rol} gets the access message and no data`, async ({ page }) => {
      const nombreUsuario = requireEnv(envUser);
      const password = requireEnv("E2E_PASSWORD");

      expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([
        rol,
      ]);

      await login(page, { user: nombreUsuario, password });
      // The nav entry is enabled for every role (S7): the denial is the server
      // gate, not a hidden link.
      await irAAdministracion(page);

      await expectSinDatos(page);
      await expectSinControlesDeEscritura(page);
    });
  }
});
