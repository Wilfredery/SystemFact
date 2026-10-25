/**
 * Pure cart-model tests (F2 slice C task 3.1, D2/R-V21) — node env, no DOM.
 *
 * Pins BEFORE implementation:
 * - every fresh line seeds `DESCUENTO_CERO` (R-V7 carrier form: PORCENTAJE, "0.00");
 * - the preview routes each line's OWN discount into the SAME released domain
 *   calculators (`calcularLineaVenta`/`calcularTotalesVenta`) — preview parity
 *   with the server by construction, totals triangulated against the F2 fixture
 *   constants in `domain/__tests__/calculators.spec.ts`;
 * - over-cap input is NEVER decided locally: a cap-exceeding discount still
 *   flows into the preview (the server's stable codes are the only accept/reject).
 */

import {
  DESCUENTO_CERO,
  DESCUENTO_TIPO,
  type Descuento,
} from "../../domain/venta";
import {
  agregarAlCarrito,
  calcularVistaPrevia,
  editarDescuentoLinea,
  limpiarDescuentoLinea,
  componerValor,
  type CarroLinea,
  type ProductoOpcion,
} from "../carro";
import type { TeclaNumerica } from "@/components/ui/numeric-keypad";

const ARROZ: ProductoOpcion = {
  id: 7,
  codigo: "P-007",
  nombre: "Arroz",
  precioVenta: "10.00",
  tasaItbis: "18",
};

const LINEA_7x333: CarroLinea = {
  productoId: 1,
  codigo: "P-001",
  nombre: "Producto 1",
  cantidad: "7",
  precioUnitario: "3.33",
  tasaItbis: "18",
  descuento: { descuentoTipo: DESCUENTO_TIPO.MONTO, descuentoValor: "5.00" },
};

const LINEA_5x415: CarroLinea = {
  ...LINEA_7x333,
  productoId: 2,
  codigo: "P-002",
  nombre: "Producto 2",
  cantidad: "5",
  precioUnitario: "4.15",
  tasaItbis: "16",
  descuento: { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "3" },
};

const LINEA_2x1290: CarroLinea = {
  ...LINEA_7x333,
  productoId: 3,
  codigo: "P-003",
  nombre: "Producto 3",
  cantidad: "2",
  precioUnitario: "12.90",
  tasaItbis: "0",
  descuento: DESCUENTO_CERO,
};

