/**
 * Falla el job de CI cuando la suite E2E se saltea tests.
 *
 * ¿Por qué existe? Un job verde que saltea tests es peor que uno rojo: lee como
 * cobertura. Pasó de verdad: con el cliente CREDITO demo sin sembrar, tres specs
 * hacían `test.skip(...)` por precondición y el job reportaba éxito habiendo
 * ejecutado 9 de 12 tests. Playwright no tiene fail-on-skip nativo, así que se
 * lee el reporte JSON y se decide acá.
 *
 * En CI los secretos E2E siempre existen (el job no corre si faltan), por eso
 * cualquier skip es inesperado: no hay caso legítimo.
 *
 * También protege contra dos falsos verdes: un reporte estructuralmente válido
 * con `stats.expected === 0` (el run no matcheó NADA y no es un pase) y un
 * reporte faltante o ilegible (un `JSON.parse` crasheado no explica qué falló).
 *
 * Uso: node e2e/assert-no-skips.mjs e2e-results.json
 */

import fs from "node:fs";

const reportPath = process.argv[2] ?? "e2e-results.json";

/** Recorre el árbol de suites del reporte Playwright y junta los skips. */
function skips(node, out) {
  for (const spec of node.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const status = test.results?.at(-1)?.status ?? test.status;
      if (status === "skipped") {
        out.push(`${spec.file ?? "?"}:${spec.line ?? "?"} › ${spec.title ?? "?"}`);
      }
    }
  }
  for (const child of node.suites ?? []) skips(child, out);
  return out;
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch {
  console.error(
    `FAIL: no se pudo leer/parsear el reporte E2E en "${reportPath}". ` +
      "El paso 'Run the confirm smoke' del workflow lo genera con " +
      "`pnpm exec playwright test --reporter=list,json` y la variable " +
      "`PLAYWRIGHT_JSON_OUTPUT_NAME=e2e-results.json`; revisá que ese paso " +
      "corrió y que el archivo existe y es JSON válido.",
  );
  process.exit(1);
}

const skipped = (report.suites ?? []).flatMap((suite) => skips(suite, []));
const stats = report.stats ?? {};
// `stats.expected` is the number of tests Playwright EXPECTED to run, not the
// number executed: a run where every test skipped still reports a nonzero
// `expected`. This check therefore targets the empty/malformed report (no
// tests at all), and the skip branch below covers the fully-skipped run.
const expected = stats.expected ?? 0;

if (expected === 0) {
  console.error(
    "FAIL: the report contains no tests at all (stats.expected = 0) — an empty run is not a pass.",
  );
  process.exit(1);
}

if (skipped.length === 0) {
  console.log(`OK: ${expected} test(s) ejecutados, 0 salteados.`);
  process.exit(0);
}

console.error(
  `FAIL: ${skipped.length} test(s) salteados en CI. Un skip esconde cobertura: ` +
    "sembrá la precondición que falta (p. ej. .github/ci/e2e-fixture.sql) en vez de dejarlo pasar.",
);
for (const title of skipped) console.error(`  - ${title}`);
process.exit(1);
