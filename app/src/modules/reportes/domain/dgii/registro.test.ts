/**
 * Unit tests — the DGII fixed-width RECORD + file assembly for a KNOWN fixture (FIS-3/FIS-4/FIS-5/
 * FIS-6; slice E, task 5.1/5.3/5.4/5.5).
 *
 * PURE (no DB). These are the "known invoice set → exact expected TXT lines" fixtures the writer
 * must reproduce byte-for-byte: the full 607 detail line (23 columns, 243 chars), the header whose
 * CANTIDAD_REGISTROS MATCHES the number of detail rows, the en-cero file (header only, count 0),
 * and the 608 (3-col, NO amount field) + 606 (23-col) shapes. The layout uses the CHOSEN widths
 * (U2 seam), so this proves the ASSEMBLY RULES, while the pre-validation loop proves the DGII-tool
 * byte offsets. The B04 negative amount and the cross-foot carry into the exact line here.
 */

import { Decimal } from "decimal.js";
import { SEPARADOR_LINEA } from "./formato";
import { distribuirFormasPago607 } from "./pagos-607";
import {
  ensamblarArchivo,
  ensamblarDetalle607,
  ensamblarDetalle606,
  ensamblarDetalle608,
  ensamblarEncabezado5,
  ensamblarEncabezado608,
  type Encabezado608,
  type EncabezadoDGII,
  type FilaDetalle606,
  type FilaDetalle607,
  type FilaDetalle608,
} from "./registro";

/** A helper repeating a zero amount `n` times (the many "no value" columns). */
const ceros = (n: number): string => "000000000.00".repeat(n);

const FILA_607: FilaDetalle607 = {
  rncAdquirente: "131045678",
  tipoIdentificacion: 1,
  ncf: "B0100000001",
  ncfModificado: null,
  tipoIngreso: "1",
  fechaComprobante: new Date("2026-07-15T23:00:00.000Z"), // SD 20260715
  fechaRetencion: null,
  montoFacturado: "1000.00",
  itbisFacturado: "180.00",
  itbisRetenidoTerceros: "0.00",
  itbisPercibido: "0.00",
  retRentaTerceros: "0.00",
  isrPercibido: "0.00",
  isc: "0.00",
  otrosImp: "0.00",
  propinaLegal: "0.00",
  formasPago: distribuirFormasPago607({ totalBruto: "1180.00", cobrosEfectivo: "1180.00" }),
};

describe("dgii/registro — 607 detail exact fixed-width line", () => {
  it("lays the 23 columns out at the documented widths (243 chars, deterministic)", () => {
    const esperado = [
      "131045678  ", // D1 (A11, right space-pad)
      "1", // D2 tipoId
      "B0100000001", // D3 NCF (11, prefix included)
      "           ", // D4 modificado (blank A11)
      "1", // D5 tipo ingreso
      "20260715", // D6 fecha
      "        ", // D7 fecha retención (blank)
      "000001000.00", // D8 monto facturado
      "000000180.00", // D9 ITBIS facturado
      ceros(7), // D10..D16 (retenido/percibido/ISR/ISC/otros/propina)
      "000001180.00", // D17 efectivo (cross-foot)
      ceros(6), // D18..D23
    ].join("");
    const linea = ensamblarDetalle607(FILA_607);
    expect(linea).toBe(esperado);
    expect(linea).toHaveLength(243);
    expect(linea).not.toContain("|"); // U6 — no pipe delimiter
  });

  it("a B04 nota crédito carries a NEGATIVE base/ITBIS so the register nets down", () => {
    const filaNC: FilaDetalle607 = {
      ...FILA_607,
      ncf: "B0400000201",
      ncfModificado: "B0100000001", // D4 references the original
      montoFacturado: "-1000.00",
      itbisFacturado: "-180.00",
      formasPago: distribuirFormasPago607({ totalBruto: "-1180.00", cobrosEfectivo: "0.00" }),
    };
    const linea = ensamblarDetalle607(filaNC);
    expect(linea).toContain("-00001000.00"); // D8 negative
    expect(linea).toContain("-00000180.00"); // D9 negative
    expect(linea).toContain("B0100000001"); // D4 original present
  });
});

