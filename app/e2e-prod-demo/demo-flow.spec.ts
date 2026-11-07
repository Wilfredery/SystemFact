/**
 * Production DEMO lane — the local E2E flows, driven through the UI only
 * (odd/tasks/prod-demo-lane.md S1/S4/S6).
 *
 * UNLIKE the production smoke (`e2e-prod/`, which never writes), this lane WRITES
 * demo data: it is separate by design (own config, own workflow, own environment,
 * `workflow_dispatch` only) and may only run against the demo company. The
 * `page` fixture (./fixtures) logs in with the demo identity and aborts before
 * the first write unless the UI shows the empresa named by `DEMO_EMPRESA_NAME`.
 *
 * It never reads the database (a production lane must never hold DATABASE_URL):
 * the product, the credit client, the invoice, the receipt and the stock figures
 * are all derived from the rendered pages, and every effect is proven through
 * the UI (NCF series shown on the confirmation, balance on the estado de cuenta,
 * the B04 credit note, the branch stock read from the app's own stock warning).
 *
 * WHAT ONE RUN CONSUMES (company numbering is bounded and never given back):
 *   - 1 B02 (cash sale to Consumidor Final)
 *   - 1 B01 (credit sale to the first CREDITO client)
 *   - 1 B04 (the return of that credit sale)
 *   - 2 units of stock sold, 1 restocked by the return
 *   - 1 partial cobro (receipt number, non-fiscal)
 *   - 4 stock-probe drafts, each cancelled at once (CANCELADA, no NCF)
 *
 * Messages name NCF series, page paths and CSP directives only: never
 * credentials, cookies or tokens.
 */

import fs from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import { formatearMonto } from "../src/shared/ui/format/money";
import { expect, test, cspViolationsOf, expectNoCspOnPage } from "./fixtures";
import {
  SLOW,
  addProduct,
  confirmDraft,
  firstCreditClient,
  firstProductWithStock,
  openPos,
  readAvailableStock,
  saveDraft,
} from "./pos";
import type { Page } from "@playwright/test";

/** Facts handed from one serial test to the next (the sales flow is one story). */
const run: {
  product?: string;
  stockAfterCash?: Decimal;
  stockAfterCredit?: Decimal;
  credit?: { id: number; name: string };
  creditSale?: { ventaId: number; ncf: string };
  receipt?: number;
} = {};

