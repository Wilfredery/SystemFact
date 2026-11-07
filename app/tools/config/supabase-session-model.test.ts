/**
 * Modelo de sesión de Supabase — pin de ESTRUCTURA (docs/22 T6).
 *
 * ¿Por qué existe? El timeout de inactividad de Supabase (1 h cuando el proyecto
 * suba a Pro) mide el último REFRESH de la sesión. Hoy el único que refresca es
 * el proxy, en cada request que llega al servidor, así que "inactivo" significa
 * lo que el negocio espera. Un cliente browser de Supabase montado en cualquier
 * componente arranca su propio `autoRefreshToken` y mantiene viva una pestaña
 * ociosa: la política seguiría configurada y dejaría de significar lo mismo, sin
 * que ningún import, typecheck ni lint se ponga rojo.
 *
 * Este test falla si alguien reintroduce un cliente browser. Si algún día hace
 * falta de verdad, se decide con el dueño y se vuelve a evaluar la política de
 * sesión; no se arregla borrando este test.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ_SRC = join(__dirname, "..", "..", "src");

function archivosDeCodigo(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDeCodigo(ruta);
    return /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

describe("modelo de sesión — sin cliente browser de Supabase", () => {
  it("no existe `src/lib/supabase/client-component.ts`", () => {
    expect(
      existsSync(join(RAIZ_SRC, "lib", "supabase", "client-component.ts")),
    ).toBe(false);
  });

  it("ningún archivo de `src/` crea un cliente browser de Supabase", () => {
    const infractores = archivosDeCodigo(RAIZ_SRC).filter((ruta) =>
      /createBrowserClient|createClientComponent/.test(
        readFileSync(ruta, "utf8"),
      ),
    );

    expect(infractores).toEqual([]);
  });
});
