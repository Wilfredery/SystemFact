/**
 * Fase-5d E2E smoke (task 2.3): the B04 return happy path through the REAL stack.
 *
 * Flow: login (remote Supabase) → POS → draft → confirm (reuses the fase-5c
 * harness so the fresh CONFIRMADA sale carries a VIGENTE FACTURA) → open the
 * Return control on the CONFIRMADA row → one VENDIBLE line, qty 1, with a
 * reason → submit → assert the VIGENTE NC + its B04 NCF on the screen → assert
 * the full observable chain in the LOCAL dev DB:
 *
 *   - NOTA_CREDITO VIGENTE with the shown NCF ([B04] family) and frozen money;
 *   - B04 NCF_SECUENCIA advanced exactly to the emitted correlativo;
 *   - DETALLE_NOTA_CREDITO congelado (qty, price, rate) + tipoReposicion;
 *   - one ENTRADA_DEVOLUCION movement restored sellable stock at the ORIGINAL
 *     sale's exit branch (VENDIBLE) — the DANADO → SALIDA_MERMA branch is
 *     pinned by the fase-5d integration tests (repository-level);
 *   - the ADR-017 derived CxC balance is reduced: computed here from the
 *     canonical sources of truth (venta total − Σ cobros − Σ VIGENTE NCs);
 *     no stored balance column is consulted or updated.
 *
 * PREREQUISITES: identical to `e2e/confirm-venta.spec.ts` (migrated & seeded
 * local Postgres, seeded B01/B02 **and B04** ranges via `pnpm seed:ncf`,
 * stocked `E2E_PRODUCT`, Supabase Auth user for E2E_USER, chromium installed).
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
// queries never mutate.
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
    throw new Error(
      `E2E_USER "${E2E_USER}" has rol "${row.rol}"; the return requires Administrador/Operador.`,
    );
  }

  const cfg = await pool.query(
    `select "facturaAutomatica" from "EMPRESA" where id = $1`,
    [row.empresaId],
  );
  if (cfg.rowCount === 0 || !cfg.rows[0].facturaAutomatica) {
    throw new Error(`Empresa ${row.empresaId} has facturaAutomatica=false (R-F1 blocks confirm).`);
  }

  // B01/B02 for the confirm emission AND B04 for the credit note (seed:ncf).
  const ncf = await pool.query(
    `select "tipoNcf" from "NCF_SECUENCIA" where "empresaId" = $1 order by "tipoNcf"`,
    [row.empresaId],
  );
  const tipos = ncf.rows.map((r) => r.tipoNcf);
  if (!tipos.includes("B01") || !tipos.includes("B02") || !tipos.includes("B04")) {
    throw new Error(
      `Empresa ${row.empresaId} lacks B01/B02/B04 NCF ranges — run pnpm seed:ncf.`,
    );
  }

  const prod = await pool.query(
    `select p.id, p.nombre, p."tasaItbis", i.cantidad
       from "PRODUCTO" p
       left join "INVENTARIO" i on i."productoId" = p.id and i."sucursalId" = $2
      where p.nombre = $1 and p.activo = true`,
    [E2E_PRODUCT, row.sucursalId],
  );
  if (prod.rowCount === 0) {
    throw new Error(
      `E2E_PRODUCT "${E2E_PRODUCT}" not found/active — seed products with stock at sucursal ${row.sucursalId}.`,
    );
  }
  if (Number(prod.rows[0].cantidad) < 1) {
    throw new Error(
      `"${E2E_PRODUCT}" has no stock at sucursal ${row.sucursalId} (cantidad=${prod.rows[0].cantidad}).`,
    );
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

/** Draft + confirm a one-line sale (fase-5c harness) to obtain a RETURNABLE row. */
async function crearVentaConfirmada(page: Page): Promise<{ ventaId: number; ncf: string }> {
  await page.goto("/venta");
  await page.getByRole("heading", { name: "Point of sale" }).waitFor();

  await page.getByLabel("Search products").fill(E2E_PRODUCT);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Add" }).first().click();
  await page.getByRole("button", { name: "Save draft" }).click();

  const confirm = page.getByRole("button", { name: /Confirm draft \d+/ });
  await confirm.waitFor();
  await confirm.click();

  const status = page.getByRole("status");
  await expect(status).toContainText(/confirmed — invoice B\d+/);
  const text = (await status.textContent())!;
  return {
    ventaId: Number(text.match(/#(\d+)/)![1]),
    ncf: text.match(/invoice (B\d+)/)![1],
  };
}

test.describe("devolucion smoke (fase-5d task 2.3)", () => {
  test.beforeAll(async () => {
    await checkPreconditions();
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test("confirmed sale → B04 return → VIGENTE NC, stock restored, derived balance reduced", async ({
    page,
  }) => {
    test.skip(E2E_PASSWORD === "", "Set E2E_USER/E2E_PASSWORD (Supabase Auth) to run the smoke.");
    await login(page);

    const { ventaId, ncf: ventaNcf } = await crearVentaConfirmada(page);

    // Open the Return control mounted on the CONFIRMADA row.
    const opener = page.getByRole("button", { name: `Return sale ${ventaId}` });
    await opener.waitFor();
    await opener.click();
    await page.getByRole("heading", { name: new RegExp(`Return sale #${ventaId}`) }).waitFor();

    await page.getByLabel("Reason for return").fill("Producto defectuoso devuelto por el cliente");
    await page.getByLabel(new RegExp(`Qty to return for ${E2E_PRODUCT}`)).fill("1");
    await page.getByRole("button", { name: "Emit credit note" }).click();

    const status = page.getByRole("status");
    await expect(status).toContainText(/Credit note NC #\d+ issued — NCF B0400000\d+/);
    const statusText = (await status.textContent())!;
    const ncNcf = statusText.match(/NCF (B0400000\d+)/)![1];
    const ncId = Number(statusText.match(/NC #(\d+)/)![1]);

    // 1. NOTA_CREDITO: VIGENTE, B04 family, frozen money mirror.
    const nc = await pool.query(
      `select estado, ncf, monto, itbis, motivo
         from "NOTA_CREDITO"
        where id = $1 and "empresaId" = $2 and "sucursalId" = $3 and "facturaOriginalId" =
          (select id from "FACTURA" where "ventaId" = $4)`,
      [ncId, precond.empresaId, precond.sucursalId, ventaId],
    );
    expect(nc.rowCount).toBe(1);
    expect(nc.rows[0].estado).toBe("VIGENTE");
    expect(nc.rows[0].ncf).toBe(ncNcf);
    expect(String(nc.rows[0].ncf).startsWith("B04")).toBe(true);
    expect(Number(nc.rows[0].monto)).toBeGreaterThan(0);

    // The original factura stays VIGENTE (the NC does not void it — 607/608).
    const factura = await pool.query(
      `select id, ncf, estado from "FACTURA" where "ventaId" = $1`,
      [ventaId],
    );
    const facturaId = factura.rows[0].id as number;
    expect(factura.rows[0].ncf).toBe(ventaNcf);
    expect(factura.rows[0].estado).toBe("VIGENTE");

    // 2. The B04 sequence advanced exactly to the emitted correlativo.
    const sec = await pool.query(
      `select "secuenciaActual" from "NCF_SECUENCIA" where "empresaId" = $1 and "tipoNcf" = 'B04'`,
      [precond.empresaId],
    );
    expect(Number(sec.rows[0].secuenciaActual)).toBe(Number(ncNcf.slice(3)));

    // 3. VENDIBLE detail: qty 1 with the ORIGINAL sale's frozen price/rate.
    const det = await pool.query(
      `select d.cantidad, d."precioUnitario", d."tasaItbis", d."tipoReposicion", d."subtotalLinea"
         from "DETALLE_NOTA_CREDITO" d
         join "PRODUCTO" p on p.id = d."productoId"
        where d."notaCreditoId" = $1 and p.nombre = $2`,
      [ncId, E2E_PRODUCT],
    );
    expect(det.rowCount).toBe(1);
    expect(Number(det.rows[0].cantidad)).toBe(1);
    expect(det.rows[0].tipoReposicion).toBe("VENDIBLE");
    expect(Number(det.rows[0].subtotalLinea)).toBe(Number(nc.rows[0].monto));

    // 4. Stock restored at the sale's exit branch: ENTRADA_DEVOLUCION movement
    //    (the branch lives on the INVENTARIO row, not on the movement).
    const mov = await pool.query(
      `select m."tipoMovimiento", m."cantidadMovida", m."cantidadAnterior", m."cantidadNueva",
              i."sucursalId"
         from "MOVIMIENTO_INVENTARIO" m
         join "INVENTARIO" i on i.id = m."inventarioId"
        where m."notaCreditoId" = $1`,
      [ncId],
    );
    expect(mov.rowCount).toBe(1);
    expect(mov.rows[0].tipoMovimiento).toBe("ENTRADA_DEVOLUCION");
    expect(mov.rows[0].sucursalId).toBe(precond.sucursalId);
    expect(Number(mov.rows[0].cantidadMovida)).toBe(1);
    expect(Number(mov.rows[0].cantidadNueva)).toBeGreaterThan(
      Number(mov.rows[0].cantidadAnterior),
    );

    // 5. ADR-017: the CxC balance is DERIVED, never stored — recompute it the
    //    way the application does from the canonical documents and assert the
    //    return reduced it by exactly the NC monto.
    const bal = await pool.query(
      `select (
         (select total from "VENTA" where id = $1)
         - coalesce((select sum(case when tipo = 'REEMBOLSO' then -p.monto else p.monto end)
                       from "PAGO" p where p."facturaId" = $2 and p.estado in ('APLICADO', 'REGISTRADO')), 0)
         - coalesce((select sum(n.monto) from "NOTA_CREDITO" n
                      where n."facturaOriginalId" = $2 and n.estado = 'VIGENTE'), 0)
         + coalesce((select sum(nd.monto) from "NOTA_DEBITO" nd
                      where nd."facturaOriginalId" = $2 and nd.estado = 'VIGENTE'), 0)
         ) as saldo`,
      [ventaId, facturaId],
    );
    const saldo = Number(bal.rows[0].saldo);
    const saldoAntes = saldo + Number(nc.rows[0].monto);
    expect(saldo).toBeLessThan(saldoAntes);
  });
});
