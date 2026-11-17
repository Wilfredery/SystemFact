/**
 * Production smoke — the logged-in half (odd/tasks/prod-smoke.md S1/S2).
 *
 * HARD RULE — NO FISCAL WRITES. This spec only READS the hosted tenant: it
 * never confirms a sale, never consumes an NCF, never voids anything and never
 * POSTs a mutating action. The only writes are the implicit ones Supabase Auth
 * performs on login (a session + refresh token). The identity is a single-branch
 * Operador supplied via PROD_USER / PROD_PASSWORD.
 *
 * ROLE GATE — the dashboard read is deny-by-default for an Operador
 * (`tilesPermitidos()` in src/modules/reportes/domain/roles.ts returns an empty
 * list), so `consultarDashboardAction()` answers REPORTE_NO_AUTORIZADO and the
 * page renders a `role="alert"` paragraph ("Su rol no incluye paneles de
 * reporte.") with NO KPI tile. If an Operador ever sees KPI data, that is a
 * security regression and this smoke must fail.
 *
 * When PROD_USER or PROD_PASSWORD is missing the check FAILS (never skips): a
 * skipped production check is exactly the lie this whole lane exists to prevent.
 *
 * PAGE COVERAGE (odd/tasks/csp-reporting-and-bump-guard.md S2, closing the
 * csp-nonce.md gap "the 7 other authenticated pages are not covered by the
 * production smoke"): the walk below visits EVERY page under
 * `src/app/(app)/**` read-only. Each page either renders its key read-only
 * content (the screens an Operador may see) or the deny-by-default
 * `role="alert"` access message with NO restricted data — the second case is a
 * SECURITY assertion, not a failure. A page list that drifts from the route
 * tree fails the coverage test instead of silently shrinking.
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { login } from "../e2e/utils/login";
import {
  expectNoCspViolations,
  watchCspViolations,
  type CspViolation,
} from "./csp-violations";

const MISSING_CREDENTIALS =
  "PROD_USER and PROD_PASSWORD are required for the production session smoke. " +
  "Without a real least-privilege identity this check cannot prove that auth and " +
  "the database work in production, so it FAILS instead of skipping.";

// The KPI tiles render as <section aria-label="..."> in
// src/modules/reportes/ui/dashboard-kpis.tsx. An Operador is deny-by-default,
// so NONE of these may render — if one does, the role gate regressed.
const KPI_TILES = [
  "Ventas del día",
  "Ventas del mes",
  "Cuentas por cobrar",
  "Inventario",
  "Productos más vendidos",
] as const;

/**
 * The deny-by-default pages must show the access message INSTEAD of the data, so
 * every one of them also names the markup of the screen it must NOT render.
 *
 * Locator strings (not text-only) so one shape covers CSS selectors, attribute
 * selectors and Playwright's `text=` engine.
 */
type PageCheck = {
  /** Route pattern as it appears under `src/app/(app)/`, e.g. `/cobros/recibo/[correlativo]`. */
  readonly route: string;
  /** URL actually visited (dynamic segments filled with a sentinel id). */
  readonly path: string;
  /** Exact `<main>` heading this page renders. */
  readonly heading?: string;
  /** Read-only markers that MUST be present. */
  readonly required?: readonly string[];
  /** Access-message text that must be the single `role="alert"` inside `<main>`. */
  readonly alert?: string;
  /** Markers that must NOT be present (restricted data or manage-only controls). */
  readonly forbidden?: readonly string[];
  /** Server-side ownership redirect this page must perform. */
  readonly redirectTo?: string;
};

/** `section[aria-label=...]` for every dashboard KPI tile (see KPI_TILES). */
const KPI_TILE_SELECTORS: readonly string[] = KPI_TILES.map(
  (label) => `section[aria-label="${label}"]`,
);

/**
 * A sentinel id that no tenant can own. The two dynamic routes are still
 * visited (their guard and their no-data state are part of the coverage), but
 * the smoke never guesses a real client or receipt id: it reads no database and
 * must not go fishing for tenant rows from the public alias.
 */
const SENTINEL_ID = "999999999";

/**
 * Every page under `src/app/(app)/`, derived from the route tree (not from
 * memory) and pinned to what a single-branch OPERADOR must see there:
 *
 *   - permitted: the list/detail screens an Operador uses (they sell, collect
 *     and receive) render their read-only UI, with NO manage-only control;
 *   - denied: Admin-only screens render the access message and none of the data
 *     (`ROLES_VER_CAJA`, `ROLES_VER_ADMINISTRACION`, the audit gate, the
 *     inventory manage group, the report role map);
 *   - redirect: `/selector-empresa-sucursal` sends a non-admin to /dashboard
 *     server-side (SEL-ROUTE-01-B).
 *
 * Source of each expectation: the page shells under `src/app/(app)/` plus the
 * named role groups in `src/modules/<domain>/http/shared.ts`.
 */