/** Invoice ids the client's estado de cuenta lists right now. */
async function statementInvoiceIds(page: Page, clienteId: number): Promise<Set<number>> {
  await page.goto(`/cobros/estado-cuenta/${clienteId}`);
  await expect(page.getByText("Cargando estado de cuenta…")).toHaveCount(0, { timeout: SLOW });
  await expect(
    page.getByRole("heading", { name: new RegExp(`Estado de cuenta · Cliente #${clienteId}`) }),
  ).toBeVisible({ timeout: SLOW });
  const testIds = await page
    .locator('[data-testid^="estado-cuenta-fila-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid") ?? ""));
  return new Set(testIds.map((id) => Number(id.replace("estado-cuenta-fila-", ""))));
}

test.describe("demo sales flow (S1: cash B02, credit B01 + partial cobro, return B04)", () => {
  test.describe.configure({ mode: "serial" });

  test("the demo identity is bound to the expected empresa (guard, no writes)", async ({ page }) => {
    // The guard already ran inside the `page` fixture; this test is its report line.
    await expect(page.getByTestId("app-shell-header")).toContainText("· Sucursal");
    expectNoCspOnPage(page, "the demo login -> dashboard journey");
  });

  test("cash sale to Consumidor Final emits a B02 NCF and debits one unit", async ({ page }) => {
    test.setTimeout(240_000);
    const product = await firstProductWithStock(page);
    run.product = product.name;

    await openPos(page);
    await addProduct(page, product.name);
    await expect(
      page.getByText("Cash (Consumidor Final)", { exact: true }),
      "the default client must be Consumidor Final (cash)",
    ).toBeVisible();
    const draftId = await saveDraft(page);
    await confirmDraft(page, draftId, "B02");

    run.stockAfterCash = await readAvailableStock(page, product.name);
    expect(
      run.stockAfterCash.toFixed(3),
      "the cash sale must debit exactly one unit of branch stock",
    ).toBe(product.stock.minus(1).toFixed(3));
    expectNoCspOnPage(page, "the cash sale journey");
  });

  test("credit sale to a CREDITO client emits a B01 NCF and a partial cobro shows on the estado de cuenta", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const product = run.product;
    expect(product, "the cash sale test must have chosen a product first").toBeDefined();

    await openPos(page);
    const credit = await firstCreditClient(page);
    run.credit = credit;
    const before = await statementInvoiceIds(page, credit.id);

    await openPos(page);
    await page
      .getByRole("combobox", { name: "Client selection" })
      .selectOption(String(credit.id));
    await expect(page.getByText(/^Crédito · \d+ días$/)).toBeVisible();
    await addProduct(page, product!);
    const draftId = await saveDraft(page);
    run.creditSale = await confirmDraft(page, draftId, "B01");

    run.stockAfterCredit = await readAvailableStock(page, product!);
    expect(
      run.stockAfterCredit.toFixed(3),
      "the credit sale must debit exactly one more unit of branch stock",
    ).toBe(run.stockAfterCash!.minus(1).toFixed(3));

    // The new invoice is the one the statement did not list before the sale.
    const after = await statementInvoiceIds(page, credit.id);
    const created = [...after].filter((id) => !before.has(id));
    expect(created, "the credit sale must add exactly one invoice to the estado de cuenta").toHaveLength(1);
    const facturaId = created[0];

    // Partial cobro: half of the prefilled pending balance, rounded down to cents.
    const row = page.getByTestId(`estado-cuenta-fila-${facturaId}`);
    await expect(row).toContainText("Pendiente");
    await row.getByRole("button", { name: `Cobrar factura ${facturaId}` }).click();
    const amount = page.getByLabel(`Monto de cobro para factura ${facturaId}`);
    const pending = new Decimal(await amount.inputValue());
    const partial = pending.div(2).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    expect(
      partial.gt(0) && partial.lt(pending),
      "the invoice must be large enough to take a PARTIAL payment",
    ).toBe(true);
    await amount.fill(partial.toFixed(2));
    await page.getByRole("button", { name: `Confirmar cobro factura ${facturaId}` }).click();

    const remaining = pending.minus(partial);
    await expect(
      page.getByText(`Cobro registrado. Nuevo saldo: ${formatearMonto(remaining.toFixed(2))}.`),
    ).toBeVisible({ timeout: SLOW });
    const receiptLink = page.locator('[data-testid^="recibo-reprint-link-"]');
    await expect(receiptLink, "the cobro must issue a receipt").toBeVisible();
    run.receipt = Number(
      (await receiptLink.getAttribute("data-testid"))!.replace("recibo-reprint-link-", ""),
    );

    // The derived statement reflects the payment: applied cobro, pending balance, Parcial.
    await page.goto(`/cobros/estado-cuenta/${credit.id}`);
    const settled = page.getByTestId(`estado-cuenta-fila-${facturaId}`);
    await expect(settled).toContainText(`Cobros aplicados ${formatearMonto(partial.toFixed(2))}`, {
      timeout: SLOW,
    });
    await expect(settled).toContainText(`Pendiente ${formatearMonto(remaining.toFixed(2))}`);
    await expect(settled).toContainText("Parcial");
    expectNoCspOnPage(page, "the credit sale and cobro journey");
  });

  test("return of the credit sale emits a B04 credit note and restocks the unit", async ({ page }) => {
    test.setTimeout(180_000);
    const sale = run.creditSale;
    expect(sale, "the credit sale test must have confirmed a sale first").toBeDefined();

    await openPos(page);
    await page.getByRole("button", { name: `Return sale ${sale!.ventaId}` }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(`Return sale #${sale!.ventaId}`) }),
    ).toBeVisible({ timeout: SLOW });
    await page.getByLabel("Reason for return").fill("Demo lane: return of the demo credit sale");
    await page.getByLabel(new RegExp(`Qty to return for ${run.product}`)).fill("1");
    await page.getByRole("button", { name: "Emit credit note" }).click();

    const banner = page.getByText(/Credit note NC #\d+ issued — NCF B\d+/);
    await expect(banner, "the credit note banner must appear (within the return window)").toBeVisible({
      timeout: SLOW,
    });
    const noteNcf = (await banner.textContent())!.match(/NCF (B\d+)/)![1];
    expect(noteNcf.startsWith("B04"), "the credit note NCF must be a B04 series number").toBe(true);
    expect(noteNcf, "a B04 NCF has 11 characters").toMatch(/^B\d{10}$/);

    const stock = await readAvailableStock(page, run.product!);
    expect(
      stock.toFixed(3),
      "the VENDIBLE return must restock exactly one unit of branch stock",
    ).toBe(run.stockAfterCredit!.plus(1).toFixed(3));

    // The estado de cuenta still renders the invoice after the credit note.
    await page.goto(`/cobros/estado-cuenta/${run.credit!.id}`);
    await expect(
      page.getByRole("heading", { name: new RegExp(`Estado de cuenta · Cliente #${run.credit!.id}`) }),
    ).toBeVisible({ timeout: SLOW });
    expectNoCspOnPage(page, "the return journey");
  });
});

