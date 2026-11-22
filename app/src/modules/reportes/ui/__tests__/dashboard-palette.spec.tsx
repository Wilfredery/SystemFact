/**
 * @jest-environment node
 *
 * Screen audit S6 (odd/tasks/screen-audit-fixes.md T3): the dashboard screen and its KPI tiles use
 * the F0 design-system tokens only (the same ones the wireframe-aligned boards use): no raw
 * Tailwind palette, no arbitrary colors and no `dark:` variants (F0 is light-only).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.join(__dirname, "..", "..", "..", "..");
const ARCHIVOS = ["app/(app)/dashboard/page.tsx", "modules/reportes/ui/dashboard-kpis.tsx"];

const RAW_PALETTE =
  /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;
const ARBITRARY_HEX = /(?:text|bg|border|ring)-\[(?:#|rgb|hsl|oklch)[^\]]+\]/g;
const DARK_VARIANT = /\bdark:[^\s"'`]+/g;

describe("dashboard — F0 tokens only (S6)", () => {
  it("keeps zero raw-palette classes, arbitrary colors and dark: variants", () => {
    const ofensas = ARCHIVOS.flatMap((archivo) => {
      const fuente = readFileSync(path.join(RAIZ, archivo), "utf8");
      return [
        ...(fuente.match(RAW_PALETTE) ?? []),
        ...(fuente.match(ARBITRARY_HEX) ?? []),
        ...(fuente.match(DARK_VARIANT) ?? []),
      ].map((c) => `${archivo}: ${c}`);
    });
    expect(ofensas).toEqual([]);
  });

  it("styles the role and error alerts with the warn and danger tokens", () => {
    const fuente = readFileSync(path.join(RAIZ, ARCHIVOS[0]), "utf8");
    expect(fuente).toMatch(/bg-warn-bg[^"]*text-warn|text-warn[^"]*bg-warn-bg/);
    expect(fuente).toMatch(/text-danger/);
  });
});