const PAGES: readonly PageCheck[] = [
  {
    route: "/administracion",
    path: "/administracion",
    heading: "Administración",
    alert: "No tiene permisos para ver la Administración.",
    // ROLES_VER_ADMINISTRACION = Administrador only: no tab data, no user list.
    forbidden: ["main table", "main form"],
  },
  {
    route: "/auditoria",
    path: "/auditoria",
    heading: "Auditoría",
    alert: "Solo el administrador puede consultar el registro de auditoría.",
    // The audit table and its filter form belong to the admin read.
    forbidden: ["main table", "main form"],
  },
  {
    route: "/caja",
    path: "/caja",
    heading: "Caja",
    alert: "No tiene permisos para ver la Caja.",
    // ROLES_VER_CAJA = Administrador only: neither board may render.
    forbidden: ["#caja-cierre-titulo", "#caja-resumen-titulo"],
  },
  {
    route: "/clientes",
    path: "/clientes",
    heading: "Clientes",
    required: ['input[aria-label="Buscar cliente"]'],
    // View-only: ROLES_GESTION_CLIENTES = Administrador only.
    forbidden: ["text=Nuevo cliente", 'main button[aria-label^="Editar "]'],
  },
  {
    route: "/cobros",
    path: "/cobros",
    heading: "Cuentas por cobrar",
    // The three derived-balance buckets always render (empty or not).
    required: ['section[aria-label="Pendientes"]'],
  },
  {
    route: "/cobros/cxc-board",
    path: "/cobros/cxc-board",
    heading: "Cuentas por cobrar",
    required: ['section[aria-label="Pendientes"]'],
  },
  {
    route: "/cobros/estado-cuenta/[clienteId]",
    path: `/cobros/estado-cuenta/${SENTINEL_ID}`,
    heading: `Estado de cuenta · Cliente #${SENTINEL_ID}`,
    // The canonical read is tenant-scoped, so a foreign id is an EMPTY
    // statement, never a cross-tenant leak (ADR-017).
    required: ["text=Sin facturas vigentes para este cliente."],
  },
  {
    route: "/cobros/recibo/[correlativo]",
    path: `/cobros/recibo/${SENTINEL_ID}`,
    // consultarReciboAction answers PAGO_NO_ENCONTRADO: an alert, no receipt.
    alert: "El pago no existe en la empresa",
    forbidden: ['[data-testid="recibo-reprint"]'],
  },
  {
    route: "/venta/factura/[facturaId]",
    path: `/venta/factura/${SENTINEL_ID}`,
    // consultarFacturaParaImpresionAction answers FACTURA_NO_ENCONTRADA: a
    // typed alert, never a document and never a cross-tenant leak (S4/S5).
    alert: "Factura no encontrada",
    forbidden: ['[data-testid="factura-print"]'],
  },
  {
    route: "/compras",
    path: "/compras",
    heading: "Compras",
    required: ['input[aria-label="Buscar proveedor"]'],
    // View-only: ROLES_GESTION_COMPRAS = Administrador only.
    forbidden: ["text=Nueva compra"],
  },
  {
    route: "/dashboard",
    path: "/dashboard",
    required: ["main h1"],
    alert: "Su rol no incluye paneles de reporte.",
    forbidden: KPI_TILE_SELECTORS,
  },
  {
    route: "/inventario",
    path: "/inventario",
    heading: "Inventario",
    required: ['input[aria-label="Buscar producto"]'],
    // ROLES_GESTION_INVENTARIO = Administrador only: no adjust/history entry.
    forbidden: ['main a[href="/inventario/ajuste"]', 'main a[href="/inventario/movimientos"]'],
  },
  {
    route: "/inventario/ajuste",
    path: "/inventario/ajuste",
    alert: "No tiene permisos para ajustar inventario.",
    forbidden: ["main form"],
  },
  {
    route: "/inventario/movimientos",
    path: "/inventario/movimientos",
    alert: "No tiene permisos para ver el historial de movimientos.",
    forbidden: ["main table"],
  },
  {
    route: "/productos",
    path: "/productos",
    heading: "Productos",
    required: ['input[aria-label="Buscar producto"]'],
    // View-only: ROLES_GESTION_PRODUCTOS = Administrador only.
    forbidden: ["text=Nuevo producto"],
  },
  {
    route: "/proveedores",
    path: "/proveedores",
    heading: "Proveedores",
    required: ['input[aria-label="Buscar proveedor"]'],
    // View-only: ROLES_GESTION_PROVEEDORES = Administrador only.
    forbidden: ["text=Nuevo proveedor"],
  },
  {
    route: "/reportes",
    path: "/reportes",
    heading: "Reportes",
    // The shell renders; the default DASHBOARD panel is denied for this role.
    alert: "No tiene permisos para consultar este reporte.",
    forbidden: KPI_TILE_SELECTORS,
  },
  {
    route: "/selector-empresa-sucursal",
    path: "/selector-empresa-sucursal",
    // Server-side ownership redirect: a non-admin never boards this screen.
    redirectTo: "/dashboard",
  },
  {
    route: "/venta",
    path: "/venta",
    heading: "Point of sale",
    // The POS opens for an Operador (ROLES_VENTA); the smoke only LOOKS at it.
  },
];

