/**
 * @jest-environment jsdom
 *
 * Screen-audit PR-A (odd/tasks/screen-audit-fixes.md S1, S2, S3, S5):
 * the root redirect, the branded boundaries (404 / error / loading), their F0-token-only
 * source gate, the caja PDF link opting out of prefetch and the Spanish POS heading.
 */

import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import Home from "./page";
import NotFound from "./not-found";
import AppLoading from "./(app)/loading";
import { ErrorPanel } from "@/shared/ui/error-panel";

const redirect = jest.fn((destino: string): never => {
  throw new Error(`NEXT_REDIRECT:${destino}`);
});
jest.mock("next/navigation", () => ({ redirect: (d: string) => redirect(d) }));
const connection = jest.fn(async () => undefined);
jest.mock("next/server", () => ({ connection: () => connection() }));

const RAIZ = path.join(__dirname, "..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

describe("root path (S1)", () => {
  it("redirects to /login and renders no starter template", () => {
    expect(() => Home()).toThrow("NEXT_REDIRECT:/login");
    expect(leer("app/page.tsx")).not.toMatch(/next\.svg|create-next-app|To get started/);
  });
});

describe("branded boundaries (S2)", () => {
  it("not-found: Spanish heading, link home, and opts into per-request rendering (CSP nonce)", async () => {
    render(await NotFound());
    expect(screen.getByRole("heading", { level: 1, name: "Página no encontrada" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it("error panel: retry calls reset, shows only the opaque digest, never the message", () => {
    const reset = jest.fn();
    render(<ErrorPanel digest="abc123" onRetry={reset} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });

  it("error panel without a digest shows no reference line", () => {
    render(<ErrorPanel onRetry={jest.fn()} />);
    expect(screen.queryByText(/Código de referencia/)).toBeNull();
  });

  it("the error boundaries never read error.message or error.stack", () => {
    for (const f of ["app/error.tsx", "app/(app)/error.tsx", "app/global-error.tsx"]) {
      expect(leer(f)).not.toMatch(/error\.(message|stack)/);
    }
  });

  it("loading: announces a busy status in Spanish", () => {
    render(<AppLoading />);
    const estado = screen.getByRole("status");
    expect(estado).toHaveAttribute("aria-busy", "true");
    expect(estado).toHaveTextContent("Cargando…");
  });

  it("keeps zero raw-palette classes in the boundary sources", () => {
    const RAW_PALETTE =
      /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;
    const ARBITRARY_HEX = /(?:text|bg|border|ring)-\[(?:#|rgb|hsl|oklch)[^\]]+\]/g;
    const archivos = [
      "app/page.tsx",
      "app/not-found.tsx",
      "app/error.tsx",
      "app/global-error.tsx",
      "app/(app)/error.tsx",
      "app/(app)/loading.tsx",
      "shared/ui/error-panel.tsx",
    ];
    const ofensas = archivos.flatMap((f) => {
      const fuente = leer(f);
      return [...(fuente.match(RAW_PALETTE) ?? []), ...(fuente.match(ARBITRARY_HEX) ?? [])].map((c) => `${f}: ${c}`);
    });
    expect(ofensas).toEqual([]);
  });
});

describe("caja PDF link (S3) and POS heading (S5)", () => {
  it("Exportar PDF opts out of Next's prefetch (the _rsc request hung on every page view)", () => {
    expect(leer("modules/caja/ui/CajaScreen.tsx")).toMatch(/href=\{RUTA_CIERRE_PDF\}[\s\S]{0,260}prefetch=\{false\}/);
  });

  it("the POS heading is Spanish", () => {
    const fuente = leer("modules/venta/ui/PosScreen.tsx");
    expect(fuente).toContain("Punto de venta");
    expect(fuente).not.toContain("Point of sale");
  });
});
