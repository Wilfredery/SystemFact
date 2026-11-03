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
});