describe("dgii/registro — 607 encabezado matches the register count", () => {
  const encabezado: EncabezadoDGII = {
    codigoInformacion: "607",
    rnc: "130000000",
    periodo: "202607",
    cantidadRegistros: 1,
    totalMontoFacturado: "1000.00",
  };
  it("emits the 5 header fields at their widths (48 chars)", () => {
    const linea = ensamblarEncabezado5(encabezado);
    expect(linea).toBe("607" + "130000000  " + "202607" + "000000000001" + "0000000001000.00");
    expect(linea).toHaveLength(48);
  });
});

describe("dgii/registro — ensamblarArchivo (header + details, en-cero, header count = detail rows)", () => {
  it("joins header and details with no separator line and a trailing terminator", () => {
    const header = ensamblarEncabezado5({
      codigoInformacion: "607",
      rnc: "130000000",
      periodo: "202607",
      cantidadRegistros: 2,
      totalMontoFacturado: "2000.00",
    });
    const d1 = ensamblarDetalle607(FILA_607);
    const d2 = ensamblarDetalle607(FILA_607);
    const txt = ensamblarArchivo(header, [d1, d2]);
    const lineas = txt.split(SEPARADOR_LINEA);
    // trailing terminator ⇒ the last split entry is empty
    expect(lineas[lineas.length - 1]).toBe("");
    expect(lineas).toHaveLength(4); // header + 2 details + trailing empty
    // The header's declared count (2) equals the number of detail lines actually written.
    const cabecera = lineas[0];
    expect(cabecera).toContain("607");
    expect(cabecera.slice(-16 - 12, -16)).toBe("000000000002");
  });

  it("a zero-activity period produces a VALID EN-CERO file: header only, CANTIDAD_REGISTROS=0", () => {
    const cero: EncabezadoDGII = {
      codigoInformacion: "607",
      rnc: "130000000",
      periodo: "202607",
      cantidadRegistros: 0,
      totalMontoFacturado: "0.00",
    };
    const txt = ensamblarArchivo(ensamblarEncabezado5(cero), []);
    const lineas = txt.split(SEPARADOR_LINEA).filter((l) => l !== "");
    expect(lineas).toHaveLength(1); // ONLY the header
    expect(lineas[0]).toContain("607");
    expect(lineas[0]).toContain("000000000000"); // count 0, zero-left-padded
    expect(txt.charCodeAt(0)).not.toBe(0xfeff); // no BOM at the head of the text (U1)
  });
});

describe("dgii/registro — 608 detail (3 cols, no amount) + 608 header (no total-monto)", () => {
  it("lays a single annulled NCF row out (11 + 8 + 2 = 21 chars)", () => {
    const fila: FilaDetalle608 = {
      ncf: "B0100000009",
      fechaComprobante: new Date("2026-07-20T14:00:00.000Z"), // SD 20260720
      tipoAnulacion: 4,
    };
    const linea = ensamblarDetalle608(fila);
    expect(linea).toBe("B0100000009" + "20260720" + "04");
    expect(linea).toHaveLength(21);
  });
  it("the 608 header omits the total-monto field (48-16=... only count field)", () => {
    const h: Encabezado608 = { codigoInformacion: "608", rnc: "130000000", periodo: "202607", cantidadRegistros: 3 };
    const linea = ensamblarEncabezado608(h);
    expect(linea).toBe("608" + "130000000  " + "202607" + "000000000003");
    expect(linea).toHaveLength(32);
  });
});

