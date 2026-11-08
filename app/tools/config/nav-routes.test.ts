/**
 * Cada enlace habilitado del menú tiene una página detrás (plan de pantallas, hallazgo F1).
 *
 * ¿Por qué existe? El menú tenía "Cobros" apuntando a `/cobros`, pero sólo existían
 * `/cobros/cxc-board`, `/cobros/estado-cuenta/...` y `/cobros/recibo/...`: el enlace
 * llevaba a un 404 y ningún typecheck, lint ni test se ponía rojo, porque un `href` es
 * sólo un string. Este test lee los `href` de `shell.tsx` y exige un `page.tsx` para
 * cada uno bajo `src/app/(app)`.
 *
 * Los ítems `disabled: true` no llevan `href`, así que quedan fuera hasta que se
 * habiliten: al habilitar uno, este test exige su página en el mismo PR.
 * No se arregla borrando este test.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ_SRC = join(__dirname, "..", "..", "src");
const SHELL = join(RAIZ_SRC, "shared", "ui", "app-shell", "shell.tsx");

function hrefsDelMenu(): string[] {
  return [...readFileSync(SHELL, "utf8").matchAll(/href:\s*"(\/[^"]*)"/g)].map(
    (coincidencia) => coincidencia[1],
  );
}

describe("menú — sin enlaces muertos", () => {
  const hrefs = hrefsDelMenu();

  it("el menú declara al menos un enlace (el test no pasa por no leer nada)", () => {
    expect(hrefs.length).toBeGreaterThan(0);
  });

  it.each(hrefs)("`%s` tiene un page.tsx bajo src/app/(app)", (href) => {
    const pagina = join(RAIZ_SRC, "app", "(app)", ...href.split("/").filter(Boolean), "page.tsx");
    // Jest no acepta un mensaje como 2.º argumento de `expect`: la ruta va en el diff.
    expect({ pagina, existe: existsSync(pagina) }).toEqual({ pagina, existe: true });
  });
});
