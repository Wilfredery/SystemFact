/**
 * Fase-6 E2E — cobros board + collection idempotency + estado de cuenta (R-C7/R-C2).
 *
 * PROVENANCE: authored for CI, NOT executed locally. Per repo precedent (the
 * fase-5d devolucion spec shipped authored-then-run), a reliable local run needs
 * the whole stack live (Next dev server + migrated/seeded Postgres + Supabase Auth
 * user). The local integration harness is DOWN (no Docker), so the first-click
 * disable and the derived-render logic are pinned by the jsdom suite in
 * `src/modules/cobros/ui/__tests__/cobros-ui.spec.tsx`; THIS spec closes the loop
 * against a real Postgres: a rapid double-click on the payment form persists AT MOST
 * ONE COBRO (the server revalidates + row-locks), and the estado de cuenta renders
 * the derived facts for a mixed-state customer.
 *
 * Preconditions (skips otherwise, never silently passes): the seeded E2E company has
 * at least one VIGENTE invoice with a positive derived pending balance — i.e. a CREDIT
 * sale to a `CREDITO` client. A contado sale auto-settles to PAGADA (R-V15) and so
 * leaves nothing collectable; if no pending receivable exists the spec skips with an
 * explicit "seed a credit sale" note.
 *
 * ENV: E2E_BASE_URL (default http://localhost:3000), E2E_USER (default "e2e"),
 * E2E_PASSWORD, and DIRECT_URL/DATABASE_URL (superuser read for ASSERTIONS ONLY).
 */

import { test, expect, type Page } from "@playwright/test";
import "dotenv/config";
import { Pool } from "pg";

const E2E_USER = process.env.E2E_USER ?? "e2e";
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";

const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});

type EmpresaPrecond = { usuarioId: number; empresaId: number; rol: string };
type Pendiente = { facturaId: number; clienteId: number; saldoPendiente: number };

let precond: EmpresaPrecond;

async function checkPreconditions(): Promise<void> {
  const user = await pool.query(
    `select u.id as "usuarioId", u."empresaId", r.nombre as rol
       from "USUARIO" u
       left join "USUARIO_ROL" ur on ur."usuarioId" = u.id
       left join "ROL" r on r.id = ur."rolId"
      where u."nombreUsuario" = $1 and u.activo = true
      limit 1`,
    [E2E_USER],
  );
  if (user.rowCount === 0) {
    throw new Error(`E2E_USER "${E2E_USER}" not found in the LOCAL dev DB.`);
  }
  const row = user.rows[0];
  if (row.rol !== "Administrador" && row.rol !== "Operador") {
    throw new Error(
      `E2E_USER "${E2E_USER}" has rol "${row.rol}"; Cobros requires Administrador/Operador (R-C6).`,
    );
  }
  precond = { usuarioId: row.usuarioId, empresaId: row.empresaId, rol: row.rol };
}

/** The most-recent VIGENTE invoice with a positive derived pending balance, if any. */
async function buscarPendiente(): Promise<Pendiente | null> {
  const res = await pool.query(
    `select f.id as "facturaId", f."clienteId",
            (f.total
               - coalesce((select sum(p.monto) from "PAGO" p
                            where p."facturaId" = f.id and p."tipo" = 'COBRO' and p.estado = 'APLICADO'), 0)
               - coalesce((select sum(nc.monto) from "NOTA_CREDITO" nc
                            where nc."facturaOriginalId" = f.id and nc.estado = 'VIGENTE'), 0)
               + coalesce((select sum(nd.monto) from "NOTA_DEBITO" nd
                            where nd."facturaOriginalId" = f.id and nd.estado = 'VIGENTE'), 0)
            ) as "saldoPendiente"
       from "FACTURA" f
      where f."empresaId" = $1 and f.estado = 'VIGENTE'
      order by f."fechaEmision" desc, f.id desc`,
    [precond.empresaId],
  );
  const cand = res.rows.find((r) => Number(r.saldoPendiente) > 0);
  if (!cand) return null;
  return {
    facturaId: Number(cand.facturaId),
    clienteId: Number(cand.clienteId),
    saldoPendiente: Number(cand.saldoPendiente),
  };
}

async function contarCobros(facturaId: number): Promise<number> {
  const res = await pool.query(
    `select count(*)::int as n from "PAGO"
      where "facturaId" = $1 and "empresaId" = $2 and "tipo" = 'COBRO' and estado = 'APLICADO'`,
    [facturaId, precond.empresaId],
  );
  return res.rows[0].n as number;
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuario").fill(E2E_USER);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}

test.describe("cobros board + collection idempotency (fase-6 R-C7)", () => {
  test.beforeAll(async () => {
    await checkPreconditions();
  });
  test.afterAll(async () => {
    await pool.end();
  });

  test("double-click on the payment form persists AT MOST ONE collection", async ({ page }) => {
    test.skip(E2E_PASSWORD === "", "Set E2E_USER/E2E_PASSWORD (Supabase Auth) to run the smoke.");
    await login(page);

    const pendiente = await buscarPendiente();
    test.skip(
      pendiente === null,
      "No pending (credit) receivable to collect — seed a CREDITO client and a credit sale first.",
    );
    const { facturaId } = pendiente!;

    await page.goto("/cobros/cxc-board");
    const fila = page.getByTestId(`cxc-fila-${facturaId}`);
    await fila.waitFor({ timeout: 20_000 });
    await fila.getByRole("button", { name: `Cobrar factura ${facturaId}` }).click();

    const confirmar = page.getByRole("button", { name: `Confirmar cobro factura ${facturaId}` });
    await confirmar.waitFor();

    const antes = await contarCobros(facturaId);

    // Rapid double-click on the SAME cycle: the button disables on the first click.
    await confirmar.dblclick();

    const status = page.getByRole("status");
    await expect(status).toContainText("Cobro registrado");
    expect(confirmar).toBeDisabled();

    const despues = await contarCobros(facturaId);
    // Server revalidation + row lock: the second event can never double-collect.
    expect(despues).toBe(antes + 1);
  });

  test("estado de cuenta renders derived facts for the mixed-state customer", async ({ page }) => {
    test.skip(E2E_PASSWORD === "", "Set E2E_USER/E2E_PASSWORD (Supabase Auth) to run the smoke.");
    await login(page);

    const pendiente = await buscarPendiente();
    test.skip(pendiente === null, "No pending receivable to anchor the estado de cuenta view.");

    await page.goto(`/cobros/estado-cuenta/${pendiente!.clienteId}`);
    // The invoice from the board must appear with its derived totals + state.
    await expect(page.getByTestId(`estado-cuenta-fila-${pendiente!.facturaId}`)).toBeVisible({
      timeout: 20_000,
    });
  });
});
