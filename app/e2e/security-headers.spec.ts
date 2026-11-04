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
