/**
 * Tests del guardián mecánico del version bump (S3).
 *
 * Runner: `node --test` (Node 24), no Jest. El script es ESM plano y el
 * `transform`/`testMatch` de app/jest.config.js no transforma `.mjs`, así que
 * una suite Jest no puede importarlo sin tocar esa config.
 *
 * Todo lo que se prueba acá es lógica pura: globs, clasificación de rutas y la
 * decisión (¿hace falta el bump?). El shell-out a `git` no necesita un repo
 * real con historia: sólo se cubre el camino de error (base sha ilegible), que
 * corre en un directorio temporal sin git.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import {
  EXEMPT_GLOBS,
  EXIT_USAGE,
  VERSION_FILES,
  evaluateVersionBump,
  exitCodeFor,
  globToRegExp,
  isExempt,
} from "./check-version-bump.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-version-bump.mjs");

describe("globToRegExp", () => {
  it("ancla el patrón: no acepta coincidencias parciales", () => {
    assert.equal(globToRegExp("docs/**").test("xdocs/a.ts"), false);
    assert.equal(globToRegExp("docs/**").test("docs/a.ts"), true);
  });

  it("'**/X' exime también en la raíz del repo (cero directorios)", () => {
    const md = globToRegExp("**/*.md");
    assert.equal(md.test("README.md"), true);
    assert.equal(md.test("docs/a.md"), true);
    assert.equal(md.test("app/src/deep/dir/notes.md"), true);
    assert.equal(md.test("docs/a.ts"), false);
    assert.equal(md.test("docs/a.md.bak"), false);
  });

  it("'dir/**' cubre todo lo que está debajo del directorio, no el directorio", () => {
    const docs = globToRegExp("docs/**");
    assert.equal(docs.test("docs/a.ts"), true);
    assert.equal(docs.test("docs/a/b/c.ts"), true);
    assert.equal(docs.test("docs-other/a.ts"), false);
    assert.equal(docs.test("app/docs/a.ts"), false);
  });

  it("'*' no cruza separadores de directorio", () => {
    const star = globToRegExp("*");
    assert.equal(star.test("README.md"), true);
    assert.equal(star.test("app/README.md"), false);
    const readme = globToRegExp("README*");
    assert.equal(readme.test("README.md"), true);
    assert.equal(readme.test("README"), true);
    assert.equal(readme.test("app/README.md"), false);
    assert.equal(readme.test("READMEs/x.md"), false);
  });

  it("'?' coincide con exactamente un carácter", () => {
    const q = globToRegExp("LICENSE?");
    assert.equal(q.test("LICENSE2"), true);
    assert.equal(q.test("LICENSE"), false);
    assert.equal(q.test("LICENSE22"), false);
  });

  it("escapa los metacaracteres de regex del patrón", () => {
    const dotted = globToRegExp("a.b");
    assert.equal(dotted.test("a.b"), true);
    assert.equal(dotted.test("axb"), false);
    const plus = globToRegExp("a+b");
    assert.equal(plus.test("a+b"), true);
    assert.equal(plus.test("aab"), false);
  });

  it("los estilos de test se eximen en las cuatro extensiones", () => {
    const cases = [
      { pattern: "**/*.test.ts", matches: ["a.test.ts", "app/src/deep/a.test.ts"], rejects: ["a.spec.ts", "a.test.tsx", "a.testXts"] },
      { pattern: "**/*.test.tsx", matches: ["a.test.tsx", "app/a.test.tsx"], rejects: ["a.test.ts", "a.spec.tsx"] },
      { pattern: "**/*.spec.ts", matches: ["a.spec.ts", "app/src/a.spec.ts"], rejects: ["a.test.ts", "a.spec.tsx"] },
      { pattern: "**/*.spec.tsx", matches: ["a.spec.tsx", "app/src/a.spec.tsx"], rejects: ["a.spec.ts", "a.test.tsx"] },
    ];
    for (const { pattern, matches, rejects } of cases) {
      const re = globToRegExp(pattern);
      for (const path of matches) {
        assert.equal(re.test(path), true, `${pattern} coincide con ${path}`);
      }
      for (const path of rejects) {
        assert.equal(re.test(path), false, `${pattern} no coincide con ${path}`);
      }
    }
  });
});

describe("isExempt (S3: los globs exentos de AGENTS.md)", () => {
  const exempt = [
    "README.md",
    "LICENSE",
    "LICENSE-CODE",
    "docs/19-directivas_desarrollo.md",
    "docs/deep/nested/plan.yml",
    "odd/tasks/csp-reporting-and-bump-guard.md",
    "app/CHANGELOG.md",
    "app/README.md",
    "app/src/modules/venta/domain/venta.test.ts",
    "app/src/app/(app)/page.spec.tsx",
    "app/tools/scripts/check-version-bump.mjs",
    "app/tools/ci/check-conventional-commits.ts",
  ];

  const notExempt = [
    ".github/workflows/ci.yml",
    ".github/actions/setup-project/action.yml",
    "app/src/proxy.ts",
    "app/src/app/(app)/page.tsx",
    "app/prisma/schema.prisma",
    "app/package.json",
    "app/pnpm-lock.yaml",
    ".release-please-manifest.json",
    "README.not-md/x.ts",
  ];

  for (const path of exempt) {
    it(`exime ${path}`, () => {
      assert.equal(isExempt(path), true);
    });
  }

  for (const path of notExempt) {
    it(`NO exime ${path}`, () => {
      assert.equal(isExempt(path), false);
    });
  }

  it("los globs exentos son exactamente los de la spec (S3)", () => {
    assert.deepEqual(EXEMPT_GLOBS, [
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
    ]);
  });

  it("los archivos de versión son exactamente los tres de AGENTS.md", () => {
    assert.deepEqual(VERSION_FILES, [
      "app/package.json",
      ".release-please-manifest.json",
      "app/CHANGELOG.md",
    ]);
  });
});

