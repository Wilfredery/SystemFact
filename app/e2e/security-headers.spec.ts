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

  test("una ruta inexistente (404) también las lleva", async ({ request }) => {
    // El 404 lo sirve Next, ningún route handler: es la respuesta que más se
    // escaparía de un control por handler. Si quedara sin `X-Frame-Options`,
    // un tercero podría incrustar la página de error y sondear la app desde un
    // iframe opaco.
    const response = await request.get("/ruta-que-no-existe", { maxRedirects: 0 });

    expect(response.status()).toBe(404);
    for (const [nombre, valor] of Object.entries(CABECERAS_REQUERIDAS)) {
      expect(response.headers()[nombre], `cabecera ${nombre} en el 404`).toBe(valor);
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