describe("dgii/registro — 606 detail (23 cols) layout", () => {
  it("lays a formal purchase row out and keeps the goods/services + ITBIS advance columns", () => {
    const fila: FilaDetalle606 = {
      rncProveedor: "131000000",
      tipoIdentificacion: 1,
      tipoBienesServicios: 9,
      ncf: "B0100000001",
      ncfModificado: null,
      fechaComprobante: new Date("2026-07-15T23:00:00.000Z"),
      fechaPago: new Date("2026-07-15T23:00:00.000Z"),
      montoServicios: "0.00",
      montoBienes: "1000.00",
      totalMontoFacturado: "1000.00",
      itbisFacturado: "180.00",
      itbisRetenido: "0.00",
      itbisProporcionalidad: "0.00",
      itbisAlCosto: "0.00",
      itbisPorAdelantar: "180.00",
      itbisPercibido: "0.00",
      tipoRetencionIsr: 0,
      montoRetencionRenta: "0.00",
      isrPercibido: "0.00",
      isc: "0.00",
      otrosImp: "0.00",
      propinaLegal: "0.00",
      formaPago: 1,
    };
    const linea = ensamblarDetalle606(fila);
    // D1..D7 widths: 11+1+2+11+11+8+8 = 52; then 15 money/ISR columns before D23 (1) ... assert length + key substrings.
    expect(linea.startsWith("131000000  109")).toBe(true); // RNC + tipoId + tipoBien(09)
    expect(linea).toContain("000001000.00"); // D9 bienes
    expect(linea).toContain("000000180.00"); // D11/D15 advance ITBIS present
    expect(linea.endsWith("1")).toBe(true); // D23 forma pago
    // total width: 52 + (D8,D9,D10,D11,D12,D13,D14,D15,D16 = 9×12=108) + D17(1) + (D18..D22=5×12=60) + D23(1) = 222
    expect(linea).toHaveLength(222);
    expect(new Decimal(fila.itbisPorAdelantar).toFixed(2)).toBe("180.00");
  });
});

describe("dgii/registro — a control-char NCF cannot desync the 606 record (fingerprint dgii-606)", () => {
  const SIN_CONTROL = /[\x00-\x1F\x7F]/;

  /** A purchase whose free-text `ncf` carries an interior CRLF (legacy dirty row / pre-F4 wire). */
  const FILA_606_CRLF: FilaDetalle606 = {
    rncProveedor: "131000000",
    tipoIdentificacion: 1,
    tipoBienesServicios: 9,
    ncf: "B01\r\n123456", // 11 chars: the CR/LF would ship raw into D4 without the sink guard
    ncfModificado: null,
    fechaComprobante: new Date("2026-07-15T23:00:00.000Z"),
    fechaPago: null,
    montoServicios: "0.00",
    montoBienes: "1000.00",
    totalMontoFacturado: "1000.00",
    itbisFacturado: "180.00",
    itbisRetenido: "0.00",
    itbisProporcionalidad: "0.00",
    itbisAlCosto: "0.00",
    itbisPorAdelantar: "0.00",
    itbisPercibido: "0.00",
    tipoRetencionIsr: 0,
    montoRetencionRenta: "0.00",
    isrPercibido: "0.00",
    isc: "0.00",
    otrosImp: "0.00",
    propinaLegal: "0.00",
    formaPago: 1,
  };

  it("emits a record with NO control character and the SAME 222-char width as a clean row", () => {
    const linea = ensamblarDetalle606(FILA_606_CRLF);
    expect(linea).not.toMatch(SIN_CONTROL);
    expect(linea).not.toContain("\r");
    expect(linea).not.toContain("\n");
    expect(linea).toHaveLength(222);
  });

  it("keeps D4 at exactly 11 positions (offset 14 = D1 11 + D2 1 + D3 2)", () => {
    const linea = ensamblarDetalle606(FILA_606_CRLF);
    const d4 = linea.slice(14, 25);
    expect(d4).toBe("B01123456  ");
    expect(d4).toHaveLength(11);
    // The column before it is intact, so the CR/LF did not shift the fixed-width layout.
    expect(linea.startsWith("131000000  109")).toBe(true);
  });

  it("produces exactly 2 physical lines (header + 1 record) for CANTIDAD_REGISTROS=1", () => {
    const header = ensamblarEncabezado5({
      codigoInformacion: "606",
      rnc: "130000000",
      periodo: "202607",
      cantidadRegistros: 1,
      totalMontoFacturado: "1000.00",
    });
    const txt = ensamblarArchivo(header, [ensamblarDetalle606(FILA_606_CRLF)]);
    // Trailing terminator ⇒ split length − 1 is the physical line count: 1 header + 1 record.
    const lineasFisicas = txt.split(SEPARADOR_LINEA).length - 1;
    expect(lineasFisicas).toBe(2);
    expect(lineasFisicas).toBe(1 + 1); // header + CANTIDAD_REGISTROS
    // Every physical line but the last terminator is a real, control-free line.
    for (const linea of txt.split(SEPARADOR_LINEA)) {
      expect(linea).not.toMatch(SIN_CONTROL);
    }
    expect(txt.split(SEPARADOR_LINEA).filter((l) => l !== "")).toHaveLength(2);
  });
});
