/**
 * @jest-environment jsdom
 *
 * Board 06 (Caja) UI alignment tests — odd/tasks/uiux-alignment.md S31–S33.
 *
 * S31 (F1): no raw-palette classes remain in the caja UI — every color routes
 * through the system.md tokens (`--ink`, `--surface`, `--line`, `--danger`,
 * `--accent`), matching the boards 02–05 retrofit.
 *
 * S32 (D2): the actions row reads as the wireframe pair — "Cerrar caja"
 * disabled (derived report, never stored) and "Exportar PDF" as the outlined
 * action, both token-styled.
 *
 * S33 (D1): no date control exists on either board — the day is server-
 * derived in America/Santo_Domingo (kept beyond-wireframe decision).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { CajaScreen } from "../CajaScreen";
import type { CierreDiarioDto, ResumenDiaDto } from "@/modules/caja/http/shared";

jest.mock("@/shared/ui/format", () => ({
  formatearFechaSD: (v: string) => v,
  formatearMonto: (v: string) => `RD$ ${v}`,
}));

const CIERRE_VACIO: CierreDiarioDto = {
  fechaSD: "2026-11-20",
  totalFacturado: "0.00",
  totalCobrado: "0.00",
  efectivoEsperado: "0.00",
  diferencia: "0.00",
  metodos: [{ metodo: "EFECTIVO", cobros: "0.00", cantidad: 0 }],
  corte: { cobros: "0.00", devoluciones: "0.00" },
};

const RESUMEN_VACIO: ResumenDiaDto = {
  fechaSD: "2026-11-20",
  ventas: "0.00",
  costoVendido: "0.00",
  margenBruto: "0.00",
  margenPorcentaje: "0.0",
};

/** Token-exact class assertion (JD round 1: substring `toContain("text-ink")`
 *  also matches `text-ink-muted`). */
function tieneClaseExacta(clases: string, token: string): boolean {
  return clases.split(/\s+/).includes(token);
}

describe("Board 06 — F0 token retrofit (S31)", () => {
  const RAIZ = path.join(__dirname, "..");

  const FILES = ["CajaScreen.tsx", "caja-formato.ts", path.join(RAIZ, "../../../app/(app)/caja/page.tsx")];

  const RAW_PALETTE =
    /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\s"'`]*/g;

  const ARBITRARY_HEX = /(?:text|bg|border|ring)-\[(?:#|rgb|hsl|oklch)[^\]]+\]/g;

  it("keeps zero raw-palette classes in the caja UI files", () => {
    const ofensas = FILES.flatMap((archivo) => {
      const fuente = readFileSync(path.isAbsolute(archivo) ? archivo : path.join(RAIZ, archivo), "utf8");
      const coincidencias = [
        ...(fuente.match(RAW_PALETTE) ?? []),
        ...(fuente.match(ARBITRARY_HEX) ?? []),
      ];
      return coincidencias.map((c) => `${archivo}: ${c}`);
    });
    expect(ofensas).toEqual([]);
  });

  it("styles a negative Diferencia with the danger token", () => {
    render(
      <CajaScreen
        cierre={{ ...CIERRE_VACIO, diferencia: "-150.00" }}
        resumen={RESUMEN_VACIO}
        alcanceNombre="Colmado El Sol · Sucursal Central"
      />,
    );
    const valor = screen.getByTestId("caja-kpi-diferencia");
    expect(tieneClaseExacta(valor.className, "text-danger")).toBe(true);
    // JD-A HIGH: the negative variant must NOT carry text-ink — both are
    // single-class colour utilities and text-ink would win in the compiled CSS.
    expect(tieneClaseExacta(valor.className, "text-ink")).toBe(false);
    // Formatting coverage (grouping/padding) lives in caja-screen.spec; this
    // spec's mock is a pass-through (JD-B-003).
    expect(valor.textContent).toContain("-RD$ 150.00");
  });
});

describe("Board 06 — actions row (S32)", () => {
  it("keeps Cerrar caja disabled with the Próximamente hint", () => {
    render(
      <CajaScreen cierre={CIERRE_VACIO} resumen={RESUMEN_VACIO} alcanceNombre="Empresa" />,
    );
    const boton = screen.getByRole("button", { name: "Cerrar caja" });
    expect(boton).toBeDisabled();
    expect(screen.getByTestId("caja-cerrar-hint")).toHaveTextContent("Próximamente");
  });

  it("renders Exportar PDF as an outlined token action", () => {
    render(
      <CajaScreen cierre={CIERRE_VACIO} resumen={RESUMEN_VACIO} alcanceNombre="Empresa" />,
    );
    const enlace = screen.getByRole("link", { name: "Exportar PDF" });
    expect(enlace).toHaveAttribute("href", expect.stringContaining("cierre-pdf"));
    expect(tieneClaseExacta(enlace.className, "border-line")).toBe(true);
    expect(tieneClaseExacta(enlace.className, "text-ink")).toBe(true);
  });
});

describe("Board 06 — no date control (S33)", () => {
  it("renders no date input on either board", () => {
    render(
      <CajaScreen cierre={CIERRE_VACIO} resumen={RESUMEN_VACIO} alcanceNombre="Empresa" />,
    );
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });
});
