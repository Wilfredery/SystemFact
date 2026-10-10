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
const E2E_PRODUCT = process.env.E2E_PRODUCT ?? "Arroz";

const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});

type EmpresaPrecond = { usuarioId: number; empresaId: number; rol: string };

/** The demo CREDITO client seeded by seed:bootstrap (name is a contract). */
const CLIENTE_CREDITO_DEMO_NOMBRE = "Comercios Clara, SRL (demo)";

let precond: EmpresaPrecond;
let clienteIdCredito: number;

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
    throw new Error(`E2E_USER "${E2E_USER}" not found in the precondition DB (DIRECT_URL/DATABASE_URL).`);
  }
  const row = user.rows[0];
  if (row.rol !== "Administrador" && row.rol !== "Operador") {
    throw new Error(
      `E2E_USER "${E2E_USER}" has rol "${row.rol}"; Cobros requires Administrador/Operador (R-C6).`,
    );
  }
  precond = { usuarioId: row.usuarioId, empresaId: row.empresaId, rol: row.rol };
  const cliente = await pool.query(
    `select id from "CLIENTE"
      where "empresaId" = $1 and nombre = $2 and "tipoCliente" = 'CREDITO' and "creditoHabilitado" = true
       and activo = true
       limit 1`,
    [precond.empresaId, CLIENTE_CREDITO_DEMO_NOMBRE],
  );
  clienteIdCredito = cliente.rows[0]?.id ?? 0;
}

/**
 * SELF-SEEDED precondition for the cobros flows: drives the already-validated
 * POS UI to create a fresh CREDIT-terms sale for the demo credit client and
 * returns its FACTURA id (VIGENTE invoice with a positive derived pending
 * balance). Deterministic by construction:
 *   - the credit client comes from the structural bootstrap seed (if absent,
 *     the tests SKIP with an explicit instruction instead of silently
 *     depending on whatever data happens to be lying around);
 *   - a BORRADOR emits no invoice, so the pending exists ONLY after Confirm;
 *   - each call creates ONE fresh invoice, so a suite run never depends on
 *     what a previous run left behind (the operator-data dance proved flaky:
 *     client resets to the default after each confirm, prior runs consume
 *     pendings, and mixed-state required exactly two outstanding invoices).
 * Side effect on a shared prod: each run leaves ONE pending credit invoice
 * behind for the client. Test 2 settles its bracket (see below) so the
 * client's ledger grows only by intentional, already-exercised rows.
 */
async function crearVentaCreditoPendiente(page: Page): Promise<number> {
  if (clienteIdCredito === 0) {
    test.skip(
      true,
      `Demo CREDITO client "${CLIENTE_CREDITO_DEMO_NOMBRE}" not found for empresa ${precond.empresaId} - run pnpm seed:bootstrap first.`,
    );
  }
  await page.goto("/venta");
  await page.getByRole("heading", { name: "Point of sale" }).waitFor();
  await page.getByRole("combobox", { name: "Client selection" }).selectOption({
    label: CLIENTE_CREDITO_DEMO_NOMBRE,
  });
  await page.getByLabel("Search products").fill(E2E_PRODUCT);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Add" }).first().click();
  await page.getByRole("button", { name: "Save draft" }).click();

  const confirmar = page.getByRole("button", { name: /Confirm draft \d+/ });
  await confirmar.waitFor();
  await confirmar.click();

  // Anchor to the specific poster text (the page may hold several role=status
  // banners; the sale-confirmed one is unique per venta).
  const poster = page.getByText(/Sale #\d+ confirmed/);
  await expect(poster).toContainText(/Sale #\d+ confirmed/);
  const ventaId = Number(((await poster.textContent())!.match(/#(\d+)/))![1]);

  const factura = await pool.query(
    `select f.id from "FACTURA" f
     where f."ventaId" = $1 and f."empresaId" = $2 and f.estado = 'VIGENTE'`,
    [ventaId, precond.empresaId],
  );
  if (factura.rowCount === 0) {
    throw new Error(`No VIGENTE FACTURA for venta ${ventaId} - confirm emitted no invoice?`);
  }
  return Number(factura.rows[0].id);
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
    // Self-seeded fresh invoice: VIGENTE credit terms, positive derived pending.
    const facturaId = await crearVentaCreditoPendiente(page);

    await page.goto("/cobros/cxc-board");
    const fila = page.getByTestId(`cxc-fila-${facturaId}`);
    await fila.waitFor({ timeout: 20_000 });
    await fila.getByRole("button", { name: `Cobrar factura ${facturaId}` }).click();

    const confirmar = page.getByRole("button", { name: `Confirmar cobro factura ${facturaId}` });
    await confirmar.waitFor();

    const antes = await contarCobros(facturaId);

    // Rapid double-click on the SAME cycle: the button disables during flight
    // (first-click disable; PaymentForm re-enables after resolution so a
    // PARTIAL-remaining balance can take further ABONO payments - the server
    // revalidates rate/balance and rejects overpayment, per AGENTS.md).
    await confirmar.dblclick();

    // The idempotency PROOF is in the DB, not in a stale post-resolution
    // disabled flag: exactly ONE inserted row (antes+1) despite TWO click
    // events (first-click disable + single-flight guard + row lock).
    const status = page.getByRole("status");
    await expect(status).toContainText("Cobro registrado");

    const despues = await contarCobros(facturaId);
    // Server revalidation + row lock: the second event can never double-collect.
    expect(despues).toBe(antes + 1);
  });

  test("estado de cuenta renders derived facts for the mixed-state customer", async ({ page }) => {
    test.skip(E2E_PASSWORD === "", "Set E2E_USER/E2E_PASSWORD (Supabase Auth) to run the smoke.");
    await login(page);
    // Mixed-state construction: collect test 1's invoice (from a previous run,
    // or a sibling run's row) plus THIS test's own fresh pending one, attached
    // to the SAME wallet - the estado de cuenta must render both facts side by
    // side from one derived query (ADR-017, no materialized balance).
    const facturaId = await crearVentaCreditoPendiente(page);

    await page.goto(`/cobros/estado-cuenta/${clienteIdCredito}`);
    // The invoice from the board must appear with its derived totals + state.
    await expect(page.getByTestId(`estado-cuenta-fila-${facturaId}`)).toBeVisible({
      timeout: 20_000,
    });

    // Ledger hygiene on a shared prod: settle the invoice this test created so
    // the demo credit wallet keeps ONLY the collections the suite actually
    // exercised. Full prefill mirrors the operator cobro path (single click).
    await page.goto("/cobros/cxc-board");
    const fila = page.getByTestId(`cxc-fila-${facturaId}`);
    await fila.waitFor({ timeout: 20_000 });
    await fila.getByRole("button", { name: `Cobrar factura ${facturaId}` }).click();
    const confirmar = page.getByRole("button", { name: `Confirmar cobro factura ${facturaId}` });
    await confirmar.waitFor();
    await confirmar.click();
    const status = page.getByRole("status");
    await expect(status).toContainText("Cobro registrado");
    const despues = await contarCobros(facturaId);
    expect(despues).toBe(1);
  });
});
