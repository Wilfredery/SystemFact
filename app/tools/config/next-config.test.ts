/**
 * Contrato de cabeceras de seguridad (docs/22 T1 stage 1).
 *
 * ¿Por qué existe? Las cabeceras viven en `next.config.ts`, un archivo que
 * ningún test importa por defecto: sin este pin, borrar la línea de `nosniff`
 * o cambiar `X-Frame-Options` a `SAMEORIGIN` no rompe nada y el navegador no
 * lo grita. Este test es la capa determinista (sin servidor) del criterio de
 * aceptación de T1; la capa Playwright (`e2e/security-headers.spec.ts`) sólo
 * corre cuando existen los secretos E2E, así que la garantía real es esta.
 *
 * Se importa el `next.config.ts` REAL, no una copia del mapa: si el archivo
 * deja de exportar una configuración válida para Next, el test falla igual.
 */

import nextConfig from "../../next.config";

/** Cabeceras exigidas por docs/22 §T1 stage 1, con su valor exacto. */
const CABECERAS_REQUERIDAS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

type EntradaCabeceras = { key: string; value: string };
type ReglaCabeceras = { source: string; headers: EntradaCabeceras[] };

async function leerReglas(): Promise<ReglaCabeceras[]> {
  const headers = nextConfig.headers;
  expect(headers).toBeDefined();
  const reglas = await headers!();
  return reglas as ReglaCabeceras[];
}

describe("next.config headers() — cabeceras de seguridad (T1 stage 1)", () => {
  it("expone una única regla que cubre todas las rutas", async () => {
    const reglas = await leerReglas();

    expect(reglas).toHaveLength(1);
    // `/(.*)` cubre /, /login, /dashboard y cualquier ruta futura. Un matcher
    // más estrecho dejaría rutas sin cabeceras sin que nada lo delate.
    expect(reglas[0].source).toBe("/(.*)");
  });

  it("devuelve exactamente las cinco cabeceras exigidas, con sus valores", async () => {
    const [regla] = await leerReglas();

    const mapa = Object.fromEntries(
      regla.headers.map(({ key, value }) => [key, value]),
    );

    // Igualdad exacta: una cabecera extra sin spec fracasa aquí a propósito,
    // para que agregar `Content-Security-Policy` (T1 stage 2) sea una decisión
    // deliberada y no un efecto colateral.
    expect(mapa).toEqual(CABECERAS_REQUERIDAS);
  });

  it("no repite nombres de cabecera dentro de la regla", async () => {
    const [regla] = await leerReglas();

    const nombres = regla.headers.map(({ key }) => key.toLowerCase());
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
