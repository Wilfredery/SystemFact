/**
 * /administracion E2E (odd/tasks/administracion.md T3, S8).
 *
 * Three tabs — Usuarios, Sucursales, Configuración. The Administrador reads all
 * three and, on Usuarios, gets the Step 7b write contract (administracion-writes
 * S11/S12): an `Acciones` column with "Cambiar roles" and "Desactivar/Activar" per
 * row (disabled on the session user's own row). Operador and Despachador are
 * outside `ROLES_VER_ADMINISTRACION` (S3), so they get the access message and NO
 * data, NO `Acciones` column and NO button (deny by default). Hiding is not
 * security: every read/write action re-checks the role group on the server and
 * RLS is the second wall (unit + integration tests).
 *
 * WRITES AND SHARED STATE: Playwright runs serially (workers:1) against ONE seeded
 * database and other specs log in as the e2e operador/despachador relying on their
 * roles. So the write test touches ONLY the dedicated throwaway user
 * `e2e-gestion-objetivo` (.github/ci/e2e-fixture.sql), never the admin, operador or
 * despachador, and puts it back (UI at the end, SQL in afterAll if a step failed).
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
 * and DIRECT_URL/DATABASE_URL (superuser read for ASSERTIONS; the ONLY write it
 * ever does is the afterAll restore of the throwaway user).
 */

import { test, expect, type Page } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { openDb, rolesDelUsuario, usuarioPrecond } from "./utils/db";
import { requireEnv } from "./utils/env";

const pool = openDb();

/** The fixture's throwaway target of the write test (e2e-fixture.sql). */
const OBJETIVO = "e2e-gestion-objetivo";