const APP_ROUTES_DIR = path.join(process.cwd(), "src", "app", "(app)");

/** Every `page.tsx` under `(app)` as a route pattern, e.g. `/cobros/recibo/[correlativo]`. */
function authenticatedRoutePatterns(dir: string = APP_ROUTES_DIR): string[] {
  const routes: string[] = [];
  const walk = (current: string, segments: string[]): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Route groups `(x)` add no URL segment.
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(path.join(current, entry.name), isGroup ? segments : [...segments, entry.name]);
      } else if (entry.name === "page.tsx") {
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(dir, []);
  return routes.sort();
}

/**
 * Pages the demo role (Operador, odd/tasks/prod-demo-lane.md "Role matrix (T1)")
 * must NOT see: the server redirects it. Reaching the target instead of the page
 * is the expected deny-by-default, not a failure. Every other page renders for it
 * (the report pages answer with an in-page access message, not a redirect).
 */
const DENIED_REDIRECTS: Readonly<Record<string, string>> = {
  "/selector-empresa-sucursal": "/dashboard",
};

test.describe("CSP across the authenticated pages (S1)", () => {
  test("no page under (app) reports a CSP violation", async ({ page }) => {
    test.setTimeout(240_000);
    expect(
      run.receipt,
      "the sales flow must have issued a cobro receipt before the page walk (run the whole lane)",
    ).toBeDefined();

    // Dynamic segments resolve to ids the UI itself exposes, so the pages render
    // their real content instead of the not-found state.
    await openPos(page);
    const credit = await firstCreditClient(page);
    const dynamicSegments: Record<string, number> = {
      clienteId: credit.id,
      correlativo: run.receipt!,
    };

    const visited: string[] = [];
    const findings: string[] = [];
    for (const pattern of authenticatedRoutePatterns()) {
      const url = pattern.replace(/\[(\w+)\]/g, (_, name: string) => {
        const id = dynamicSegments[name];
        if (id === undefined) {
          throw new Error(`No UI-derived id for the dynamic segment [${name}] of ${pattern}.`);
        }
        return String(id);
      });

      const before = cspViolationsOf(page).length;
      await page.goto(url, { waitUntil: "load" });
      // Hydration and client effects (late inline/eval injections, RSC and
      // Supabase fetches) land after `load`; `networkidle` is not used because
      // a page that keeps a request open would hang the whole walk.
      await page.waitForTimeout(1_000);

      const landed = new URL(page.url()).pathname;
      const deniedTarget = DENIED_REDIRECTS[pattern];
      if (landed !== url) {
        expect(
          landed,
          `${pattern} must render, or redirect to ${deniedTarget ?? "nothing (no redirect is expected)"}`,
        ).toBe(deniedTarget);
      }
      visited.push(landed === url ? url : `${url} -> ${landed} (denied by role)`);
      for (const violation of cspViolationsOf(page).slice(before)) {
        findings.push(
          `${url}: ${violation.directive} (blocked: ${violation.blocked}, source: ${violation.source})`,
        );
      }
    }

    test.info().annotations.push({ type: "pages visited", description: visited.join(", ") });
    console.log(`CSP walk visited ${visited.length} pages: ${visited.join(", ")}`);
    expect(findings, `${findings.length} CSP violation(s) across the authenticated pages`).toEqual(
      [],
    );
  });
});
