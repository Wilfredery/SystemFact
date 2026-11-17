#!/usr/bin/env node
/**
 * Guardián mecánico del version bump (AGENTS.md, convención de release
 * 2026-09-18 / amendment 2026-11-04, spec S3 en
 * odd/tasks/csp-reporting-and-bump-guard.md).
 *
 * Regla: un PR que cambia algo capaz de alterar el artefacto construido o el
 * pipeline de entrega debe subir la versión (app/package.json +
 * .release-please-manifest.json + app/CHANGELOG.md, al menos uno de los tres).
 * Todo lo demás es exento y nunca falla: docs, odd, markdown, README/LICENSE,
 * tests y las propias herramientas (app/tools/**).
 *
 * Uso:
 *   node tools/scripts/check-version-bump.mjs <base-sha>
 *
 * Sale 0 si el PR no necesita bump o si al menos un archivo de versión cambió;
 * 1 si cambió una ruta no exenta y ningún archivo de versión cambió; 2 si no
 * se pudo leer el diff (argumento faltante, sha inexistente, repo shallow...).
 *
 * ESM plano, sin dependencias: lo corre el job `version-bump` de ci.yml con el
 * Node de `engines`, sin `tsx`. Las funciones puras de abajo son las que prueba
 * check-version-bump.test.mjs; el único shell-out (`git diff`) no aparece en
 * los tests salvo por su camino de error.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Globs exentos, exactamente los de AGENTS.md + S3 (orden de la spec). */
export const EXEMPT_GLOBS = [
  "docs/**",
  "odd/**",
  "**/*.md",
  "README*",
  "LICENSE*",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "app/tools/**",
];

/** Los tres archivos que debe tocar el PR para satisfacer el bump. */
export const VERSION_FILES = [
  "app/package.json",
  ".release-please-manifest.json",
  "app/CHANGELOG.md",
];

/** Código de salida cuando el diff no se pudo leer (error de entorno, no de PR). */
export const EXIT_USAGE = 2;

const REGEX_METACHARS = /[.*+?^${}()|[\]\\]/g;

/**
 * Traduce un glob estilo gitignore a RegExp anclada.
 *
 * - `**\/` = cero o más directorios (`**\/*.md` exime `README.md` de la raíz).
 * - `**`  = cualquier cosa, separadores incluidos.
 * - `*`   = cualquier cosa sin cruzar `/`.
 * - `?`   = exactamente un carácter que no sea `/`.
 *
 * Un patrón sin `/` se ancla a la raíz del repo (`README*` es el README de la
 * raíz, no `app/README.md` de cualquier nivel), igual que en gitignore.
 */
export function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] !== "*") {
        source += "[^/]*";
        continue;
      }
      if (glob[i + 2] === "/") {
        // `**/` → cero o más directorios.
        source += "(?:.*/)?";
        i += 2;
        continue;
      }
      // `**` (o `**` al final) → todo.
      source += ".*";
      i += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(REGEX_METACHARS, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

const EXEMPT_MATCHERS = EXEMPT_GLOBS.map(globToRegExp);

/** ¿La ruta es exenta? (ruta relativa a la raíz del repo, separador `/`). */
export function isExempt(path) {
  return EXEMPT_MATCHERS.some((matcher) => matcher.test(path));
}

/**
 * Decisión pura del guardián sobre una lista de rutas cambiadas.
 *
 * Devuelve `ok` (¿el PR cumple?), las rutas que importan, los archivos de
 * versión tocados y un mensaje listo para imprimir.
 */
export function evaluateVersionBump(changedPaths) {
  const paths = changedPaths.filter((path) => typeof path === "string" && path.length > 0);
  // Los archivos de versión son el bump: no cuentan como rutas que lo exigen.
  const versionFilesChanged = paths.filter((path) => VERSION_FILES.includes(path));
  const releaseAffectingPaths = paths.filter(
    (path) => !isExempt(path) && !VERSION_FILES.includes(path),
  );

  if (releaseAffectingPaths.length === 0) {
    return {
      ok: true,
      releaseAffectingPaths,
      versionFilesChanged,
      message:
        `OK: las ${paths.length} ruta(s) cambiada(s) son exentas (docs/odd/markdown/README/LICENSE/tests/app/tools): ` +
        "no hace falta subir la versión.",
    };
  }

  if (versionFilesChanged.length === 0) {
    return {
      ok: false,
      releaseAffectingPaths,
      versionFilesChanged,
      message: [
        "Falta el version bump: este PR cambia rutas que pueden alterar el artefacto",
        "construido o el pipeline de entrega, y ninguno de los tres archivos de versión cambió.",
        "",
        "Rutas que exigen bump:",
        ...releaseAffectingPaths.map((path) => `  - ${path}`),
        "",
        "Archivos de versión (al menos uno debe cambiar):",
        ...VERSION_FILES.map((path) => `  - ${path}`),
        "",
        "Regla completa: AGENTS.md, Release convention (2026-09-18, maintainer-approved).",
      ].join("\n"),
    };
  }

  return {
    ok: true,
    releaseAffectingPaths,
    versionFilesChanged,
    message:
      `OK: ${releaseAffectingPaths.length} ruta(s) con impacto de artefacto y version bump presente ` +
      `(${versionFilesChanged.join(", ")}).`,
  };
}

/** Mapea la decisión al código de salida del CLI. */
export function exitCodeFor(result) {
  return result.ok ? 0 : 1;
}

/**
 * Rutas relativas a la raíz del repo entre `baseSha` y HEAD.
 *
 * `git diff` ya emite rutas relativas a la raíz del working tree aunque se
 * invoque desde un subdirectorio (ci.yml corre con working-directory: app), así
 * que no hace falta normalizar nada. `--no-renames` mantiene el reporte en un
 * movimiento = dos rutas, que es justo lo que la regla necesita ver.
 */
export function readChangedPaths(baseSha, options = {}) {
  const output = execFileSync(
    "git",
    ["-c", "core.quotepath=false", "diff", "--name-only", "--no-renames", baseSha, "HEAD"],
    { cwd: options.cwd, encoding: "utf8" },
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function main(argv) {
  const baseSha = argv[2];
  if (baseSha === undefined || baseSha.length === 0 || baseSha.startsWith("--")) {
    console.error(
      "Uso: node tools/scripts/check-version-bump.mjs <base-sha>\n" +
        "  <base-sha> = github.event.pull_request.base.sha (el diff se calcula contra HEAD).",
    );
    return EXIT_USAGE;
  }

  let changedPaths;
  try {
    changedPaths = readChangedPaths(baseSha);
  } catch (error) {
    console.error(
      `No se pudo leer el diff de git entre '${baseSha}' y HEAD: ${String(error)}`,
    );
    return EXIT_USAGE;
  }

  const result = evaluateVersionBump(changedPaths);
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(result.message);
  }
  return exitCodeFor(result);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
