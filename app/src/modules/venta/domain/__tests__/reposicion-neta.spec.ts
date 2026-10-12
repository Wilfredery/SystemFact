/**
 * Pure net-reposition calculator tests (audit run-3 remediation, R-V16 amend).
 * No DB — the aggregation itself lives in the devolucion infrastructure;
 * here only the pure netting arithmetic is pinned.
 */

import { Decimal } from "decimal.js";
import { calcularReposicionNeta } from "../reposicion-neta";
import type { DevueltoPorProducto } from "../reposicion-neta";

const l = (productoId: number, cantidad: string) => ({ productoId, cantidad });
const devuelto = (
  entries: ReadonlyArray<readonly [number, string]>,
): DevueltoPorProducto => new Map(entries.map(([id, d]) => [id, new Decimal(d)]));

describe("calcularReposicionNeta", () => {
  it("no devoluciones → every line unchanged (plain cancel regression guard)", () => {
    const lineas = [l(1, "10.000"), l(2, "5.500")];
    expect(calcularReposicionNeta(lineas, new Map())).toEqual([
      { productoId: 1, cantidad: "10.000" },
      { productoId: 2, cantidad: "5.500" },
    ]);
  });

  it("partial return → net reduces the line by the VIGENTE NC quantity", () => {
    const lineas = [l(1, "10.000")];
    expect(calcularReposicionNeta(lineas, devuelto([[1, "4.000"]]))).toEqual([
      { productoId: 1, cantidad: "6.000" },
    ]);
  });

  it("full return → the line is dropped (cancel skips repositioning it)", () => {
    const lineas = [l(1, "10.000"), l(2, "3.000")];
    expect(calcularReposicionNeta(lineas, devuelto([[1, "10.000"]]))).toEqual([
      { productoId: 2, cantidad: "3.000" },
    ]);
  });

  it("net ≤ 0 is dropped even if the objectionable amount were passed (no negative reposition)", () => {
    const lineas = [l(1, "10.000")];
    expect(calcularReposicionNeta(lineas, devuelto([[1, "12.000"]]))).toEqual([]);
  });

  it("multiple NCs sum: devuelto values are already cumulative totals", () => {
    const lineas = [l(1, "10.000"), l(2, "8.000")];
    expect(
      calcularReposicionNeta(lineas, devuelto([[1, "1.500"], [2, "8.000"]])),
    ).toEqual([{ productoId: 1, cantidad: "8.500" }]);
  });

  it("multi-line same product: the devuelto total nets ONCE against the aggregated sold total, not per line", () => {
    // The per-product devuelto is a TOTAL shared by every sale line of the
    // product; nets-per-line would under-credit (4+4=8) instead of 14.
    const lineas = [l(1, "10.000"), l(1, "10.000")];
    expect(calcularReposicionNeta(lineas, devuelto([[1, "6.000"]]))).toEqual([
      { productoId: 1, cantidad: "14.000" },
    ]);
  });

  it("multi-line output order follows FIRST APPEARANCE of each product", () => {
    const lineas = [l(3, "2.000"), l(1, "10.000"), l(3, "4.000")];
    expect(calcularReposicionNeta(lineas, new Map())).toEqual([
      { productoId: 3, cantidad: "6.000" },
      { productoId: 1, cantidad: "10.000" },
    ]);
  });

  it("both reposicion types count: a DANADO disposal reduces the net like a VENDIBLE return", () => {
    // The devuelto map is tipo-agnostic BY CALLER CONTRACT: the infrastructure
    // aggregates EVERY Linea of TipoReposicion of the factura's VIGENTE NCs, so
    // neither restocked (VENDIBLE) nor merma-disposed (DANADO) units are
    // re-credited (audit run-3 finding, product decision "solo reposición neta").
    const lineas = [l(1, "10.000"), l(2, "10.000")];
    expect(
      calcularReposicionNeta(lineas, devuelto([[1, "4.000"], [2, "4.000"]])),
    ).toEqual([
      { productoId: 1, cantidad: "6.000" },
      { productoId: 2, cantidad: "6.000" },
    ]);
  });

  it("fractional Decimal(12,3) quantities net exactly (no float)", () => {
    const lineas = [l(1, "3.500")];
    expect(calcularReposicionNeta(lineas, devuelto([[1, "1.250"]]))).toEqual([
      { productoId: 1, cantidad: "2.250" },
    ]);
  });
});
