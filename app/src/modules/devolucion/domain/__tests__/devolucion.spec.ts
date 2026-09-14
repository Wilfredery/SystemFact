/**
 * Unit — pure devolucion (B04 Nota de Crédito) domain rules (tasks 1.1 / 1.10).
 *
 * Covers R-D2 (return window via the INJECTED clock, SD calendar day, never a
 * raw UTC-instant compare), R-D3 (CUMULATIVE returned-quantity cap), R-D4
 * (frozen VENDIBLE/DANADO classification) and R-D5 (NC totals, sums of rounded
 * per-line values, parity with the venta calculators). No database, no Prisma:
 * the domain is pure (ADR-013).
 */

import { Decimal } from "decimal.js";
import {
  CANTIDAD_EXCEDE_ORIGINAL,
  DEVOLUCION_FUERA_DE_PLAZO,
  FACTURA_NO_VIGENTE,
  LINEA_INVALIDA,
  VENTA_NO_CONFIRMADA,
  TIPO_REPOSICION,
  validarPlazoDevolucion,
  validarCantidadDevuelta,
  validarReturnType,
  calcularTotalesNotaCredito,
  type TipoReposicion,
} from "../devolucion";

describe("devolucion — re-exported stable codes (single venta catalog, R-V13)", () => {
  it("exposes the 4 frozen return codes with their task-1.5 identifiers", () => {
    expect(DEVOLUCION_FUERA_DE_PLAZO).toBe("DEVOLUCION_FUERA_DE_PLAZO");
    expect(CANTIDAD_EXCEDE_ORIGINAL).toBe("CANTIDAD_EXCEDE_ORIGINAL");
    expect(FACTURA_NO_VIGENTE).toBe("FACTURA_NO_VIGENTE");
    expect(VENTA_NO_CONFIRMADA).toBe("VENTA_NO_CONFIRMADA");
  });
});

describe("devolucion — validarPlazoDevolucion (R-D2, SD calendar-day window)", () => {
  // fechaVenta SD date 2026-09-01; plazo 15 ⇒ boundary SD date 2026-09-16.
  const fechaVenta = new Date("2026-09-01T12:00:00.000Z");

  it("accepts a return strictly inside the window", () => {
    expect(() =>
      validarPlazoDevolucion(fechaVenta, 15, new Date("2026-09-10T15:00:00.000Z")),
    ).not.toThrow();
  });

  it("boundary SD day is still valid even when a raw UTC compare would expire it", () => {
    // limite instant = 2026-09-16T12:00Z. now 2026-09-17T02:30Z is AFTER the
    // limite instant, but its SD date is still 2026-09-16 (UTC-4) ⇒ valid.
    const now = new Date("2026-09-17T02:30:00.000Z");
    expect(now.getTime()).toBeGreaterThan(
      new Date(fechaVenta.getTime() + 15 * 86_400_000).getTime(),
    );
    expect(() => validarPlazoDevolucion(fechaVenta, 15, now)).not.toThrow();
  });

  it("rejects a return whose SD date is past the boundary day (code 601)", () => {
    // 2026-09-17T04:30Z ⇒ SD 2026-09-17 ⇒ the 16th is already gone.
    const now = new Date("2026-09-17T04:30:00.000Z");
    expect(() => validarPlazoDevolucion(fechaVenta, 15, now)).toThrow(
      expect.objectContaining({ code: DEVOLUCION_FUERA_DE_PLAZO }),
    );
  });

  it("uses the SD calendar day, not the UTC day (injected clock)", () => {
    // Both instants share the SAME UTC day (2026-09-17). The first is still
    // 2026-09-16 in Santo Domingo (UTC-4) ⇒ inside the window; the second has
    // crossed into SD 2026-09-17 ⇒ outside. A raw UTC-day compare can never
    // distinguish them.
    expect(() =>
      validarPlazoDevolucion(fechaVenta, 15, new Date("2026-09-17T01:00:00.000Z")),
    ).not.toThrow(); // SD 2026-09-16 21:00 = boundary day, still valid
    expect(() =>
      validarPlazoDevolucion(fechaVenta, 15, new Date("2026-09-17T05:00:00.000Z")),
    ).toThrow(expect.objectContaining({ code: DEVOLUCION_FUERA_DE_PLAZO })); // SD 09-17
  });

  it("rejects a degenerative config plazo (negative / non-integer) as a defect", () => {
    expect(() =>
      validarPlazoDevolucion(fechaVenta, -1, new Date("2026-09-10T15:00:00.000Z")),
    ).toThrow(Error);
    expect(() =>
      validarPlazoDevolucion(fechaVenta, 7.5, new Date("2026-09-10T15:00:00.000Z")),
    ).toThrow(Error);
  });
});

describe("devolucion — validarCantidadDevuelta (R-D3, CUMULATIVE cap)", () => {
  it("accepts when cumulative (prior + new) stays at or under the original", () => {
    expect(() =>
      validarCantidadDevuelta(new Decimal(1), new Decimal(5), new Decimal(3)),
    ).not.toThrow(); // 3 prior + 1 new = 4 ≤ 5
    expect(() =>
      validarCantidadDevuelta(new Decimal(2), new Decimal(5), new Decimal(3)),
    ).not.toThrow(); // 3 + 2 = 5 = original: exactly at the cap
  });

  it("rejects when the cumulative would exceed the original sold quantity (code 602)", () => {
    // 3 already returned across prior NCs + 3 more = 6 > 5 sold.
    expect(() =>
      validarCantidadDevuelta(new Decimal(3), new Decimal(5), new Decimal(3)),
    ).toThrow(expect.objectContaining({ code: CANTIDAD_EXCEDE_ORIGINAL }));
  });

  it("no prior returns ⇒ the full original quantity is available", () => {
    expect(() =>
      validarCantidadDevuelta(new Decimal(5), new Decimal(5), new Decimal(0)),
    ).not.toThrow();
    expect(() =>
      validarCantidadDevuelta(new Decimal("5.001"), new Decimal(5), new Decimal(0)),
    ).toThrow(expect.objectContaining({ code: CANTIDAD_EXCEDE_ORIGINAL }));
  });

  it("rejects a zero/negative requested quantity with the same stable code", () => {
    expect(() =>
      validarCantidadDevuelta(new Decimal(0), new Decimal(5), new Decimal(0)),
    ).toThrow(expect.objectContaining({ code: CANTIDAD_EXCEDE_ORIGINAL }));
    expect(() =>
      validarCantidadDevuelta(new Decimal(-1), new Decimal(5), new Decimal(0)),
    ).toThrow(expect.objectContaining({ code: CANTIDAD_EXCEDE_ORIGINAL }));
  });
});

