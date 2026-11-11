/**
 * /caja E2E (odd/tasks/caja.md T5, S8): the daily close against the real stack.
 *
 * The close is a DERIVED report (S3: no CIERRE_CAJA row), so this spec never seeds a "close": it
 * self-seeds the ONE fact the board needs today — a cash receipt — by driving the already-validated
 * POS flow to a CONTADO sale, which auto-settles (R-V15) with exactly one `COBRO/APLICADO/EFECTIVO`
 * `PAGO` row. That row is what makes the método table's "Efectivo" line exist; a freshly provisioned
 * stack has no payments at all.
 *
 * Then, as the Administrador:
 *   - the "Cierre diario de caja" board renders with TODAY's America/Santo_Domingo date (there is no
 *     date selector, S1) and the four KPIs;
 *   - every rendered figure EQUALS the database's own aggregate for the same SD day — computed by
 *     Postgres (`AT TIME ZONE 'America/Santo_Domingo'`), never by JS arithmetic, and company-wide
 *     because the Administrador reads the whole empresa (S6 widen);
 *   - the método table shows the Efectivo row plus the Total row, and the "Corte de caja" panel
 *     shows its formula and the three terms;
 *   - "Cerrar caja" is DISABLED with the "Próximamente" hint (S3) and "Exportar PDF" misses nothing:
 *     it is a link to the PDF route that answers `application/pdf` (S4/S9).
 *
 * Operador and Despachador are outside `ROLES_VER_CAJA` (S6): the server page renders the access
 * message and NO board, NO table and NO control (deny by default, hiding is not security — the read
 * actions re-check the role group server-side, covered by the unit tests).
 *
 * No test here may skip: a missing env var FAILS the test (a skip in the local lane reads as coverage
 * it does not have; see assert-no-skips.mjs).
 *
 * ENV: E2E_USER (Administrador), E2E_OPERADOR_USER, E2E_DESPACHADOR_USER, E2E_PASSWORD (shared by
 * the three identities on the ephemeral local stack), E2E_PRODUCT (default `Arroz`) and
 * DIRECT_URL/DATABASE_URL (superuser reads, ASSERTIONS ONLY).
 */

import { test, expect, type Page } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { openDb, rolesDelUsuario, usuarioPrecond } from "./utils/db";
import { requireEnv } from "./utils/env";
import { E2E_PRODUCT, buscarYAgregar, guardarYConfirmar } from "./utils/venta-pos";

const pool = openDb();

test.afterAll(async () => {
  await pool.end();
});

/** Wireframe 06a copy (S1) — the formula prints an actual minus sign (U+2212). */
const FORMULA_CORTE =
  "Efectivo esperado = Cobros en efectivo − Devoluciones en efectivo";
const NOTA_CIERRE = "Cierre informativo: no bloquea las operaciones del día.";
const MENSAJE_SIN_PERMISO = "No tiene permisos para ver la Caja.";

