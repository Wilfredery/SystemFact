/**
 * Guardas estructurales del lane de DEMO en producción
 * (odd/tasks/prod-demo-lane.md S3/S5/S6).
 *
 * ¿Por qué existen? Ese lane ESCRIBE en producción y consume NCF para siempre.
 * Lo que lo hace seguro no es un comentario: es que sólo se dispare a mano, con una
 * confirmación explícita, y que su config nunca grabe trazas, capturas ni video de
 * un login real en un repo público. Nada ejecuta el workflow ni mira esa config
 * hasta que alguien lo despliega, así que sin estos tests un cambio "inocente"
 * (agregar un cron, quitar el input, prender el trace) llegaría a producción sin
 * que ningún check se entere. Son deterministas y no necesitan servidor ni base.
 *
 * El YAML se inspecciona como texto (sin comentarios) porque `js-yaml` no es una
 * dependencia directa del proyecto y agregar una sólo para esto no se justifica.
 */

import fs from "node:fs";
import path from "node:path";
import demoConfig from "../../playwright.prod-demo.config";

const WORKFLOW = path.join(__dirname, "..", "..", "..", ".github", "workflows", "prod-demo.yml");
const SMOKE_WORKFLOW = path.join(__dirname, "..", "..", "..", ".github", "workflows", "prod-smoke.yml");

/** Líneas del YAML sin comentarios de línea completa ni vacías, con su indentación. */
function lineasYaml(archivo: string): string[] {
  return fs
    .readFileSync(archivo, "utf8")
    .split(/\r?\n/)
    .filter((linea) => linea.trim() !== "" && !linea.trimStart().startsWith("#"));
}

/** Claves hijas (indent `hijo`) del bloque top-level `clave:`. */
function clavesDelBloque(lineas: string[], clave: string, hijo: number): string[] {
  const inicio = lineas.findIndex((l) => l === `${clave}:`);
  expect(inicio).toBeGreaterThanOrEqual(0);
  const claves: string[] = [];
  for (const linea of lineas.slice(inicio + 1)) {
    if (!linea.startsWith(" ")) break; // siguiente clave top-level
    const m = new RegExp(`^ {${hijo}}([A-Za-z_][A-Za-z0-9_-]*):`).exec(linea);
    if (m) claves.push(m[1]);
  }
  return claves;
}

describe("prod-demo.yml — sólo manual y con confirmación", () => {
  const lineas = lineasYaml(WORKFLOW);
  const texto = lineas.join("\n");

  it("se dispara ÚNICAMENTE por workflow_dispatch (sin schedule, push ni pull_request)", () => {
    expect(clavesDelBloque(lineas, "on", 2)).toEqual(["workflow_dispatch"]);
  });

  it("exige el input `confirm` y lo compara con la frase literal WRITE-DEMO-DATA", () => {
    expect(clavesDelBloque(lineas, "on", 2)).toContain("workflow_dispatch");
    expect(texto).toMatch(/inputs:\n\s+confirm:\n(?:\s+.*\n)*?\s+required: true/);
    expect(texto).toContain("CONFIRM: ${{ inputs.confirm }}");
    expect(texto).toContain('if [ "${CONFIRM}" != "WRITE-DEMO-DATA" ]; then');
  });

  it("la confirmación es el primer paso: falla antes del checkout y de los tests", () => {
    const pasos = texto.slice(texto.indexOf("steps:"));
    const confirmar = pasos.indexOf("WRITE-DEMO-DATA");
    expect(confirmar).toBeGreaterThan(-1);
    expect(confirmar).toBeLessThan(pasos.indexOf("actions/checkout@"));
    expect(confirmar).toBeLessThan(pasos.indexOf("playwright test"));
  });

  it("la confirmación no depende de que exista `app/` (corre antes del checkout)", () => {
    // `defaults.run.working-directory: app` aplica a TODO paso `run`. Antes del
    // checkout ese directorio no existe y el runner falla el paso, así que la
    // confirmación mataría cada dispatch, también el que trae la frase correcta
    // (hallazgo R3-confirm-step-workdir-before-checkout de la revisión nativa).
    const pasos = texto.slice(texto.indexOf("steps:"));
    const bloque = pasos.slice(
      pasos.indexOf("- name: Require the write confirmation"),
      pasos.indexOf("actions/checkout@"),
    );
    expect(texto).toMatch(/working-directory: app/);
    expect(bloque).toMatch(/working-directory: \.\s*$/m);
  });

  it("permisos mínimos y environment propio, no el del smoke", () => {
    expect(clavesDelBloque(lineas, "permissions", 2)).toEqual(["contents"]);
    expect(texto).toMatch(/permissions:\n {2}contents: read\n/);
    expect(texto).toContain("environment: prod-demo");
    expect(texto).not.toContain("prod-smoke");
  });

  it("lee sólo los secrets DEMO_USER y DEMO_PASSWORD", () => {
    const secrets = [...texto.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort();
    expect(secrets).toEqual(["DEMO_PASSWORD", "DEMO_USER"]);
  });

  it("las variables del environment son DEMO_BASE_URL y DEMO_EMPRESA_NAME", () => {
    const variables = [...texto.matchAll(/vars\.([A-Z_]+)/g)].map((m) => m[1]).sort();
    expect(variables).toEqual(["DEMO_BASE_URL", "DEMO_EMPRESA_NAME"]);
  });

  it("falla ante un test salteado con el guard existente y no sube artefactos", () => {
    expect(texto).toContain("node e2e/assert-no-skips.mjs prod-demo-results.json");
    expect(texto).not.toContain("upload-artifact");
  });

  it("fija los mismos SHAs de acción que prod-smoke.yml (ninguno nuevo sin revisar)", () => {
    const fijadas = (archivo: string) =>
      new Set(
        lineasYaml(archivo)
          .join("\n")
          .match(/uses: [\w./-]+@[0-9a-f]{40}/g) ?? [],
      );
    const smoke = fijadas(SMOKE_WORKFLOW);
    const demo = [...fijadas(WORKFLOW)];
    expect(demo.length).toBeGreaterThan(0);
    for (const accion of demo) expect(smoke).toContain(accion);
    // Toda acción externa va fijada a un commit (un tag movido es ejecución de código en CI).
    const externas = texto.match(/uses: (?!\.\/)\S+/g) ?? [];
    for (const uso of externas) expect(uso).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe("playwright.prod-demo.config.ts — sin trace, captura ni video", () => {
  const use = demoConfig.use ?? {};

  it("trace, screenshot y video están apagados", () => {
    expect(use.trace).toBe("off");
    expect(use.screenshot).toBe("off");
    expect(use.video).toBe("off");
  });

  it("corre serial, sin reintentos, se corta en el primer fallo y no levanta servidor", () => {
    expect(demoConfig.workers).toBe(1);
    expect(demoConfig.retries).toBe(0);
    expect(demoConfig.maxFailures).toBe(1);
    expect(demoConfig.webServer).toBeUndefined();
    expect(demoConfig.testDir).toBe("./e2e-prod-demo");
  });

  it("no hay bypass de protección de Vercel", () => {
    expect(JSON.stringify(demoConfig)).not.toMatch(/protection-bypass/i);
  });
});
