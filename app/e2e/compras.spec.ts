/**
 * /compras E2E (odd/tasks/compras.md T5, S9).
 *
 * The Administrador buys from the new screen: creates a draft, edits its lines,
 * confirms it (the internal `CMP-%06d` correlativo and the frozen retentions
 * appear only on confirm), receives the merchandise (inventory grows and a
 * movement row is written), then cancels a second draft — asserting the row is
 * CANCELADA and STILL EXISTS, because a purchase is a fiscal document and is
 * never deleted. Operador and Despachador are view-only (S3): no `+ Nueva
 * compra`, no `Acciones` column, no row buttons and no CxP section. Hiding is
 * not security: the write actions re-check the role group on the server,
 * covered by the unit tests.
 *
 * The CI fixture (`.github/ci/e2e-fixture.sql`) seeds the empresa, the branch,
 * the three identities, one product with stock and one credit client — but NO
 * supplier, and a purchase needs one. Rather than editing files outside this
 * task's surface, the spec CREATES its supplier through the Proveedores screen
 * and leaves it inactive in the soft cleanup (`activo=false`, never a delete:
 * master entities are never removed).
 *
 * No test here may skip: a missing env var FAILS the test (a skip in the local
 * lane reads as coverage it does not have; see assert-no-skips.mjs).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_DESPACHADOR_USER,
 * E2E_PASSWORD (shared by the three identities on the ephemeral local stack),
 * E2E_PRODUCT (the fixture product, default `Arroz`) and
 * DIRECT_URL/DATABASE_URL (superuser read of the acting user's role and of the
 * created purchase, ASSERTIONS ONLY plus the soft cleanup described above).
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

/** Product the CI fixture seeds (`provision-local-e2e.sh` E2E_PRODUCT). */
const PRODUCTO = process.env.E2E_PRODUCT ?? "Arroz";
/** The scenario: 2 units at 100.00 with 18% ITBIS → 200.00 + 36.00 = 236.00. */
const CANTIDAD = "2";
const COSTO = "100";
const MOTIVO_CANCELACION = "Compra duplicada en la prueba E2E";

/**
 * The supplier RNC rule is the DOMAIN's (separators stripped, 9–11 digits). A
 * timestamp gives a unique value per run without reusing seeded data.
 */
function rncProveedorUnico(): string {
  return String(Date.now()).slice(-9);
}

/** Opens /compras from the sidebar once signed in. */
async function irACompras(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Compras", exact: true }).click();
  await page.waitForURL("**/compras", { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "Compras", exact: true }),
  ).toBeVisible();
}

/**
 * Precondition the CI fixture does not provide: an active supplier. Created
 * through the Proveedores screen (the Administrador manages suppliers there), so
 * the purchase dialog can find it in its supplier list.
 */
async function crearProveedorE2E(
  page: Page,
  nombre: string,
  rnc: string,
): Promise<void> {
  await page.getByRole("link", { name: "Proveedores", exact: true }).click();
  await page.waitForURL("**/proveedores", { timeout: 20_000 });
  await page.getByRole("button", { name: "+ Nuevo proveedor" }).click();
  const crear = page.getByRole("dialog");
  await expect(crear.getByRole("heading", { name: "Nuevo proveedor" })).toBeVisible();
  await crear.getByLabel("Nombre o razón social *").fill(nombre);
  await crear.getByLabel("RNC").fill(rnc);
  await crear.getByLabel("Contacto *").fill("Compras E2E");
  await crear.getByLabel("Teléfono *").fill("809-555-0199");
  await crear.getByLabel("Tipo de proveedor *").selectOption("FORMAL");
  await crear.getByLabel("Tipo de persona *").selectOption("JURIDICA");
  await crear.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("status")).toHaveText("Proveedor creado.");
}

/** Rows of the purchases list whose cells mention the supplier. */
function filasDelProveedor(page: Page, nombre: string) {
  return page.locator('[data-testid^="compra-fila-"]').filter({ hasText: nombre });
}

/**
 * Fills the purchase dialog for one line of the fixture product and returns it.
 * The pricing is asserted from the DOMAIN's own preview (RD$ strings, never a
 * float in the UI), so a drifting fiscal rule fails here too.
 */
