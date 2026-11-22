/**
 * @jest-environment node
 *
 * Screen audit S6 (odd/tasks/screen-audit-fixes.md T5): NO component or page under `app/src` may use
 * the raw Tailwind palette, an arbitrary color or a `dark:` variant. The F0 design system is
 * light-only and every screen takes its colors from the tokens of the wireframe-aligned boards
 * (ink, ink-muted, surface, surface-muted, line, accent, warn, danger, success, link).
 *
 * This one app-wide scan replaces the per-screen "no raw palette" lists: a new file is covered
 * the moment it exists. Specs, tests and the generated Prisma client are not scanned.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "..", "..", "..");

function archivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const completo = path.join(dir, nombre);
    if (statSync(completo).isDirectory()) {
      return nombre === "generated" || nombre === "__tests__" || nombre === "node_modules"
        ? []
        : archivosTsx(completo);
    }
    return /\.tsx$/.test(nombre) && !/\.(spec|test)\.tsx$/.test(nombre) ? [completo] : [];
  });
}

const RAW_PALETTE =
  /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;
const ARBITRARY_COLOR = /(?:text|bg|border|ring|fill|stroke)-\[(?:#|rgb|hsl|oklch)[^\]]+\]/g;
const DARK_VARIANT = /\bdark:[^\s"'`]+/g;

describe("app-wide: F0 tokens only (S6)", () => {
  const archivos = archivosTsx(SRC);

  it("scans a meaningful set of files", () => {
    expect(archivos.length).toBeGreaterThan(60);
  });

  it("has zero raw-palette classes, arbitrary colors and dark: variants in any component or page", () => {
    const ofensas = archivos.flatMap((archivo) => {
      const fuente = readFileSync(archivo, "utf8");
      return [
        ...(fuente.match(RAW_PALETTE) ?? []),
        ...(fuente.match(ARBITRARY_COLOR) ?? []),
        ...(fuente.match(DARK_VARIANT) ?? []),
      ].map((c) => `${path.relative(SRC, archivo).split(path.sep).join("/")}: ${c}`);
    });
    // Group by file so a failure names the files to fix.
    const porArchivo = [...new Set(ofensas.map((o) => o.split(":")[0]))];
    expect(porArchivo).toEqual([]);
  });
});
