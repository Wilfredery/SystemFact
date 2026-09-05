import { Decimal } from "decimal.js";
import { calcularItbisProducto } from "./calcular-itbis";
import { CANTIDAD_INVALIDA } from "./errors";
import type { Producto } from "./producto";

function producto(
  precioVenta: string,
  tasa: "0" | "16" | "18",
): Producto {
  return {
    id: 1,
    empresaId: 1,
    categoriaId: 1,
    codigo: "TEST",
    nombre: "Producto de prueba",
    descripcion: null,
    precioVenta: new Decimal(precioVenta),
    itbis: {
      tasa,
      vigenteDesde: new Date("2026-01-01"),
      vigenteHasta: null,
      aplicaRetencionITBIS: false,
    },
    exento: tasa === "0",
    activo: true,
  };
}

describe("calcularItbisProducto", () => {
  it("calcula laptop al 18%", () => {
    const p = producto("50000.00", "18");
    const line = calcularItbisProducto(p, "1");
    expect(line.baseImponible.toString()).toBe("50000");
    expect(line.itbis.toString()).toBe("9000");
    expect(line.total.toString()).toBe("59000");
  });

  it("calcula yogurt al 16%", () => {
    const p = producto("1000.00", "16");
    const line = calcularItbisProducto(p, "1");
    expect(line.baseImponible.toString()).toBe("1000");
    expect(line.itbis.toString()).toBe("160");
    expect(line.total.toString()).toBe("1160");
  });

  it("calcula leche fresca exenta al 0%", () => {
    const p = producto("100.00", "0");
    const line = calcularItbisProducto(p, "1");
    expect(line.baseImponible.toString()).toBe("100");
    expect(line.itbis.toString()).toBe("0");
    expect(line.total.toString()).toBe("100");
  });

  it("calcula carrito mixto con cantidades", () => {
    const laptop = producto("50000.00", "18");
    const yogurt = producto("1000.00", "16");
    const leche = producto("100.00", "0");

    const lineLaptop = calcularItbisProducto(laptop, "2");
    const lineYogurt = calcularItbisProducto(yogurt, "3");
    const lineLeche = calcularItbisProducto(leche, "5");

    expect(lineLaptop.baseImponible.toString()).toBe("100000");
    expect(lineLaptop.itbis.toString()).toBe("18000");
    expect(lineYogurt.baseImponible.toString()).toBe("3000");
    expect(lineYogurt.itbis.toString()).toBe("480");
    expect(lineLeche.baseImponible.toString()).toBe("500");
    expect(lineLeche.itbis.toString()).toBe("0");
  });

  it("mantiene precisión decimal exacta", () => {
    const p = producto("50000.00", "18");
    const line = calcularItbisProducto(p, "1");
    expect(line.itbis.toFixed(2)).toBe("9000.00");
  });

  it("devuelve cero para cantidad cero", () => {
    const p = producto("50000.00", "18");
    const line = calcularItbisProducto(p, "0");
    expect(line.baseImponible.toString()).toBe("0");
    expect(line.itbis.toString()).toBe("0");
    expect(line.total.toString()).toBe("0");
  });

  it("rechaza cantidad negativa", () => {
    const p = producto("50000.00", "18");
    expect(() => calcularItbisProducto(p, "-1")).toThrow(
      expect.objectContaining({ code: CANTIDAD_INVALIDA }),
    );
  });
});
