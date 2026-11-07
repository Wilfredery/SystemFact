/**
 * UI-only point-of-sale helpers of the production DEMO lane.
 *
 * Everything here drives and reads the rendered app: no database, no ids baked
 * in. The product, the client and the stock figures are all derived from what
 * the page shows at run time.
 */

import { expect, type Page } from "@playwright/test";
import Decimal from "decimal.js";

/** Server actions on the hosted stack are slower than on the local one. */
export const SLOW = 30_000;

/**
 * Saving a draft that asks for more than the branch holds makes the app show its
 * own "requested X, available Y" warning, which is the only place a role without
 * inventory access can read the branch stock. The probe draft is cancelled.
 * The probe total must still fit `Decimal(12,2)` (the app rejects a bigger one),
 * so the quantity is sized from the product price: about 900 million of money.
 */
const PROBE_MONEY = new Decimal(900_000_000);

/** Units one run sells: one cash sale and one credit sale. */
export const UNITS_PER_RUN = 2;

export async function openPos(page: Page): Promise<void> {
  await page.goto("/venta");
  await expect(page.getByRole("heading", { name: "Point of sale" })).toBeVisible({
    timeout: SLOW,
  });
}

/** Names of the products the search lists (empty search = first page of the catalog). */
export async function listProductNames(page: Page): Promise<string[]> {
  const card = page.getByLabel("Product search", { exact: true });
  await page.getByLabel("Search products").fill("");
  await page.getByRole("button", { name: "Search" }).click();
  const names = card.locator("li p.font-medium");
  await expect(names.first(), "the product search must list at least one product").toBeVisible({
    timeout: SLOW,
  });
  return (await names.allTextContents()).map((name) => name.trim());
}

/** Search the product by name and add exactly that result to the cart. */
export async function addProduct(page: Page, name: string): Promise<void> {
  const card = page.getByLabel("Product search", { exact: true });
  await page.getByLabel("Search products").fill(name);
  await page.getByRole("button", { name: "Search" }).click();
  const result = card.locator("li").filter({ has: page.getByText(name, { exact: true }) });
  await result.first().getByRole("button", { name: "Add" }).click();
}

/** Save the cart as a draft and return its id from the confirmation banner. */
export async function saveDraft(page: Page): Promise<number> {
  await page.getByRole("button", { name: "Save draft" }).click();
  const banner = page.getByText(/Draft #\d+ saved/);
  await expect(banner).toBeVisible({ timeout: SLOW });
  return Number((await banner.textContent())!.match(/Draft #(\d+) saved/)![1]);
}

/**
 * Branch stock of a product, read through the UI: save a probe draft that asks for
 * far more than exists, read "available" from the insufficient-stock warning, then
 * cancel the draft (CANCELADA: no NCF, no stock effect).
 */
export async function readAvailableStock(page: Page, product: string): Promise<Decimal> {
  await openPos(page);
  await addProduct(page, product);
  const price = new Decimal(await page.getByLabel(`Unit price for ${product}`).inputValue());
  const probeQuantity = Decimal.min(99_999_999, PROBE_MONEY.div(price).floor());
  await page.getByLabel(`Quantity for ${product}`).fill(probeQuantity.toFixed(0));
  const draftId = await saveDraft(page);

  const warning = page
    .getByRole("alert")
    .filter({ hasText: "Insufficient stock" })
    .getByRole("listitem")
    .filter({ hasText: `${product}: requested` });
  await expect(warning, "the probe draft must report the available stock").toBeVisible({
    timeout: SLOW,
  });
  const available = (await warning.textContent())!.match(/available (\d+(?:\.\d+)?)/);
  if (available === null) {
    throw new Error(`The stock warning for "${product}" did not carry an available quantity.`);
  }

  await page.getByRole("button", { name: `Cancel draft ${draftId}` }).click();
  await expect(page.getByText(`Sale #${draftId} cancelled.`)).toBeVisible({ timeout: SLOW });
  return new Decimal(available[1]);
}

/** First listed product that can cover one run (UNITS_PER_RUN units), with its stock. */
export async function firstProductWithStock(
  page: Page,
): Promise<{ name: string; stock: Decimal }> {
  await openPos(page);
  const names = await listProductNames(page);
  for (const name of names) {
    const stock = await readAvailableStock(page, name);
    if (stock.gte(UNITS_PER_RUN)) return { name, stock };
  }
  throw new Error(
    `No listed product has at least ${UNITS_PER_RUN} units of stock in the demo branch ` +
      "(restock through an AJUSTE movement in the app before running the lane).",
  );
}

/** Id and name of the first client the selector shows as CREDITO (derived from the UI). */
export async function firstCreditClient(page: Page): Promise<{ id: number; name: string }> {
  const select = page.getByRole("combobox", { name: "Client selection" });
  const options = select.locator("option");
  await expect
    .poll(() => options.count(), { timeout: SLOW, message: "the client list must load" })
    .toBeGreaterThan(1);
  const found = await options.evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        value: (node as HTMLOptionElement).value,
        name: (node.textContent ?? "").trim(),
      }))
      .filter((option) => option.value !== ""),
  );
  for (const option of found) {
    await select.selectOption(option.value);
    const credit = page.getByText("CREDITO", { exact: true });
    const isCredit = await expect(credit)
      .toBeVisible({ timeout: 1_500 })
      .then(
        () => true,
        () => false,
      );
    if (isCredit) return { id: Number(option.value), name: option.name };
  }
  throw new Error("The demo company shows no CREDITO client in the point of sale.");
}

export type ConfirmedSale = { ventaId: number; ncf: string };

/**
 * Confirm the saved draft and read the sale id and NCF from the success banner.
 * `ncfPrefix` is the fiscal series the sale must emit (B01 credit-fiscal, B02 consumer).
 */
export async function confirmDraft(
  page: Page,
  draftId: number,
  ncfPrefix: "B01" | "B02",
): Promise<ConfirmedSale> {
  await page.getByRole("button", { name: `Confirm draft ${draftId}` }).click();
  const banner = page.getByText(/Sale #\d+ confirmed — invoice B\d+/);
  await expect(banner, "the sale confirmation banner must appear").toBeVisible({
    timeout: SLOW,
  });
  const text = (await banner.textContent())!;
  const ventaId = Number(text.match(/Sale #(\d+)/)![1]);
  const ncf = text.match(/invoice (B\d+)/)![1];
  expect(ncf.startsWith(ncfPrefix), `the invoice NCF must be a ${ncfPrefix} series number`).toBe(
    true,
  );
  expect(ncf, `a ${ncfPrefix} NCF has 11 characters`).toMatch(/^B\d{10}$/);

  const row = page.getByTestId(`venta-fila-${ventaId}`);
  await expect(row).toContainText("CONFIRMADA");
  await expect(row).toContainText(ncf);
  return { ventaId, ncf };
}
