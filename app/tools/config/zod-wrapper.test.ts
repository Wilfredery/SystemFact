/**
 * Zod sólo entra por `src/lib/zod.ts` (docs/22 T1 stage 2, odd/tasks/csp-nonce.md).
 *
 * ¿Por qué existe? Zod 4 decide si compila sus esquemas con `new Function("")`
 * dentro de un try/catch. El throw se traga y zod sigue por su camino normal,
 * pero una CSP estricta (sin `'unsafe-eval'`, que S2 prohíbe) REPORTA ese intento
 * como `securitypolicyviolation`: venta, cobros y estado de cuenta lo cargan en
 * el cliente y el guard E2E de páginas autenticadas se ponía rojo. El wrapper
 * llama `z.config({ jitless: true })` antes de que se construya cualquier
 * esquema y zod ni siquiera sondea. Un import directo de "zod" que se ejecute
 * antes que el wrapper vuelve a abrir el agujero sin que ningún typecheck ni
 * lint se entere.
 *
 * Este test falla si algún archivo de `src/` (salvo el propio wrapper y los
 * tests) importa un VALOR de "zod". `import type` está permitido: se borra en
 * compilación y no ejecuta nada. No se arregla borrando este test.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_SRC = join(__dirname, "..", "..", "src");
const WRAPPER = join(RAIZ_SRC, "lib", "zod.ts");

function archivosDeCodigo(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosDeCodigo(ruta);
    return /\.(ts|tsx)$/.test(nombre) && !/\.(test|spec)\.tsx?$/.test(nombre)
      ? [ruta]
      : [];
  });
}

/** `import`/`export ... from "zod"` sin `type`, `import "zod"`, `import("zod")` y `require("zod")`. */
const IMPORT_DE_VALOR_ZOD = new RegExp(
  [
    String.raw`(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']zod(?:\/[^"']*)?["']`,
    String.raw`(?:^|\n)\s*import\s*["']zod(?:\/[^"']*)?["']`,
    String.raw`\b(?:import|require)\s*\(\s*["']zod(?:\/[^"']*)?["']\s*\)`,
  ].join("|"),
);

describe("zod sólo entra por `src/lib/zod.ts`", () => {
  it("ningún otro archivo de `src/` importa un valor de 'zod'", () => {
    const infractores = archivosDeCodigo(RAIZ_SRC)
      .filter((ruta) => ruta !== WRAPPER)
      .filter((ruta) => IMPORT_DE_VALOR_ZOD.test(readFileSync(ruta, "utf8")))
      .map((ruta) => relative(RAIZ_SRC, ruta).split("\\").join("/"));

    if (infractores.length > 0) {
      throw new Error(
        "Importá desde '@/lib/zod', no desde 'zod': una CSP estricta reporta la sonda " +
          "`new Function` de zod como violación; el wrapper la apaga con " +
          "`z.config({ jitless: true })` antes de construir cualquier esquema. " +
          "(`import type` desde 'zod' sí está permitido.)\nInfractores:\n" +
          infractores.join("\n"),
      );
    }
  });

  it("el wrapper existe y activa jitless", () => {
    const fuente = readFileSync(WRAPPER, "utf8");

    expect(fuente).toMatch(/z\.config\(\s*\{\s*jitless:\s*true\s*\}\s*\)/);
  });
});
