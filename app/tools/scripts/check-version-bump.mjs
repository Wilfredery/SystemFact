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

/**
 * Globs exentos: la lista de AGENTS.md (Release convention, enmienda 2026-11-04) más la paridad
 * de extensiones de test `.test.tsx`/`.spec.tsx` (enmienda del owner 2026-11-17: el proyecto
 * tiene suites RTL .test.tsx y la regla exime a los tests, no a una extensión).
 */
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
 * raíz, no `app/README.md` de cualquier nivel). Esto es MÁS estricto que
 * gitignore, donde un patrón sin `/` coincide en cualquier profundidad; la
 * regla de AGENTS.md («README*», «LICENSE*») nombra los de la raíz, y este
 * guardián prefiere fallar a exigir un bump de más que a eximir de menos.
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
 * Compara dos versiones semver ("0.36.2"). Numérico por componente; devuelve
 * > 0, 0 o < 0. Un componente ausente cuenta como 0.
 */
export function compareVersions(a, b) {
  const pa = String(a ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * La versión aumentó de base a head Y el manifest coincide con la de head.
 * Valores nulos/ausentes nunca cuentan como bump.
 */
export function versionIncreased(versions) {
  if (!versions) return false;
  const { pkgBase, pkgHead, manifestBase, manifestHead } = versions;
  if (
    typeof pkgBase !== "string" ||
    typeof pkgHead !== "string" ||
    pkgBase.length === 0 ||
    pkgHead.length === 0
  ) {
    return false;
  }
  return compareVersions(pkgHead, pkgBase) > 0 && manifestHead === pkgHead;
}

/**
 * Decisión pura del guardián sobre una lista de rutas cambiadas.
 *
 * El segundo argumento es la evidencia de versión leída por el CLI con `git
 * show` en la base y en HEAD (`null` cuando el archivo no existía). Es
 * obligatorio: el guardián exige que la versión AUMENTE, no que un archivo de
 * versión se toque (así una edición de un byte al CHANGELOG y un cambio sólo
 * en campos runtime de app/package.json ya no escapan sin bump).
 *
 * Devuelve `ok` (¿el PR cumple?), las rutas que importan, los archivos de
 * versión tocados y un mensaje listo para imprimir.
 */
export function evaluateVersionBump(changedPaths, versions) {
  if (
    !versions ||
    typeof versions !== "object" ||
    !("pkgBase" in versions) ||
    !("pkgHead" in versions) ||
    !("manifestBase" in versions) ||
    !("manifestHead" in versions)
  ) {
    throw new Error(
      "evaluateVersionBump requiere evidencia de versión: " +
        "{ pkgBase, pkgHead, manifestBase, manifestHead } leídos de la base y de HEAD.",
    );
  }
  const paths = changedPaths.filter((path) => typeof path === "string" && path.length > 0);
  const versionFilesChanged = paths.filter((path) => VERSION_FILES.includes(path));
  const bumped = versionIncreased(versions);

  if (
    bumped === false &&
    [versions.pkgBase, versions.pkgHead, versions.manifestBase, versions.manifestHead].some(
      (value) => value === null,
    )
  ) {
    return {
      ok: false,
      releaseAffectingPaths: paths.filter((path) => !isExempt(path)),
      versionFilesChanged,
      message:
        "No se pudo leer la evidencia de versión con git show (alguna ref o archivo no existe); " +
        "el guardián no puede verificar el bump, así que falla en lugar de dejar pasar.",
    };
  }
  // Con el bump presente, los tres archivos de versión SON el bump y no exigen
  // nada más. Sin bump, app/package.json y el manifest cuentan como rutas que
  // lo exigen (pueden llevar cambios runtime que el artefacto sí consume).
  const versionFilesExcused = bumped ? VERSION_FILES : VERSION_FILES.filter(
    (path) => path !== "app/package.json" && path !== ".release-please-manifest.json",
  );
  const releaseAffectingPaths = paths.filter(
    (path) => !isExempt(path) && !versionFilesExcused.includes(path),
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

  if (!bumped) {
    return {
      ok: false,
      releaseAffectingPaths,
      versionFilesChanged,
      message: [
        `Falta el version bump: la versión era ${versions.pkgBase} en la base y es ${versions.pkgHead} en HEAD`,
        `(manifest: ${versions.manifestBase} -> ${versions.manifestHead}); el PR cambia rutas que pueden`,
        "alterar el artefacto construido o el pipeline de entrega, y la versión NO aumentó.",
        "",
        "Rutas que exigen bump:",
        ...releaseAffectingPaths.map((path) => `  - ${path}`),
        "",
        "El bump exige: versión en app/package.json estrictamente mayor en HEAD que en la base,",
        "y .release-please-manifest.json coincidiendo con la nueva versión.",
        "Regla completa: AGENTS.md, Release convention (2026-09-18 + amendments).",
      ].join("\n"),
    };
  }

  return {
    ok: true,
    releaseAffectingPaths,
    versionFilesChanged,
    message:
      `OK: ${releaseAffectingPaths.length} ruta(s) con impacto de artefacto y version bump presente ` +
      `(${versions.pkgBase} -> ${versions.pkgHead}).`,
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
    ["-c", "core.quotepath=false", "diff", "--name-only", "--no-renames", "-z", baseSha, "HEAD"],
    { cwd: options.cwd, encoding: "utf8" },
  );
  // `-z` (NUL-separated) es la salida máquina de git: sin ella git C-escapa
  // rutas con comillas, backslashes o caracteres de control incluso con
  // core.quotepath=false, y un `.trim()` se comería espacios reales de un
  // nombre. Con `-z` no hay comillas que des-escapar y NUL no aparece en
  // nombres de archivo.
  return parseChangedPaths(output);
}

/** Parseo puro de la salida `--name-only -z` de git (probable sin repo). */
export function parseChangedPaths(raw) {
  // Sin `.trim()`: con NUL-separación no hay relleno que quitar y un trim se
  // comería espacios reales del nombre de un archivo.
  return raw.split("\0").filter((line) => line.length > 0);
}

/**
 * Lee el campo `version` de un archivo JSON en una ref vía `git show`.
 * Devuelve `null` cuando la ref o el archivo no existen — el CLI distingue ese
 * caso del error de entorno y el guardián nunca cuenta un `null` como bump.
 */
export function readVersionAt(ref, file, options = {}) {
  // El manifest usa la clave "app"; package.json usa "version".
  const key = file.includes("manifest") ? "app" : "version";
  try {
    const output = execFileSync(
      "git",
      ["show", `${ref}:${file}`],
      { cwd: options.cwd, encoding: "utf8" },
    );
    const parsed = JSON.parse(output.replace(/^\uFEFF/, ""));
    const version = parsed?.[key];
    return typeof version === "string" ? version : null;
  } catch (error) {
    // execFileSync marca el fallo de git con status != 0: ref o archivo
    // inexistente en esa ref. Otros errores (git roto) se relanzan.
    if (typeof error?.status === "number" && error.status !== 0) return null;
    throw error;
  }
}

function main(argv) {
  const baseRef = argv[2];
  if (baseRef === undefined || baseRef.length === 0 || baseRef.startsWith("--")) {
    console.error(
      "Uso: node tools/scripts/check-version-bump.mjs <base-ref>\n" +
        "  <base-ref> = origin/${{ github.base_ref }} (el diff y las versiones se leen contra HEAD).",
    );
    return EXIT_USAGE;
  }

  let changedPaths;
  try {
    changedPaths = readChangedPaths(baseRef);
  } catch (error) {
    console.error(
      `No se pudo leer el diff de git entre '${baseRef}' y HEAD: ${String(error)}`,
    );
    return EXIT_USAGE;
  }

  let versions;
  try {
    versions = {
      pkgBase: readVersionAt(baseRef, "app/package.json"),
      pkgHead: readVersionAt("HEAD", "app/package.json"),
      manifestBase: readVersionAt(baseRef, ".release-please-manifest.json"),
      manifestHead: readVersionAt("HEAD", ".release-please-manifest.json"),
    };
  } catch (error) {
    console.error(`No se pudo leer la evidencia de versión con git show: ${String(error)}`);
    return EXIT_USAGE;
  }

  const result = evaluateVersionBump(changedPaths, versions);
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
