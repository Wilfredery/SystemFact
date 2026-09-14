/**
 * Guardián de Conventional Commits — CLI para CI y uso local.
 *
 * Uso:
 *   pnpm exec tsx tools/ci/check-conventional-commits.ts --from origin/master --to HEAD
 *   pnpm exec tsx tools/ci/check-conventional-commits.ts   # audita TODA la historia de HEAD
 *
 * El rango es exclusivo en `--from` y inclusivo en `--to`, igual que
 * `git log <from>..<to>`. Sin `--from` se audita todo lo alcanzable desde
 * `--to` (útil para revisar la historia). Los merge commits se ignoran
 * (`--no-merges`): el contenido del PR son sus commits individuales, no el
 * merge.
 *
 * Códigos de salida: 0 = todos cumplen, 1 = hay commits inválidos,
 * 2 = no se pudo leer el historial (rango inexistente, repo shallow, etc.).
 */

import { execFileSync } from "node:child_process";

import {
  formatearReporte,
  parsearGitLog,
  validarCommits,
} from "./conventional-commits";

function leerArgumento(nombre: string): string | undefined {
  const indice = process.argv.indexOf(nombre);
  if (indice === -1) {
    return undefined;
  }
  const valor = process.argv[indice + 1];
  if (valor === undefined || valor.startsWith("--")) {
    return undefined;
  }
  return valor;
}

const desde = leerArgumento("--from");
const hasta = leerArgumento("--to") ?? "HEAD";
const rango = desde === undefined ? hasta : desde + ".." + hasta;

let salida = "";
try {
  salida = execFileSync(
    "git",
    ["log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", rango],
    { encoding: "utf8" },
  );
} catch (error) {
  console.error(
    "No se pudo leer el historial de git para el rango '" + rango + "': " + String(error),
  );
  process.exit(2);
}

const commits = parsearGitLog(salida);
const invalidos = validarCommits(commits);

if (invalidos.length > 0) {
  console.error(formatearReporte(invalidos, commits.length));
  process.exit(1);
}

console.log(
  "OK: " + commits.length + " commit(s) en '" + rango + "' cumplen Conventional Commits.",
);