const APP_ROUTES_DIR = path.resolve(__dirname, "..", "src", "app", "(app)");

/**
 * Every `page.tsx` under `(app)` as a route pattern — same filesystem walk as
 * `e2e/csp-authenticated.spec.ts`, kept here because the production smoke must
 * fail LOUDLY when a new page ships without an expectation instead of quietly
 * covering fewer pages than the route tree has.
 */
function authenticatedRoutePatterns(dir: string = APP_ROUTES_DIR): string[] {
  const routes: string[] = [];
  const walk = (current: string, segments: string[]): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Route groups `(x)` add no URL segment.
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(
          path.join(current, entry.name),
          isGroup ? segments : [...segments, entry.name],
        );
      } else if (entry.name === "page.tsx") {
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(dir, []);
  return routes.sort();
}

function readCredentials(): { user: string; password: string } {
  const user = process.env.PROD_USER;
  const password = process.env.PROD_PASSWORD;
  if (!user || !password) {
    throw new Error(MISSING_CREDENTIALS);
  }
  return { user, password };
}

test.describe("production session smoke", () => {
  test.beforeAll(() => {
    // Throws (and therefore FAILS the tests, never skips) when the identity is
    // missing, before any browser work starts.
    readCredentials();
  });

  test("a single-branch Operador logs in through the real form and lands on the dashboard rendered as a denied report role", async ({
    page,
  }) => {
    // Watch from before the login page loads, so the whole login -> dashboard
    // journey is covered (S4/S5: zero CSP violations on login and dashboard).
    const violations = await watchCspViolations(page);

    await login(page, readCredentials());
    await expect(page).toHaveURL(/\/dashboard/);

    // The session header renders the acting identity: the greeting heading with
    // the user's name, then the empresa/sucursal line directly under it.
    await expect(
      page.getByRole("heading", { level: 1, name: /^Hola, .+/ }),
      "the dashboard must render the 'Hola, <nombre>' greeting with a real name",
    ).toBeVisible();
    await expect(
      page.locator("main h1 + p"),
      "the empresa/sucursal line under the greeting must be rendered",
    ).toBeVisible();
    await expect(page.locator("main h1 + p")).toContainText(/\S/);

    // Role gate: an Operador gets the access message, not KPI data. Scoped to
    // `main` on purpose: right after a client-side navigation Next.js injects
    // its route announcer (`<div role="alert" id="__next-route-announcer__">`,
    // which announces the greeting) into <body>, so an unscoped
    // `getByRole("alert")` resolves to two elements and dies on strict mode
    // before it asserts anything about the gate.
    const denial = page.locator("main").getByRole("alert");
    await expect(denial).toHaveCount(1);
    await expect(denial).toBeVisible();
    await expect(denial).toContainText("Su rol no incluye paneles de reporte.");

    // And explicitly: NO KPI tile may render for this role.
    for (const label of KPI_TILES) {
      await expect(
        page.locator(`section[aria-label="${label}"]`),
        `an Operador must not see the "${label}" KPI tile`,
      ).toHaveCount(0);
    }

    await page.waitForLoadState("networkidle");
    expectNoCspViolations(violations, "the login -> dashboard journey");
  });

  // S2 — no page under (app) may be missing from PAGES. The list is compared to
  // the ROUTE TREE, so shipping a screen without an expectation turns the
  // production smoke red instead of leaving the gap this feature closes.
  test("every page under (app) has a read-only expectation in this smoke", () => {
    const patterns = authenticatedRoutePatterns();
    expect(
      patterns.length,
      `the route tree produced no pages — ${APP_ROUTES_DIR} did not resolve`,
    ).toBeGreaterThan(0);

    const covered = PAGES.map((page) => page.route).sort();
    expect(
      covered,
      "the production smoke does not cover exactly the pages under src/app/(app): " +
        "a new page must get its own expectation (permitted content or the deny-by-default " +
        "access message) before this lane can claim coverage",
    ).toEqual(patterns);
  });

  /**
   * Asserts ONE page: the URL it must land on, its heading, its required
   * read-only markers, its access message, and the restricted markup it must NOT
   * render. Read-only: navigation only, never a form submit.
   */
  async function assertPage(page: Page, check: PageCheck): Promise<void> {
    await page.goto(check.path, { waitUntil: "load" });

    if (check.redirectTo !== undefined) {
      await expect(
        page,
        `${check.path} must redirect a non-admin to ${check.redirectTo}`,
      ).toHaveURL(check.redirectTo, { timeout: 15_000 });
      return;
    }

    await expect(page, `${check.path} must render at its own URL`).toHaveURL(
      check.path,
      { timeout: 15_000 },
    );

    if (check.heading !== undefined) {
      await expect(
        page.locator("main h1"),
        `${check.path} must render the heading "${check.heading}"`,
      ).toHaveText(check.heading, { timeout: 15_000 });
    }

    for (const required of check.required ?? []) {
      await expect(
        page.locator(required),
        `${check.path} must render its read-only content: ${required}`,
      ).toBeVisible({ timeout: 15_000 });
    }

    if (check.alert !== undefined) {
      // Scoped to `main`: Next injects its route announcer
      // (`<div role="alert" id="__next-route-announcer__">`) into <body>.
      const denial = page.locator("main").getByRole("alert");
      await expect(
        denial,
        `${check.path} must render exactly one access message`,
      ).toHaveCount(1, { timeout: 15_000 });
      await expect(denial).toContainText(check.alert);
    }

    for (const forbidden of check.forbidden ?? []) {
      await expect(
        page.locator(forbidden),
        `${check.path} must NOT render restricted content or a manage-only control: ${forbidden}`,
      ).toHaveCount(0);
    }
  }

  test("a single-branch Operador visits EVERY page under (app) read-only and gets content or the access message", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    // Watcher starts before the login page loads, so the whole journey counts.
    const violations: CspViolation[] = await watchCspViolations(page);
    await login(page, readCredentials());

    const findings: string[] = [];
    for (const check of PAGES) {
      const before = violations.length;
      // A failing page must name itself: Playwright already attaches the
      // assertion message, and the loop reports the per-page CSP slice below.
      await assertPage(page, check);
      for (const violation of violations.slice(before)) {
        findings.push(
          `${check.path}: ${violation.directive} (blocked: ${violation.blocked}, ` +
            `source: ${violation.source})`,
        );
      }
    }

    test
      .info()
      .annotations.push({
        type: "pages visited",
        description: PAGES.map((page) => page.path).join(", "),
      });
    expectNoCspViolations(violations, "the (app) pages walk");
    expect(findings, "per-page CSP findings").toEqual([]);
  });

  // The F1 hallazgo: the "Cobros" menu entry pointed at a route that 404'd.
  // Spelled out on its own because it is the page the owner reported, and
  // because it must serve the CxC board at ITS OWN URL (never a redirect).
  test("/cobros renders the receivables board at its own URL for an Operador", async ({
    page,
  }) => {
    const violations = await watchCspViolations(page);
    await login(page, readCredentials());

    await page.goto("/cobros", { waitUntil: "load" });
    await expect(page, "/cobros must not redirect").toHaveURL("/cobros", {
      timeout: 15_000,
    });
    await expect(
      page.locator("main h1"),
      "/cobros must serve the CxC board heading",
    ).toHaveText("Cuentas por cobrar", { timeout: 15_000 });
    await expect(
      page.locator('section[aria-label="Pendientes"]'),
      "/cobros must render the receivables board (empty state counts too)",
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('input[aria-label="Número de recibo a reimprimir"]'),
      "/cobros must render the receipt-reprint entry (read-only form, never submitted)",
    ).toBeVisible({ timeout: 15_000 });

    await page.waitForLoadState("networkidle");
    expectNoCspViolations(violations, "/cobros");
  });

  // docs/22 T6: @supabase/ssr and Next never set `Secure` on the sb-* auth
  // cookies, so production is PROVEN here, never assumed. HttpOnly is recorded
  // as deliberately false (see the comment in src/lib/supabase/client.ts).
  // Messages name cookies and flags only — NEVER values: this lane logs into
  // live production.
  test("the sb-* auth cookies carry Secure and SameSite=Lax and are deliberately not HttpOnly", async ({
    page,
  }) => {
    await login(page, readCredentials());
    await expect(page).toHaveURL(/\/dashboard/);

    const authCookies = (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("sb-"),
    );
    expect(
      authCookies.length,
      "login must leave at least one sb-* auth cookie",
    ).toBeGreaterThan(0);

    for (const cookie of authCookies) {
      expect(
        cookie.secure,
        `auth cookie ${cookie.name} must be Secure`,
      ).toBe(true);
      expect(
        cookie.sameSite,
        `auth cookie ${cookie.name} must be SameSite=Lax`,
      ).toBe("Lax");
      expect(
        cookie.httpOnly,
        `auth cookie ${cookie.name} is deliberately not HttpOnly`,
      ).toBe(false);
    }
  });
});
