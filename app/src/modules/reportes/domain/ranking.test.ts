/**
 * Unit — the product-sales ranking rule (OP-2). Pure domain, no DB.
 *
 * Proves the two spec scenarios exactly: units decide the order (100 cheap units outrank
 * 90 expensive ones) and monto is only a tie-breaker; the same data reversed is "menos
 * vendidos".
 */

import {
  compararPorUnidades,
  ordenarMasVendidos,
  ordenarMenosVendidos,
  type FilaProductoRankeable,
} from "./ranking";

interface Fila extends FilaProductoRankeable {
  readonly nombre: string;
}

const f = (nombre: string, unidades: string, monto: string): Fila => ({
  nombre,
  unidades,
  monto,
});

describe("reportes/domain/ranking — units-first with monto tie-break (OP-2)", () => {
  it("ranks 100 cheap units ABOVE 90 expensive units (units decide, monto shown separately)", () => {
    // X: 100 × RD$5 = 500; Y: 90 × RD$50 = 4500. Y has the larger monto but X wins on units.
    const filas = [f("Y", "90.000", "4500.00"), f("X", "100.000", "500.00")];
    const orden = ordenarMasVendidos(filas);
    expect(orden.map((x) => x.nombre)).toEqual(["X", "Y"]);
    // The secondary monto column is still carried (both figures survive the ranking).
    expect(orden[1]?.monto).toBe("4500.00");
  });

  it("breaks a units tie by descending monto (higher monto first)", () => {
    const filas = [f("barato", "50.000", "100.00"), f("caro", "50.000", "900.00")];
    const orden = ordenarMasVendidos(filas);
    expect(orden.map((x) => x.nombre)).toEqual(["caro", "barato"]);
  });

  it("is a full tie on units and monto (comparator returns 0, order preserved)", () => {
    const a = f("A", "10.000", "100.00");
    const b = f("B", "10.000", "100.00");
    expect(compararPorUnidades(a, b)).toBe(0);
  });

  it("decides a decimal units tie that only differs at the 3rd place (never a float)", () => {
    // 10.001 vs 10.000 units: a float compare could round; Decimal keeps the distinction.
    const filas = [f("exacto", "10.000", "999.00"), f("extra", "10.001", "1.00")];
    const orden = ordenarMasVendidos(filas);
    expect(orden[0]?.nombre).toBe("extra");
  });

  it("ordenarMenosVendidos is the exact inverse of ordenarMasVendidos", () => {
    const filas = [
      f("X", "100.000", "500.00"),
      f("Y", "90.000", "4500.00"),
      f("Z", "5.000", "20.00"),
    ];
    const mas = ordenarMasVendidos(filas).map((x) => x.nombre);
    const menos = ordenarMenosVendidos(filas).map((x) => x.nombre);
    expect(menos).toEqual([...mas].reverse());
  });

  it("does not mutate the input array", () => {
    const filas = [f("Y", "90.000", "4500.00"), f("X", "100.000", "500.00")];
    const original = [...filas];
    ordenarMasVendidos(filas);
    expect(filas).toEqual(original);
  });
});