describe("carro — per-line discount (F2 slice C, R-V21)", () => {
  it("preview for line 7 × 3.33 @18% with MONTO 5.00 → base 18.31, ITBIS 3.30", () => {
    const vista = calcularVistaPrevia([LINEA_7x333], DESCUENTO_CERO);
    const previa = vista.porLinea[0];
    expect(previa.computable).toBe(true);
    expect(previa.calculo?.baseLinea).toBe("18.31");
    expect(previa.calculo?.itbisLinea).toBe("3.30");
  });

  it("multi-line totals triangulate against the domain F2 fixture constants", () => {
    // Same three lines / rates / discounts as calculators.spec Fixture F2:
    // subtotal 69.86 / descuento 5.62 / itbis 6.52 / total 70.76 (no header).
    const vista = calcularVistaPrevia(
      [LINEA_7x333, LINEA_5x415, LINEA_2x1290],
      DESCUENTO_CERO,
    );
    expect(vista.totales.subtotal).toBe("69.86");
    expect(vista.totales.descuento).toBe("5.62");
    expect(vista.totales.itbis).toBe("6.52");
    expect(vista.totales.total).toBe("70.76");
  });

  it("seeds DESCUENTO_CERO (PORCENTAJE, \"0.00\") on every fresh line", () => {
    const carro = agregarAlCarrito([], ARROZ);
    expect(carro).toHaveLength(1);
    expect(carro[0].descuento).toEqual(DESCUENTO_CERO);
    expect(carro[0].descuento).toEqual({
      descuentoTipo: DESCUENTO_TIPO.PORCENTAJE,
      descuentoValor: "0.00",
    });
  });

  it("editarDescuentoLinea merges Partial<Descuento> onto the touched line immutably", () => {
    const carro: CarroLinea[] = [LINEA_2x1290];
    const siguiente = editarDescuentoLinea(carro, 3, {
      descuentoTipo: DESCUENTO_TIPO.MONTO,
      descuentoValor: "2.50",
    });
    // Immutability: the source array and its line are untouched.
    expect(carro[0].descuento).toEqual(DESCUENTO_CERO);
    expect(siguiente).not.toBe(carro);
    expect(siguiente[0].productoId).toBe(3);
    expect(siguiente[0].descuento).toEqual({
      descuentoTipo: DESCUENTO_TIPO.MONTO,
      descuentoValor: "2.50",
    });
    // Merge keeps prior fields not overridden.
    const trasTipo = editarDescuentoLinea(siguiente, 3, { descuentoValor: "3.00" });
    expect(trasTipo[0].descuento).toEqual({
      descuentoTipo: DESCUENTO_TIPO.MONTO,
      descuentoValor: "3.00",
    });
    // Other lines walk through untouched.
    expect(editarDescuentoLinea(carro, 999, { descuentoValor: "1.00" })).toEqual(carro);
  });

  it("limpiarDescuentoLinea restores DESCUENTO_CERO on the touched line", () => {
    const carro: CarroLinea[] = [LINEA_7x333];
    const limpio = limpiarDescuentoLinea(carro, 1);
    expect(limpio[0].descuento).toEqual(DESCUENTO_CERO);
    expect(carro[0].descuento.descuentoValor).toBe("5.00"); // source untouched
  });

  it("over-cap input is NOT decided locally — it still flows into the preview", () => {
    // 99% line discount (far beyond any server-authorized cap) must still be
    // previewable: the non-authoritative preview never rejects. The server's
    // DESCUENTO_EXCEDE_MAXIMO stable code is the only accept/reject authority.
    const carro: CarroLinea[] = [{ ...LINEA_2x1290, descuento: { descuentoTipo: DESCUENTO_TIPO.PORCENTAJE, descuentoValor: "99" } as Descuento }];
    const vista = calcularVistaPrevia(carro, DESCUENTO_CERO);
    expect(vista.porLinea[0].computable).toBe(true);
    expect(vista.porLinea[0].calculo).not.toBeNull();
  });
});

// F2 slice D task 4.5 (D4/R-V23): pure keypad composition — append/drop
// overdigits per the SAME line-validity regexes the domain validates
// (quantity → 3 decimals, money → 2; single dot; BSP strips; CLR clears).
describe("componerValor", () => {
  it("appends digits within the 3-decimal quantity shape", () => {
    expect(componerValor("", "1", 3)).toBe("1");
    expect(componerValor("1", "2", 3)).toBe("12");
    expect(componerValor("1.234", "5", 3)).toBe("1.234"); // overdigit dropped
    expect(componerValor("123456789", "9", 3)).toBe("123456789"); // 9 int digits already — the 10th never lands
  });

  it("caps money fields at 2 decimals", () => {
    expect(componerValor("1.2", "3", 2)).toBe("1.23");
    expect(componerValor("1.23", "5", 2)).toBe("1.23"); // 3rd decimal dropped
    expect(componerValor("", "3", 2)).toBe("3");
  });

  it("inserts the decimal point at most once", () => {
    expect(componerValor("1", ".", 2)).toBe("1.");
    expect(componerValor("1.", ".", 3)).toBe("1."); // second dot never lands
    expect(componerValor("1.", "5", 3)).toBe("1.5");
  });

  it("BSP strips the last char and CLR clears", () => {
    expect(componerValor("12.5", "BSP", 3)).toBe("12.");
    expect(componerValor("12.5", "CLR", 3)).toBe("");
    expect(componerValor("", "BSP", 2)).toBe("");
  });
});