describe("devolucion — validarReturnType (R-D4, frozen VENDIBLE/DANADO)", () => {
  it("accepts both frozen classifications", () => {
    expect(() => validarReturnType(TIPO_REPOSICION.VENDIBLE)).not.toThrow();
    expect(() => validarReturnType(TIPO_REPOSICION.DANADO)).not.toThrow();
  });

  it("rejects anything outside the frozen enum (fail loud, never coerce)", () => {
    expect(() => validarReturnType("REPARABLE")).toThrow(
      expect.objectContaining({ code: LINEA_INVALIDA }),
    );
    expect(() => validarReturnType("")).toThrow(
      expect.objectContaining({ code: LINEA_INVALIDA }),
    );
  });
});

describe("devolucion — calcularTotalesNotaCredito (R-D5, frozen NC totals)", () => {
  it("sums rounded per-line subtotals and ITBIS across mixed rates", () => {
    const lineas = [
      {
        productoId: 1,
        cantidad: "2.000",
        precioUnitario: "10.50",
        tasaItbis: "18",
        tipoReposicion: TIPO_REPOSICION.VENDIBLE,
      },
      {
        productoId: 2,
        cantidad: "1.000",
        precioUnitario: "5.00",
        tasaItbis: "0",
        tipoReposicion: TIPO_REPOSICION.DANADO,
      },
    ];
    // sub1 = round2(2 × 10.50) = 21.00 ; itbis1 = round2(21 × 18/100) = 3.78
    // sub2 = round2(1 × 5.00)  = 5.00  ; itbis2 = 0.00
    expect(calcularTotalesNotaCredito(lineas)).toEqual({
      monto: "26.00",
      itbis: "3.78",
      // Per-line values are the exact columns persisted in DETALLE_NOTA_CREDITO.
      lineas: [
        { productoId: 1, subtotalLinea: "21.00", itbisLinea: "3.78" },
        { productoId: 2, subtotalLinea: "5.00", itbisLinea: "0.00" },
      ],
    });
  });

  it("rounds ITBIS half-up per line (sum of ROUNDED values, not unrounded)", () => {
    const lineas = [
      {
        productoId: 1,
        cantidad: "3.000",
        precioUnitario: "10.99",
        tasaItbis: "16",
        tipoReposicion: TIPO_REPOSICION.VENDIBLE,
      },
    ];
    // sub = round2(3 × 10.99) = 32.97 ; itbis = round2(32.97 × 16/100) = round2(5.2752) = 5.28
    expect(calcularTotalesNotaCredito(lineas)).toEqual({
      monto: "32.97",
      itbis: "5.28",
      lineas: [{ productoId: 1, subtotalLinea: "32.97", itbisLinea: "5.28" }],
    });
  });

  it("any empty line set yields a zero NC (no lines ⇒ no efectos)", () => {
    expect(calcularTotalesNotaCredito([])).toEqual({
      monto: "0.00",
      itbis: "0.00",
      lineas: [],
    });
  });

  it("rejects malformed lines with LINEA_INVALIDA before any arithmetic", () => {
    expect(() =>
      calcularTotalesNotaCredito([
        {
          productoId: 1,
          cantidad: "0.000",
          precioUnitario: "10.50",
          tasaItbis: "18",
          tipoReposicion: TIPO_REPOSICION.VENDIBLE,
        },
      ]),
    ).toThrow(expect.objectContaining({ code: LINEA_INVALIDA }));

    expect(() =>
      calcularTotalesNotaCredito([
        {
          productoId: 1,
          cantidad: "2.000",
          precioUnitario: "-1.00",
          tasaItbis: "18",
          tipoReposicion: TIPO_REPOSICION.VENDIBLE,
        },
      ]),
    ).toThrow(expect.objectContaining({ code: LINEA_INVALIDA }));

    expect(() =>
      calcularTotalesNotaCredito([
        {
          productoId: 1,
          cantidad: "2.000",
          precioUnitario: "10.50",
          tasaItbis: "25",
          tipoReposicion: TIPO_REPOSICION.VENDIBLE,
        },
      ]),
    ).toThrow(expect.objectContaining({ code: LINEA_INVALIDA }));

    // A string outside the frozen enum, forced through the type boundary — the
    // runtime validator must reject it BEFORE it can be anything else.
    const tipoReposicionInvalido = "EXTRAVIADO" as unknown as TipoReposicion;
    expect(() =>
      calcularTotalesNotaCredito([
        {
          productoId: 1,
          cantidad: "2.000",
          precioUnitario: "10.50",
          tasaItbis: "18",
          tipoReposicion: tipoReposicionInvalido,
        },
      ]),
    ).toThrow(expect.objectContaining({ code: LINEA_INVALIDA }));
  });
});