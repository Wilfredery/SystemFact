/**
 * Unit — Caja domain close math (S5). No database.
 *
 * Pins the three figures the Cierre diario board shows (S1) as pure Decimal arithmetic over
 * strings: the cash corte (Efectivo esperado = Cobros en efectivo − Devoluciones en efectivo),
 * the method-agnostic total cobrado, and the diferencia (total cobrado − total facturado, kept
 * separate from the corte per docs and NEVER clamped — a negative diferencia is the point).
 */

import {
  calcularCorte,
  calcularDiferencia,
  calcularEfectivoEsperado,
  calcularTotalCobrado,
  type GrupoCobroMetodo,
} from "./cierre";

describe("calcularEfectivoEsperado — Cobros en efectivo − Devoluciones en efectivo", () => {
  it("subtracts the cash refunds from the cash receipts", () => {
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "1000.00", devolucionesEfectivo: "250.50" }),
    ).toBe("749.50");
  });

  it("a refunds-free day expects exactly the cash collected", () => {
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "5000.00", devolucionesEfectivo: "0.00" }),
    ).toBe("5000.00");
  });

  it("a day with no cash movement at all is 0.00", () => {
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "0.00", devolucionesEfectivo: "0.00" }),
    ).toBe("0.00");
  });

  it("preserves a NEGATIVE esperado when refunds exceed receipts (never clamped)", () => {
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "100.00", devolucionesEfectivo: "150.00" }),
    ).toBe("-50.00");
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "0.00", devolucionesEfectivo: "150.25" }),
    ).toBe("-150.25");
  });

  it("rounds half-up to 2 decimals", () => {
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "10.005", devolucionesEfectivo: "0.00" }),
    ).toBe("10.01");
    // 10.00 − 0.015 = 9.985 → half-up at 2 dp → 9.99.
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "10.00", devolucionesEfectivo: "0.015" }),
    ).toBe("9.99");
    // 10.00 − 0.005 = 9.995 → half-up at 2 dp → 10.00.
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "10.00", devolucionesEfectivo: "0.005" }),
    ).toBe("10.00");
  });

  it("keeps big money exact beyond JS number precision", () => {
    expect(
      calcularEfectivoEsperado({
        cobrosEfectivo: "1234567890123.45",
        devolucionesEfectivo: "0.00",
      }),
    ).toBe("1234567890123.45");
    expect(
      calcularEfectivoEsperado({
        cobrosEfectivo: "1234567890123.45",
        devolucionesEfectivo: "1234567890000.00",
      }),
    ).toBe("123.45");
  });

  it("normalises the emitted scale to 2 decimals", () => {
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "1000", devolucionesEfectivo: "250.5" }),
    ).toBe("749.50");
  });

  it("never prints -0.00", () => {
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "0.004", devolucionesEfectivo: "0.00" }),
    ).toBe("0.00");
    expect(
      calcularEfectivoEsperado({ cobrosEfectivo: "0.00", devolucionesEfectivo: "0.001" }),
    ).toBe("0.00");
  });
});

describe("calcularTotalCobrado — Σ cobros across the provided method groups", () => {
  it("sums every method group, not only cash (method-agnostic)", () => {
    const grupos: GrupoCobroMetodo[] = [
      { metodo: "EFECTIVO", cobros: "100.00" },
      { metodo: "TARJETA", cobros: "50.25" },
      { metodo: "TRANSFERENCIA", cobros: "9.75" },
    ];
    expect(calcularTotalCobrado(grupos)).toBe("160.00");
  });

  it("is EFECTIVO-only today (a single group) and rounds half-up", () => {
    expect(calcularTotalCobrado([{ metodo: "EFECTIVO", cobros: "10.005" }])).toBe("10.01");
  });

  it("an empty group list is 0.00 (zero-day)", () => {
    expect(calcularTotalCobrado([])).toBe("0.00");
  });

  it("does not care what the method is called (no name matching)", () => {
    expect(
      calcularTotalCobrado([
        { metodo: "OTRO_FUTURO", cobros: "1.10" },
        { metodo: "OTRO_FUTURO", cobros: "2.20" },
      ]),
    ).toBe("3.30");
  });

  it("preserves big money across groups", () => {
    expect(
      calcularTotalCobrado([
        { metodo: "EFECTIVO", cobros: "999999999999.99" },
        { metodo: "TARJETA", cobros: "0.01" },
      ]),
    ).toBe("1000000000000.00");
  });
});

describe("calcularDiferencia — total cobrado − total facturado", () => {
  it("is positive when more was collected than invoiced", () => {
    expect(calcularDiferencia({ totalCobrado: "1200.00", totalFacturado: "1000.00" })).toBe(
      "200.00",
    );
  });

  it("preserves a NEGATIVE diferencia (under-collection is a real signal, never clamped)", () => {
    expect(calcularDiferencia({ totalCobrado: "1000.00", totalFacturado: "1200.00" })).toBe(
      "-200.00",
    );
  });

  it("a fully collected day is 0.00", () => {
    expect(calcularDiferencia({ totalCobrado: "1000.00", totalFacturado: "1000.00" })).toBe(
      "0.00",
    );
  });

  it("a zero day is 0.00", () => {
    expect(calcularDiferencia({ totalCobrado: "0.00", totalFacturado: "0.00" })).toBe("0.00");
  });

  it("does not fold the corte (refunds) into the diferencia", () => {
    // The diferencia is cobrado − facturado; a refund-heavy day can be negative on its own.
    expect(calcularDiferencia({ totalCobrado: "250.00", totalFacturado: "1000.00" })).toBe(
      "-750.00",
    );
  });

  it("keeps big money exact", () => {
    expect(
      calcularDiferencia({
        totalCobrado: "1234567890123.45",
        totalFacturado: "1234567890000.00",
      }),
    ).toBe("123.45");
  });

  it("never prints -0.00", () => {
    expect(calcularDiferencia({ totalCobrado: "0.001", totalFacturado: "0.00" })).toBe("0.00");
  });
});

describe("calcularCorte — the Corte de caja struct", () => {
  it("carries Cobros / Devoluciones / Esperado straight from the formula", () => {
    expect(
      calcularCorte({ cobrosEfectivo: "1000.00", devolucionesEfectivo: "250.50" }),
    ).toEqual({ cobros: "1000.00", devoluciones: "250.50", esperado: "749.50" });
  });

  it("a zero day is all zeros at the 2-decimal scale", () => {
    expect(calcularCorte({ cobrosEfectivo: "0.00", devolucionesEfectivo: "0.00" })).toEqual({
      cobros: "0.00",
      devoluciones: "0.00",
      esperado: "0.00",
    });
  });

  it("keeps esperado = cobros − devoluciones when refunds exceed receipts", () => {
    expect(
      calcularCorte({ cobrosEfectivo: "100.00", devolucionesEfectivo: "150.00" }),
    ).toEqual({ cobros: "100.00", devoluciones: "150.00", esperado: "-50.00" });
  });

  it("normalises both input scales to 2 decimals", () => {
    expect(calcularCorte({ cobrosEfectivo: "1000", devolucionesEfectivo: "250.5" })).toEqual({
      cobros: "1000.00",
      devoluciones: "250.50",
      esperado: "749.50",
    });
  });
});
