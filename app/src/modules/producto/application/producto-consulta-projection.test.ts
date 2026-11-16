import { Decimal } from "decimal.js";
import { mapearProductoConsulta } from "./producto-consulta-projection";
import type { ProductoConsultaFila } from "../infrastructure/producto-repository";

function fila(tasa: string): ProductoConsultaFila {
  return {
    id: 7,
    codigo: "P-007",
    nombre: "Arroz",
    descripcion: null,
    categoriaId: 3,
    categoriaNombre: "Granos",
    unidadMedida: "Libra",
    precioVenta: new Decimal("125.50"),
    tasaItbis: new Decimal(tasa),
    itbisVigenteDesde: new Date("2026-01-01T00:00:00.000Z"),
    itbisVigenteHasta: null,
    itbisAplicaRetencionITBIS: false,
    activo: true,
    version: 1,
  };
}

describe("mapearProductoConsulta", () => {
  const lista = ["18", "16", "0"];

  it("S4: a stored rate outside the list maps without throwing and is not current", () => {
    const item = mapearProductoConsulta(fila("7"), lista);
    expect(item.tasaItbis).toBe("7");
    expect(item.tasaVigente).toBe(false);
  });

  it("a stored rate in the list is current, compared numerically", () => {
    expect(mapearProductoConsulta(fila("18.00"), lista)).toMatchObject({
      tasaItbis: "18",
      tasaVigente: true,
    });
    expect(mapearProductoConsulta(fila("0"), lista).tasaVigente).toBe(true);
  });

  it("narrowing the list makes the rate not current", () => {
    expect(mapearProductoConsulta(fila("18"), ["16", "0"]).tasaVigente).toBe(false);
  });
});
