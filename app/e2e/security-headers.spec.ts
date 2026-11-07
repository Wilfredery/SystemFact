/**
 * T1 stage 1 — cabeceras de seguridad en respuestas REALES (docs/22 §T1).
 *
 * Segunda capa del criterio de aceptación, después del pin determinista de
 * `tools/config/next-config.test.ts`. Aquí se comprueba lo que el test unitario
 * no puede: que Next realmente EMITE las cabeceras, incluidas las respuestas
 * que nunca llegan a un route handler.
 *
 * Sin login y sin base de datos: sólo habla HTTP contra el servidor que
 * `playwright.config.ts` levanta (o `E2E_BASE_URL`). Por eso no se saltea con
 * los precondicionamientos de las specs que mutan datos.
 *
 * ENV: E2E_BASE_URL (default http://localhost:3000).
 */

import { test, expect } from "@playwright/test";

const CABECERAS_REQUERIDAS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
} as const;

test.describe("cabeceras de seguridad (T1 stage 1)", () => {
  test("una ruta pública responde con las cinco cabeceras", async ({ request }) => {
    const response = await request.get("/login", { maxRedirects: 0 });

    for (const [nombre, valor] of Object.entries(CABECERAS_REQUERIDAS)) {
      expect(response.headers()[nombre], `cabecera ${nombre}`).toBe(valor);
    }
  });

  test("la redirección del gate de auth también las lleva", async ({ request }) => {
    // Ruta protegida sin sesión: el proxy responde 307 a /login antes de que
    // renderice ningún handler. Es justo el caso que la capa de config cubre.
    const response = await request.get("/dashboard", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toContain("/login");
    for (const [nombre, valor] of Object.entries(CABECERAS_REQUERIDAS)) {
      expect(response.headers()[nombre], `cabecera ${nombre} en el redirect`).toBe(valor);
    }
  });

  test("una ruta inexistente sin sesión la corta el gate, con las cinco", async ({
    request,
  }) => {
    // Historia de esta aserción (0.18.1): antes pedía un 404 y estaba verde
    // mientras el proxy NO corría, porque Next resolvía la ruta desconocida y
    // servía su página de error. O sea: la prueba fijaba como correcta la
    // consecuencia del bug. Con el gate vivo, lo que no es público se protege
    // por defecto, así que una ruta inexistente nunca llega a 404 sin sesión.
    // El 404 sigue siendo una respuesta que hay que cubrir, pero sólo se
    // alcanza autenticado (follow-up: afirmarlo en una spec que ya tiene
    // sesión).
    const response = await request.get("/ruta-que-no-existe", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toContain("/login");
    for (const [nombre, valor] of Object.entries(CABECERAS_REQUERIDAS)) {
      expect(
        response.headers()[nombre],
        `cabecera ${nombre} en el redirect del gate`,
      ).toBe(valor);
    }
  });

  test("un asset estático también las lleva", async ({ request }) => {
    // El matcher del proxy excluye `.*\.(?:svg|png|...)$`, así que esta
    // respuesta la sirve el sistema de archivos y NUNCA pasa por el proxy:
    // sólo la capa de config puede ponerle las cabeceras. Sin este caso, la
    // cobertura de assets queda afirmada en el CHANGELOG pero sin pin real.
    const response = await request.get("/next.svg");

    expect(response.status()).toBe(200);
    for (const [nombre, valor] of Object.entries(CABECERAS_REQUERIDAS)) {
      expect(response.headers()[nombre], `cabecera ${nombre} en el asset`).toBe(valor);
    }
  });
});

// docs/22 T1 stage 2: the CSP is report-only (nothing is blocked), lives alone in
// the proxy, and carries a per-request nonce. The five headers above stay in
// next.config.ts and must not change.
test.describe("Content-Security-Policy-Report-Only (T1 stage 2)", () => {
  function nonceOf(policy: string | undefined): string {
    const match = policy?.match(/script-src[^;]*'nonce-([A-Za-z0-9+/]+={0,2})'/);
    expect(match, "script-src must carry a nonce").not.toBeNull();
    return match![1];
  }

  test("la página de login lleva el CSP report-only con nonce y las cinco intactas", async ({
    request,
  }) => {
    const response = await request.get("/login", { maxRedirects: 0 });
    const headers = response.headers();

    expect(headers["content-security-policy"], "no debe ser enforcing").toBeUndefined();
    const policy = headers["content-security-policy-report-only"];
    expect(policy, "falta content-security-policy-report-only").toBeTruthy();
    expect(nonceOf(policy)).toBeTruthy();
    expect(policy).not.toContain("unsafe-eval");
    for (const [nombre, valor] of Object.entries(CABECERAS_REQUERIDAS)) {
      expect(headers[nombre], `cabecera ${nombre}`).toBe(valor);
    }
  });

  test("el nonce cambia en cada petición", async ({ request }) => {
    const first = await request.get("/login", { maxRedirects: 0 });
    const second = await request.get("/login", { maxRedirects: 0 });

    expect(nonceOf(first.headers()["content-security-policy-report-only"])).not.toBe(
      nonceOf(second.headers()["content-security-policy-report-only"]),
    );
  });

  // Trap 4 of odd/tasks/csp-nonce.md: Next can only stamp the nonce while it
  // renders a request. A prerendered /login ships the CSP header with a fresh
  // nonce and inline scripts with none, so enforcing would break the page.
  test("/login se renderiza por petición y sus scripts inline llevan el nonce de ESA petición", async ({
    request,
  }) => {
    const response = await request.get("/login", { maxRedirects: 0 });
    const headers = response.headers();

    expect(headers["x-nextjs-prerender"], "/login no debe estar prerenderizada").toBeUndefined();
    expect(headers["cache-control"] ?? "", "/login no debe servirse cacheada").not.toContain(
      "s-maxage=31536000",
    );

    const nonce = nonceOf(headers["content-security-policy-report-only"]);
    const html = await response.text();
    const inline = [...html.matchAll(/<script(?![^>]*ssrc=)([^>]*)>/g)];
    expect(inline.length, "se esperan scripts inline de Next").toBeGreaterThan(0);
    for (const [, attrs] of inline) {
      expect(attrs, "script inline sin el nonce de la petición").toContain(`nonce="${nonce}"`);
    }
  });

  test("el redirect del gate también lleva el CSP report-only", async ({ request }) => {
    const response = await request.get("/dashboard", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toContain("/login");
    expect(response.headers()["content-security-policy-report-only"]).toBeTruthy();
  });
});
