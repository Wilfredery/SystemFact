/**
 * Domain unit tests — pure calculators, no database (ADR-013).
 *
 * Covers: the 18/16/0 mixed-rate totals, the full `tipoCompra × supplier-class`
 * retention matrix, the applicable-config-key set, and the line validator.
 */

import {
  calcularLinea,
  calcularRetenciones,
  calcularTotales,
  requiredRetentionKeys,
  validarLinea,
} from "./calculators";
import {
  CLASE_PROVEEDOR,
  TIPO_COMPRA,
  TIPO_PERSONA,
  type CompraLineaCalculada,
  type RetentionRates,
} from "./compra";

// Percent-form rates, as they would be read from ConfiguracionEmpresa.
const RATES: RetentionRates = {
  isr15: "15",
  isr2: "2",
  itbis100: "100",
  itbis30: "30",
};

function linea(
  productoId: number,
  cantidad: string,
  costoUnitario: string,
  tasaItbis: string,
): CompraLineaCalculada {
  return calcularLinea({ productoId, cantidad, costoUnitario }, tasaItbis);
}

describe("calcularLinea", () => {
  it("computes per-line subtotal and ITBIS at the frozen rate", () => {
    const l = linea(1, "2.000", "100.00", "18");
    expect(l.subtotalLinea).toBe("200.00");
    expect(l.itbisLinea).toBe("36.00");
  });

  it("yields zero ITBIS for an exempt (0%) line", () => {
    const l = linea(1, "3.000", "50.00", "0");
    expect(l.subtotalLinea).toBe("150.00");
    expect(l.itbisLinea).toBe("0.00");
  });

  it("rounds money half-up to two decimals", () => {
    // 1.5 * 1.005 = 1.5075 → 1.51; itbis 1.51 * 16% = 0.2416 → 0.24
    const l = linea(1, "1.500", "1.005", "16");
    expect(l.subtotalLinea).toBe("1.51");
    expect(l.itbisLinea).toBe("0.24");
  });
});

describe("calcularTotales — mixed 18/16/0", () => {
  const lineas = [
    linea(1, "2.000", "100.00", "18"), // gravado 200, itbis 36
    linea(2, "1.000", "150.00", "16"), // gravado 150, itbis 24
    linea(3, "4.000", "25.00", "0"), // exento 100, itbis 0
  ];
  const totales = calcularTotales(lineas);

  it("splits gravado/exento and sums per-line ITBIS", () => {
    expect(totales.subtotalGravado).toBe("350.00");
    expect(totales.subtotalExento).toBe("100.00");
    expect(totales.itbis).toBe("60.00"); // 36 + 24 + 0
    expect(totales.subtotal).toBe("450.00"); // gravado + exento
    expect(totales.total).toBe("510.00"); // gross = subtotal + itbis
  });

  it("handles an empty line set without NaN", () => {
    const vacio = calcularTotales([]);
    expect(vacio.total).toBe("0.00");
    expect(vacio.itbis).toBe("0.00");
  });
});

describe("requiredRetentionKeys — config applicability", () => {
  it("informal supplier requires RET_ITBIS_100", () => {
    expect(
      requiredRetentionKeys({
        tipoCompra: TIPO_COMPRA.MERCANCIA,
        tipoProveedor: CLASE_PROVEEDOR.INFORMAL,
        tipoPersona: TIPO_PERSONA.FISICA,
      }),
    ).toEqual(["RET_ITBIS_100"]);
  });

  it("formal merchandise requires no keys", () => {
    expect(
      requiredRetentionKeys({
        tipoCompra: TIPO_COMPRA.MERCANCIA,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.JURIDICA,
      }),
    ).toEqual([]);
  });

  it("maps the professional/technical/rental matrix to the right key", () => {
    expect(
      requiredRetentionKeys({
        tipoCompra: TIPO_COMPRA.SERVICIO_PROFESIONAL,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.FISICA,
      }),
    ).toEqual(["RET_ISR_15"]);
    expect(
      requiredRetentionKeys({
        tipoCompra: TIPO_COMPRA.SERVICIO_PROFESIONAL,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.JURIDICA,
      }),
    ).toEqual(["RET_ITBIS_30"]);
    expect(
      requiredRetentionKeys({
        tipoCompra: TIPO_COMPRA.SERVICIO_TECNICO,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.FISICA,
      }),
    ).toEqual(["RET_ISR_2"]);
    expect(
      requiredRetentionKeys({
        tipoCompra: TIPO_COMPRA.ALQUILER,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.FISICA,
      }),
    ).toEqual(["RET_ISR_15"]);
  });
});

