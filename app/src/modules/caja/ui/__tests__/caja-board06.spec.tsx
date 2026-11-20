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
import type { CierreDiarioDto } from "@/modules/caja/http/shared";
import type { ResumenDiaDto } from "@/modules/caja/http/shared";

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
  metodos: [],
  corte: { cobros: "0.00", devoluciones: "0.00" },
} as unknown as CierreDiarioDto;

const RESUMEN_VACIO = {
  ventas: "0.00",
  costoVendido: "0.00",
  margenBruto: "0.00",
  margenPorcentaje: "0.0",
} as unknown as ResumenDiaDto;

describe("Board 06 — F0 token retrofit (S31)", () => {
  const RAIZ = path.join(__dirname, "..");

  const FILES = ["CajaScreen.tsx", "caja-formato.ts", path.join(RAIZ, "../../../app/(app)/caja/page.tsx")];

  const RAW_PALETTE =
    /(?:text|bg|border|ring|divide|from|to|placeholder|fill|stroke|shadow|outline|accent|caret|decoration)-(?:zinc|red|emerald|amber|indigo|gray|slate|neutral|stone|white|black|blue|green|sky|orange|violet|purple|yellow|rose|teal|cyan|lime|pink|fuchsia)-?[^\\s"'`]*/g;

  const ARBITRARY_HEX = /(?:text|bg|border|ring)-\[#[^\\]]+\]/g;

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
        cierre={{ ...CIERRE_VACIO, diferencia: "-150.00" } as CierreDiarioDto}
        resumen={RESUMEN_VACIO}
        alcanceNombre="Colmado El Sol · Sucursal Central"
      />,
    );
    const valor = screen.getByTestId("caja-kpi-diferencia");
    expect(valor.className).toContain("text-danger");
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
    expect(enlace.className).toContain("border-line");
    expect(enlace.className).toContain("text-ink");
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
