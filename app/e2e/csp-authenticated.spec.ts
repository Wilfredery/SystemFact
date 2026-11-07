/**
 * CSP guard for the AUTHENTICATED pages (docs/22 T1 stage 2, odd/tasks/csp-nonce.md S5/S7).
 *
 * The production smoke only sees /login and the dashboard, and the hosted E2E
 * identities are banned, so until this spec nothing measured the pages where the
 * app actually lives. It logs in with the seeded local admin and visits EVERY
 * `page.tsx` under `src/app/(app)/**` (the list is derived from the filesystem,
 * so a new page is covered — or fails loudly — without editing this file),
 * collecting `securitypolicyviolation` events from before the login.
 *
 * It fails on ANY violation and lists page + directive + host. The app now sends
 * the ENFORCING `Content-Security-Policy`, so a violation here is a page the
 * browser actually blocks. The event fires under both the enforcing and the
 * report-only header, which is how the same spec measured before the flip.
 *
 * Read-only by design: navigation only — no sale, no payment, no void. The only
 * writes are the ones the app makes itself on login (session cookies).
 *
 * ENV: E2E_BASE_URL (default http://localhost:3000), E2E_USER, E2E_PASSWORD and
 * DIRECT_URL/DATABASE_URL (superuser read of two ids, ASSERTIONS/ROUTING ONLY).
 * Measure on `next build` + `next start`, never `next dev` (dev needs
 * 'unsafe-eval', trap 3 of the inventory).
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import "dotenv/config";
import { login } from "./utils/login";
import { openDb, usuarioPrecond } from "./utils/db";
import { E2E_PASSWORD, E2E_USER } from "./utils/venta-pos";
import { describeViolation, watchCspViolations } from "./utils/csp-violations";

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

const pool = openDb();

test.afterAll(async () => {
  await pool.end();
});

test.describe("CSP across the authenticated pages (S5/S7)", () => {
  test.skip(E2E_USER === "", "Set E2E_USER/E2E_PASSWORD to run the guard.");

  test("no page under (app) reports a CSP violation", async ({ page }) => {
    test.setTimeout(120_000);
    // Dynamic segments resolve to ids that exist in the seeded tenant, so the
    // pages render their real UI instead of the not-found state.
    const { empresaId } = await usuarioPrecond(pool, E2E_USER);
    const cliente = await pool.query(
      `select min(id) as id from "CLIENTE" where "empresaId" = $1`,
      [empresaId],
    );
    const pago = await pool.query(
      `select min("correlativoRecibo") as correlativo from "PAGO" where "empresaId" = $1`,
      [empresaId],
    );
    const dynamicSegments: Record<string, number | null> = {
      clienteId: cliente.rows[0].id,
      correlativo: pago.rows[0].correlativo,
    };

    const violations = await watchCspViolations(page);
    await login(page, { user: E2E_USER, password: E2E_PASSWORD });
    expect(
      violations.map(describeViolation),
      "the login itself reported CSP violations",
    ).toEqual([]);

    const visited: string[] = [];
    const findings: string[] = [];
    for (const pattern of authenticatedRoutePatterns()) {
      const url = pattern.replace(/\[(\w+)\]/g, (_, name: string) => {
        const id = dynamicSegments[name];
        if (id === undefined) {
          throw new Error(`No seeded id known for the dynamic segment [${name}] of ${pattern}.`);
        }
        if (id === null) {
          throw new Error(`The seeded tenant has no row for [${name}] (${pattern}): run the seeds.`);
        }
        return String(id);
      });

      const before = violations.length;
      await page.goto(url, { waitUntil: "load" });
      // Hydration and client effects (late inline/eval injections, RSC and
      // Supabase fetches) land after `load`; `networkidle` is not used because
      // a page that keeps a request open would hang the whole walk.
      await page.waitForTimeout(1_000);

      expect(new URL(page.url()).pathname, `${pattern} must render, not redirect`).toBe(url);
      visited.push(url);
      for (const violation of violations.slice(before)) {
        findings.push(`${url}: ${describeViolation(violation)}`);
      }
    }

    test.info().annotations.push({ type: "pages visited", description: visited.join(", ") });
    console.log(`CSP guard visited ${visited.length} pages: ${visited.join(", ")}`);
    expect(
      findings,
      `${findings.length} CSP violation(s) across the authenticated pages`,
    ).toEqual([]);
  });
});