test.afterAll(async () => {
  try {
    await restaurarObjetivo();
  } finally {
    await pool.end();
  }
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

type EstadoObjetivo = { activo: boolean; version: number; roles: string[] };

/** The throwaway user's real state (superuser read: `activo` is NOT filtered). */
async function leerObjetivo(): Promise<EstadoObjetivo> {
  const res = await pool.query(
    `select u.activo, u.version,
            coalesce(array_agg(r.nombre order by r.nombre) filter (where r.nombre is not null), '{}') as roles
       from "USUARIO" u
       left join "USUARIO_ROL" ur on ur."usuarioId" = u.id
       left join "ROL" r on r.id = ur."rolId"
      where u."nombreUsuario" = $1
      group by u.id`,
    [OBJETIVO],
  );
  expect(res.rowCount, `the fixture seeds ${OBJETIVO}`).toBe(1);
  return res.rows[0] as EstadoObjetivo;
}

/**
 * Puts the throwaway user back to its fixture state (Operador, activo) so a
 * failed step leaves no drift for the rest of the serial run. Idempotent; the
 * only mutation this spec's superuser connection ever performs, on a row that
 * exists only to be changed here.
 */
async function restaurarObjetivo(): Promise<void> {
  const cliente = await pool.connect();
  try {
    await cliente.query("begin");
    await cliente.query(
      `delete from "USUARIO_ROL"
        where "usuarioId" = (select id from "USUARIO" where "nombreUsuario" = $1)`,
      [OBJETIVO],
    );
    await cliente.query(
      `insert into "USUARIO_ROL" ("usuarioId", "rolId")
       select u.id, r.id from "USUARIO" u join "ROL" r on r.nombre = 'Operador'
        where u."nombreUsuario" = $1`,
      [OBJETIVO],
    );
    await cliente.query(`update "USUARIO" set activo = true where "nombreUsuario" = $1`, [
      OBJETIVO,
    ]);
    await cliente.query("commit");
  } catch (e) {
    await cliente.query("rollback");
    throw e;
  } finally {
    cliente.release();
  }
}

/** No tab, no rows and no columns: the denial happens on the server. */
async function expectSinDatos(page: Page): Promise<void> {
  await expect(page.locator("main").getByRole("alert")).toHaveText(MENSAJE_SIN_PERMISO);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator(FILAS_USUARIO)).toHaveCount(0);
  await expect(page.locator("main").getByRole("table")).toHaveCount(0);
}

/** No user-management control: no Acciones column, no write button or link. */
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
    const { usuarioId, empresaId, sucursalId } = await usuarioPrecond(pool, nombreUsuario);
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

    // The wireframe columns plus the Administrador-only Acciones column (S11).
    for (const columna of ["Usuario", "Nombre", "Rol", "Empresa/Sucursal", "Estado", "Acciones"]) {
      await expect(page.getByRole("columnheader", { name: columna, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId(`usuario-fila-${esperados[0].id}`)).toContainText(
      /Activo|Inactivo/,
    );
    for (const usuario of esperados) {
      const filaUsuario = page.getByTestId(`usuario-fila-${usuario.id}`);
      const botones = [
        filaUsuario.getByRole("button", { name: "Cambiar roles" }),
        filaUsuario.getByRole("button", { name: /^(Desactivar|Activar)$/ }),
      ];
      for (const boton of botones) {
        await expect(boton).toBeVisible();
        // The session user's own row: both actions disabled (the server refuses it too).
        if (usuario.id === usuarioId) await expect(boton).toBeDisabled();
        else await expect(boton).toBeEnabled();
      }
    }
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

    // The write column belongs to the Usuarios tab only; the other tabs stay read-only.
    await expectSinControlesDeEscritura(page);
  });

  test("Administrador changes roles and estado of the throwaway user and restores it", async ({
    page,
  }) => {
    const nombreUsuario = requireEnv("E2E_USER");
    const password = requireEnv("E2E_PASSWORD");

    await restaurarObjetivo(); // known start even after an aborted earlier run
    const inicial = await leerObjetivo();
    expect(inicial.activo).toBe(true);
    expect(inicial.roles).toEqual(["Operador"]);

    await login(page, { user: nombreUsuario, password });
    await irAAdministracion(page);

    await page.getByLabel("Buscar usuario").fill(OBJETIVO);
    const fila = page.locator(FILAS_USUARIO).filter({ hasText: OBJETIVO });
    // The debounced search narrows the list to exactly the target row.
    await expect(page.locator(FILAS_USUARIO)).toHaveCount(1);
    await expect(fila).toHaveCount(1);
    await expect(fila).toContainText("Operador");
    await expect(fila).not.toContainText("Despachador");

    // --- Cambiar roles: Operador -> Operador + Despachador ---------------------
    await fila.getByRole("button", { name: "Cambiar roles" }).click();
    const dialogoRoles = page.getByRole("dialog", { name: "Cambiar roles" });
    await expect(dialogoRoles.getByRole("checkbox")).toHaveCount(3);
    await expect(dialogoRoles.getByRole("checkbox", { name: "Operador" })).toBeChecked();
    await expect(dialogoRoles.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await dialogoRoles.getByRole("checkbox", { name: "Despachador" }).check();
    await dialogoRoles.getByRole("button", { name: "Guardar" }).click();
    await expect(dialogoRoles).toBeHidden();

    await expect(fila).toContainText("Despachador");
    await expect(fila).toContainText("Operador");
    await expect(page.locator("main").getByRole("status")).toHaveText("Roles actualizados.");
    const trasRoles = await leerObjetivo();
    expect(trasRoles.roles).toEqual(["Despachador", "Operador"]);
    expect(trasRoles.version, "version bumped by the roles write").toBe(inicial.version + 1);
    expect(trasRoles.activo).toBe(true);

    // --- Desactivar -------------------------------------------------------------
    await fila.getByRole("button", { name: "Desactivar" }).click();
    const dialogoEstado = page.getByRole("dialog", { name: "Desactivar usuario" });
    await expect(
      dialogoEstado.getByText("No podrá iniciar sesión ni operar desde su próxima solicitud."),
    ).toBeVisible();
    await dialogoEstado.getByRole("button", { name: "Desactivar" }).click();
    await expect(dialogoEstado).toBeHidden();

    await expect(fila.getByText("Inactivo", { exact: true })).toBeVisible();
    const trasDesactivar = await leerObjetivo();
    expect(trasDesactivar.activo).toBe(false);
    expect(trasDesactivar.version, "version bumped by the estado write").toBe(
      trasRoles.version + 1,
    );
    expect(trasDesactivar.roles, "deactivation never touches the roles").toEqual(trasRoles.roles);

    // --- Activar ------------------------------------------------------------------
    await fila.getByRole("button", { name: "Activar" }).click();
    const dialogoActivar = page.getByRole("dialog", { name: "Activar usuario" });
    await dialogoActivar.getByRole("button", { name: "Activar" }).click();
    await expect(dialogoActivar).toBeHidden();

    await expect(fila.getByText("Activo", { exact: true })).toBeVisible();
    const trasActivar = await leerObjetivo();
    expect(trasActivar.activo).toBe(true);
    expect(trasActivar.version).toBe(trasDesactivar.version + 1);

    // --- Restore the roles through the UI: Operador only ---------------------------
    await fila.getByRole("button", { name: "Cambiar roles" }).click();
    await dialogoRoles.getByRole("checkbox", { name: "Despachador" }).uncheck();
    await dialogoRoles.getByRole("button", { name: "Guardar" }).click();
    await expect(dialogoRoles).toBeHidden();
    await expect(fila).not.toContainText("Despachador");

    const final = await leerObjetivo();
    expect(final.roles).toEqual(["Operador"]);
    expect(final.activo).toBe(true);
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
