/**
 * Shared POS flow helpers (design D8, task 5.4).
 *
 * The env-reading constants and the draft→confirm drive live here so the
 * confirmed-sale harness exists ONCE; each spec keeps only its own assertions.
 * The demo CREDITO client name is a seed contract (`seed:bootstrap`).
 *
 * Post-confirm contract (board 02, S5): a confirm does NOT always stay on the
 * POS. `PosScreen.confirmarBorrador` routes to the emitted receipt
 * (`/venta/factura/<facturaId>`) when the sale is CONTADO **and** carries no NCF
 * warning; a CREDITO confirm (the user must read the due-date verdict) or an
 * NCF_UMBRAL_90 confirm (the warning banner must stay visible) stays on /venta
 * with the `Sale #N confirmed — invoice <NCF>` status banner. `guardarYConfirmar`
 * branches on that observed outcome instead of assuming the banner, so a spec
 * never depends on the screen the app has already navigated away from.
 */

import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";

export const E2E_PRODUCT = process.env.E2E_PRODUCT ?? "Arroz";
export const E2E_USER = process.env.E2E_USER ?? "E2E-automation";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";

/** The demo CREDITO client seeded by seed:bootstrap (name is a contract). */
export const CLIENTE_CREDITO_DEMO_NOMBRE = "Comercios Clara, SRL (demo)";

/** A confirmed sale plus the invoice it emitted on confirm. */
export interface VentaConfirmada {
  readonly ventaId: number;
  /** NCF read from the surface the app actually left open (banner or receipt). */
  readonly ncf: string;
  /** Id of the emitted FACTURA — the receipt route's own path segment. */
  readonly facturaId: number;
}

/** The receipt route segment: `/venta/factura/<facturaId>` (PosScreen S5). */
const RUTA_RECIBO = /\/venta\/factura\/(\d+)$/;

/** Poll interval while the post-confirm outcome has not settled yet. */
const PASO_DESENLACE_MS = 150;
/** How long the outcome may take to become observable (cold route compile). */
const ESPERA_DESENLACE_MS = 30_000;
/**
 * The CONTADO confirm sets its banner and calls `router.push` in the same
 * continuation, so the banner renders for a moment BEFORE the receipt route
 * replaces the screen. A banner that is still there after this window is the
 * terminal state (CREDITO / NCF warning), not that transient one.
 */
const ASENTAR_BANNER_MS = 1_000;

/**
 * The confirm status banner, anchored to its copy so it can never be confused
 * with the app shell's own live region.
 */
