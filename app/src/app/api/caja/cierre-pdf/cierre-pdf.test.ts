/**
 * Unit — the daily-close PDF builder (S4 / S9).
 *
 * The builder is a PURE projection of the close DTO: it reuses the SAME labels and the SAME display
 * formatters the /caja screen uses (`caja-formato`, `shared/ui/format`), so the exported document can
 * never print a different label or a different figure than the screen for the same payload.
 *
 * It is exercised against the REAL pdfkit standard-font factory (no font files, no network): the
 * texts live in the uncompressed content stream, so the assertions read the bytes the client gets.
 */

import { construirCierrePdf } from "./cierre-pdf";
import {
  FORMULA_CORTE,
  TEXTO_NOTA_CIERRE,
} from "@/modules/caja/ui/caja-formato";
import { formatearFechaSD } from "@/shared/ui/format";
import type { CierreDiarioDto } from "@/modules/caja/http/shared";

const cierre: CierreDiarioDto = {
  fechaSD: "2026-11-11",
  totalFacturado: "2000.00",
  totalCobrado: "1500.50",
  efectivoEsperado: "1000.25",
  diferencia: "-499.50",
  metodos: [{ metodo: "EFECTIVO", cobros: "1500.50", cantidad: 3 }],
  corte: { cobros: "1500.50", devoluciones: "500.25" },
};

const entrada = {
  cierre,
  empresaNombre: "Comercial Demo SRL",
  sucursalNombre: "Sucursal Centro",
};

/**
 * The PDF's visible text. pdfkit emits each text run as a `[...] TJ` array whose glyphs are HEX
 * strings interleaved with kerning offsets, in the uncompressed content stream. Rebuilding each
 * array's hex tokens is what actually proves the document says what the screen says (WinAnsi
 * round-trips the accented glyphs through latin1).
 */
function texto(pdf: Buffer): string {
  const crudo = pdf.toString("latin1");
  // Glyphs are WinAnsi: decode with windows-1252 so "—" (0x97) reads as the wireframe's dash.
  const decodificar = new TextDecoder("windows-1252");
  const runs = [...crudo.matchAll(/\[([^\]]*)\]\s*TJ/gs)].map((m) =>
    [...m[1].matchAll(/<([0-9A-Fa-f]+)>/g)]
      .map((h) => decodificar.decode(Buffer.from(h[1], "hex")))
      .join(""),
  );
  return runs.join("\n");
}

describe("construirCierrePdf", () => {
  it("produces a non-empty PDF buffer", async () => {
    const pdf = await construirCierrePdf(entrada);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("prints the title, the SD date, and the tenant names", async () => {
    const t = texto(await construirCierrePdf(entrada));

    expect(t).toContain("Cierre diario de caja");
    expect(t).toContain(formatearFechaSD(cierre.fechaSD));
    expect(t).toContain("Comercial Demo SRL");
    expect(t).toContain("Sucursal Centro");
  });

  it("prints the four KPIs with the SAME figures the screen shows", async () => {
    const t = texto(await construirCierrePdf(entrada));

    expect(t).toContain("Total facturado");
    expect(t).toContain("RD$ 2,000.00");
    expect(t).toContain("Total cobrado");
    expect(t).toContain("RD$ 1,500.50");
    expect(t).toContain("Efectivo esperado");
    expect(t).toContain("RD$ 1,000.25");
    expect(t).toContain("Diferencia");
    // Signed, magnitude formatted by the shared money helper.
    expect(t).toContain("-RD$ 499.50");
  });

  it("prints the método table with a dash under per-method Ventas and a Total row", async () => {
    const t = texto(await construirCierrePdf(entrada));

    expect(t).toContain("Método");
    expect(t).toContain("Ventas");
    expect(t).toContain("Cobros");
    expect(t).toContain("Total");
    expect(t).toContain("Efectivo");
    expect(t).toContain("—");
    // Cobros column of the single method row.
    expect(t).toContain("RD$ 1,500.50");
  });

  it("prints the corte block (formula + Cobros/Devoluciones/Esperado) and the note", async () => {
    const t = texto(await construirCierrePdf(entrada));

    expect(t).toContain("Corte de caja");
    expect(t).toContain("Cobros en efectivo");
    expect(t).toContain("Devoluciones en efectivo");
    expect(t).toContain("Cobros");
    expect(t).toContain("Devoluciones");
    expect(t).toContain("Esperado");
    expect(t).toContain("RD$ 500.25");
    expect(t).toContain(TEXTO_NOTA_CIERRE);
    expect(t).toContain(FORMULA_CORTE.slice(0, 20));
  });

  it("renders a zero day as zeros instead of failing", async () => {
    const cero: CierreDiarioDto = {
      fechaSD: "2026-11-11",
      totalFacturado: "0.00",
      totalCobrado: "0.00",
      efectivoEsperado: "0.00",
      diferencia: "0.00",
      metodos: [],
      corte: { cobros: "0.00", devoluciones: "0.00" },
    };

    const pdf = await construirCierrePdf({ ...entrada, cierre: cero });
    const t = texto(pdf);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(t).toContain(formatearFechaSD(cero.fechaSD));
    expect(t).toContain("RD$ 0.00");
    expect(t).not.toContain("-RD$");
  });

  it("builds through the injected document factory (no hidden globals)", async () => {
    const real = await import("pdfkit");
    const fabricas = jest.fn(() => new real.default({ size: "A4", margin: 54, compress: false }));

    const pdf = await construirCierrePdf(entrada, fabricas);

    expect(fabricas).toHaveBeenCalledTimes(1);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