/** Today in America/Santo_Domingo as `YYYY-MM-DD` (the same zone the board resolves, never UTC). */
function hoySD(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** `YYYY-MM-DD` → the board's `dd/MM/yyyy` subtitle. */
function comoSubfijo(fechaSD: string): string {
  const [y, m, d] = fechaSD.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * A `Decimal(12,2)` string → the display form the screen renders (`RD$ 1,234.50`), with the sign kept
 * in front (`-RD$ 499.50`). Mirrors the shared `formatearMonto` + the caja sign helper; it is a
 * display contract, not a calculation.
 */
function rd(valor: string): string {
  const negativo = valor.trim().startsWith("-");
  const [entero, decimales = "00"] = valor.trim().replace("-", "").split(".");
  const agrupado = new Intl.NumberFormat("en-US").format(Number(entero));
  return `${negativo ? "-" : ""}RD$ ${agrupado}.${decimales.padEnd(2, "0")}`;
}

/** The day's five figures, aggregated by Postgres over the SAME SD day (`AT TIME ZONE`). */
async function cifrasDelDia(
  empresaId: number,
  fechaSD: string,
): Promise<{
  cobros: string;
  devoluciones: string;
  ventas: string;
  esperado: string;
  diferencia: string;
}> {
  const res = await pool.query(
    `WITH hoy AS (SELECT $2::date AS dia),
     cobros AS (
       SELECT COALESCE(SUM(p.monto), 0) AS t FROM "PAGO" p, hoy
        WHERE p."empresaId" = $1 AND p.tipo = 'COBRO' AND p.estado = 'APLICADO'
          AND p."metodoPago" = 'EFECTIVO'
          AND (p.fecha AT TIME ZONE 'America/Santo_Domingo')::date = hoy.dia
     ),
     devoluciones AS (
       SELECT COALESCE(SUM(p.monto), 0) AS t FROM "PAGO" p, hoy
        WHERE p."empresaId" = $1 AND p.tipo = 'REEMBOLSO' AND p.estado = 'APLICADO'
          AND p."metodoPago" = 'EFECTIVO'
          AND (p.fecha AT TIME ZONE 'America/Santo_Domingo')::date = hoy.dia
     ),
     ventas AS (
       SELECT COALESCE(SUM(v.total), 0) AS t FROM "VENTA" v, hoy
        WHERE v."empresaId" = $1 AND v.estado = 'CONFIRMADA'
          AND (v.fecha AT TIME ZONE 'America/Santo_Domingo')::date = hoy.dia
     )
     SELECT cobros.t::numeric(12, 2)::text                      AS "cobros",
            devoluciones.t::numeric(12, 2)::text                AS "devoluciones",
            ventas.t::numeric(12, 2)::text                      AS "ventas",
            (cobros.t - devoluciones.t)::numeric(12, 2)::text   AS "esperado",
            (cobros.t - ventas.t)::numeric(12, 2)::text         AS "diferencia"
       FROM cobros, devoluciones, ventas`,
    [empresaId, fechaSD],
  );
  return res.rows[0] as {
    cobros: string;
    devoluciones: string;
    ventas: string;
    esperado: string;
    diferencia: string;
  };
}

/** Opens /caja through the sidebar link (S7: the nav entry is enabled for every role). */
async function irACaja(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Caja", exact: true }).click();
  await page.waitForURL("**/caja**", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Caja", exact: true })).toBeVisible();
}

/** Exactly one cash receipt was written by the cash sale: `COBRO` + `APLICADO` + `EFECTIVO`. */
async function pagosDeLaVenta(
  ventaId: number,
): Promise<{ tipo: string; estado: string; metodoPago: string; monto: string }[]> {
  const res = await pool.query(
    `SELECT p.tipo::text AS "tipo", p.estado::text AS "estado",
            p."metodoPago"::text AS "metodoPago", p.monto::numeric(12, 2)::text AS "monto"
       FROM "PAGO" p
       JOIN "FACTURA" f ON f.id = p."facturaId"
      WHERE f."ventaId" = $1`,
    [ventaId],
  );
  return res.rows as { tipo: string; estado: string; metodoPago: string; monto: string }[];
}

/** A denial renders the access message and NO board, table or control (deny by default). */
async function expectSinDatos(page: Page): Promise<void> {
  await expect(page.locator("main").getByRole("alert")).toHaveText(MENSAJE_SIN_PERMISO);
  await expect(page.getByTestId("caja-cierre")).toHaveCount(0);
  await expect(page.getByTestId("caja-resumen")).toHaveCount(0);
  await expect(page.locator("main").getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cerrar caja" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Exportar PDF" })).toHaveCount(0);
}

test.describe("/caja (caja T5)", () => {
  test("Administrador sees today's close, the método table, the corte and the PDF export", async ({
    page,
  }) => {
    const nombreUsuario = requireEnv("E2E_USER");
    const password = requireEnv("E2E_PASSWORD");
    expect(await rolesDelUsuario(pool, nombreUsuario), `roles of ${nombreUsuario}`).toEqual([
      "Administrador",
    ]);
    const { empresaId } = await usuarioPrecond(pool, nombreUsuario);

    await login(page, { user: nombreUsuario, password });

    // Self-seed the day's cash receipt through the POS (a CONTADO sale settles with one COBRO).
    await page.goto("/venta");
    await page.getByRole("heading", { name: "Point of sale" }).waitFor();
    await buscarYAgregar(page, E2E_PRODUCT);
    const { ventaId } = await guardarYConfirmar(page);
    const pagos = await pagosDeLaVenta(ventaId);
    expect(pagos, `cash receipt of venta ${ventaId}`).toHaveLength(1);
    expect(pagos[0]?.tipo).toBe("COBRO");
    expect(pagos[0]?.estado).toBe("APLICADO");
    expect(pagos[0]?.metodoPago).toBe("EFECTIVO");

    await irACaja(page);

    // --- 06a: title + today's SD date (no date selector, S1) ------------------
    const fecha = hoySD();
    await expect(
      page.getByRole("heading", { name: "Cierre diario de caja", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("caja-fecha")).toHaveText(comoSubfijo(fecha));
    // No date selector anywhere on the board (S1: the close is always TODAY).
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    // --- The four KPIs, each byte-equal to the DB aggregate -------------------
    const cifras = await cifrasDelDia(empresaId, fecha);
    await expect(page.getByText("Total facturado", { exact: true })).toBeVisible();
    await expect(page.getByText("Total cobrado", { exact: true })).toBeVisible();
    await expect(page.getByText("Efectivo esperado", { exact: true })).toBeVisible();
    await expect(page.getByText("Diferencia", { exact: true })).toBeVisible();
    await expect(page.getByTestId("caja-kpi-total-facturado")).toHaveText(rd(cifras.ventas));
    await expect(page.getByTestId("caja-kpi-total-cobrado")).toHaveText(rd(cifras.cobros));
    await expect(page.getByTestId("caja-kpi-efectivo-esperado")).toHaveText(rd(cifras.esperado));
    await expect(page.getByTestId("caja-kpi-diferencia")).toHaveText(rd(cifras.diferencia));

    // --- Método table: the Efectivo row (from the seeded cobro) + Total row ----
    const tabla = page.getByTestId("caja-tabla-metodos");
    await expect(tabla).toBeVisible();
    for (const columna of ["Método", "Ventas", "Cobros", "Total"]) {
      await expect(tabla.getByRole("columnheader", { name: columna, exact: true })).toBeVisible();
    }
    const filaEfectivo = page.getByTestId("caja-metodo-EFECTIVO");
    await expect(filaEfectivo).toBeVisible();
    await expect(filaEfectivo).toContainText("Efectivo");
    await expect(filaEfectivo).toContainText(rd(cifras.cobros));
    const filaTotal = page.getByTestId("caja-total-fila");
    await expect(filaTotal).toBeVisible();
    await expect(filaTotal).toContainText("Total");
    await expect(filaTotal).toContainText(rd(cifras.ventas));
    await expect(filaTotal).toContainText(rd(cifras.cobros));

    // --- Corte de caja: the formula and its three terms ----------------------
    const corte = page.getByTestId("caja-corte");
    await expect(corte).toBeVisible();
    await expect(corte).toContainText("Corte de caja");
    await expect(corte).toContainText(FORMULA_CORTE);
    await expect(page.getByTestId("caja-corte-cobros")).toHaveText(rd(cifras.cobros));
    await expect(page.getByTestId("caja-corte-devoluciones")).toHaveText(rd(cifras.devoluciones));
    await expect(page.getByTestId("caja-corte-esperado")).toHaveText(rd(cifras.esperado));
    await expect(page.getByText(NOTA_CIERRE, { exact: true })).toBeVisible();

    // --- Cerrar caja is disabled on purpose (S3) ----------------------------
    const cerrar = page.getByRole("button", { name: "Cerrar caja" });
    await expect(cerrar).toBeDisabled();
    await expect(page.getByTestId("caja-cerrar-hint")).toHaveText("Próximamente");

    // --- 06b stays a SEPARATE board (S2), never mixed into the close --------
    await expect(
      page.getByRole("heading", {
        name: "Resumen del día — Ventas, costo y margen bruto",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver cierre de caja →" })).toBeVisible();

    // --- Exportar PDF: the link really answers a PDF (S4/S9) ----------------
    const exportar = page.getByRole("link", { name: "Exportar PDF" });
    await expect(exportar).toHaveAttribute("href", "/api/caja/cierre-pdf");
    const respuestaPdf = page.waitForResponse((r) => r.url().includes("/api/caja/cierre-pdf"));
    await exportar.click({ noWaitAfter: true });
    const respuesta = await respuestaPdf;
    expect(respuesta.status()).toBe(200);
    expect(respuesta.headers()["content-type"]).toBe("application/pdf");
    expect(respuesta.headers()["content-disposition"]).toContain(
      `attachment; filename="cierre-caja-${fecha}.pdf"`,
    );
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
      // The nav entry is enabled for every role (S7): the denial is the server gate, not a
      // hidden link.
      await irACaja(page);

      await expectSinDatos(page);
    });
  }
});
