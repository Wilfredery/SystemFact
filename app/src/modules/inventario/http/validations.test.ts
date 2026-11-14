/**
 * Zod contract of the movement history query (odd/tasks/inventario-historial.md S1/S4).
 * Shape only: the range rules (inverted, > 90 days) live in the domain.
 */

import { zListarMovimientosQuery } from "./validations";

describe("zListarMovimientosQuery", () => {
  it("defaults page 1 / limit 25 and leaves every filter undefined", () => {
    const r = zListarMovimientosQuery.parse({});
    expect(r).toEqual({ page: 1, limit: 25 });
  });

  it("accepts the full filter set and coerces numeric strings", () => {
    const r = zListarMovimientosQuery.parse({
      page: "2",
      limit: "50",
      tipo: "AJUSTE",
      producto: "  arroz  ",
      desde: "2026-11-01",
      hasta: "2026-11-14",
    });
    expect(r).toEqual({
      page: 2,
      limit: 50,
      tipo: "AJUSTE",
      producto: "arroz",
      desde: "2026-11-01",
      hasta: "2026-11-14",
    });
  });

  it("treats cleared form fields (empty string / null) as no filter", () => {
    const r = zListarMovimientosQuery.parse({ tipo: "", producto: "", desde: "", hasta: null });
    expect(r).toEqual({ page: 1, limit: 25 });
  });

  it("accepts every TipoMovimiento value and rejects anything else", () => {
    for (const tipo of [
      "ENTRADA_COMPRA",
      "SALIDA_VENTA",
      "ENTRADA_DEVOLUCION",
      "SALIDA_MERMA",
      "AJUSTE",
      "REPOSICION_CANCELACION",
      "SALIDA_CANCELACION_COMPRA",
    ]) {
      expect(zListarMovimientosQuery.safeParse({ tipo }).success).toBe(true);
    }
    expect(zListarMovimientosQuery.safeParse({ tipo: "ajuste" }).success).toBe(false);
    expect(zListarMovimientosQuery.safeParse({ tipo: "DROP" }).success).toBe(false);
  });

  it("enforces the pagination contract: page >= 1 integer, limit 1..100", () => {
    expect(zListarMovimientosQuery.safeParse({ page: 0 }).success).toBe(false);
    expect(zListarMovimientosQuery.safeParse({ page: 1.5 }).success).toBe(false);
    expect(zListarMovimientosQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(zListarMovimientosQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(zListarMovimientosQuery.safeParse({ limit: 100 }).success).toBe(true);
  });

  it("bounds the page so skip can never overflow a Postgres int4 offset input", () => {
    expect(zListarMovimientosQuery.safeParse({ page: 2147483647 }).success).toBe(true);
    expect(zListarMovimientosQuery.safeParse({ page: 2147483648 }).success).toBe(false);
  });

  it("limits the producto text to 100 characters", () => {
    expect(zListarMovimientosQuery.safeParse({ producto: "a".repeat(100) }).success).toBe(true);
    expect(zListarMovimientosQuery.safeParse({ producto: "a".repeat(101) }).success).toBe(false);
  });

  it("requires YYYY-MM-DD dates (shape only; calendar validity is the domain's)", () => {
    expect(zListarMovimientosQuery.safeParse({ desde: "2026-11-01" }).success).toBe(true);
    for (const d of ["14/11/2026", "2026-1-1", "2026-11-01T00:00:00Z", "hoy"]) {
      expect(zListarMovimientosQuery.safeParse({ desde: d }).success).toBe(false);
      expect(zListarMovimientosQuery.safeParse({ hasta: d }).success).toBe(false);
    }
  });
});