async function llenarCompra(
  page: Page,
  proveedor: { readonly nombre: string; readonly rnc: string },
  cantidad: string,
) {
  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: "Nueva compra" })).toBeVisible();
  // S1: mercancía is billed with the formal B01 purchase receipt.
  await expect(form.getByTestId("compra-comprobante")).toHaveText("B01 — Formal");
  await form
    .getByLabel("Proveedor")
    .selectOption({ label: `${proveedor.nombre} — ${proveedor.rnc}` });

  await form.getByLabel("Producto línea 1").fill(PRODUCTO);
  const resultados = form.getByRole("list", { name: "Resultados línea 1" });
  await resultados.getByRole("button").first().click();
  await expect(form.getByTestId("compra-linea-1-producto")).toContainText(PRODUCTO);
  await expect(form.getByTestId("compra-linea-1-itbis")).toHaveText("18.00%");

  await form.getByLabel("Cantidad línea 1").fill(cantidad);
  await form.getByLabel("Costo unitario línea 1").fill(COSTO);
  return form;
}

async function comprasDelProveedor(empresaId: number, proveedorId: number) {
  const res = await pool.query(
    `select id, estado, "correlativoInterno" as "correlativoInterno",
            total::text as total,
            "retencionIsr"::text as "retencionIsr",
            "retencionItbis"::text as "retencionItbis"
       from "COMPRA"
      where "empresaId" = $1 and "proveedorId" = $2
      order by id`,
    [empresaId, proveedorId],
  );
  return res.rows as {
    id: number;
    estado: string;
    correlativoInterno: string;
    total: string;
    retencionIsr: string;
    retencionItbis: string;
  }[];
}

async function cantidadDeLaLinea(compraId: number): Promise<string> {
  const res = await pool.query(
    `select cantidad::text as cantidad from "DETALLE_COMPRA" where "compraId" = $1 order by id`,
    [compraId],
  );
  expect(res.rowCount, `DETALLE_COMPRA lines of compra ${compraId}`).toBe(1);
  return res.rows[0].cantidad as string;
}

async function idDelProveedor(empresaId: number, rnc: string): Promise<number> {
  const res = await pool.query(
    `select id from "PROVEEDOR" where "empresaId" = $1 and "rnc" = $2`,
    [empresaId, rnc],
  );
  expect(res.rowCount, `PROVEEDOR row for ${rnc}`).toBe(1);
  return res.rows[0].id as number;
}

async function idDelProducto(empresaId: number, codigo: string): Promise<number> {
  const res = await pool.query(
    `select id from "PRODUCTO" where "empresaId" = $1 and "codigo" = $2`,
    [empresaId, codigo],
  );
  expect(res.rowCount, `PRODUCTO row for ${codigo}`).toBe(1);
  return res.rows[0].id as number;
}

async function cantidadEnInventario(
  sucursalId: number,
  productoId: number,
): Promise<string> {
  const res = await pool.query(
    `select cantidad::text as cantidad from "INVENTARIO"
      where "sucursalId" = $1 and "productoId" = $2`,
    [sucursalId, productoId],
  );
  expect(res.rowCount, `INVENTARIO row for sucursal ${sucursalId}`).toBe(1);
  return res.rows[0].cantidad as string;
}

// If the test dies mid-flow, leave the created data in SOFT states (never a
// delete): the supplier becomes inactive and any draft/pending purchase is
// CANCELADA. A RECIBIDA purchase has no reverse path and is left as evidence.
let creado: { empresaId: number; rnc: string } | null = null;

