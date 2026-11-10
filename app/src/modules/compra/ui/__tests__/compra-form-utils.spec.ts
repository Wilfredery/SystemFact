/**
 * @jest-environment jsdom
 *
 * Pure helpers of the purchase dialog (odd/tasks/compras.md, T3: S1/S6).
 *
 * The `fecha` of a purchase is a BUSINESS CALENDAR DAY frozen at UTC midnight
 * (`compra-repository` stores `2026-01-10T00:00:00.000Z`), so it must render as
 * that day — reading the instant in `America/Santo_Domingo` would shift it back
 * one day (midnight UTC = 20:00 of the previous SD day).
 */

import { formatearFechaCompra, tipoNcfParaCompra, validarFormularioCompra } from "../compra-form-utils";

describe("formatearFechaCompra (S1)", () => {
  it("renders a purchase fecha frozen at UTC midnight as that same calendar day", () => {
    expect(formatearFechaCompra("2026-01-10T00:00:00.000Z")).toBe("10/01/2026");
    expect(formatearFechaCompra("2026-12-31T00:00:00.000Z")).toBe("31/12/2026");
  });

  it("keeps the day for an instant with a time component (same UTC day)", () => {
    expect(formatearFechaCompra("2026-11-10T14:00:00.000Z")).toBe("10/11/2026");
  });
});

describe("tipoNcfParaCompra (S1)", () => {
  it("bills mercancía as a B01 receipt and every service/rental as B11", () => {
    expect(tipoNcfParaCompra("MERCANCIA")).toBe("B01");
    expect(tipoNcfParaCompra("SERVICIO_PROFESIONAL")).toBe("B11");
    expect(tipoNcfParaCompra("SERVICIO_TECNICO")).toBe("B11");
    expect(tipoNcfParaCompra("ALQUILER")).toBe("B11");
  });
});

describe("validarFormularioCompra (S6)", () => {
  it("refuses a missing supplier, an empty line set and float-unsafe decimals", () => {
    expect(
      validarFormularioCompra({ proveedorId: null, fecha: "2026-11-10", lineas: [] }),
    ).toBe("Debe seleccionar un proveedor.");

    const producto = {
      id: 11,
      codigo: "A001",
      nombre: "Arroz",
      unidadMedida: "Libra",
      tasaItbis: "18",
    };
    expect(
      validarFormularioCompra({
        proveedorId: 3,
        fecha: "2026-11-10",
        lineas: [{ clave: "l1", producto, cantidad: "1.2345", costoUnitario: "10" }],
      }),
    ).toBe("La cantidad debe ser un número mayor que cero (hasta 3 decimales).");
    expect(
      validarFormularioCompra({
        proveedorId: 3,
        fecha: "2026-11-10",
        lineas: [{ clave: "l1", producto, cantidad: "1", costoUnitario: "10.999" }],
      }),
    ).toBe("El costo unitario debe ser un número mayor o igual a cero (hasta 2 decimales).");
  });
});