describe("evaluateVersionBump (S3: la decisión)", () => {
  it("deja pasar un PR que sólo cambia rutas exentas (provable por test)", () => {
    const result = evaluateVersionBump([
      "docs/19-directivas_desarrollo.md",
      "odd/tasks/csp-reporting-and-bump-guard.md",
      "README.md",
      "app/tools/scripts/check-version-bump.mjs",
      "app/src/modules/venta/domain/venta.test.ts",
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.releaseAffectingPaths, []);
    assert.deepEqual(result.versionFilesChanged, []);
    assert.equal(exitCodeFor(result), 0);
    assert.match(result.message, /exent/i);
    assert.equal(result.message.includes("\n"), false, "el mensaje de éxito es una sola línea");
  });

  it("deja pasar un PR sin cambios", () => {
    const result = evaluateVersionBump([]);
    assert.equal(result.ok, true);
    assert.equal(exitCodeFor(result), 0);
  });

  it("falla cuando cambia una ruta no exenta y ningún archivo de versión cambió", () => {
    const result = evaluateVersionBump([
      ".github/workflows/ci.yml",
      "app/src/proxy.ts",
      "docs/plan.md",
    ]);
    assert.equal(result.ok, false);
    assert.equal(exitCodeFor(result), 1);
    assert.deepEqual(result.releaseAffectingPaths, [
      ".github/workflows/ci.yml",
      "app/src/proxy.ts",
    ]);
  });

  it("el mensaje de fallo nombra cada ruta ofensora y los tres archivos de versión", () => {
    const result = evaluateVersionBump([
      ".github/workflows/ci.yml",
      "app/src/proxy.ts",
      "docs/plan.md",
    ]);
    assert.match(result.message, /\.github\/workflows\/ci\.yml/);
    assert.match(result.message, /app\/src\/proxy\.ts/);
    assert.equal(result.message.includes("docs/plan.md"), false, "no nombra rutas exentas");
    for (const file of VERSION_FILES) {
      assert.equal(result.message.includes(file), true, `menciona ${file}`);
    }
  });

  for (const versionFile of ["app/package.json", ".release-please-manifest.json", "app/CHANGELOG.md"]) {
    it(`deja pasar un cambio no exento cuando ${versionFile} cambió`, () => {
      const result = evaluateVersionBump([".github/workflows/ci.yml", versionFile]);
      assert.equal(result.ok, true);
      assert.equal(exitCodeFor(result), 0);
      assert.deepEqual(result.versionFilesChanged, [versionFile]);
      assert.deepEqual(result.releaseAffectingPaths, [".github/workflows/ci.yml"]);
      assert.match(result.message, new RegExp(versionFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    });
  }

  it("un archivo de versión sin cambios no exentos no exige nada", () => {
    const result = evaluateVersionBump(["app/package.json"]);
    assert.equal(result.ok, true);
    assert.equal(exitCodeFor(result), 0);
    assert.deepEqual(result.releaseAffectingPaths, []);
    assert.deepEqual(result.versionFilesChanged, ["app/package.json"]);
  });

  it("reporta cada archivo de versión tocado, no sólo el primero", () => {
    const result = evaluateVersionBump([
      "app/package.json",
      ".release-please-manifest.json",
      "app/CHANGELOG.md",
      "app/src/proxy.ts",
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.versionFilesChanged, VERSION_FILES);
  });

  it("preserva el orden de las rutas tal como las entrega git", () => {
    const changed = ["app/src/b.ts", "app/src/a.ts"];
    const result = evaluateVersionBump(changed);
    assert.deepEqual(result.releaseAffectingPaths, changed);
  });
});

describe("CLI", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "version-bump-guard-"));
  after(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("sale con código de uso (2) y explica el uso cuando falta el base sha", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { cwd: sandbox, encoding: "utf8" });
    assert.equal(run.status, EXIT_USAGE);
    assert.match(run.stderr, /<base-sha>/);
    assert.equal(run.stdout, "");
  });

  it("sale con código de uso (2) cuando git no puede leer la base sha", () => {
    // El sandbox es un directorio temporal fuera del repo: git falla sin
    // necesidad de una historia real (ni de un repo real).
    const run = spawnSync(process.execPath, [SCRIPT, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"], {
      cwd: sandbox,
      encoding: "utf8",
    });
    assert.equal(run.status, EXIT_USAGE);
    assert.match(run.stderr, /git/i);
  });
});