describe("calcularRetenciones — full matrix", () => {
  const totales = {
    subtotalGravado: "1000.00",
    itbis: "180.00",
    subtotalExento: "0.00",
    subtotal: "1000.00",
    total: "1180.00",
  };

  it("formal merchandise → no retentions (scenario 'Formal merchandise')", () => {
    expect(
      calcularRetenciones(totales, {
        tipoCompra: TIPO_COMPRA.MERCANCIA,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.JURIDICA,
        rates: RATES,
      }),
    ).toEqual({ retencionIsr: "0.00", retencionItbis: "0.00" });
  });

  it("formal professional / física → ISR 15% of gravado", () => {
    expect(
      calcularRetenciones(totales, {
        tipoCompra: TIPO_COMPRA.SERVICIO_PROFESIONAL,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.FISICA,
        rates: RATES,
      }),
    ).toEqual({ retencionIsr: "150.00", retencionItbis: "0.00" });
  });

  it("formal professional / jurídica → ITBIS 30% of itbis", () => {
    expect(
      calcularRetenciones(totales, {
        tipoCompra: TIPO_COMPRA.SERVICIO_PROFESIONAL,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.JURIDICA,
        rates: RATES,
      }),
    ).toEqual({ retencionIsr: "0.00", retencionItbis: "54.00" });
  });

  it("formal technical service → ISR 2% of gravado", () => {
    expect(
      calcularRetenciones(totales, {
        tipoCompra: TIPO_COMPRA.SERVICIO_TECNICO,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.FISICA,
        rates: RATES,
      }),
    ).toEqual({ retencionIsr: "20.00", retencionItbis: "0.00" });
  });

  it("formal rental / física → ISR 15%; / jurídica → none", () => {
    expect(
      calcularRetenciones(totales, {
        tipoCompra: TIPO_COMPRA.ALQUILER,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.FISICA,
        rates: RATES,
      }),
    ).toEqual({ retencionIsr: "150.00", retencionItbis: "0.00" });
    expect(
      calcularRetenciones(totales, {
        tipoCompra: TIPO_COMPRA.ALQUILER,
        tipoProveedor: CLASE_PROVEEDOR.FORMAL,
        tipoPersona: TIPO_PERSONA.JURIDICA,
        rates: RATES,
      }),
    ).toEqual({ retencionIsr: "0.00", retencionItbis: "0.00" });
  });

  it("informal supplier → ITBIS 100% of itbis, no ISR", () => {
    expect(
      calcularRetenciones(totales, {
        tipoCompra: TIPO_COMPRA.MERCANCIA,
        tipoProveedor: CLASE_PROVEEDOR.INFORMAL,
        tipoPersona: TIPO_PERSONA.FISICA,
        rates: RATES,
      }),
    ).toEqual({ retencionIsr: "0.00", retencionItbis: "180.00" });
  });
});

describe("validarLinea", () => {
  it("accepts a positive quantity, non-negative cost and a 18/16/0 rate", () => {
    expect(
      validarLinea({ productoId: 1, cantidad: "1.000", costoUnitario: "0.00" }, "18"),
    ).toBeNull();
  });

  it("rejects a non-positive quantity", () => {
    expect(
      validarLinea({ productoId: 1, cantidad: "0.000", costoUnitario: "10.00" }, "18"),
    ).toBe("LINEA_INVALIDA");
  });

  it("rejects a negative unit cost", () => {
    expect(
      validarLinea({ productoId: 1, cantidad: "1.000", costoUnitario: "-1.00" }, "18"),
    ).toBe("LINEA_INVALIDA");
  });

  it("rejects a rate outside the 18/16/0 set", () => {
    expect(
      validarLinea({ productoId: 1, cantidad: "1.000", costoUnitario: "10.00" }, "12"),
    ).toBe("LINEA_INVALIDA");
  });
});