function bannerConfirmacion(page: Page) {
  return page.getByRole("status").filter({ hasText: /Sale #\d+ confirmed/ }).first();
}

/** The invoice id the receipt route path carries. */
function facturaIdDeLaUrl(page: Page): number {
  const coincidencia = RUTA_RECIBO.exec(new URL(page.url()).pathname);
  if (coincidencia === null) {
    throw new Error(`La URL actual no es la ruta del recibo: ${page.url()}`);
  }
  return Number(coincidencia[1]);
}

type Desenlace = "recibo" | "banner";

/** Which post-confirm surface is showing right now (`null` = neither yet). */
async function desenlaceActual(page: Page): Promise<Desenlace | null> {
  if (RUTA_RECIBO.test(new URL(page.url()).pathname)) return "recibo";
  if ((await bannerConfirmacion(page).count()) === 0) return null;
  return "banner";
}

/**
 * Wait for the post-confirm outcome the way the user experiences it: either the
 * receipt route rendered, or the POS stayed with its confirm banner. Never
 * assumes which one — that decision belongs to `PosScreen` (S5).
 */
async function esperarDesenlace(page: Page): Promise<Desenlace> {
  const limite = Date.now() + ESPERA_DESENLACE_MS;
  for (;;) {
    const visto = await desenlaceActual(page);
    if (visto === "recibo") return "recibo";
    if (visto === "banner") {
      // The banner may be the transient one of a navigation already in flight:
      // wait out the window (or until the receipt route lands) and re-read.
      await page
        .waitForURL(RUTA_RECIBO, { timeout: ASENTAR_BANNER_MS })
        .catch(() => undefined);
      const asentado = await desenlaceActual(page);
      return asentado ?? "banner";
    }
    if (Date.now() > limite) {
      throw new Error(
        `La confirmación no llegó a un estado observable en ${ESPERA_DESENLACE_MS / 1000}s: ` +
          `ni la ruta del recibo (/venta/factura/<id>) ni el banner "Sale #N confirmed" ` +
          `aparecieron (url=${page.url()}).`,
      );
    }
    await page.waitForTimeout(PASO_DESENLACE_MS);
  }
}

/** Search a product and add the first match to the cart. */
export async function buscarYAgregar(
  page: Page,
  producto: string,
): Promise<void> {
  await page.getByLabel("Search products").fill(producto);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Add" }).first().click();
}

/**
 * Save the current cart as a draft, confirm it, and read the emitted sale id +
 * NCF from whichever surface the app left open (board-02 S5):
 *   - CONTADO without an NCF warning → the receipt route
 *     `/venta/factura/<facturaId>`; the NCF is read from the printed document
 *     (`factura-ncf`) and the VENTA id comes from the invoice's FK;
 *   - CREDITO / NCF warning → the POS status banner
 *     `Sale #N confirmed — invoice <NCF>`.
 * The `pool` is used for those read-only id resolutions, never for assertions.
 */
export async function guardarYConfirmar(
  page: Page,
  pool: Pool,
): Promise<VentaConfirmada> {
  await page.getByRole("button", { name: "Save draft" }).click();

  // Board-02 S6: the draft list is collapsed by default — expand it first.
  await page.getByRole("button", { name: /My drafts/ }).click();

  const confirm = page.getByRole("button", { name: /Confirm draft \d+/ });
  await confirm.waitFor();
  await confirm.click();

  const desenlace = await esperarDesenlace(page);

  if (desenlace === "banner") {
    const banner = bannerConfirmacion(page);
    await expect(banner).toContainText(/Sale #\d+ confirmed/);
    const texto = (await banner.textContent())!;
    const ventaId = Number(texto.match(/#(\d+)/)![1]);
    const ncf = texto.match(/invoice (B\d+)/)![1];
    // The banner names the sale, not its invoice: resolve the FK (read only).
    const factura = await pool.query(
      `select id from "FACTURA" where "ventaId" = $1 order by id desc limit 1`,
      [ventaId],
    );
    if (factura.rowCount !== 1) {
      throw new Error(
        `La venta ${ventaId} se confirmó en pantalla pero no tiene UNA FACTURA persistida (filas=${factura.rowCount}).`,
      );
    }
    return { ventaId, ncf, facturaId: Number(factura.rows[0].id) };
  }

  // Receipt route: the printed document is the observable success surface.
  const documento = page.getByTestId("factura-print");
  await documento.waitFor();
  const facturaId = facturaIdDeLaUrl(page);
  const ncfTexto = (await page.getByTestId("factura-ncf").textContent())!;
  const ncf = ncfTexto.match(/NCF:\s*(B\d+)/)![1];
  const factura = await pool.query(
    `select "ventaId" from "FACTURA" where id = $1`,
    [facturaId],
  );
  if (factura.rowCount !== 1) {
    throw new Error(
      `El recibo /venta/factura/${facturaId} se renderizó sin la FACTURA correspondiente (filas=${factura.rowCount}).`,
    );
  }
  return { ventaId: Number(factura.rows[0].ventaId), ncf, facturaId };
}

/**
 * The demo credit client's id for a tenant (0 when the seed row is absent, so
 * callers keep their explicit self-skip contract).
 */
export async function idClienteCreditoDemo(
  pool: Pool,
  empresaId: number,
): Promise<number> {
  const cliente = await pool.query(
    `select id from "CLIENTE"
      where "empresaId" = $1 and nombre = $2 and "tipoCliente" = 'CREDITO' and "creditoHabilitado" = true
       and activo = true
       limit 1`,
    [empresaId, CLIENTE_CREDITO_DEMO_NOMBRE],
  );
  return cliente.rows[0]?.id ?? 0;
}
