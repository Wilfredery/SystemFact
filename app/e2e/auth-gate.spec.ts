/**
 * Gate de autenticación — que el proxy REALMENTE corra (0.18.1).
 *
 * Por qué existe esta spec: `security-headers.spec.ts` ya pide `/dashboard` sin
 * sesión y espera 307, pero eso NO prueba el proxy. El layout de `(app)` también
 * redirige por su cuenta, así que la aserción pasa igual aunque el proxy no se
 * ejecute nunca. Eso es exactamente lo que pasó entre #132 y 0.18.0: `proxy.ts`
 * quedó en la raíz del proyecto y, con un directorio `src/`, Next no lo detecta
 * (el build no imprime `ƒ Proxy (Middleware)`), de modo que el gate desapareció
 * de producción sin que ninguna prueba se pusiera roja.
 *
 * Los dos casos de aquí sólo pueden pasar si el proxy corre:
 *   1. `/` no tiene guard propio (es una página estática): sin proxy responde
 *      200 con el scaffold de Next; con proxy responde 307 a `/login`.
 *   2. una ruta INEXISTENTE tampoco tiene guard propio: sin proxy da 404; con
 *      proxy da 307 a `/login`, porque todo lo que no es público está protegido
 *      por defecto.
 *
 * Sin login y sin base de datos: sólo HTTP contra el servidor que levanta
 * `playwright.config.ts` (o `E2E_BASE_URL`). ENV: E2E_BASE_URL (default
 * http://localhost:3000).
 */

import { test, expect } from "@playwright/test";

test.describe("gate de autenticación (proxy)", () => {
  test("una visita anónima a la raíz termina en el login", async ({ request }) => {
    const response = await request.get("/", { maxRedirects: 0 });

    // 200 acá significa que se sirvió el scaffold de Next a un visitante
    // anónimo: el gate no está corriendo.
    expect(
      response.status(),
      "GET / sin sesión debe redirigir al login, no servir la página",
    ).toBe(307);
    expect(response.headers()["location"]).toContain("/login");
  });

  test("una ruta inexistente también pasa por el gate", async ({ request }) => {
    const response = await request.get("/ruta-que-no-existe-proxy-check", {
      maxRedirects: 0,
    });

    // 404 significa que Next resolvió la ruta sin pasar por el proxy. Con el
    // gate activo, lo no público se protege por defecto y nunca se llega a 404.
    expect(
      response.status(),
      "una ruta desconocida sin sesión debe redirigir al login antes de 404",
    ).toBe(307);
    expect(response.headers()["location"]).toContain("/login");
  });
});