test.describe("/compras (compras T5)", () => {
  test.afterEach(async () => {
    const pendiente = creado;
    creado = null;
    if (pendiente === null) return;
    await pool.query(
      `update "COMPRA" c set estado = 'CANCELADA'
         from "PROVEEDOR" p
        where p.id = c."proveedorId"
          and p."empresaId" = $1 and p."rnc" = $2
          and c.estado in ('BORRADOR', 'PENDIENTE')`,
      [pendiente.empresaId, pendiente.rnc],
    );
    await pool.query(
      `update "PROVEEDOR" set "activo" = false
        where "empresaId" = $1 and "rnc" = $2`,
      [pendiente.empresaId, pendiente.rnc],
    );
  });

  test("Administrador drafts, edits, confirms, receives and cancels a purchase; the database reflects it", async ({ page }) => {
    const nombreUsuario = requireEnv("E2E_USER");
    const password = requireEnv("E2E_PASSWORD");

    expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([
      "Administrador",
    ]);
    const { empresaId, sucursalId } = await usuarioPrecond(pool, nombreUsuario);
    const rnc = rncProveedorUnico();
    const nombreProveedor = `Proveedor Compras E2E ${Date.now()}`;
    creado = { empresaId, rnc };

    await login(page, { user: nombreUsuario, password });
    // Precondition: the fixture seeds no supplier, and a purchase needs one.
    await crearProveedorE2E(page, nombreProveedor, rnc);

    const proveedorId = await idDelProveedor(empresaId, rnc);
    const productoId = await idDelProducto(empresaId, PRODUCTO);
    const stockAntes = await cantidadEnInventario(sucursalId, productoId);

    await irACompras(page);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

    // --- Create the draft ------------------------------------------------
    await page.getByRole("button", { name: "+ Nueva compra" }).click();
    const form = await llenarCompra(
      page,
      { nombre: nombreProveedor, rnc },
      CANTIDAD,
    );
    // S6: the breakdown is the domain's own preview over Decimal strings.
    await expect(form.getByTestId("compra-linea-1-subtotal")).toHaveText("RD$ 200.00");
    await expect(form.getByTestId("compra-subtotal")).toHaveText("RD$ 200.00");
    await expect(form.getByTestId("compra-itbis")).toHaveText("RD$ 36.00");
    await expect(form.getByTestId("compra-total")).toHaveText("RD$ 236.00");
    await form.getByRole("button", { name: "Guardar Borrador" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(filasDelProveedor(page, nombreProveedor).first()).toBeVisible();

    const [borrador] = await comprasDelProveedor(empresaId, proveedorId);
    expect(borrador.estado, "COMPRA.estado after the draft save").toBe("BORRADOR");
    expect(borrador.correlativoInterno, "the correlativo is deferred to confirm").toBe("");
    expect(borrador.total, "COMPRA.total after the draft save").toBe("236.00");
    expect(borrador.retencionIsr, "no retention is frozen before confirm").toBe("0.00");

    // --- Edit the draft (lines are replaced, header follows) -------------
    await filasDelProveedor(page, nombreProveedor)
      .first()
      .getByRole("button", { name: /^Editar/ })
      .click();
    const editar = page.getByRole("dialog");
    await expect(editar.getByRole("heading", { name: "Editar compra" })).toBeVisible();
    await expect(editar.getByTestId("compra-estado")).toContainText("Borrador");
    await editar.getByLabel("Cantidad línea 1").fill("3");
    await editar.getByRole("button", { name: "Guardar Borrador" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    expect(
      await cantidadDeLaLinea(borrador.id),
      "DETALLE_COMPRA.cantidad after the edit",
    ).toBe("3.000");
    const [editado] = await comprasDelProveedor(empresaId, proveedorId);
    expect(editado.estado, "the edit never confirms the draft").toBe("BORRADOR");
    expect(editado.total, "COMPRA.total follows the edited lines").toBe("354.00");

    // --- Confirm (BORRADOR → PENDIENTE) ----------------------------------
    await filasDelProveedor(page, nombreProveedor)
      .first()
      .getByRole("button", { name: /^Confirmar/ })
      .click();
    await expect(page.getByRole("status")).toContainText("confirmada");

    const [confirmada] = await comprasDelProveedor(empresaId, proveedorId);
    expect(confirmada.estado, "COMPRA.estado after confirm").toBe("PENDIENTE");
    expect(confirmada.correlativoInterno, "the atomic CMP correlativo").toMatch(
      /^CMP-\d{6}$/,
    );
    expect(confirmada.total, "COMPRA.total after confirm").toBe("354.00");
    // Mercancía from a FORMAL supplier: the retention matrix charges nothing.
    expect(confirmada.retencionIsr, "COMPRA.retencionIsr after confirm").toBe("0.00");
    expect(confirmada.retencionItbis, "COMPRA.retencionItbis after confirm").toBe("0.00");

    // --- Receive (PENDIENTE → RECIBIDA): stock enters, never edited by hand
    await filasDelProveedor(page, nombreProveedor)
      .first()
      .getByRole("button", { name: /^Recibir/ })
      .click();
    await expect(page.getByRole("status")).toContainText("recibida");

    const [recibida] = await comprasDelProveedor(empresaId, proveedorId);
    expect(recibida.estado, "COMPRA.estado after receive").toBe("RECIBIDA");
    const movimiento = await pool.query(
      `select "tipoMovimiento" as tipo, "cantidadNueva"::text as "cantidadNueva"
         from "MOVIMIENTO_INVENTARIO"
        where "compraId" = $1`,
      [recibida.id],
    );
    expect(movimiento.rowCount, "one inventory movement per receipt").toBe(1);
    expect(movimiento.rows[0].tipo, "the receipt is an ENTRADA_COMPRA").toBe(
      "ENTRADA_COMPRA",
    );
    const stockDespues = await cantidadEnInventario(sucursalId, productoId);
    expect(stockDespues, "the movement carries the new stock").toBe(
      movimiento.rows[0].cantidadNueva,
    );
    const delta = await pool.query(
      `select ("cantidad" - $3::numeric)::text as delta from "INVENTARIO"
        where "sucursalId" = $1 and "productoId" = $2`,
      [sucursalId, productoId, stockAntes],
    );
    expect(delta.rows[0].delta, "the received quantity entered the branch stock").toBe(
      "3.000",
    );
    // No cancel control exists on a RECIBIDA row: the domain has no path back.
    await expect(
      filasDelProveedor(page, nombreProveedor)
        .first()
        .getByRole("button", { name: /^Cancelar/ }),
    ).toHaveCount(0);

    // --- Cancel a second draft: CANCELADA, never deleted ------------------
    await page.getByRole("button", { name: "+ Nueva compra" }).click();
    const segundo = await llenarCompra(
      page,
      { nombre: nombreProveedor, rnc },
      "1",
    );
    await segundo.getByRole("button", { name: "Guardar Borrador" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const filaBorrador = filasDelProveedor(page, nombreProveedor)
      .filter({ hasText: "Borrador" })
      .first();
    await expect(filaBorrador).toBeVisible();
    await filaBorrador.getByRole("button", { name: /^Cancelar/ }).click();
    const cancelar = page.getByRole("dialog");
    await expect(cancelar.getByRole("heading", { name: "Cancelar compra" })).toBeVisible();
    // S5: the motivo is mandatory, so the confirm stays disabled until typed.
    await expect(
      cancelar.getByRole("button", { name: "Cancelar compra", exact: true }),
    ).toBeDisabled();
    await cancelar.getByLabel("Motivo de cancelación").fill(MOTIVO_CANCELACION);
    await cancelar.getByRole("button", { name: "Cancelar compra", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("cancelada");

    const delProveedor = await comprasDelProveedor(empresaId, proveedorId);
    expect(delProveedor, "a cancelled purchase is NEVER deleted").toHaveLength(2);
    const cancelada = delProveedor.find((c) => c.id !== recibida.id);
    expect(cancelada?.estado, "COMPRA.estado after cancel").toBe("CANCELADA");
    expect(cancelada?.total, "the cancelled draft keeps its own total").toBe("118.00");
  });

  for (const [rol, envUser] of [
    ["Operador", "E2E_OPERADOR_USER"],
    ["Despachador", "E2E_DESPACHADOR_USER"],
  ] as const) {
    test(`${rol} reads /compras with no manage controls`, async ({ page }) => {
      const nombreUsuario = requireEnv(envUser);
      const password = requireEnv("E2E_PASSWORD");

      expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([rol]);

      await login(page, { user: nombreUsuario, password });
      await irACompras(page);

      // Read side works: the list renders (rows, or the explicit empty state)
      // and no permission error is shown.
      await expect(page.getByLabel("Buscar proveedor")).toBeVisible();
      await expect(
        page
          .locator('[data-testid^="compra-fila-"]')
          .first()
          .or(page.getByText("No hay compras que coincidan con los filtros.")),
      ).toBeVisible();
      // The screen's OWN alert (inside `main`), never any alert on the page:
      // Next.js App Router appends a route announcer to `document.body`
      // (`<next-route-announcer>` with `role="alert"`, open shadow root) that
      // Playwright's role query pierces. Same rule as the Proveedores screen.
      await expect(page.locator("main").getByRole("alert")).toHaveCount(0);

      // Manage side is absent markup, not a disabled control (S3).
      await expect(page.getByRole("button", { name: "+ Nueva compra" })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: "Acciones" })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^(Editar|Confirmar|Recibir|Cancelar) / }),
      ).toHaveCount(0);
      // S8: the CxP (cuentas por pagar) section is Administrador-only.
      await expect(page.getByRole("heading", { name: "Cuentas por pagar" })).toHaveCount(0);
    });
  }
});
