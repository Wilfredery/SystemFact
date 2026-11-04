/**
 * Convenciones de archivo de Next — pin de UBICACIÓN.
 *
 * ¿Por qué existe? El 2026-11-04 se descubrió que `proxy.ts` no corría en
 * NINGÚN build desde #132: el archivo estaba en la raíz del proyecto, pero esta
 * app usa `src/` y, en ese caso, Next sólo busca el proxy dentro de `src/`. El
 * build lo omitió en silencio — sin la línea `Proxy (Middleware)`, sin warning —
 * así que el gate de auth (sesión + deny-by-default) desapareció durante varias
 * releases y nada se puso rojo.
 *
 * `e2e/auth-gate.spec.ts` cubre el COMPORTAMIENTO (anónimo a `/` y a una ruta
 * desconocida responden 307 a `/login`). Este test cubre lo otro, más barato y
 * más temprano: que el archivo esté donde Next lo va a mirar. Un `git mv` que lo
 * devuelva a la raíz no rompe ningún import, ningún typecheck y ningún lint —
 * sólo deja de ejecutarse. Ese es exactamente el fallo que este pin convierte en
 * un test rojo en dos segundos.
 *
 * Misma familia que `next-config.test.ts`: fija una convención de framework que
 * ningún import protege.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const RAIZ_APP = join(__dirname, "..", "..");

/**
 * Regla de resolución de Next: si existe `src/app`, el directorio de
 * convenciones es `src/`; si no, la raíz del proyecto. Cuando esta aserción
 * falle, el resto del archivo está apuntando al lugar equivocado.
 */
const USA_SRC_DIR = existsSync(join(RAIZ_APP, "src", "app"));
const RAIZ_CONVENCIONES = USA_SRC_DIR ? join(RAIZ_APP, "src") : RAIZ_APP;

describe("convenciones de archivo de Next — ubicación del proxy", () => {
  it("esta app usa `src/`, así que las convenciones viven en `src/`", () => {
    expect(USA_SRC_DIR).toBe(true);
  });

  it("`proxy.ts` está donde Next lo busca", () => {
    expect(existsSync(join(RAIZ_CONVENCIONES, "proxy.ts"))).toBe(true);
  });

  it("no queda un `proxy.ts` en la raíz que Next ignoraría en silencio", () => {
    // Un duplicado acá es peor que no tener el archivo: parece configurado y no
    // corre. Si alguna vez hay que moverlo, se mueve, no se copia.
    expect(existsSync(join(RAIZ_APP, "proxy.ts"))).toBe(false);
  });
});
